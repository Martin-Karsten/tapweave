// Observes physical state even while menus own focus. It never submits input.
// On blur the browser can no longer observe releases; clear physical state.
// The engine independently retains the gameplay state until reconciliation.
export class Held_Input {
  readonly sources = new Set<string>();
  readonly quarantined = new Set<string>();
  pointer_x = Number.NaN;
  pointer_y = Number.NaN;
  private readonly listeners = new AbortController();

  constructor(window: Window) {
    const options = { capture: true, signal: this.listeners.signal };
    window.addEventListener('keydown', event => this.sources.add(event.code), options);
    window.addEventListener('keyup', event => { this.sources.delete(event.code); this.quarantined.delete(event.code); }, options);
    window.addEventListener('blur', event => {
      // Capturing blur also observes ordinary element focus changes. Only a
      // window blur makes physical releases unobservable.
      if (event.target !== window) return;
      this.sources.clear();
      this.quarantined.clear();
    }, options);
    const pointer = (event: PointerEvent, held: boolean) => {
      if (event.pointerType !== 'mouse') return;
      this.pointer_x = event.clientX;
      this.pointer_y = event.clientY;
      const source = `mouse:${event.button}`;
      if (held) this.sources.add(source);
      else { this.sources.delete(source); this.quarantined.delete(source); }
    };
    window.addEventListener('pointerdown', event => pointer(event, true), options);
    window.addEventListener('pointerup', event => pointer(event, false), options);
    window.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse') return;
      this.pointer_x = event.clientX;
      this.pointer_y = event.clientY;
      for (const [button, mask] of [[0, 1], [2, 2]]) {
        if (event.buttons & mask!) this.sources.add(`mouse:${button}`);
        else { this.sources.delete(`mouse:${button}`); this.quarantined.delete(`mouse:${button}`); }
      }
    }, options);
  }

  get gameplay_sources(): ReadonlySet<string> {
    return new Set([...this.sources].filter(source => !this.quarantined.has(source)));
  }

  dispose(): void {
    this.listeners.abort();
    this.sources.clear();
    this.quarantined.clear();
  }
}
