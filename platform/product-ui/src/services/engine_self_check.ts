import { Engine_Bridge } from '@browser/engine-bridge.js';

const SELF_CHECK_BEATMAP = 'osu file format v14\n[General]\nAudioFilename: missing.wav\n[Difficulty]\nCircleSize:4\nApproachRate:9\n[HitObjects]\n256,192,1000,1,0';

export interface Engine_Self_Check_Result {
  x: number;
  y: number;
  state: number;
  accuracy: number;
  owned_sessions: number;
  owned_maps: number;
}

// Browser-executed proof that the production session and coordinate exports
// work end to end: prepare, session, playfield transform, input submission,
// advance/acknowledge, result and handle cleanup (player parity port).
export const run_engine_self_check = async (): Promise<Engine_Self_Check_Result> => {
  const engine = await Engine_Bridge.create(await (await fetch('/tapweave.wasm')).arrayBuffer());
  try {
    const prepared = engine.prepare_map(new TextEncoder().encode(SELF_CHECK_BEATMAP));
    const session = engine.create_session(prepared.map_handle, { input_capacity: 64, batch_capacity: 8 });
    engine.release_map(prepared.map_handle);
    const bounds = document.body.getBoundingClientRect();
    const transform = engine.playfield_transform({ css_left: bounds.left, css_top: bounds.top,
      css_width: bounds.width, css_height: bounds.height, device_pixel_ratio: devicePixelRatio });
    const client_x = Number(transform.client_left) + 256 * Number(transform.scale);
    const client_y = Number(transform.client_top) + 192 * Number(transform.scale);
    const x = client_x * Number(transform.inverse_a) + Number(transform.inverse_e);
    const y = client_y * Number(transform.inverse_d) + Number(transform.inverse_f);
    engine.submit_inputs(session, [{ sequence: 1n, raw_time_ms: 1000, effective_time_ms: 1000, x, y, action_bits: 1 }]);
    const snapshot = engine.advance(session, 2000);
    engine.acknowledge(session, snapshot.summary.batch_token as bigint);
    const final = engine.result(session);
    engine.release_session(session);
    return { x, y, state: Number(final.summary.state), accuracy: Number(final.summary.accuracy),
      owned_sessions: engine.session_handles.size, owned_maps: engine.map_handles.size };
  } finally {
    engine.dispose();
  }
};
