import { engine_wasm_url } from './engine_asset';
import { Engine_Bridge } from '@browser/engine-bridge.js';
import { WASM_PAGE_BYTES, type Engine_Diagnostic } from '@browser/abi-records.js';

export interface Engine_Boot_Result {
  engine: Engine_Bridge;
  engine_logs: Engine_Diagnostic[];
}

export interface Engine_Capabilities_View {
  build_id: string;
  behavior_id: number;
  abi: string;
  lazer_version: number;
  numeric_mode: number;
  raw_bytes_limit: string;
  arena_bytes_limit: string;
  preparation_version: number;
  simulation_flags: number;
  simulation_max_inputs: number;
  output_flags: number;
  transport_flags: number;
  voice_command_mask: number;
  wasm_pages: number;
}

export async function boot_engine(): Promise<Engine_Boot_Result> {
  const engine_logs: Engine_Diagnostic[] = [];
  const wasm_response = await fetch(engine_wasm_url);
  if (!wasm_response.ok) {
    throw new Error(`tapweave.wasm fetch failed with status ${wasm_response.status}`);
  }
  const wasm_bytes = await wasm_response.arrayBuffer();
  const engine = await Engine_Bridge.create(wasm_bytes, (message) => {
    engine_logs.push(message);
  });
  return { engine, engine_logs };
}

export const capabilities_view = (engine: Engine_Bridge): Engine_Capabilities_View => ({
  build_id: engine.capabilities.build_id.toString(),
  behavior_id: engine.capabilities.behavior_id,
  abi: `${engine.capabilities.abi_major}.${engine.capabilities.abi_minor}`,
  lazer_version: engine.capabilities.lazer_version,
  numeric_mode: engine.capabilities.numeric_mode,
  raw_bytes_limit: engine.capabilities.raw_bytes.toString(),
  arena_bytes_limit: engine.capabilities.arena_bytes.toString(),
  preparation_version: engine.preparation_capabilities.preparation_version,
  simulation_flags: engine.simulation_capabilities.flags,
  simulation_max_inputs: engine.simulation_capabilities.max_inputs,
  output_flags: engine.output_capabilities.flags,
  transport_flags: engine.transport_capabilities.flags,
  voice_command_mask: engine.transport_capabilities.voice_command_mask,
  wasm_pages: engine.wasm.memory.buffer.byteLength / WASM_PAGE_BYTES,
});
