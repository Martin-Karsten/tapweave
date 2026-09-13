import { Engine_Bridge, type Session_Output } from './engine-bridge.js';
import { Selection_Controller, type Active_Selection } from './selection.js';
import { Audio_Playback } from './audio-playback.js';
import { Gameplay_Frame } from './gameplay-frame.js';
import { Gameplay_Input } from './gameplay-input.js';
import { Renderer } from './renderer.js';
import { SESSION_STATE, ALL_VOICE_COMMAND_FAMILIES } from './abi-records.js';
import { Browser_Error, require_condition } from './errors.js';
import type { Diagnostics_Service } from './diagnostics.js';

export type Gameplay_State = 'loading' | 'ready' | 'starting' | 'running' | 'paused' | 'recovering' | 'terminal' | 'disposed';
export interface Gameplay_View {
  readonly state: Gameplay_State;
  readonly can_play: boolean;
  readonly can_resume: boolean;
  readonly can_retry: boolean;
  readonly recovery: Readonly<Record<string, unknown>> | null;
  readonly in_attempt: boolean;
  readonly message: string;
  readonly error: unknown;
  readonly result: Session_Output | null;
}
export interface Gameplay_Options {
  on_change?: (view: Gameplay_View) => void;
  create_renderer?: (...arguments_: ConstructorParameters<typeof Renderer>) => Renderer;
  request_frame?: (callback: FrameRequestCallback) => number;
  cancel_frame?: (identifier: number) => void;
  sample_audio?: () => number;
  diagnostics?: Diagnostics_Service | null;
  on_frame?: () => void;
}

// Product lifecycle only. Engine records remain the authority for gameplay/results.
export class Gameplay_Controller {
  private state: Gameplay_State = 'ready';
  private message = 'Open a local beatmap to begin.';
  private error: unknown = null;
  private recovery_details: Readonly<Record<string, unknown>> | null = null;
  private result: Session_Output | null = null;
  private generation = 0;
  private listeners = new AbortController();
  private prepared_selection: Active_Selection | null = null;
  private session_handle: bigint | null = null;
  private playback: Audio_Playback | null = null;
  private renderer: Renderer | null = null;
  private frame: Gameplay_Frame | null = null;
  private input: Gameplay_Input | null = null;
  private in_attempt = false;
  private terminal_draining = false;
  private graphics_lost = false;
  private restoration_timer: ReturnType<typeof setTimeout> | null = null;
  private readonly sample_audio: () => number;
  private readonly diagnostics: Diagnostics_Service | null;

  constructor(readonly engine: Engine_Bridge, readonly selection: Selection_Controller,
    readonly context: AudioContext, readonly canvas: HTMLCanvasElement, readonly options: Gameplay_Options = {}) {
    this.sample_audio = options.sample_audio ?? (() => this.context.currentTime);
    this.diagnostics = options.diagnostics ?? null;
    selection.on_change = () => this.selection_changed();
    const signal = this.listeners.signal;
    const document = canvas.ownerDocument;
    const window = document.defaultView!;
    window.addEventListener('blur', () => this.pause('Window lost focus.'), { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause('Page is hidden.');
    }, { signal });
    context.addEventListener('statechange', () => {
      if (context.state !== 'running') {
        this.diagnostics?.note_audio_interruption('Audio output was interrupted.',
          { audio_state: context.state, lifecycle_state: this.state });
        this.pause('Audio output was interrupted.');
      }
    }, { signal });
    canvas.addEventListener('webglcontextrestored', () => {
      this.diagnostics?.note_graphics_event('info', 'Graphics context restored by the browser.');
      // The resource owner's listener clears its loss flag first; restoration
      // publication is deferred and guarded against replacement/disposal.
      const generation = this.generation;
      if (this.restoration_timer !== null) clearTimeout(this.restoration_timer);
      this.restoration_timer = setTimeout(() => {
        this.restoration_timer = null;
        if (generation !== this.generation || !this.renderer || this.state === 'disposed') return;
        try {
          this.renderer.restore();
          this.graphics_lost = false;
          this.diagnostics?.note_graphics_event('info', 'Graphics resources republished after restoration.');
          if (this.playback?.state === 'paused') this.state = 'paused';
          if (this.state !== 'terminal') this.message = this.#restoration_message();
          this.publish();
        } catch (error) { this.recover(error); }
      }, 0);
    }, { signal });
    window.addEventListener('pagehide', event => {
      if (event.persisted) this.pause('Page restored: resume when ready.');
      else this.dispose();
    }, { signal });
    window.addEventListener('pageshow', () => this.publish(), { signal });
    this.selection_changed();
  }

