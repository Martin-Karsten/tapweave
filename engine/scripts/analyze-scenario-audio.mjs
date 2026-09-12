import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const scenarios = JSON.parse(await readFile(new URL('../reference/findings/m3-scenarios.json', import.meta.url)));
const findings = [];
for (const scenario of scenarios.findings.filter(finding => /^(slider-toggle|spinner-motion)-/.test(finding.id))) {
  const fixture_bytes = await readFile(new URL(`../artifacts/scenarios/${scenario.id}.fixture.json`, import.meta.url));
  const observation_bytes = await readFile(new URL(`../artifacts/scenarios/${scenario.id}.upstream.json`, import.meta.url));
  assert.equal(digest(fixture_bytes), scenario.fixture_sha256);
  assert.equal(digest(observation_bytes), scenario.observation_sha256);
  const fixture = JSON.parse(fixture_bytes);
  const observation = JSON.parse(observation_bytes);
  assert.equal(fixture.observe_audio, true);
  assert.equal(observation.clock_rate, 1);
  assert.equal(observation.source_commit, scenarios.source_commit);
  assert.equal(observation.framework_commit, scenarios.framework_commit);
  assert.ok(observation.audio.length > 0);
  for (let event_index = 0; event_index < observation.audio.length; event_index++) {
    assert.equal(observation.audio[event_index].sequence, event_index + 1);
    assert.ok(Number.isFinite(observation.audio[event_index].time_ms));
  }
  const loop_frames = observation.frames.flatMap(frame => frame.objects.flatMap(object => object.sounds
    .filter(sound => sound.looping).map(sound => ({ time_ms: frame.time_ms, volume: sound.volume,
      rate: sound.frequency, requested_playing: sound.requested_playing }))));
  const calls = observation.audio.filter(event => event.command === 'play' || event.command === 'stop');
  const parameter_writes = observation.audio.filter(event => event.command.startsWith('sound_'));
  assert.ok(parameter_writes.length > 0);
  const loop_calls = calls.filter(event => event.looping);
  if (scenario.stall_ms === 0) {
    assert.ok(loop_calls.some(event => event.command === 'play'));
    assert.ok(loop_calls.some(event => event.command === 'stop'));
  }
  findings.push({ id: scenario.id, fixture_sha256: scenario.fixture_sha256, observation_sha256: scenario.observation_sha256,
    classification: 'executed-upstream-observation', acceptance: ['H11', 'A20', 'A21'],
    ordered_call_count: calls.length, parameter_write_count: parameter_writes.length,
    loop_calls, minimum_volume: Math.min(...loop_frames.map(frame => frame.volume)),
    maximum_volume: Math.max(...loop_frames.map(frame => frame.volume)),
    minimum_rate: Math.min(...loop_frames.map(frame => frame.rate)), maximum_rate: Math.max(...loop_frames.map(frame => frame.rate)) });
}
await writeFile(new URL('../reference/findings/m3-audio-observations.json', import.meta.url), JSON.stringify({
  schema_version: 1, source_commit: scenarios.source_commit, framework_commit: scenarios.framework_commit,
  lock_sha256: scenarios.lock_sha256, command: 'npm --prefix engine run analyze:scenario-audio', acceptance_complete: false,
  fixture_assets: 'First lookup candidate is available as a zero-duration silent test sample',
  observation_boundary: 'Actual upstream SampleChannel play/stop calls and SkinnableSound parameter writes; sampled drawable sound state retained separately',
  policies: [
    { source: 'DrawableSlider.cs::Update', policy: 'Request sliding loop while tracking at/after start; stop on loss; update balance from ball position.' },
    { source: 'DrawableSpinner.cs::updateSpinningSample', policy: 'Start once when spinning; linear volume ramp to 1 over 300 ms, ramp to 0 on loss; new transforms replace the active ramp.' },
    { source: 'DrawableSpinner.cs::Update', policy: 'Frequency is base 0.5 plus progress when modulation is enabled.' },
    { source: 'PausableSkinnableSound.cs::SamplePlaybackDisabledChanged', policy: 'Pause leaves started one-shots playing; stops underlying loops while retaining requested state; resume schedules loop restart only if still requested.' },
  ],
  source_test_mapping: [
    { path: 'osu.Game.Rulesets.Osu.Tests/TestSceneSpinner.cs::TestSpinningSamplePitchShift', local: 'spinner-motion-*', status: 'analogous real-input setup; upstream auto-rotation test infrastructure not ported' },
    { path: 'osu.Game.Rulesets.Osu.Tests/TestSceneOsuHitObjectSamples.cs', status: 'custom beatmap/user-skin fallback parameter cases remain open; this fixture declares first-candidate availability' },
  ],
  limitations: ['These observations do not close H11 or enable Odin loop/ramp production',
    'Pause/resume policy is source-grounded here; executable lifecycle/audio matrix remains checkpoint 6/W05',
    'Virtual channel aggregate values are distinct from drawable-side parameter writes; no device mixing or audible acceptance'], findings,
}, null, 2) + '\n');
console.log(`${findings.length} actual slider/spinner audio observation schedules retained.`);
