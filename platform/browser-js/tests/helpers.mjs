import { readFile } from 'node:fs/promises';
import { Engine_Bridge } from '../src/engine-bridge.mjs';

export const wasm_bytes = await readFile(new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url));
export const two_circle_map = new TextEncoder().encode('osu file format v14\n[Difficulty]\nHPDrainRate:0\n[HitObjects]\n256,192,1000,1,0\n256,192,2000,1,0');
export const two_circle_inputs = [
  { sequence: 1n, raw_time_ms: 1000, effective_time_ms: 1000, x: 256, y: 192, action_bits: 1 },
  { sequence: 2n, raw_time_ms: 1500, effective_time_ms: 1500, x: 256, y: 192, action_bits: 0 },
  { sequence: 3n, raw_time_ms: 2000, effective_time_ms: 2000, x: 256, y: 192, action_bits: 1 },
];

export function create_engine() {
  return Engine_Bridge.create(wasm_bytes);
}

// A session with the authoritative voice journal reserved and ready for input.
export async function voice_session(engine, map_bytes = two_circle_map, options = { input_capacity: 8, batch_capacity: 8 }) {
  const prepared = engine.prepare_map(map_bytes);
  const session = engine.create_session(prepared.map_handle, options);
  const capacity = engine.voice_reserve(session);
  engine.voice_reserve(session, capacity.required_commands, capacity.required_bytes);
  return session;
}