  get view(): Gameplay_View {
    const graphics_usable = !!this.renderer?.ready && !this.graphics_lost;
    return Object.freeze({ state: this.state,
      can_play: this.state === 'ready' && !!this.playback && graphics_usable,
      can_resume: this.state === 'paused' && this.playback?.state === 'paused' && graphics_usable,
      can_retry: this.in_attempt && this.state !== 'starting' && this.state !== 'disposed' && graphics_usable,
      recovery: this.recovery_details, in_attempt: this.in_attempt, message: this.message, error: this.error, result: this.result });
  }

  private publish() {
    this.diagnostics?.update_resources({ map_handles: this.engine.map_handles.size,
      session_handles: this.engine.session_handles.size,
      wasm_pages: this.engine.wasm.memory.buffer.byteLength / 65536,
      input_queue_depth: this.frame?.input.records.length ?? 0,
      audio_pending: this.playback?.audio.pending.length ?? 0,
      audio_voices: this.playback?.audio.voices.size ?? 0,
      audio_retiring_voices: this.playback?.audio.retiring_voices.size ?? 0,
      audio_dispatched: this.playback?.audio.metrics.dispatched ?? 0,
      audio_dropped: this.playback?.audio.metrics.dropped ?? 0,
      audio_stale: this.playback?.audio.metrics.stale ?? 0,
      draw_instances: this.renderer?.gpu.metrics.instances ?? 0,
      draw_batches: this.renderer?.gpu.metrics.commands ?? 0,
      static_uploads: this.renderer?.gpu.upload_count ?? 0,
      dynamic_bytes: this.renderer?.gpu.metrics.dynamic_bytes ?? 0 });
    this.options.on_change?.(this.view);
  }

  private selection_changed() {
    if (this.state === 'disposed') return;
    if (this.selection.state === 'loading') {
      this.release_attempt();
      this.state = 'loading';
      this.message = 'Preparing beatmap and audio…';
      this.publish();
      return;
    }
    if (this.selection.active !== this.prepared_selection || !this.playback) this.prepare();
    if (this.selection.error) {
      this.error = this.selection.error;
      this.message = `${this.selection.error.message} Previous selection remains available.`;
    }
    this.publish();
  }

  private prepare() {
    this.release_attempt();
    this.state = 'ready';
    this.error = null;
    this.recovery_details = null;
    this.result = null;
    const active = this.selection.active;
    this.message = 'Open a local beatmap to begin.';
    if (!active) return;
    try {
      require_condition(active.music_buffer && active.samples, 'MISSING_ASSET',
        active.music_error ?? 'Music and sample preparation must finish before Play.');
      require_condition(this.context.state !== 'closed', 'INVALID_STATE', 'Audio output is closed. Reload the page.');
      this.#require_complete_protocols();
      this.engine.scene_capabilities();
      this.session_handle = this.engine.create_session(active.map_handle);
      this.prepared_selection = active;
      this.diagnostics?.note_session_context(this.session_handle.toString(), null, null);
      this.diagnostics?.record_event('lifecycle', 'info', 'session_created',
        `Session prepared for ${active.filename}.`, { session_handle: this.session_handle.toString(),
          map_handle: active.map_handle.toString() });
      this.create_playback();
      const epoch = Number(this.engine.snapshot(this.session_handle, 0).summary.epoch);
      this.renderer = (this.options.create_renderer ?? ((...arguments_) => new Renderer(...arguments_)))(
        this.engine, this.session_handle, active.map_handle, this.canvas, epoch, () => {
          this.graphics_lost = true;
          this.diagnostics?.note_graphics_event('error', 'Graphics context lost. Waiting for restoration.',
            { lifecycle_state: this.state });
          this.pause('Graphics context lost. Waiting for restoration.');
          if (this.state !== 'terminal') this.message = 'Graphics context lost. Waiting for restoration.';
          this.publish();
        });
      this.message = active.samples.warnings.length ? `Ready. ${active.samples.warnings.length} sample warning(s); see diagnostics.` : 'Ready to play.';
    } catch (error) {
      this.release_attempt();
      this.error = error;
      this.message = error instanceof Error ? error.message : String(error);
    }
  }

