import { Resume_Gate, mapped_sources } from './resume-gate.js';
import { Held_Input } from './held-input.js';
import { DEFAULT_PLAYER_SETTINGS, gameplay_control_hint, gameplay_accessible_label, type Gameplay_Input_Settings } from './player-settings.js';
import { Engine_Bridge, type Session_Output } from './engine-bridge.js';
import { Selection_Controller, type Active_Selection } from './selection.js';
import { Audio_Playback } from './audio-playback.js';
import type { Audio_Clock } from './clock.js';
import { Gameplay_Frame } from './gameplay-frame.js';
import { Gameplay_Input } from './gameplay-input.js';
import { Renderer } from './renderer.js';
import { SESSION_STATE, ALL_VOICE_COMMAND_FAMILIES } from './abi-records.js';
import { Browser_Error, require_condition } from './errors.js';
import type { Diagnostics_Service } from './diagnostics.js';

export type Gameplay_State = 'loading' | 'ready' | 'starting' | 'running' | 'resuming' | 'paused' | 'recovering' | 'terminal' | 'disposed';
export interface Gameplay_View {
  readonly state: Gameplay_State;
  readonly can_play: boolean;
  readonly can_resume: boolean;
  readonly can_retry: boolean;
  readonly can_watch_replay: boolean;
  readonly watching_replay: boolean;
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
  input_settings?: () => Gameplay_Input_Settings;
  outputs?: { music?: AudioNode; effects?: AudioNode };
}

// A finished run, retained independently of the active session: the owned
// result record plus the exported TWREPLAY container captured while the
// producing session was still terminal. Save and watch always serve this
// record, so they keep working after the session is reset, re-prepared or
// released.
export interface Completed_Run {
  readonly result: Session_Output;
  readonly replay_bytes: Uint8Array;
}

// Product lifecycle only. Engine records remain the authority for gameplay/results.
export class Gameplay_Controller {
  private state: Gameplay_State = 'ready';
  private message = 'Open a local beatmap to begin.';
  private error: unknown = null;
  private recovery_details: Readonly<Record<string, unknown>> | null = null;
  private completed_run: Completed_Run | null = null;
  private generation = 0;
  private listeners = new AbortController();
  private prepared_selection: Active_Selection | null = null;
  private session_handle: bigint | null = null;
  private playback: Audio_Playback | null = null;
  private renderer: Renderer | null = null;
  private frame: Gameplay_Frame | null = null;
  private input: Gameplay_Input | null = null;
  private resume_gate: Resume_Gate | null = null;
  private paused_cursor_flags = 0;
  private paused_sources = new Map<string, number>();
  private in_attempt = false;
  private terminal_draining = false;
  private graphics_lost = false;
  private watching_replay = false;
  private restoration_timer: ReturnType<typeof setTimeout> | null = null;
  private readonly held_input: Held_Input;
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
    this.held_input = new Held_Input(window);
    window.addEventListener('blur', () => {
      this.pause('Window lost focus.');
      this.paused_cursor_flags = 0;
    }, { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.pause('Page is hidden.'); this.paused_cursor_flags = 0; }
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
    const live_session = !this.watching_replay;
    return Object.freeze({ state: this.state,
      can_play: live_session && this.state === 'ready' && !!this.playback && graphics_usable,
      can_resume: live_session && this.state === 'paused' && this.playback?.state === 'paused' && graphics_usable,
      can_retry: this.in_attempt && this.state !== 'starting' && this.state !== 'disposed' && graphics_usable,
      can_watch_replay: live_session && this.state === 'terminal' && this.completed_run !== null &&
        this.session_handle !== null && graphics_usable,
      watching_replay: this.watching_replay,
      recovery: this.recovery_details, in_attempt: this.in_attempt, message: this.message, error: this.error,
      result: this.completed_run?.result ?? null });
  }

