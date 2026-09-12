import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { load_browser_runtime } from './browser-runtime.mjs';
const { Engine_Bridge } = await load_browser_runtime();

// A diagnostic intervention, not a replacement for timestamped-input evidence:
// run Odin with the times at which the controlled host queues each input.
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const artifact_url = filename => new URL(`../artifacts/scenarios/${filename}`, import.meta.url);
execFileSync(process.execPath, [new URL('./verify-sources.mjs', import.meta.url).pathname, '--require-checkouts'], { stdio: 'inherit' });
const scenarios = JSON.parse(await readFile(new URL('../reference/findings/m3-scenarios.json', import.meta.url)));
assert.equal(digest(await readFile(new URL('../reference-host/packages.lock.json', import.meta.url))), scenarios.lock_sha256);
const wasm_bytes = await readFile(new URL('../artifacts/tapweave.wasm', import.meta.url));
const findings = [];
for (const scenario of scenarios.findings) {
  const fixture_bytes = await readFile(artifact_url(`${scenario.id}.fixture.json`));
  const observation_bytes = await readFile(artifact_url(`${scenario.id}.upstream.json`));
  const original_comparison_bytes = await readFile(artifact_url(`${scenario.id}.comparison.json`));
  assert.equal(digest(fixture_bytes), scenario.fixture_sha256);
  assert.equal(digest(observation_bytes), scenario.observation_sha256);
  assert.equal(digest(original_comparison_bytes), scenario.comparison_sha256);
  const fixture = JSON.parse(fixture_bytes);
  const upstream = JSON.parse(observation_bytes);
  assert.equal(upstream.fixture_sha256, scenario.fixture_sha256);
  assert.equal(upstream.source_commit, scenarios.source_commit);
  assert.equal(upstream.framework_commit, scenarios.framework_commit);
  assert.deepEqual(upstream.frames.map(frame => frame.time_ms), fixture.schedule_ms);
  const delivery = fixture.inputs.map(input => {
    const delivery_time_ms = fixture.schedule_ms.find(time_ms => time_ms >= input.time_ms);
    assert.notEqual(delivery_time_ms, undefined, 'Input must be delivered within the observed schedule.');
    return { receipt_time_ms: input.time_ms, delivery_time_ms, x: input.x, y: input.y, actions: input.actions };
  });
  const engine = await Engine_Bridge.create(wasm_bytes);
  let local;
  try {
    const prepared = engine.prepare_map(new TextEncoder().encode(fixture.map));
    const session = engine.create_session(prepared.map_handle, {
      input_capacity: Math.max(64, delivery.length + 8), batch_capacity: Math.max(8, delivery.length) });
    engine.submit_inputs(session, delivery.map((input, input_index) => ({
      sequence: BigInt(input_index + 1), raw_time_ms: input.delivery_time_ms,
      effective_time_ms: input.delivery_time_ms, x: input.x, y: input.y, action_bits: input.actions,
    })));
    const output = engine.advance(session, fixture.schedule_ms.at(-1));
    local = Array.from({ length: output.summary.judgements_count }, (_, judgement_index) => {
      const result = output.record('judgements', judgement_index);
      return { result: result.result, score: Number(result.score_after), combo: result.combo_after };
    });
  } finally {
    engine.dispose();
  }
  const projection = upstream.judgements.map(result => ({ result: result.result, score: result.score, combo: result.combo }));
  const matches = JSON.stringify(local) === JSON.stringify(projection);
  const comparison_bytes = JSON.stringify({ delivery, local, upstream: projection });
  await writeFile(artifact_url(`${scenario.id}.delivery-comparison.json`), comparison_bytes);
  findings.push({ id: scenario.id, acceptance: scenario.acceptance,
    fixture_sha256: scenario.fixture_sha256, observation_sha256: scenario.observation_sha256,
    original_comparison_sha256: scenario.comparison_sha256, comparison_sha256: digest(comparison_bytes),
    original_classification: scenario.classification,
    delivery_classification: matches ? 'executed-and-matched' : 'executed-different',
    diagnosis: !matches ? 'residual-difference-requires-investigation' : scenario.classification === 'executed-different'
      ? 'selected-difference-eliminated-by-input-delivery-times' : 'selected-fields-match-both-input-schedules',
  });
}
await writeFile(new URL('../reference/findings/m3-scenario-delivery.json', import.meta.url), JSON.stringify({
  schema_version: 1, source_commit: scenarios.source_commit, framework_commit: scenarios.framework_commit,
  lock_sha256: scenarios.lock_sha256, command: 'npm --prefix engine run compare:scenario-delivery',
  acceptance_complete: false,
  intervention: 'Odin input timestamps replaced only in this diagnostic by first declared upstream update at or after receipt. Original fixture, oracle and receipt-time comparison unchanged.',
  compared_fields: ['ordered result', 'score', 'combo'],
  limitations: ['No judgement timing, health, replay or audio comparison',
    'Matching after intervention does not prove receipt-time equivalence or justify changing production input timestamps',
    'Multiple queued inputs can still differ in framework dispatch semantics',
    'Equivalent upstream test ports remain open as recorded in m3-scenarios.json'],
  findings,
}, null, 2) + '\n');
console.log(`${findings.length} delivery diagnostics: ${findings.filter(finding => finding.delivery_classification === 'executed-and-matched').length} match selected fields; ${findings.filter(finding => finding.delivery_classification === 'executed-different').length} residual differences.`);
