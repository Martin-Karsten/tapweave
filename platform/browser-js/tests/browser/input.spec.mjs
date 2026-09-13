import { test, expect } from '@playwright/test';

test('DOM mouse and keyboard aggregate with Odin coordinates and Escape releases actions', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { Engine_Bridge } = await import('/platform/browser-js/src/engine-bridge.js');
    const { Gameplay_Input } = await import('/platform/browser-js/src/gameplay-input.js');
    const { Input_Buffer } = await import('/platform/browser-js/src/input.js');
    const engine = await Engine_Bridge.create(await (await fetch('/tapweave.wasm')).arrayBuffer());
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;left:20px;top:40px;width:512px;height:384px;z-index:999';
    document.body.append(canvas);
    const frame = { playback: { state: 'running', engine }, input: new Input_Buffer(64),
      pause() { this.input.release_all(performance.now()); this.playback.state = 'paused'; },
      fail(error) { throw error; } };
    window.input_fixture = { frame, engine, binding: new Gameplay_Input(canvas, frame) };
  });
  await page.mouse.move(276, 232);
  await page.mouse.down();
  await page.keyboard.down('z');
  await page.mouse.up();
  const held = await page.evaluate(() => {
    const record = window.input_fixture.frame.input.records.at(-1);
    return { bits: record.action_bits, x: record.x, y: record.y };
  });
  expect(held.bits).toBe(1);
  expect(held.x).toBeCloseTo(256, 6);
  expect(held.y).toBeCloseTo(192, 6);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.input_fixture.frame.input.records.at(-1).action_bits)).toBe(0);
  await page.evaluate(() => { window.input_fixture.binding.dispose(); window.input_fixture.engine.dispose(); });
});
