import { Engine_Bridge } from './engine-bridge.js';
import { Renderer } from './renderer.js';
import type { Input_Snapshot_Values } from './abi-records.js';

const canvas = document.querySelector('canvas')!;
const time_control = document.querySelector<HTMLInputElement>('#time')!;
const time_label = document.querySelector<HTMLOutputElement>('#time-label')!;
const status = document.querySelector<HTMLElement>('#status')!;
const restore = document.querySelector<HTMLButtonElement>('#restore')!;
const map_text = `osu file format v14
[Difficulty]
HPDrainRate:0
ApproachRate:5
SliderMultiplier:1.4
[TimingPoints]
0,500,4,1,1,100,1,0
[HitObjects]
100,100,1000,1,0
150,180,1500,2,0,L|380:180,1,230
256,192,3000,8,0,4500`;

async function initialize() {
  const engine = await Engine_Bridge.create(await (await fetch('/tapweave.wasm')).arrayBuffer());
  const map = engine.prepare_map(new TextEncoder().encode(map_text));
  const session = engine.create_session(map.map_handle, { input_capacity: 512, batch_capacity: 512 });
  const inputs: Input_Snapshot_Values[] = [];
  const append_input = (time_ms: number, x: number, y: number, action_bits: number) => inputs.push({
    sequence: BigInt(inputs.length + 1), raw_time_ms: time_ms, effective_time_ms: time_ms, x, y, action_bits });
  append_input(1000, 100, 100, 1);
  append_input(1100, 100, 100, 0);
  for (let sample_index = 0; sample_index <= 100; sample_index++) {
    append_input(1500 + sample_index / 100 * (230 / .28), 150 + sample_index / 100 * 230, 180, 1);
  }
  append_input(2400, 380, 180, 0);
  for (let sample_index = 0; sample_index <= 180; sample_index++) {
    append_input(3000 + sample_index * 1500 / 180,
      Math.fround(256 + Math.cos(sample_index * Math.PI / 6) * 100),
      Math.fround(192 + Math.sin(sample_index * Math.PI / 6) * 100), 1);
  }
  const renderer = new Renderer(engine, session, map.map_handle, canvas, Number(engine.snapshot(session, 0).summary.epoch), () => {
    status.textContent = 'Graphics context lost. Restore after the browser makes it available.';
    time_control.disabled = true;
  });
  const draw = () => {
    try {
      const time_ms = Number(time_control.value);
      engine.reset_session(session);
      engine.submit_inputs(session, inputs);
      const output = engine.advance(session, time_ms);
      const bounds = canvas.getBoundingClientRect();
      renderer.render(time_ms, { css_left: bounds.left, css_top: bounds.top, css_width: bounds.width,
        css_height: bounds.height, device_pixel_ratio: devicePixelRatio }, Number(output.summary.epoch));
      time_label.value = `${time_ms} ms`;
      status.textContent = `${renderer.gpu.metrics.instances} instances · ${renderer.gpu.metrics.commands} batches · ${renderer.gpu.upload_count} static upload(s)`;
    } catch (error) { status.textContent = String(error); }
  };
  canvas.addEventListener('webglcontextrestored', () => { restore.disabled = false; });
  restore.addEventListener('click', () => {
    try {
      renderer.restore();
      restore.disabled = true;
      time_control.disabled = false;
      draw();
    } catch (error) { status.textContent = String(error); }
  });
  time_control.addEventListener('input', draw);
  window.addEventListener('resize', draw);
  window.addEventListener('pagehide', () => { renderer.dispose(); engine.dispose(); }, { once: true });
  draw();
}

initialize().catch(error => { status.textContent = String(error); });
