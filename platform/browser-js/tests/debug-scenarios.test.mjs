import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { debug_scenarios, Debug_Scenario_Run, DEBUG_SCENARIO_MAP } from '../build/debug-scenarios.js';
import { Diagnostics_Service } from '../build/diagnostics.js';
import { serialize_debug_report, build_debug_report, PINNED_SOURCE_REVISIONS } from '../build/debug-report.js';
import { Engine_Bridge } from '../build/engine-bridge.js';

const wasm = await readFile(new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url));
const definitions = debug_scenarios();

test('scenario corpus covers the required groups and declares browser-only scenarios', () => {
  const groups = new Set(definitions.map(definition => definition.group));
  for (const group of ['clock', 'delivery', 'input', 'lifecycle', 'audio', 'graphics']) {
    assert.ok(groups.has(group), `missing group ${group}`);
  }
  for (const skew of [-400, -10, -2, 0, 2, 10]) {
    assert.ok(definitions.some(definition => definition.parameters.clock_skew_ms === skew),
      `missing clock skew ${skew}`);
  }
  for (const rate of [30, 60, 120, 144]) {
    assert.ok(definitions.some(definition => definition.parameters.rate_hz === rate), `missing rate ${rate}`);
  }
  for (const stall of [50, 100, 250]) {
    assert.ok(definitions.some(definition => definition.parameters.stall_ms === stall), `missing stall ${stall}`);
  }
  for (const browser_only of ['audio-real-start', 'graphics-loss-restoration', 'graphics-dispatch-failure', 'graphics-capacity-exhaustion']) {
    const definition = definitions.find(candidate => candidate.id === browser_only);
    assert.ok(definition && !definition.synthetic, `${browser_only} must declare real browser resources`);
  }
});

test('every synthetic scenario passes its declared assertions against production WASM', async () => {
  for (const definition of definitions.filter(candidate => candidate.synthetic)) {
    const run = await Debug_Scenario_Run.create(wasm, definition);
    try {
      const summary = await run.run_to_completion();
      const failures = summary.assertions.filter(assertion => !assertion.passed);
      assert.deepEqual(failures.map(assertion => `${definition.id}: ${assertion.description} (observed ${assertion.observed})`), [],
        `scenario ${definition.id} failed`);
    } finally {
      run.dispose();
    }
  }
});

test('browser-only scenarios reject explicitly outside a browser workspace', async () => {
  for (const definition of definitions.filter(candidate => !candidate.synthetic)) {
    await assert.rejects(() => Debug_Scenario_Run.create(wasm, definition),
      error => error.code === 'UNSUPPORTED', `${definition.id} must reject without browser resources`);
  }
});

test('clock mismatch retains exact mapped timestamps and lateness in production WASM', async () => {
  const definition = definitions.find(candidate => candidate.id === 'clock-mismatch-rejection');
  const diagnostics = new Diagnostics_Service();
  const run = await Debug_Scenario_Run.create(wasm, definition, { diagnostics });
  try {
    await run.run_to_completion();
    const inputs = diagnostics.ordered_inputs();
    // The -400 ms stamp skew maps the first scripted press exactly to 1095 ms;
    // the run aborts at the first rejected batch, so one record is retained.
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].mapped_time_ms, 1095);
    assert.equal(inputs[0].receipt_ms, 1095);
    const failure = diagnostics.first_failure;
    assert.equal(failure.operation, 'oe_session_inputs_from_reserved');
    assert.equal(failure.status, 'ENGINE_7');
    const capture = failure.detail.timing_capture;
    assert.equal(capture.batch_count, 1);
    assert.equal(capture.first_late_index, 0);
    // The 60 Hz frame before delivery pumps the engine to exactly
    // 1483.333333333335 ms; the mapped 1095 ms input is late by that delta.
    assert.ok(Math.abs(capture.last_committed_ms - (89 * 1000 / 60)) < 1e-9,
      `unexpected committed ${capture.last_committed_ms}`);
    const sample = capture.input_samples[0];
    assert.equal(sample.receipt.raw_time_ms, 1095);
    assert.equal(sample.mapped.effective_time_ms, 1095);
    assert.ok(Math.abs(sample.behind_committed_ms - (89 * 1000 / 60 - 1095)) < 1e-9,
      `unexpected lateness ${sample.behind_committed_ms}`);
    assert.ok(capture.clock_mapping);
    // The binding receipt is a wall-clock diagnostic; judgement timestamps are
    // the deterministic audio stamps recorded above.
    assert.ok(Number.isFinite(capture.clock_mapping.receipt_ms));
  } finally {
    run.dispose();
  }
});

