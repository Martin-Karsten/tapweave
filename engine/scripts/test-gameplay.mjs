import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomFillSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, compile, verifyCompiler } from './toolchain.mjs';
import { gameplayFixtures, localFixture, schedules } from './gameplay-fixtures.mjs';
import { sourceInventory, hash } from './gameplay-provenance.mjs';
import { gameplayWorkloads } from './gameplay-workloads.mjs';
import { validateGameplay } from './gameplay-schema.mjs';

const upstream_enabled = process.argv.includes('--upstream');
const filter_argument = process.argv.find(argument => argument.startsWith('--filter='));
const workloads_enabled = process.argv.includes('--workloads');
assert.ok(!(upstream_enabled && workloads_enabled), 'Workloads are local regressions, not upstream fixtures');
const schedule_indices = workloads_enabled ? [0, 8] : Array.from({ length: 17 }, (_, schedule_index) => schedule_index);
const fixtures = (workloads_enabled ? gameplayWorkloads() : gameplayFixtures()).filter(fixture => !filter_argument || fixture.id.includes(filter_argument.slice(9)));
assert.ok(fixtures.length, 'No matching gameplay fixtures');
const directory = resolve(root, workloads_enabled ? 'artifacts/gameplay-workloads' : 'artifacts/gameplay');
mkdirSync(directory, { recursive: true });
const compiler = verifyCompiler();
execFileSync(process.execPath, [resolve(root, 'scripts/verify-sources.mjs'), ...(upstream_enabled ? ['--require-checkouts'] : [])], { stdio: 'inherit' });
const sources = upstream_enabled ? sourceInventory(fixtures, process.env.OSU_REFERENCE_CHECKOUT || resolve(root, '.reference/osu')) : [];
compile(['build', 'gameplay_native', '-o:speed', '-out:artifacts/gameplay-native']);
compile(['build', 'gameplay_wasm', '-target:js_wasm32', '-o:speed', '-out:artifacts/gameplay.wasm', '-extra-linker-flags:--export-memory --max-memory=268435456']);
let memory;
const { instance } = await WebAssembly.instantiate(readFileSync(resolve(root, 'artifacts/gameplay.wasm')), { odin_env: {
  pow: Math.pow, sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, atan2: Math.atan2,
  write(descriptor, address, byte_count) {
    (descriptor === 2 ? process.stderr : process.stdout).write(new Uint8Array(memory.buffer, address, byte_count));
    return byte_count;
  },
  rand_bytes(address, byte_count) { randomFillSync(new Uint8Array(memory.buffer, address, byte_count)); },
} });
const wasm = instance.exports;
memory = wasm.memory;
const failures = [];
function check(label, assertion) {
  try { assertion(); } catch (error) { failures.push({ label, message: error.message }); }
}
function assertExpected(fixture, observation) {
  const judgements = observation.judgements;
  const expected = fixture.expected;
  if (expected.judgement_count) assert.equal(judgements.length, expected.judgement_count);
  if (expected.recorded_actions) {
    for (const actions of expected.recorded_actions)
      assert.ok(observation.recording.some(frame => frame.action_bits === actions), `No recorded action ${actions}`);
  }
  if (expected.state && observation.state) assert.equal(observation.state, expected.state);
  if (expected.component_results) {
    for (const [object_type, expected_result] of Object.entries(expected.component_results)) {
      const components = judgements.filter(judgement => judgement.object_type === object_type);
      assert.ok(components.length > 0, `Missing ${object_type}`);
      assert.ok(components.every(judgement => judgement.result === expected_result), `${object_type} result`);
    }
  }
  if (expected.object_results)
    assert.deepEqual(judgements.toSorted((left, right) => left.object_index - right.object_index).map(judgement => judgement.result), expected.object_results);
  if (expected.results)
    assert.deepEqual(judgements.map(judgement => judgement.result), expected.results);
  if (expected.assertion === 'all_max')
    assert.ok(judgements.every(judgement => judgement.result === judgement.maximum), 'Every component must receive its maximum result');
  if (expected.assertion === 'all_min')
    assert.ok(judgements.every(judgement => judgement.result === (judgement.object_type === 'Spinner' ? 1 : 13)), 'Every spinner component must receive its minimum result');
  if (expected.assertion?.includes('tail')) {
    const tail = judgements.filter(judgement => judgement.object_type === 'SliderTailCircle');
    assert.equal(tail.length, 1);
    assert.equal(tail[0].result, expected.assertion === 'tail_miss' ? 13 : 16);
    if (expected.assertion === 'head_miss_tail_hit')
      assert.equal(judgements[0].result, 1);
  }
  if (expected.spins) {
    const ticks = judgements.filter(judgement => judgement.object_type === 'SpinnerTick');
    assert.deepEqual(ticks.slice(0, expected.spins + 1).map(judgement => judgement.result), [...Array(expected.spins).fill(11), 13]);
  }
}
const baseline = new Map();
const records = fixtures.map(fixture => ({ id: fixture.id, acceptance: fixture.acceptance,
  upstream_tests: fixture.upstream_tests, source_symbols: fixture.source_symbols ?? [], adaptation: fixture.adaptation ?? null,
  fixture_sha256: hash(JSON.stringify(fixture)), schedules: [], upstream: null }));
