import { Audio_Mixer } from '@browser/audio-mixer.js';
import { gameplay_accessible_label } from '@browser/player-settings.js';
import { Player_Settings_Service } from './player_settings.js';
import { Engine_Bridge } from '@browser/engine-bridge.js';
import { Selection_Controller, type Active_Selection } from '@browser/selection.js';
import { Gameplay_Controller, type Gameplay_View } from '@browser/gameplay-controller.js';
import { create_fallback_audio } from '@browser/fallback-audio.js';
import { Music_Preview } from '@browser/preview.js';
import type { Map_Summary } from '@browser/map-summary.js';
import type { Browser_Error } from '@browser/errors.js';
import { WASM_PAGE_BYTES, type Engine_Diagnostic, type Prepared_Descriptor_Record } from '@browser/abi-records.js';
import { Debug_Session_Service } from './debug_session.js';

const MAXIMUM_ENGINE_MESSAGES = 64;
// The preview starts only once a selection has settled briefly, so rapid
// difficulty switches never stack audio starts.
const PREVIEW_DELAY_MS = 800;

export type Shell_Phase = 'booting' | 'ready' | 'boot-failed';

export interface Selection_Snapshot {
  readonly state: 'empty' | 'loading' | 'prepared' | 'disposed';
  readonly active: Active_Selection | null;
  readonly error: Browser_Error | null;
  readonly summaries: ReadonlyMap<string, Map_Summary>;
  readonly summary_failures: ReadonlyMap<string, string>;
}

export interface Shell_State {
  readonly phase: Shell_Phase;
  readonly boot_error: string | null;
  readonly selection: Selection_Snapshot;
  readonly gameplay: Gameplay_View;
}

export const INITIAL_SHELL_STATE: Shell_State = Object.freeze({
  phase: 'booting',
  boot_error: null,
  selection: Object.freeze({
    state: 'empty',
    active: null,
    error: null,
    summaries: Object.freeze(new Map()),
    summary_failures: Object.freeze(new Map()),
  }),
  gameplay: Object.freeze({
    state: 'ready',
    can_play: false,
    can_resume: false,
    can_retry: false,
    can_skip: false,
    can_watch_replay: false,
    watching_replay: false,
    recovery: null,
    in_attempt: false,
    message: 'Starting engine…',
    error: null,
    result: null,
  }),
});

export interface Shell_Diagnostics {
  scope: string;
  upstream_verified: boolean;
  gameplay: boolean;
  browser: string;
  messages: Engine_Diagnostic[];
  engine?: unknown;
  preparation?: unknown;
  map?: { filename: string; summary: Prepared_Descriptor_Record; music: string } | null;
  error?: { code: string; message: string; details?: unknown } | null;
  wasm_pages?: number;
  lifecycle?: { state: string; message: string; recovery: Readonly<Record<string, unknown>> | null; error: unknown };
  samples?: string[] | undefined;
  result?: { summary: Record<string, unknown>; counts: unknown[] } | null;
}

// Product lifecycle only (ADR-006): this service owns browser resources and
// wraps the @browser controllers. It contains no reactivity; UI layers
// subscribe through `subscribe` and read immutable state snapshots.
export class Player_Session_Service {
  private phase: Shell_Phase = 'ready';
  private boot_error: string | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly gameplay: Gameplay_Controller;
  private readonly cleanup_callbacks = new Set<() => void>();

  own_cleanup(cleanup: () => void): void { this.cleanup_callbacks.add(cleanup); }

  private cleanup_settings(): void {
    for (const cleanup of this.cleanup_callbacks) cleanup();
    this.cleanup_callbacks.clear();
  }

  private constructor(readonly engine: Engine_Bridge, readonly selection: Selection_Controller,
    readonly audio_context: AudioContext, readonly canvas: HTMLCanvasElement,
    gameplay: Gameplay_Controller, private readonly engine_logs: Engine_Diagnostic[],
    readonly debug: Debug_Session_Service, readonly settings: Player_Settings_Service, readonly mixer: Audio_Mixer) {
    this.gameplay = gameplay;
    // The preview loops through the mixer's music destination so volume
    // settings apply; it never touches the gameplay voice protocol.
    this.preview = new Music_Preview(audio_context, mixer.music);
  }

  private readonly preview: Music_Preview;
  private preview_timer: ReturnType<typeof setTimeout> | null = null;
  private preview_filename: string | null = null;
  private summaries_view: ReadonlyMap<string, Map_Summary> = Object.freeze(new Map());
  private summary_failures_view: ReadonlyMap<string, string> = Object.freeze(new Map());

