import { ACTION } from './input.js';
import type { Gameplay_Input_Settings } from './player-settings.js';

export function mapped_sources(sources: ReadonlySet<string>, settings: Gameplay_Input_Settings): Map<string, number> {
  const mapped = new Map<string, number>();
  const modifier_held = [...sources].some(source => /^(Control|Alt|Meta|Shift)(Left|Right)$/.test(source));
  for (const source of sources) {
    if (modifier_held && !source.startsWith('mouse:')) continue;
    const action = source === settings.left_key || (settings.mouse_buttons_enabled && source === 'mouse:0') ? ACTION.LEFT :
      source === settings.right_key || (settings.mouse_buttons_enabled && source === 'mouse:2') ? ACTION.RIGHT : 0;
    if (action) mapped.set(source, action);
  }
  return mapped;
}

// Browser executes the engine's frozen target and hitbox. Animation is visual
// only; it never changes the hitbox or advances the paused gameplay clock.
export class Resume_Gate {
  private readonly listeners = new AbortController();
  private readonly target: HTMLDivElement;
  private readonly instruction: HTMLDivElement;
  private pointer_x: number;
  private pointer_y: number;

  constructor(canvas: HTMLCanvasElement, settings: Gameplay_Input_Settings,
    target_x: number, target_y: number, half_size: number,
    pointer_x: number, pointer_y: number, held_sources: ReadonlySet<string>, accept: (action: number, source: string) => void, cancel: () => void) {
    const document = canvas.ownerDocument;
    const window = document.defaultView!;
    this.pointer_x = pointer_x;
    this.pointer_y = pointer_y;
    this.target = document.createElement('div');
    this.target.id = 'resume-cursor';
    this.target.setAttribute('role', 'status');
    this.target.setAttribute('aria-label', 'Move to the orange cursor and press a hit key or mouse button to resume. Escape returns to pause.');
    Object.assign(this.target.style, { position: 'fixed', left: `${target_x - half_size}px`, top: `${target_y - half_size}px`,
      width: `${half_size * 2}px`, height: `${half_size * 2}px`, border: '2px solid orange', borderRadius: '50%',
      boxSizing: 'border-box', pointerEvents: 'none', zIndex: '20', boxShadow: '0 0 8px orange' });
    document.body.append(this.target);
    this.instruction = document.createElement('div');
    this.instruction.textContent = 'Move to the orange cursor and press a hit key or mouse button. Escape returns to pause.';
    Object.assign(this.instruction.style, { position: 'fixed', top: `${canvas.getBoundingClientRect().top + 16}px`,
      left: '10%', width: '80%', textAlign: 'center', pointerEvents: 'none', zIndex: '20', color: 'orange',
      textShadow: '0 1px 3px black' });
    document.body.append(this.instruction);
    const active_sources = mapped_sources(held_sources, settings);
    const key_press = (source: string, action: number) => {
      const already_held = [...active_sources.values()].includes(action);
      active_sources.set(source, action);
      if (!already_held) press(action, source);
    };
    const options = { signal: this.listeners.signal };
    const press = (action: number, source: string) => {
      if (Math.abs(this.pointer_x - target_x) <= half_size && Math.abs(this.pointer_y - target_y) <= half_size) accept(action, source);
    };
    window.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse') return;
      this.pointer_x = event.clientX;
      this.pointer_y = event.clientY;
      if (!(event.buttons & 1)) active_sources.delete('mouse:0');
      if (!(event.buttons & 2)) active_sources.delete('mouse:2');
    }, options);
    window.addEventListener('keydown', event => {
      if (event.code === 'Escape') { event.preventDefault(); cancel(); return; }
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      if (event.target !== canvas) return;
      const action = mapped_sources(new Set([event.code]), settings).get(event.code);
      if (action) { event.preventDefault(); key_press(event.code, action); }
    }, options);
    window.addEventListener('keyup', event => active_sources.delete(event.code), options);
    window.addEventListener('pointerup', event => active_sources.delete(`mouse:${event.button}`), options);
    canvas.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'mouse' || !settings.mouse_buttons_enabled || ![0, 2].includes(event.button)) return;
      event.preventDefault();
      this.pointer_x = event.clientX;
      this.pointer_y = event.clientY;
      key_press(`mouse:${event.button}`, event.button === 0 ? ACTION.LEFT : ACTION.RIGHT);
    }, options);
    window.addEventListener('resize', cancel, options);
    canvas.addEventListener('contextmenu', event => event.preventDefault(), options);
    canvas.focus();
  }

  dispose() {
    this.listeners.abort();
    this.target.remove();
    this.instruction.remove();
  }
}
