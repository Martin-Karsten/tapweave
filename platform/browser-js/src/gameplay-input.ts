import { ACTION } from './input.js';
import type { Gameplay_Frame } from './gameplay-frame.js';

// DOM receipt coordinates are transformed immediately, before resize can change
// their meaning. No DOM timestamp, RAF timestamp or browser judgement is used.
export class Gameplay_Input {
  private listeners = new AbortController();
  private touch_id: number | null = null;
  private captured_pointers = new Set<number>();
  private previous_touch_action: string;

  constructor(readonly canvas: HTMLCanvasElement, readonly frame: Gameplay_Frame,
    readonly receipt_now: () => number = () => performance.now(),
    readonly request_pause: (reason: string) => void = () => frame.pause(),
    readonly owns_focus_events = true) {
    this.previous_touch_action = canvas.style.touchAction;
    canvas.style.touchAction = 'none';
    const options = { signal: this.listeners.signal };
    const document = canvas.ownerDocument;
    const window = document.defaultView!;
    const guarded = <Event_Type extends Event>(handler: (event: Event_Type) => void) => (event: Event) => {
      if (frame.playback.state !== 'running' || frame.terminal) return;
      try { handler(event as Event_Type); } catch (error) { frame.fail(error); }
    };
    window.addEventListener('keydown', guarded((event: KeyboardEvent) => {
      const action = event.code === 'KeyZ' ? ACTION.LEFT : event.code === 'KeyX' ? ACTION.RIGHT : 0;
      if (!action && event.code !== 'Escape') return;
      event.preventDefault();
      if (event.repeat) return;
      if (event.code === 'Escape') { this.pause(); return; }
      frame.input.receive({ source_id: event.code, action, held: true, raw_time_ms: receipt_now() });
    }), options);
    window.addEventListener('keyup', guarded((event: KeyboardEvent) => {
      const action = event.code === 'KeyZ' ? ACTION.LEFT : event.code === 'KeyX' ? ACTION.RIGHT : 0;
      if (!action) return;
      event.preventDefault();
      frame.input.receive({ source_id: event.code, action, held: false, raw_time_ms: receipt_now() });
    }), options);
    canvas.addEventListener('pointerdown', guarded((event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        if (!event.isPrimary || this.touch_id !== null) return;
        this.touch_id = event.pointerId;
      } else if (event.pointerType !== 'mouse' || ![0, 2].includes(event.button)) return;
      event.preventDefault();
      this.pointer(event, true);
      canvas.setPointerCapture(event.pointerId);
      this.captured_pointers.add(event.pointerId);
    }), options);
    window.addEventListener('pointermove', guarded((event: PointerEvent) => {
      if (event.pointerType === 'touch' ? event.pointerId !== this.touch_id : event.pointerType !== 'mouse') return;
      this.pointer(event);
    }), options);
    window.addEventListener('pointerup', guarded((event: PointerEvent) => {
      if (event.pointerType === 'touch' ? event.pointerId !== this.touch_id :
        event.pointerType !== 'mouse' || ![0, 2].includes(event.button)) return;
      event.preventDefault();
      this.pointer(event, false);
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

  private pointer(event: PointerEvent, held?: boolean) {
    const raw_time_ms = this.receipt_now();
    const bounds = this.canvas.getBoundingClientRect();
    const transform = this.frame.playback.engine.playfield_transform({ css_left: bounds.left, css_top: bounds.top,
      css_width: bounds.width, css_height: bounds.height,
      device_pixel_ratio: this.canvas.ownerDocument.defaultView!.devicePixelRatio });
    this.frame.input.receive({ source_id: event.pointerType === 'touch' ? 'touch' : `mouse:${event.button}`,
      action: held === undefined ? 0 : event.pointerType === 'touch' || event.button === 0 ? ACTION.LEFT : ACTION.RIGHT,
      held: held ?? false, raw_time_ms, client_x: event.clientX, client_y: event.clientY,
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