  static async create(fetch_engine_wasm: () => Promise<ArrayBuffer> = Player_Session_Service.default_engine_fetch): Promise<Player_Session_Service> {
    const settings = new Player_Settings_Service(() => window.localStorage);
    const wasm_bytes = await fetch_engine_wasm();
    const engine_logs: Engine_Diagnostic[] = [];
    const debug = new Debug_Session_Service();
    const engine = await Engine_Bridge.create(wasm_bytes, {
      diagnostics: debug.diagnostics,
      on_engine_log: (message) => {
        if (engine_logs.length >= MAXIMUM_ENGINE_MESSAGES) {
          engine_logs.shift();
        }
        engine_logs.push(message);
        debug.record_engine_log(message);
      },
    });
    debug.note_player_started();
    let audio_context: AudioContext | null = null;
    let mixer: Audio_Mixer | null = null;
    let selection: Selection_Controller | null = null;
    let gameplay: Gameplay_Controller | null = null;
    try {
      audio_context = new AudioContext();
      const context = audio_context;
      mixer = new Audio_Mixer(context, settings.snapshot.settings);
      const fallback_assets = new Map<string, AudioBuffer>();
      const canvas = document.createElement('canvas');
      canvas.id = 'playfield';
      canvas.tabIndex = 0;
      canvas.setAttribute('aria-label', gameplay_accessible_label(settings.snapshot.settings));
      selection = new Selection_Controller(engine, {
        fallback_assets,
        on_change: () => {},
        on_summaries_change: () => publish(),
        decode_audio: async (bytes) => {
          if (fallback_assets.size === 0) {
            for (const [name, buffer] of create_fallback_audio(context)) fallback_assets.set(name, buffer);
          }
          return context.decodeAudioData(bytes as ArrayBuffer);
        },
        // Summary passes use their own engine so the gameplay engine's input
        // inbox stays dedicated to the live session.
        summary_engine_factory: () => Engine_Bridge.create(wasm_bytes, { diagnostics: debug.diagnostics }),
      });
      debug.bind({ engine: () => engine, selection: () => selection!.active, audio_context: () => context });
      // The gameplay controller rewires selection.on_change to its own handler,
      // so its published views are the single lifecycle notification point. The
      // indirection keeps the callback alive before the shell is constructed.
      let publish: () => void = () => {};
      gameplay = new Gameplay_Controller(engine, selection, context, canvas, {
        input_settings: () => settings.snapshot.settings,
        outputs: { music: mixer.music, effects: mixer.effects },
        on_change: () => publish(),
        diagnostics: debug.diagnostics,
        on_frame: () => debug.note_frame_tick(),
      });
      const shell = new Player_Session_Service(engine, selection, audio_context, canvas, gameplay, engine_logs, debug, settings, mixer);
      shell.own_cleanup(settings.subscribe(() => {
        mixer!.update(settings.snapshot.settings);
        // Running input keeps its frozen configuration until the next start.
        if (shell.view.state !== 'running' && shell.view.state !== 'starting') {
          canvas.setAttribute('aria-label', gameplay_accessible_label(settings.snapshot.settings));
        }
      }));
      shell.own_cleanup(() => mixer!.dispose());
      publish = () => shell.publish();
      return shell;
    } catch (error) {
      if (gameplay) gameplay.dispose();
      else { selection?.dispose(); engine.dispose(); }
      mixer?.dispose();
      if (audio_context && audio_context.state !== 'closed') await audio_context.close().catch(() => {});
      throw error;
    }
  }

  private static async default_engine_fetch(): Promise<ArrayBuffer> {
    const wasm_response = await fetch('/tapweave.wasm');
    if (!wasm_response.ok) {
      throw new Error('Engine download failed. Build the browser assets and try again.');
    }
    return wasm_response.arrayBuffer();
  }

  private publish() {
    this.debug.note_gameplay_view(this.gameplay.view, this.selection.active);
    this.summaries_view = Object.freeze(new Map(this.selection.summaries));
    this.summary_failures_view = Object.freeze(new Map(this.selection.summary_failures));
    this.coordinate_selection_extras();
    for (const listener of [...this.listeners]) listener();
    if (this.gameplay.view.state === 'disposed') {
      this.cleanup_settings();
      this.listeners.clear();
    }
  }