  // Read-only diagnostic probe over the active playback clock (never drives
  // gameplay). Browser parity specs use it to inject deterministic faults.
  get playback_clock(): Audio_Clock | null {
    return this.playback?.clock ?? null;
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
    this.completed_run = null;
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
    require_condition(simulation.simulation_version === 1 && simulation.rules_version === 2 &&
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
    this.playback = new Audio_Playback(this.engine, this.session_handle!, this.context, this.prepared_selection!, {}, reuse_voice_storage, this.diagnostics, this.options.outputs);
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
    this.frame.on_pause = reason => {
      if (this.watching_replay) {
        // Watch playback cannot pause; an audio interruption fails loudly so
        // the replay can be restarted through Retry or left through stop_watch.
        this.recover(new Browser_Error('INVALID_STATE', `${reason} Retry to restart the replay.`));
        return;
      }
      this.pause(reason);
    };
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

  private physical_position(): { x: number; y: number } | undefined {
    const { pointer_x, pointer_y } = this.held_input;
    if (!Number.isFinite(pointer_x) || !Number.isFinite(pointer_y)) return;
    const bounds = this.canvas.getBoundingClientRect();
    const transform = this.engine.playfield_transform({ css_left: bounds.left, css_top: bounds.top,
      css_width: bounds.width, css_height: bounds.height,
      device_pixel_ratio: this.canvas.ownerDocument.defaultView!.devicePixelRatio });
    return { x: Number(transform.inverse_a) * pointer_x + Number(transform.inverse_c) * pointer_y + Number(transform.inverse_e),
      y: Number(transform.inverse_b) * pointer_x + Number(transform.inverse_d) * pointer_y + Number(transform.inverse_f) };
  }

  quarantine_input(source: string) {
    this.held_input.quarantined.add(source);
  }

  async resume() {
    if (!this.view.can_resume) return;
    try {
      const policy = this.engine.resume_policy(this.session_handle!, this.paused_cursor_flags);
      if (!Number(policy.required)) { await this.start(true); return; }
      const bounds = this.canvas.getBoundingClientRect();
      const transform = this.engine.playfield_transform({ css_left: bounds.left, css_top: bounds.top,
        css_width: bounds.width, css_height: bounds.height,
        device_pixel_ratio: this.canvas.ownerDocument.defaultView!.devicePixelRatio });
      const target_x = Number(transform.client_left) + Number(transform.scale) * Number(policy.x);
      const target_y = Number(transform.client_top) + Number(transform.scale) * Number(policy.y);
      this.state = 'resuming';
      this.message = 'Move to the orange cursor and press a hit key or mouse button. Escape returns to pause.';
      this.publish();
      this.resume_gate = new Resume_Gate(this.canvas, this.options.input_settings?.() ?? DEFAULT_PLAYER_SETTINGS,
        target_x, target_y, Number(policy.half_size) * Math.min(bounds.width / 1024, bounds.height / 768),
        this.held_input.pointer_x, this.held_input.pointer_y, this.held_input.gameplay_sources, (action, source) => {
          this.resume_gate?.dispose();
          this.resume_gate = null;
          void this.start(true, Number(action === 1 ? policy.left_input_flags : policy.right_input_flags), source);
        }, () => this.pause('Paused.'));
    } catch (error) { this.recover(error); }
  }

  // Shared start core for live and watch playback: one generation, one
  // starting publication, the awaited playback start and the graphics
  // precondition. Failures recover once; a superseded start (Back, dispose,
  // retry) resolves false without touching state.
  async #await_playback_start(before_pump?: () => void, starting_message = 'Starting audio…'): Promise<boolean> {
    const generation = ++this.generation;
    this.state = 'starting';
    this.message = starting_message;
    this.publish();
    try {
      await this.playback!.start(0, before_pump);
      if (generation !== this.generation) return false;
      require_condition(this.renderer?.ready && !this.graphics_lost, 'INVALID_STATE', 'Graphics are not ready.');
      return true;
    } catch (error) {
      if (generation === this.generation) this.recover(error);
      return false;
    }
  }

  private async start(resuming = false, resume_flags = 0, resume_source?: string) {
    const resume_sources = new Set(this.held_input.gameplay_sources);
    const input_settings = this.options.input_settings?.() ?? DEFAULT_PLAYER_SETTINGS;
    const resume_position = resuming ? this.physical_position() : undefined;
    const retained_sources = mapped_sources(resume_sources, input_settings);
    for (const [source, action] of retained_sources) {
      if (this.paused_sources.get(source) !== action) retained_sources.delete(source);
    }
    const playback = this.playback!;
    if (!await this.#await_playback_start(resuming ? () => {
      const audio_seconds = playback.clock.anchor!.audio_seconds;
      // PassThroughInputManager first synchronises releases, then forwards
      // the actual resume event. Unrelated keys pressed while paused do not
      // become new gameplay presses merely because input is re-enabled.
      this.frame!.input.reconcile(retained_sources, audio_seconds, playback.clock.epoch, resume_flags, resume_position);
      if (resume_source) {
        const action = mapped_sources(resume_sources, input_settings).get(resume_source);
        if (action) retained_sources.set(resume_source, action);
      }
      this.frame!.input.reconcile(retained_sources, audio_seconds, playback.clock.epoch);
      const physical_sources = this.held_input.gameplay_sources;
      for (const source of retained_sources.keys()) if (!physical_sources.has(source)) retained_sources.delete(source);
      this.frame!.input.reconcile(retained_sources, audio_seconds, playback.clock.epoch, 0, this.physical_position());
      this.frame!.drain();
    } : undefined)) return;
    try {
      this.state = 'running';
      this.message = gameplay_control_hint(input_settings);
      this.canvas.setAttribute?.('aria-label', gameplay_accessible_label(input_settings));
      // Live runs attach the gameplay input surface; watch playback never does.
      this.input = new Gameplay_Input(this.canvas, this.frame!, this.sample_audio, reason => this.pause(reason), false,
        input_settings, resuming ? new Set([...this.held_input.sources].filter(source => !retained_sources.has(source))) : this.held_input.sources);
      if (resuming) this.input.cursor_flags = this.paused_cursor_flags;
      this.frame!.start();
      this.publish();
    } catch (error) {
      this.recover(error);
    }
  }

  pause(reason = 'Paused.') {
    if (this.state === 'disposed') return;
    // Watch playback is non-interactive and cannot pause; its exits are
    // completion, Retry and stop_watch. Terminal sound draining still applies.
    if (this.watching_replay && this.state !== 'terminal') return;
    if (this.state === 'resuming') {
      this.resume_gate?.dispose();
      this.resume_gate = null;
      this.state = 'paused';
      this.message = reason;
      this.publish();
      return;
    }
    if (this.state === 'terminal') { this.finish_terminal(); return; }
    if (this.state === 'starting') {
      this.recover(new Browser_Error('START_INTERRUPTED', `${reason} Retry when ready.`));
      return;
    }
    if (this.state !== 'running') return;
    this.paused_cursor_flags = this.input?.cursor_flags ?? 0;
    this.frame!.stop();
    this.input?.dispose();
    this.input = null;
    try {
      this.frame!.drain();
      const state = this.playback!.pause();
      this.paused_sources = new Map(this.frame!.input.held_sources);
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
    if (!this.session_handle || this.state === 'terminal' || this.state === 'disposed') return;
    if (!this.watching_replay && this.completed_run) return;
    this.input?.dispose();
    this.input = null;
    this.frame!.terminal = true;
    if (!this.watching_replay) {
      // Capture the finished run while the producing session is still
      // terminal; every later reset, re-prepare or release keeps serving
      // this retained record. A watch completion reuses the retained run:
      // resimulation reproduces it byte-for-byte (asserted in tests).
      this.completed_run = { result: this.engine.result(this.session_handle),
        replay_bytes: this.engine.export_replay(this.session_handle) };
    }
    const result = this.completed_run!.result;
    this.state = 'terminal';
    this.message = result.summary.state === SESSION_STATE.PASSED ? 'Passed' : 'Failed';
    this.diagnostics?.note_lifecycle(`Run complete: ${this.message}.`,
      { state: Number(result.summary.state), score: result.summary.score.toString(),
        accuracy: Number(result.summary.accuracy), highest_combo: Number(result.summary.highest_combo) });
    this.terminal_draining = result.summary.state === SESSION_STATE.PASSED && this.context.state === 'running';
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
    this.resume_gate?.dispose();
    this.resume_gate = null;
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
    if (this.watching_replay && this.completed_run) {
      await this.#begin_watch(this.completed_run.replay_bytes);
      return;
    }
    this.generation++;
    this.stop_owners();
    this.completed_run = null;
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

  // Terminal-only replay export serving the retained completed run. The bytes
  // are a self-contained TWREPLAY v2 container; a private copy is returned so
  // callers cannot mutate the retained recording.
  export_replay(): Uint8Array {
    require_condition(this.completed_run !== null, 'INVALID_STATE', 'Replay export requires a finished run.');
    return this.completed_run.replay_bytes.slice();
  }

  // Watch the retained completed run: its exported frames are reset into the
  // current session and replayed without any live input attached.
  async watch_replay() {
    require_condition(this.state === 'terminal' && this.completed_run !== null && !this.watching_replay,
      'INVALID_STATE', 'Watch requires a finished run.');
    await this.#begin_watch(this.completed_run.replay_bytes);
  }

  async #begin_watch(replay_bytes: Uint8Array) {
    this.generation++;
    this.stop_owners();
    this.error = null;
    this.recovery_details = null;
    this.watching_replay = true;
    try {
      require_condition(this.session_handle && this.renderer?.ready && !this.graphics_lost,
        'INVALID_STATE', 'Wait for graphics restoration before watching.');
      this.engine.reset_session(this.session_handle);
      // Playback construction rebinds samples on the reset READY session;
      // load_replay then switches to replay mode, which rejects live input
      // and further sample binding.
      this.create_playback(true);
      this.engine.load_replay(this.session_handle, replay_bytes);
      this.state = 'ready';
      this.in_attempt = true;
      this.publish();
    } catch (error) {
      this.recover(error);
      return;
    }
    await this.#start_watch();
  }

  // Spectator start: shares the live start lifecycle but never attaches the
  // gameplay input surface, so judgement comes only from the replay frames.
  async #start_watch() {
    if (!await this.#await_playback_start(undefined, 'Starting replay…')) return;
    try {
      this.state = 'running';
      this.message = 'Watching replay.';
      this.canvas.setAttribute?.('aria-label', 'Replay playback. Press Escape to exit.');
      this.frame!.start();
      this.publish();
    } catch (error) {
      this.recover(error);
    }
  }

  // Exit watch mode from any watch state (running, finished or interrupted):
  // the replay session is released, a fresh live session is prepared for the
  // same selection, and the retained completed run is restored so the shell
  // returns to the original results context with working replay actions.
  stop_watch() {
    require_condition(this.watching_replay, 'INVALID_STATE', 'No replay is being watched.');
    const retained_run = this.completed_run;
    this.watching_replay = false;
    this.prepare();
    if (retained_run && !this.error) {
      this.completed_run = retained_run;
      this.in_attempt = true;
      this.state = 'terminal';
      this.message = retained_run.result.summary.state === SESSION_STATE.PASSED ? 'Passed' : 'Failed';
    }
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
    this.resume_gate?.dispose();
    this.resume_gate = null;
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
    // Releasing the attempt also abandons any watch session and the retained
    // completed run: Back and new selections return to a clean live lifecycle.
    this.watching_replay = false;
    this.completed_run = null;
  }

  dispose() {
    if (this.state === 'disposed') return;
    this.release_attempt();
    this.listeners.abort();
    this.held_input.dispose();
    this.selection.dispose();
    this.engine.dispose();
    void this.context.close().catch(() => {});
    this.state = 'disposed';
    this.publish();
  }
}
