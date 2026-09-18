import { DEFAULT_PLAYER_SETTINGS, type Gameplay_Input_Settings } from './player-settings.js';
import { ACTION } from './input.js';
import { fullscreen_owns_escape, install_fullscreen_escape_guard } from './fullscreen.js';
import { require_condition } from './errors.js';
import type { Gameplay_Frame } from './gameplay-frame.js';

// Each DOM handler samples the authoritative audio clock first and stores that
// stamp permanently with the browser clock epoch; performance.now() is kept for
// diagnostics only. DOM receipt coordinates are transformed immediately, before
// resize can change their meaning. No DOM timestamp, RAF timestamp or browser
// judgement is used.
export class Gameplay_Input {
  cursor_flags = 0;
  private listeners = new AbortController();
  private touch_id: number | null = null;
  private captured_pointers = new Set<number>();
  private previous_touch_action: string;
  private readonly suppressed_sources: Set<string>;
  readonly settings: Gameplay_Input_Settings;

  constructor(readonly canvas: HTMLCanvasElement, readonly frame: Gameplay_Frame,
    readonly sample_audio: () => number = () => frame.playback.context.currentTime,
    readonly request_pause: (reason: string) => void = () => frame.pause(),
    readonly owns_focus_events = true, settings: Gameplay_Input_Settings = DEFAULT_PLAYER_SETTINGS,
    held_sources: ReadonlySet<string> = new Set()) {
    this.settings = Object.freeze({ ...settings });
    this.suppressed_sources = new Set(held_sources);
    this.previous_touch_action = canvas.style.touchAction;
    canvas.style.touchAction = 'none';
    const options = { signal: this.listeners.signal };
    const document = canvas.ownerDocument;
    const window = document.defaultView!;
    install_fullscreen_escape_guard(document);
    const guarded = <Event_Type extends Event>(handler: (event: Event_Type) => void) => (event: Event) => {
      if (frame.playback.state !== 'running' || frame.terminal) return;
      try { handler(event as Event_Type); } catch (error) { frame.fail(error); }
    };
    window.addEventListener('keydown', guarded((event: KeyboardEvent) => {
      const action = event.code === this.settings.left_key ? ACTION.LEFT : event.code === this.settings.right_key ? ACTION.RIGHT : 0;
      if (!action && event.code !== 'Escape') return;
      event.preventDefault();
      if (event.repeat) return;
      if (event.code === 'Escape') {
        // Browser fullscreen owns the first Escape: exiting fullscreen must
        // not also dispatch the application pause, whichever order the engine
        // delivers the exit event and the keydown in. No timeout is involved,
        // so a later windowed Escape still pauses.
        if (fullscreen_owns_escape()) return;
        this.pause();
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || this.suppressed_sources.has(event.code)) return;
      frame.input.receive({ source_id: event.code, action, held: true, ...this.stamp() });
    }), options);
    window.addEventListener('keyup', guarded((event: KeyboardEvent) => {
      if (this.suppressed_sources.delete(event.code)) return;
      const action = event.code === this.settings.left_key ? ACTION.LEFT : event.code === this.settings.right_key ? ACTION.RIGHT : 0;
      if (!action) return;
      event.preventDefault();
      frame.input.receive({ source_id: event.code, action, held: false, ...this.stamp() });
    }), options);
    canvas.addEventListener('pointerdown', guarded((event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        if (!event.isPrimary || this.touch_id !== null) return;
        this.touch_id = event.pointerId;
      } else if (event.pointerType !== 'mouse' || ![0, 2].includes(event.button)) return;
      event.preventDefault();
      this.pointer(event, event.pointerType === 'mouse' && (!this.settings.mouse_buttons_enabled ||
        this.suppressed_sources.has(`mouse:${event.button}`)) ? undefined : true);
      canvas.setPointerCapture(event.pointerId);
      this.captured_pointers.add(event.pointerId);
    }), options);
    window.addEventListener('pointermove', guarded((event: PointerEvent) => {
      if (event.pointerType === 'touch' ? event.pointerId !== this.touch_id : event.pointerType !== 'mouse') return;
      if (event.pointerType === 'mouse') {
        if (!(event.buttons & 1)) this.suppressed_sources.delete('mouse:0');
        if (!(event.buttons & 2)) this.suppressed_sources.delete('mouse:2');
      }
      this.pointer(event);
    }), options);
    window.addEventListener('pointerup', guarded((event: PointerEvent) => {
      if (event.pointerType === 'touch' ? event.pointerId !== this.touch_id :
        event.pointerType !== 'mouse' || ![0, 2].includes(event.button)) return;
      event.preventDefault();
      const suppressed = this.suppressed_sources.delete(`mouse:${event.button}`);
      this.pointer(event, event.pointerType === 'mouse' && (!this.settings.mouse_buttons_enabled || suppressed) ? undefined : false);
      if (event.pointerType === 'touch') this.touch_id = null;
      this.captured_pointers.delete(event.pointerId);
    }), options);
    const cancel = guarded(() => this.pause());
    window.addEventListener('pointercancel', guarded((event: PointerEvent) => {
      if (event.pointerId === this.touch_id || event.pointerType === 'mouse') this.pause();
    }), options);
    canvas.addEventListener('lostpointercapture', guarded((event: PointerEvent) => {
      if (event.pointerId === this.touch_id || frame.input.held_sources.has('mouse:0') ||
        frame.input.held_sources.has('mouse:2')) this.pause();
    }), options);
    if (owns_focus_events) {
      window.addEventListener('blur', cancel, options);
      document.addEventListener('visibilitychange', guarded(() => {
        if (document.hidden) this.pause();
      }), options);
    }
    canvas.addEventListener('contextmenu', guarded(event => event.preventDefault()), options);
  }

  // Capture the judgement stamp before any other handler work: the audio-clock
  // sample and its epoch are the authority; performance.now() is diagnostics.
  private stamp() {
    const audio_seconds = this.sample_audio();
    require_condition(Number.isFinite(audio_seconds), 'INVALID_CLOCK', 'Sampled audio time must be finite.');
    return { audio_seconds, clock_epoch: this.frame.playback.clock.epoch, raw_time_ms: performance.now() };
  }

  private pointer(event: PointerEvent, held?: boolean) {
    const stamp = this.stamp();
    const bounds = this.canvas.getBoundingClientRect();
    this.cursor_flags = event.pointerType === 'mouse' ? 1 |
      (event.clientX >= bounds.left && event.clientX <= bounds.right &&
        event.clientY >= bounds.top && event.clientY <= bounds.bottom ? 2 : 0) : 0;
    // Receipt-time conversion through the session's cached visual bounds: the
    // canvas rectangle is read now, never the last rendered frame's transform.
    const transform = this.frame.playback.engine.session_playfield_transform(
      this.frame.playback.session_handle, { css_left: bounds.left, css_top: bounds.top,
        css_width: bounds.width, css_height: bounds.height,
        device_pixel_ratio: this.canvas.ownerDocument.defaultView!.devicePixelRatio });
    this.frame.input.receive({ source_id: event.pointerType === 'touch' ? 'touch' : `mouse:${event.button}`,
      action: held === undefined ? 0 : event.pointerType === 'touch' || event.button === 0 ? ACTION.LEFT : ACTION.RIGHT,
      held: held ?? false, ...stamp, client_x: event.clientX, client_y: event.clientY,
      inverse_transform: [transform.inverse_a, transform.inverse_b, transform.inverse_c,
        transform.inverse_d, transform.inverse_e, transform.inverse_f] as number[] });
  }

  private pause() {
    this.request_pause('Input cancelled or Escape pressed.');
    this.touch_id = null;
  }

  dispose() {
    this.listeners.abort();
    for (const pointer_id of this.captured_pointers) {
      if (this.canvas.hasPointerCapture?.(pointer_id)) this.canvas.releasePointerCapture(pointer_id);
    }
    this.captured_pointers.clear();
    this.canvas.style.touchAction = this.previous_touch_action;
    this.touch_id = null;
  }
}