  // Song-select enrichment: background difficulty summaries and the looping
  // music preview. Both run only for a settled selection and stop the moment
  // an attempt starts or the selection leaves the prepared state.
  private coordinate_selection_extras() {
    const view = this.gameplay.view;
    const active = this.selection.active;
    if (view.state === 'disposed') {
      this.cancel_preview();
      return;
    }
    if (this.selection.state === 'prepared') {
      // Background work: failures surface through the summaries snapshot and
      // selection state, never as unhandled rejections.
      this.selection.describe_summaries().catch(() => {});
    }
    if (view.in_attempt || this.selection.state !== 'prepared' || !active?.music_buffer) {
      this.cancel_preview();
      return;
    }
    if (this.preview_filename === active.filename) {
      return;
    }
    this.cancel_preview_timer();
    this.preview_filename = active.filename;
    this.preview_timer = setTimeout(() => {
      this.preview_timer = null;
      const current = this.selection.active;
      if (this.selection.state === 'prepared' && !this.gameplay.view.in_attempt &&
          current?.music_buffer && current.filename === this.preview_filename) {
        this.preview.start(current.music_buffer, current.descriptor.playback.preview_time as number)
          .catch(() => {});
      }
    }, PREVIEW_DELAY_MS);
  }

  private cancel_preview_timer() {
    if (this.preview_timer !== null) {
      clearTimeout(this.preview_timer);
      this.preview_timer = null;
    }
  }

  private cancel_preview() {
    this.cancel_preview_timer();
    this.preview_filename = null;
    this.preview.stop();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get state(): Shell_State {
    return Object.freeze({
      phase: this.phase,
      boot_error: this.boot_error,
      selection: Object.freeze({
        state: this.selection.state,
        active: this.selection.active,
        error: this.selection.error,
        summaries: this.summaries_view,
        summary_failures: this.summary_failures_view,
      }),
      gameplay: this.gameplay.view,
    });
  }

  get view(): Gameplay_View {
    return this.gameplay.view;
  }

  // Read-only diagnostic probe over the active playback clock; browser specs
  // use the window player probe to inject deterministic clock faults.
  get playback_clock() {
    return this.gameplay.playback_clock;
  }

  // The canvas is owned by this service and survives route changes; the play
  // route only lends it a host element. Appending moves the same node, keeping
  // the WebGL context, listeners and renderer bindings intact.
  attach_host(host: HTMLElement) {
    if (this.canvas.parentElement !== host) {
      host.appendChild(this.canvas);
    }
  }

  async play() { await this.gameplay.play(); }
  quarantine_input(source: string) { this.gameplay.quarantine_input(source); }
  pause(reason?: string) { this.gameplay.pause(reason); }
  skip() { this.gameplay.skip(); }
  async resume() { await this.gameplay.resume(); }
  async retry() { await this.gameplay.retry(); }
  back() { this.gameplay.back(); }
  export_replay(): Uint8Array { return this.gameplay.export_replay(); }
  async watch_replay(): Promise<void> { await this.gameplay.watch_replay(); }
  stop_watch(): void { this.gameplay.stop_watch(); }
  async load_files(files: File[]) { await this.gameplay.load_files(files); }
  async select_map(filename: string) { await this.gameplay.select_map(filename); }

  mark_boot_failed(error: unknown) {
    this.phase = 'boot-failed';
    this.boot_error = error instanceof Error ? error.message : String(error);
    this.publish();
  }

  diagnostics(): Shell_Diagnostics {
    const record: Shell_Diagnostics = { scope: 'M3 integrated validation player', upstream_verified: false,
      gameplay: false, browser: navigator.userAgent, messages: [...this.engine_logs],
      engine: this.engine.capabilities, preparation: this.engine.preparation_capabilities };
    const active = this.selection.active;
    if (active) {
      record.map = { filename: active.filename, summary: active.descriptor.summary, music: active.music_status };
    }
    const selection_error = this.selection.error;
    record.error = selection_error ? { code: selection_error.code, message: selection_error.message,
      details: selection_error.details } : null;
    record.wasm_pages = this.engine.wasm.memory.buffer.byteLength / WASM_PAGE_BYTES;
    const view = this.gameplay.view;
    record.gameplay = view.can_play || view.in_attempt;
    record.lifecycle = { state: view.state, message: view.message, recovery: view.recovery,
      error: view.error instanceof Error ? view.error.message : view.error };
    record.samples = active?.samples?.warnings;
    record.result = view.result ? { summary: view.result.summary, counts: [...view.result.result_counts()] } : null;
    return record;
  }

  dispose() {
    this.cancel_preview();
    this.gameplay.dispose();
    this.cleanup_settings();
    this.listeners.clear();
  }
}
