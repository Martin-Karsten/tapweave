import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { load_browser_runtime } from './browser-runtime.mjs';
const { Engine_Bridge, Draw_Output } = await load_browser_runtime();
import { readRecord } from '../abi/records.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
execFileSync(process.execPath, [new URL('./verify-sources.mjs', import.meta.url).pathname, '--require-checkouts'], { stdio: 'inherit' });
const scenarios = JSON.parse(await readFile(new URL('../reference/findings/m3-scenarios.json', import.meta.url)));
assert.equal(digest(await readFile(new URL('../reference-host/packages.lock.json', import.meta.url))), scenarios.lock_sha256);
const wasm_bytes = await readFile(new URL('../artifacts/tapweave.wasm', import.meta.url));
const findings = [];
for (const scenario of scenarios.findings.filter(finding => /^circle-(centre|miss|great-edge)-/.test(finding.id))) {
  const fixture_bytes = await readFile(new URL(`../artifacts/scenarios/${scenario.id}.fixture.json`, import.meta.url));
  const observation_bytes = await readFile(new URL(`../artifacts/scenarios/${scenario.id}.upstream.json`, import.meta.url));
  assert.equal(digest(fixture_bytes), scenario.fixture_sha256);
  assert.equal(digest(observation_bytes), scenario.observation_sha256);
  const fixture = JSON.parse(fixture_bytes);
  const upstream = JSON.parse(observation_bytes);
  assert.equal(upstream.fixture_sha256, scenario.fixture_sha256);
  assert.equal(upstream.source_commit, scenarios.source_commit);
  assert.equal(upstream.framework_commit, scenarios.framework_commit);
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
    const output = new Draw_Output(resources, epoch);
    const instance = {};
    for (const frame of upstream.frames.filter(frame => frame.time_ms < 1000)) {
      engine.draw(session, frame.time_ms, { css_left: 0, css_top: 0, css_width: 512, css_height: 384, device_pixel_ratio: 1 }, output);
      let alpha = 0;
      let scale = null;
      for (let instance_index = 0; instance_index < output.instances.count; instance_index++) {
        output.record_into(output.instances, instance_index, instance);
        if (instance.layer === 30) {
          alpha = instance.alpha;
          scale = instance.scale_x / object.radius;
        }
      }
      const upstream_alpha = Math.fround(frame.objects[0].approach_alpha);
      const upstream_scale = Math.fround(frame.objects[0].approach_scale);
      comparisons.push({ time_ms: frame.time_ms, alpha: Math.fround(alpha), upstream_alpha,
        scale: scale === null ? null : Math.fround(scale), upstream_scale,
        alpha_error: Math.fround(alpha) - upstream_alpha,
        scale_error: scale === null ? null : Math.fround(scale) - upstream_scale });
    }
  } finally {
    engine.dispose();
  }
  const first_difference = comparisons.findIndex(comparison => comparison.alpha_error !== 0 || comparison.scale_error !== null && comparison.scale_error !== 0);
  const comparison_bytes = JSON.stringify(comparisons);
  await writeFile(new URL(`../artifacts/scenarios/${scenario.id}.circle-draw.json`, import.meta.url), comparison_bytes);
  findings.push({ id: scenario.id, fixture_sha256: scenario.fixture_sha256, observation_sha256: scenario.observation_sha256,
    comparison_sha256: digest(comparison_bytes), samples: comparisons.length,
    classification: first_difference < 0 ? 'executed-and-matched' : 'executed-different',
    first_difference: first_difference < 0 ? null : comparisons[first_difference],
    maximum_alpha_error: Math.max(...comparisons.map(comparison => Math.abs(comparison.alpha_error))),
    maximum_scale_error: Math.max(...comparisons.map(comparison => Math.abs(comparison.scale_error ?? 0))),
    mean_signed_alpha_error: comparisons.reduce((sum, comparison) => sum + comparison.alpha_error, 0) / comparisons.length,
    mean_signed_scale_error: comparisons.reduce((sum, comparison) => sum + (comparison.scale_error ?? 0), 0) / comparisons.length });
}
await writeFile(new URL('../reference/findings/m3-circle-draw.json', import.meta.url), JSON.stringify({
  schema_version: 1, source_commit: scenarios.source_commit, framework_commit: scenarios.framework_commit,
  lock_sha256: scenarios.lock_sha256, acceptance: ['A22'], acceptance_complete: false,
  command: 'npm --prefix engine run test:scenarios:upstream && npm --prefix engine run compare:circle-draw',
  matching: 'Exact f32 projection of approach alpha and scale before object start; signed numeric errors retained. Invisible local primitives have no scale comparison.',
  source_symbols: ['osu.Game.Rulesets.Osu/Objects/Drawables/DrawableHitCircle.cs::UpdateInitialTransforms',
    'osu.Game.Rulesets.Osu/Objects/Drawables/DrawableHitCircle.cs::UpdateStartTimeStateTransforms',
    'osu.Game.Rulesets.Osu/Skinning/Default/MainCirclePiece.cs::updateStateTransforms',
    'osu.Framework/Utils/Interpolation.cs::ValueAt(float) and ValueAt(Vector2)'],
  limitations: ['Only pre-start approach alpha/scale compared; feedback and full A22 are open',
    'Circle appearance is original Tapweave styling', 'No slider/spinner, HUD, trail or follow-point draw implementation in this increment'], findings,
}, null, 2) + '\n');
console.log(`${findings.length} circle approach schedule comparisons; ${findings.filter(finding => finding.classification === 'executed-and-matched').length} exact f32 projections.`);
