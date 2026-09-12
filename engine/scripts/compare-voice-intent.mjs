import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Engine_Bridge, Gameplay_Output, Voice_Output } from '../../platform/browser-js/src/engine-bridge.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const artifact = filename => new URL(`../artifacts/scenarios/${filename}`, import.meta.url);
const scenarios = JSON.parse(await readFile(new URL('../reference/findings/m3-scenarios.json', import.meta.url)));
const lock_sha256 = digest(await readFile(new URL('../reference-host/packages.lock.json', import.meta.url)));
assert.equal(lock_sha256, scenarios.lock_sha256);
const wasm = await readFile(new URL('../artifacts/tapweave.wasm', import.meta.url));
const findings = [];
for (const scenario of scenarios.findings.filter(finding => /^(slider-toggle|spinner-motion)-/.test(finding.id))) {
  const fixture_bytes = await readFile(artifact(`${scenario.id}.fixture.json`));
  const observation_bytes = await readFile(artifact(`${scenario.id}.upstream.json`));
  assert.equal(digest(fixture_bytes), scenario.fixture_sha256);
  assert.equal(digest(observation_bytes), scenario.observation_sha256);
  const fixture = JSON.parse(fixture_bytes);
  const upstream = JSON.parse(observation_bytes);
  assert.equal(upstream.source_commit, scenarios.source_commit);
  assert.equal(upstream.framework_commit, scenarios.framework_commit);
  assert.equal(upstream.clock_rate, 1);
  const engine = await Engine_Bridge.create(wasm);
  try {
    const map = engine.prepare_map(new TextEncoder().encode(fixture.map));
    const session = engine.create_session(map.map_handle, { input_capacity: Math.max(64, fixture.inputs.length + 8),
      batch_capacity: Math.max(8, fixture.inputs.length) });
    const capacity = engine.voice_reserve(session, 0, 0n, 1);
    engine.voice_reserve(session, capacity.required_commands, capacity.required_bytes, 1);
    for (const sample of map.descriptor.sample_candidates()) {
      if (sample.candidates.length) engine.bind_sample(session, { object_id: sample.object_id, component_id: sample.component_id,
        sample_index: sample.sample_index, candidate_index: 0, asset_id: 1n });
    }
    engine.submit_inputs(session, fixture.inputs.map((input, input_index) => ({ sequence: BigInt(input_index + 1),
      raw_time_ms: input.time_ms, effective_time_ms: input.time_ms, x: input.x, y: input.y, action_bits: input.actions })));
    engine.advance_output(session, fixture.schedule_ms.at(-1), new Gameplay_Output());
    const output = engine.voice_output(session, new Voice_Output());
    const commands = Array.from({ length: output.summary.commands_count }, (_, command_index) => output.record_into(command_index, {}));
    const local_loops = commands.filter(command => command.command_kind === 2 || command.command_kind === 3)
      .map(command => ({ command: command.command_kind === 2 ? 'play' : 'stop', time_ms: command.time_ms }));
    const upstream_loops = upstream.audio.filter(event => event.looping && ['play', 'stop'].includes(event.command))
      .map(event => ({ command: event.command, time_ms: event.time_ms }));
    const comparison = JSON.stringify({ local_loops, upstream_loops, commands }, (_, field) => typeof field === 'bigint' ? field.toString() : field);
    await writeFile(artifact(`${scenario.id}.voice-comparison.json`), comparison);
    const same_transitions = JSON.stringify(local_loops.map(event => event.command)) === JSON.stringify(upstream_loops.map(event => event.command));
    const exact_times = JSON.stringify(local_loops) === JSON.stringify(upstream_loops);
    findings.push({ id: scenario.id, acceptance: ['H11', 'A20', 'A21'], fixture_sha256: scenario.fixture_sha256,
      observation_sha256: scenario.observation_sha256, comparison_sha256: digest(comparison),
      transition_kinds_match: same_transitions, exact_times_match: exact_times,
      classification: exact_times ? 'selected-loop-events-match' : 'executed-different-open', local_loops, upstream_loops });
  } finally { engine.dispose(); }
}
await writeFile(new URL('../reference/findings/m3-voice-intent.json', import.meta.url), JSON.stringify({
  schema_version: 1, source_commit: scenarios.source_commit, framework_commit: scenarios.framework_commit, lock_sha256,
  command: 'npm --prefix engine run compare:voice-intent', acceptance_complete: false,
  compared_fields: ['ordered loop start/stop kinds', 'nominal loop command times'],
  source_test_mapping: [
    { upstream: 'osu.Game.Rulesets.Osu.Tests/TestSceneOsuHitObjectSamples.cs::TestDefaultCustomSampleFromBeatmap',
      local: 'tests/sample-assets.test.mjs custom bank availability; tests/audio-playback.test.mjs binding and native/WASM slider fixtures',
      classification: 'analogous availability setup; exact upstream skin fixture port remains open' },
    { upstream: 'osu.Game.Rulesets.Osu.Tests/TestSceneSpinner.cs::TestSpinningSamplePitchShift',
      local: 'spinner-motion-* real drawable observations; tests/audio-playback.test.mjs spinner ramps',
      classification: 'real-input analogue; full auto-rotation parameter port remains open' },
  ],
  limitations: ['Original input timestamps are preserved; upstream event delivery and drawable expiry differ.',
    'Continuous spinner damping is an event-driven source interpretation; exact update-quantised envelope acceptance remains open.',
    'Fallback skin matrix, seek, physical audible playback and release-browser lifecycle certification remain open.',
    'No differing expectation is treated as an accepted deterministic divergence; H11 is not complete.'], findings,
}, null, 2) + '\n');
console.log(`${findings.length} H11 comparisons: ${findings.filter(finding => finding.transition_kinds_match).length} transition-kind matches; ${findings.filter(finding => finding.exact_times_match).length} exact timing matches. Full H11 remains open.`);