  // Reject engines lacking the gameplay, scene and audio protocol surface.
  #require_complete_protocols() {
    const simulation = this.engine.simulation_capabilities;
    const output = this.engine.output_capabilities;
    require_condition(simulation.simulation_version === 1 && simulation.rules_version === 1 &&
      simulation.flags === 1 && simulation.max_inputs >= 8192 &&
      output.compact_version === 1 && output.flags === 0 && output.reserved === 0 &&
      this.engine.transport_capabilities.voice_command_mask === ALL_VOICE_COMMAND_FAMILIES,
    'UNSUPPORTED', 'Complete gameplay, scene and audio protocols are required.');
  }

  #restoration_message() {
    if (this.state === 'paused') return 'Graphics restored. Resume when ready.';
    return this.in_attempt ? 'Graphics restored. Retry or return to selection.' : 'Ready to play.';
  }

  private create_playback(reuse_voice_storage = false) {
    this.playback = new Audio_Playback(this.engine, this.session_handle!, this.context, this.prepared_selection!, {}, reuse_voice_storage, this.diagnostics);
    this.frame = new Gameplay_Frame(this.playback, (time_ms, output) => {
      const bounds = this.canvas.getBoundingClientRect();
      this.renderer!.render(time_ms, { css_left: bounds.left, css_top: bounds.top,
        css_width: bounds.width, css_height: bounds.height,
        device_pixel_ratio: this.canvas.ownerDocument.defaultView!.devicePixelRatio }, output.summary.epoch);
      // Diagnostic UI refresh rides the existing frame driver; no scheduler is
      // added and the callback itself never touches gameplay state.
      this.options.on_frame?.();
    }, 8192, this.options.request_frame, this.options.cancel_frame,
      { diagnostics: this.diagnostics,
        frame_metrics: () => ({ instances: this.renderer?.gpu.metrics.instances ?? 0,
          batches: this.renderer?.gpu.metrics.commands ?? 0, gpu_ms: this.renderer?.gpu.metrics.gpu_ms ?? null }) });
    this.frame.on_error = error => this.recover(error);
    this.frame.on_terminal = () => this.terminal();
    this.frame.on_terminal_frame = () => this.drain_terminal();
  }

  async play() {
    if (!this.view.can_play) return;
    this.in_attempt = true;
    this.diagnostics?.begin_attempt();
    await this.start();
  }

  async resume() {
    if (!this.view.can_resume) return;
    await this.start();
  }

  private async start() {
    const generation = ++this.generation;
    const playback = this.playback!;
    this.state = 'starting';
    this.message = 'Starting audio…';
    this.publish();
    try {
      await playback.start(0);
      if (generation !== this.generation) return;
      require_condition(this.renderer?.ready && !this.graphics_lost, 'INVALID_STATE', 'Graphics are not ready.');
      this.state = 'running';
      this.message = 'Z / X or mouse buttons · Escape to pause';
      this.input = new Gameplay_Input(this.canvas, this.frame!, this.sample_audio, reason => this.pause(reason), false);
      this.frame!.start();
      this.publish();
    } catch (error) {
      if (generation === this.generation) this.recover(error);
    }
  }

  pause(reason = 'Paused.') {
    if (this.state === 'disposed') return;
    if (this.state === 'terminal') { this.finish_terminal(); return; }
    if (this.state === 'starting') {
      this.recover(new Browser_Error('START_INTERRUPTED', `${reason} Retry when ready.`));
      return;
    }
    if (this.state !== 'running') return;
    this.frame!.stop();
    this.input?.dispose();
    this.input = null;
    try {
      this.frame!.drain();
      const state = this.playback!.pause();
      this.frame!.input.held_sources.clear();
      this.frame!.input.focus_epoch++;
      this.diagnostics?.note_lifecycle(`Paused: ${reason}`, { engine_state: state });
      if (state === SESSION_STATE.PASSED || state === SESSION_STATE.FAILED) {
        this.terminal();
        if (this.terminal_draining) this.frame!.start();
        return;
      }
      this.state = 'paused';
      this.message = reason;
      this.publish();
    } catch (error) { this.recover(error); }
  }

  private terminal() {
    if (this.result || !this.session_handle) return;
    this.result = this.engine.result(this.session_handle);
    this.input?.dispose();
    this.input = null;
    this.frame!.terminal = true;
    this.state = 'terminal';
    this.message = this.result.summary.state === SESSION_STATE.PASSED ? 'Passed' : 'Failed';
    this.diagnostics?.note_lifecycle(`Run complete: ${this.message}.`,
      { state: Number(this.result.summary.state), score: this.result.summary.score.toString(),
        accuracy: Number(this.result.summary.accuracy), highest_combo: Number(this.result.summary.highest_combo) });
    this.terminal_draining = this.result.summary.state === SESSION_STATE.PASSED && this.context.state === 'running';
    if (!this.terminal_draining || !this.playback!.pending_sounds) this.finish_terminal();
    this.publish();
  }

  private drain_terminal() {
    if (!this.terminal_draining) return;
    this.playback!.audio.pump();
    if (!this.playback!.pending_sounds) this.finish_terminal();
  }

  private finish_terminal() {
    this.terminal_draining = false;
    this.frame?.stop();
    this.playback?.finish();
  }

  recover(error: unknown) {
    if (this.state === 'disposed' || this.state === 'recovering') return;
    this.generation++;
    // Playback context is captured before recovery cleanup runs; the engine
    // failure itself was already recorded by its owning layer.
    const playback_failure = this.playback?.failure_context() ?? { last_committed_ms: this.playback?.last_committed_ms,
      audio_seconds: this.context.currentTime, audio_state: this.context.state, receipt_ms: performance.now() };
    this.recovery_details = Object.freeze({ pending_input_count: this.frame?.input.records.length ?? 0,
      pending_input_preview: this.frame?.input.records.slice(0, 16).map(record => ({ ...record })) ?? [],
      session_handle: this.session_handle, clock_mapping: this.playback?.clock.session_mapping,
      error_code: error instanceof Browser_Error ? error.code : null,
      error_message: error instanceof Error ? error.message : String(error),
      error_stack: error instanceof Error ? error.stack : null,
      error_details: error instanceof Browser_Error ? structuredClone(error.details) : null,
      playback: playback_failure,
      lifecycle_state: this.state, document_hidden: this.canvas.ownerDocument.hidden,
      captured_at: new Date().toISOString() });
    this.diagnostics?.record_event('lifecycle', 'error', 'recover',
      `${error instanceof Error ? error.message : String(error)} Retry or return to selection.`,
      { ...playback_failure, error_stack: error instanceof Error ? error.stack : null });
    this.frame?.stop();
    this.input?.dispose();
    this.input = null;
    this.terminal_draining = false;
    this.playback?.recover(error);
    this.state = 'recovering';
    this.error = error;
    this.message = `${error instanceof Error ? error.message : String(error)} Retry or return to selection.`;
    this.publish();
  }

  async retry() {
    if (!this.view.can_retry) return;
    this.generation++;
    this.stop_owners();
    this.result = null;
    this.error = null;
    this.recovery_details = null;
    try {
      require_condition(this.session_handle && this.renderer?.ready && !this.graphics_lost,
        'INVALID_STATE', 'Wait for graphics restoration before retrying.');
      this.engine.reset_session(this.session_handle);
      this.create_playback(true);
      this.state = 'ready';
    } catch {
      this.prepare();
      this.in_attempt = true;
    }
    if (this.view.can_play) await this.play();
    else {
      this.state = 'recovering';
      this.publish();
    }
  }

  back() {
    if (this.state === 'disposed') return;
    this.prepare();
    this.publish();
  }

  async load_files(files: File[]) {
    if (this.state === 'disposed') return;
    this.release_attempt();
    await this.selection.load_files(files);
  }

  async select_map(filename: string) {
    if (this.state === 'disposed') return;
    this.release_attempt();
    await this.selection.select_map(filename);
  }

  private stop_owners() {
    this.frame?.stop();
    this.input?.dispose();
    this.input = null;
    this.playback?.dispose();
    this.playback = null;
    this.frame = null;
    this.terminal_draining = false;
  }

  private release_attempt() {
    this.generation++;
    if (this.restoration_timer !== null) clearTimeout(this.restoration_timer);
    this.restoration_timer = null;
    this.stop_owners();
    this.renderer?.dispose();
    this.renderer = null;
    if (this.session_handle) {
      this.diagnostics?.record_event('lifecycle', 'info', 'session_release', null,
        { session_handle: this.session_handle.toString() });
      try { this.engine.release_session(this.session_handle); } catch { /* Invalid sessions are already unusable. */ }
    }
    this.session_handle = null;
    this.prepared_selection = null;
    this.in_attempt = false;
    this.graphics_lost = false;
  }

  dispose() {
    if (this.state === 'disposed') return;
    this.release_attempt();
    this.listeners.abort();
    this.selection.dispose();
    this.engine.dispose();
    void this.context.close().catch(() => {});
    this.state = 'disposed';
    this.publish();
  }
}
