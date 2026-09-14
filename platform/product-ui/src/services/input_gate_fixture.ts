import { Engine_Bridge } from '@browser/engine-bridge.js';
import { Gameplay_Input } from '@browser/gameplay-input.js';
import { Input_Buffer } from '@browser/input.js';
import type { Gameplay_Frame } from '@browser/gameplay-frame.js';

declare global {
  interface Window {
    __tapweave_input_fixture?: {
      frame: { playback: { state: string; engine: Engine_Bridge }; input: Input_Buffer;
        pause(): void; fail(error: unknown): void };
      engine: Engine_Bridge;
      binding: Gameplay_Input;
    };
  }
}

let active_fixture: { canvas: HTMLCanvasElement; engine: Engine_Bridge; binding: Gameplay_Input } | null = null;

// Diagnostics-only fixture binding real Gameplay_Input listeners to a probe
// canvas so browser specs can drive real mouse/keyboard events and inspect
// the aggregated Odin-space records (input parity port of the browser-js
// suite). Nothing here runs during gameplay.
export const start_input_gate_fixture = async (): Promise<void> => {
  stop_input_gate_fixture();
  const engine = await Engine_Bridge.create(await (await fetch('/tapweave.wasm')).arrayBuffer());
  const canvas = document.createElement('canvas');
  canvas.setAttribute('data-input-fixture', 'playfield');
  canvas.style.cssText = 'position:fixed;left:20px;top:40px;width:512px;height:384px;z-index:999';
  document.body.append(canvas);
  const frame = {
    playback: { state: 'running', engine, clock: { epoch: 1 }, context: { currentTime: 0.5 } },
    input: new Input_Buffer(64),
    pause() {
      this.input.release_all(this.playback.context.currentTime, this.playback.clock.epoch);
      this.playback.state = 'paused';
    },
    fail(error: unknown) {
      throw error;
    },
  };
  const binding = new Gameplay_Input(canvas, frame as unknown as Gameplay_Frame);
  active_fixture = { canvas, engine, binding };
  window.__tapweave_input_fixture = { frame, engine, binding };
};

export const stop_input_gate_fixture = (): void => {
  if (active_fixture === null) return;
  active_fixture.binding.dispose();
  active_fixture.engine.dispose();
  active_fixture.canvas.remove();
  active_fixture = null;
  delete window.__tapweave_input_fixture;
};