for (const schedule_index of schedule_indices) {
  const inputs = fixtures.map(fixture => localFixture(fixture, schedules(fixture)[schedule_index].times));
  const fixture_bytes = JSON.stringify(inputs);
  const fixture_path = resolve(directory, `local-${schedule_index}.json`);
  writeFileSync(fixture_path, fixture_bytes);
  const native_text = execFileSync(resolve(root, 'artifacts/gameplay-native'), [fixture_path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
  const bytes = Buffer.from(fixture_bytes);
  const address = wasm.gameplay_reserve(bytes.length);
  assert.ok(address);
  new Uint8Array(memory.buffer, address, bytes.length).set(bytes);
  const byte_count = wasm.gameplay_run();
  assert.ok(byte_count, 'WASM gameplay trace failed');
  const wasm_text = new TextDecoder().decode(new Uint8Array(memory.buffer, wasm.gameplay_output(), byte_count));
  assert.equal(wasm_text, native_text, `Native/WASM gameplay disagreement at schedule ${schedule_index}`);
  const observations = JSON.parse(native_text);
  assert.equal(observations.length, fixtures.length);
  writeFileSync(resolve(directory, `local-${schedule_index}.observations.json`), native_text);
  for (const [fixture_index, observation] of observations.entries()) {
    const fixture = fixtures[fixture_index];
    assert.equal(observation.id, fixture.id);
    validateGameplay(observation);
    if (schedule_index === 0) {
      baseline.set(fixture.id, observation);
      check(`${fixture.id}: ported assertions`, () => assertExpected(fixture, observation));
      if (fixture.audio && fixture.expected.results) {
        // These single-slider/circle ports have one sample per successful
        // scoring component. The parent IgnoreHit is visual and adds no sample.
        const requests = fixture.expected.results.filter(result => [2, 3, 5, 10, 16].includes(result)).length;
        check(`${fixture.id}: local sample eligibility`, () => assert.equal(observation.audio.length, requests));
      }
    } else {
      check(`${fixture.id}: cadence invariant`, () => assert.deepEqual(observation, baseline.get(fixture.id)));
    }
    records[fixture_index].schedules.push({ id: schedules(fixture)[schedule_index].id, input_sha256: hash(JSON.stringify(inputs[fixture_index])), observation_sha256: hash(JSON.stringify(observation)), native_wasm_equal: true });
  }
}
wasm.gameplay_dispose();
wasm.gameplay_dispose();
assert.equal(wasm.gameplay_reserve(0xffffffff), 0);
console.log(`${fixtures.length} gameplay fixtures × ${schedule_indices.length} schedules: native/WASM parity checked; ${failures.length} local assertion failures.`);
if (upstream_enabled) {
  const dotnet = process.env.DOTNET_BIN || 'dotnet';
  const project = resolve(root, 'reference-host/ReferenceHost.csproj');
  execFileSync(dotnet, ['restore', project, '--locked-mode'], { stdio: 'inherit' });
  execFileSync(dotnet, ['build', project, '--no-restore', '-t:Rebuild', '-m:1', '-p:RunAnalyzers=false', '-v:quiet'], { stdio: 'inherit' });
  for (const [fixture_index, fixture] of fixtures.entries()) {
    // Exact input boundaries are included, without moving the receipt timestamps.
    // This semantic schedule establishes the assertion oracle independently of
    // the separate frame-quantisation experiments in test-scenarios.mjs.
    const schedule_ms = [...new Set([0, fixture.end_ms, ...fixture.inputs.map(frame => frame.time_ms),
      ...Array.from({ length: fixture.end_ms / 10 }, (_, frame_index) => frame_index * 10)])].sort((left, right) => left - right);
    const envelope = { schema_version: 1, id: fixture.id, profile: 'unmodded-lazer-zero-offset-rate-1',
      map: fixture.map, inputs: fixture.inputs, replay: fixture.replay, record: fixture.record ?? false, schedule_ms, capture_frames: false };
    const fixture_bytes = JSON.stringify(envelope);
    const fixture_path = resolve(directory, `${fixture.id}.upstream-fixture.json`);
    const observation_path = resolve(directory, `${fixture.id}.upstream.json`);
    writeFileSync(fixture_path, fixture_bytes);
    const log = execFileSync(dotnet, [resolve(root, 'reference-host/bin/Debug/net10.0/ReferenceHost.dll'), fixture.player ? '--player' : '--scenario', fixture_path, observation_path], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    writeFileSync(resolve(directory, `${fixture.id}.upstream.log`), log);
    const upstream_bytes = readFileSync(observation_path);
    const envelope_observation = JSON.parse(upstream_bytes);
    assert.equal(envelope_observation.fixture_sha256, hash(fixture_bytes));
    const observation = fixture.player ? { ...envelope_observation, ...envelope_observation.observation, summary: envelope_observation.observation } : envelope_observation;
    if (fixture.player) {
      // Player emits visual results during its failure animation, but its score
      // processor rejects FailedAtJudgement records. Keep them in the raw oracle
      // and compare the committed gameplay journal against accepted results.
      observation.judgements = observation.judgements.filter(judgement => !judgement.failed_at_judgement);
    }
    check(`${fixture.id}: upstream ported assertions`, () => assertExpected(fixture, observation));
    const local = baseline.get(fixture.id);
    const projection = judgement => ({ object_index: judgement.object_index, object_type: judgement.object_type,
      result: judgement.result, maximum: judgement.maximum, score: judgement.score, combo: judgement.combo });
    check(`${fixture.id}: upstream ordered judgements`, () => assert.deepEqual(local.judgements.map(projection), observation.judgements.map(projection)));
    for (const field of ['score', 'combo', 'highest_combo', 'rank', 'counts'])
      check(`${fixture.id}: upstream ${field}`, () => assert.deepEqual(local[field], observation.summary[field]));
    check(`${fixture.id}: upstream accuracy`, () => assert.ok(Math.abs(local.accuracy - observation.summary.accuracy) <= Number.EPSILON));
    if (fixture.audio) {
      const requests = observation.sample_requests.flatMap(request => request.samples.map(sample => ({
        time_ms: request.time_ms, object_id: request.object_index, volume: sample.volume / 100,
      })));
      // The upstream adapter observes requests after a frame update. Project
      // semantic intent time to its delivery frame without retiming engine input
      // or changing the retained local event. This is an exact clock mapping,
      // not a tolerance on arbitrary request-time disagreement.
      const delivered_requests = local.audio.map(event => {
        const delivery_ms = schedule_ms.find(time_ms => time_ms >= event.time_ms);
        assert.notEqual(delivery_ms, undefined, 'Sample request extends past the observation schedule');
        return { time_ms: delivery_ms, object_id: event.object_id, volume: event.volume };
      });
      check(`${fixture.id}: upstream discrete sample requests`, () => assert.deepEqual(delivered_requests, requests));
      check(`${fixture.id}: missing assets are explicit silence`, () => assert.ok(local.audio.every(event => event.asset_id === 0 && event.missing)));
    }
    if (fixture.player) {
      check(`${fixture.id}: player failure`, () => assert.equal(local.state === 'FAILED', observation.failed));
      check(`${fixture.id}: player health`, () => assert.ok(Math.abs(local.health - observation.health) <= 1e-9, `${local.health} versus ${observation.health}`));
      for (const [judgement_index, judgement] of local.judgements.entries()) {
        check(`${fixture.id}: player health at result ${judgement_index}`, () => assert.ok(Math.abs(judgement.health - observation.judgements[judgement_index]?.health) <= 1e-9,
          `${judgement.health} versus ${observation.judgements[judgement_index]?.health}`));
      }
    }
    records[fixture_index].upstream = { fixture_sha256: hash(fixture_bytes), observation_sha256: hash(upstream_bytes), adapter: observation.adapter,
      compared_fields: ['ordered object/result/maximum/score/combo', 'final score/combo/highest_combo/rank/counts/accuracy',
        ...(fixture.player ? ['player failure/final health/per-result health'] : []),
        ...(fixture.record ? ['recorded action assertions'] : []),
        ...(fixture.audio ? ['discrete sample delivery frame/object/volume'] : [])] };
    console.log(`${fixture.id}: upstream observed`);
  }
}
const manifest = JSON.parse(readFileSync(resolve(root, 'reference/source-manifest.json')));
const report = { schema_version: 1, compiler, source_commit: manifest.osu.commit, framework_commit: manifest.framework.commit,
  lock_sha256: hash(readFileSync(resolve(root, 'reference-host/packages.lock.json'))), upstream_executed: upstream_enabled,
  filtered: Boolean(filter_argument), sources, records, failures,
  limitations: ['Player health/failure uses a semantic boundary schedule with audio-clock smoothing disabled; arbitrary upstream render-cadence equivalence remains open.',
    'Judgement deadline quantisation is observed separately; this comparison does not claim equal automatic-result times.',
    'Recording ports assert action retention, not full adaptive recorder sampling equivalence.',
    'Discrete sample requests cover the marked fixtures; asset selection, loops, browser playback and presentation acceptance remain separate.'],
};
writeFileSync(resolve(directory, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
assert.equal(failures.length, 0, `${failures.length} gameplay failures. See ${directory}/acceptance.json\n${JSON.stringify(failures.slice(0, 12), null, 2)}`);
console.log('All selected gameplay assertions and comparisons passed.');