test('diagnostic capture modes do not change gameplay results or ordered engine outputs', async () => {
  const definition = definitions.find(candidate => candidate.id === 'delivery-60hz');
  const observed = {};
  for (const capture_mode of ['basic', 'detailed']) {
    const diagnostics = new Diagnostics_Service();
    diagnostics.capture_mode = capture_mode;
    const run = await Debug_Scenario_Run.create(wasm, definition, { diagnostics });
    try {
      const summary = await run.run_to_completion();
      observed[capture_mode] = { score: summary.score, state: summary.final_state,
        committed_ms: run.playback_for_test?.last_committed_ms ?? summary.committed_ms,
        wasm_pages: [...new Set(diagnostics.ordered_frames().map(frame => frame.wasm_pages))],
        report_bytes: serialize_debug_report(build_debug_report(diagnostics,
          { engine: null, wasm_sha256: null, sources: PINNED_SOURCE_REVISIONS, map: null, browser: null,
            audio: null, capabilities: null, notes: [] }, 'scenario')).length };
    } finally {
      run.dispose();
    }
  }
  const engine = await Engine_Bridge.create(wasm);
  try {
    const map = engine.prepare_map(new TextEncoder().encode(DEBUG_SCENARIO_MAP));
    const session = engine.create_session(map.map_handle, { input_capacity: 64, batch_capacity: 64 });
    const script_inputs = definition.inputs.map((event, event_index) => ({
      sequence: BigInt(event_index + 1), raw_time_ms: event.time_ms, effective_time_ms: event.time_ms,
      x: event.x, y: event.y, action_bits: event.action_bits === 0 ? undefinedHold(event.held, event.source) : event.action_bits }));
    // The direct schedule submits the same scripted actions at the same times
    // without any browser service or diagnostics attached.
    const held = new Set();
    const records = [];
    for (const event of definition.inputs) {
      if (event.source === 'KeyZ' || event.source === 'mouse:0' || event.source === 'KeyX' || event.source === 'mouse:2') {
        if (event.held) held.add(event.source);
        else held.delete(event.source);
      }
      let action_bits = 0;
      for (const source of held) action_bits += source === 'KeyZ' || source === 'mouse:0' ? 1 : 2;
      records.push({ sequence: BigInt(records.length + 1), raw_time_ms: event.time_ms,
        effective_time_ms: event.time_ms, x: event.x, y: event.y, action_bits });
    }
    void script_inputs;
    engine.submit_inputs(session, records);
    let committed_ms = 0;
    for (let frame_time = 1000 / 60; frame_time <= 5000; frame_time += 1000 / 60) {
      const snapshot = engine.advance(session, frame_time);
      committed_ms = Number(snapshot.summary.committed_ms);
    }
    const final_result = engine.result(session);
    observed.disabled = { score: final_result.summary.score.toString(), state: Number(final_result.summary.state),
      committed_ms };
    engine.release_session(session);
    engine.release_map(map.map_handle);
  } finally {
    engine.dispose();
  }
  assert.equal(observed.basic.score, observed.detailed.score);
  assert.equal(observed.basic.state, observed.detailed.state);
  assert.equal(observed.basic.committed_ms, observed.detailed.committed_ms);
  assert.equal(observed.basic.score, observed.disabled.score);
  assert.equal(observed.basic.state, observed.disabled.state);
  // The direct schedule may commit the final frame slightly earlier because it
  // advances in exact 1/60 steps without a terminal drain; scores must match.
  assert.ok(Math.abs(observed.basic.committed_ms - observed.disabled.committed_ms) < 1000 / 60 + 1e-6);
  assert.ok(observed.detailed.report_bytes > observed.basic.report_bytes);
  // Instrumentation must not grow WASM memory: page counts stay constant and
  // identical across capture modes for the same workload.
  assert.deepEqual(observed.detailed.wasm_pages, observed.basic.wasm_pages);
  assert.equal(new Set(observed.basic.wasm_pages).size, 1);
});

function undefinedHold() {
  return 0;
}
