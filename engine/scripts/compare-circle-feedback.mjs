import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { load_browser_runtime } from './browser-runtime.mjs';
const { Engine_Bridge, Draw_Output } = await load_browser_runtime();
import { readRecord } from '../abi/records.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const artifact_url = filename => new URL(`../artifacts/scenarios/${filename}`, import.meta.url);
execFileSync(process.execPath, [new URL('./verify-sources.mjs', import.meta.url).pathname, '--require-checkouts'], { stdio: 'inherit' });
const scenarios = JSON.parse(await readFile(new URL('../reference/findings/m3-scenarios.json', import.meta.url)));
assert.equal(digest(await readFile(new URL('../reference-host/packages.lock.json', import.meta.url))), scenarios.lock_sha256);
const wasm_bytes = await readFile(new URL('../artifacts/tapweave.wasm', import.meta.url));
const findings = [];
for (const scenario of scenarios.findings.filter(finding => /^circle-(centre|miss|great-edge|early|late)-/.test(finding.id))) {
  const fixture_bytes = await readFile(artifact_url(`${scenario.id}.fixture.json`));
  const observation_bytes = await readFile(artifact_url(`${scenario.id}.upstream.json`));
  assert.equal(digest(fixture_bytes), scenario.fixture_sha256);
  assert.equal(digest(observation_bytes), scenario.observation_sha256);
  const fixture = JSON.parse(fixture_bytes);
  const upstream = JSON.parse(observation_bytes);
  assert.equal(upstream.source_commit, scenarios.source_commit);
  assert.equal(upstream.framework_commit, scenarios.framework_commit);
  assert.equal(upstream.fixture_sha256, scenario.fixture_sha256);
  const engine = await Engine_Bridge.create(wasm_bytes);
  const comparisons = [];
  try {
    const prepared = engine.prepare_map(new TextEncoder().encode(fixture.map));
    const object = readRecord(prepared.descriptor.view, prepared.descriptor.summary.objects_offset, 9);
    const resources = engine.render_resources(prepared.map_handle);
    const session = engine.create_session(prepared.map_handle, { input_capacity: 8, batch_capacity: 8 });
    const epoch = engine.snapshot(session, 0).summary.epoch;
    const capacity = engine.render_reserve(session);
    engine.render_reserve(session, capacity.required_instances, capacity.required_bytes);
    engine.submit_inputs(session, fixture.inputs.map((input, input_index) => {
      const delivery_ms = fixture.schedule_ms.find(time_ms => time_ms >= input.time_ms);
      return { sequence: BigInt(input_index + 1), raw_time_ms: delivery_ms, effective_time_ms: delivery_ms,
        x: input.x, y: input.y, action_bits: input.actions };
    }));
    const gameplay = engine.advance(session, fixture.schedule_ms.at(-1));
    const judgement = gameplay.record('judgements', 0);
    assert.equal(judgement.result, upstream.judgements[0].result);
    const upstream_result_ms = object.time_ms + upstream.judgements[0].offset_ms;
    const output = new Draw_Output(resources, epoch);
    const instance = {};
    for (const frame of upstream.frames) {
      const elapsed_ms = frame.time_ms - upstream_result_ms;
      if (elapsed_ms < 0 || elapsed_ms >= 800) continue;
      const requested_ms = judgement.time_ms + elapsed_ms;
      engine.draw(session, requested_ms, { css_left: 0, css_top: 0, css_width: 512, css_height: 384, device_pixel_ratio: 1 }, output);
      let alpha = 0;
      let scale = null;
      for (let instance_index = 0; instance_index < output.instances.count; instance_index++) {
        output.record_into(output.instances, instance_index, instance);
        if (instance.layer === (judgement.result === 1 ? 20 : 40)) {
          alpha = instance.alpha;
          scale = instance.scale_x / object.radius;
          break;
        }
      }
      const observed = frame.objects[0];
      assert.equal(observed.main_circle.length, 1);
      // Removed drawables retain their last property values. Their expired
      // lifetime makes them invisible; a frozen nonzero Alpha is not output.
      const alive = frame.time_ms >= observed.lifetime_start && (observed.lifetime_end === null || frame.time_ms < observed.lifetime_end);
      const upstream_alpha = alive ? Math.fround(observed.alpha) * Math.fround(observed.circle_piece_alpha) * Math.fround(observed.main_circle[0].alpha) : 0;
      const upstream_scale = Math.fround(observed.main_circle[0].scale);
      comparisons.push({ upstream_ms: frame.time_ms, local_ms: requested_ms, elapsed_ms,
        alpha_error: Math.fround(alpha) - Math.fround(upstream_alpha),
        scale_error: scale === null ? null : Math.fround(scale) - upstream_scale });
    }
  } finally {
    engine.dispose();
  }
  assert.ok(comparisons.length > 0);
  const differences = comparisons.filter(comparison => comparison.alpha_error !== 0 || comparison.scale_error !== null && comparison.scale_error !== 0);
  const comparison_bytes = JSON.stringify(comparisons);
  await writeFile(artifact_url(`${scenario.id}.circle-feedback.json`), comparison_bytes);
  findings.push({ id: scenario.id, fixture_sha256: scenario.fixture_sha256, observation_sha256: scenario.observation_sha256,
    comparison_sha256: digest(comparison_bytes), samples: comparisons.length, differences: differences.length,
    classification: differences.length === 0 ? 'executed-and-matched' : 'executed-different',
    first_difference: differences[0] ?? null });
}
await writeFile(new URL('../reference/findings/m3-circle-feedback.json', import.meta.url), JSON.stringify({
  schema_version: 1, source_commit: scenarios.source_commit, framework_commit: scenarios.framework_commit,
  lock_sha256: scenarios.lock_sha256, acceptance: ['A22'], acceptance_complete: false,
  command: 'npm --prefix engine run compare:circle-feedback',
  matching: 'Exact f32 effective feedback alpha and MainCirclePiece scale at equal elapsed time after each implementation result. Both times retained; this isolates visual curves from live miss-deadline quantisation.',
  limitations: ['Original Tapweave feedback ring represents the main-piece transform, not upstream skin pixels',
    'Separate parent-result anchors do not establish judgement-time equivalence',
    'Child flash/explode appearance and full A22 remain open'], findings,
}, null, 2) + '\n');
console.log(`${findings.length} circle feedback comparisons: ${findings.filter(finding => finding.differences === 0).length} exact f32 projections.`);
