import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Engine_Bridge } from '../../platform/browser-js/src/engine-bridge.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = path.join(root, 'artifacts/scenarios');
await mkdir(artifacts, { recursive: true });
const dotnet = process.env.DOTNET_BIN || 'dotnet';
const project = path.join(root, 'reference-host/ReferenceHost.csproj');
execFileSync(process.execPath, [path.join(root, 'scripts/verify-sources.mjs'), '--require-checkouts'], { stdio: 'inherit' });
execFileSync(dotnet, ['restore', project, '--locked-mode'], { stdio: 'inherit' });
// A previous component-only build may leave unwoven Realm types in obj/. The
// real input manager uses the database; rebuilding executes the pinned weaver.
execFileSync(dotnet, ['build', project, '--no-restore', '-t:Rebuild', '-m:1', '-p:RunAnalyzers=false', '-v:quiet'], { stdio: 'inherit' });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const lock_sha256 = digest(await readFile(path.join(root, 'reference-host/packages.lock.json')));
const wasm_bytes = await readFile(path.join(root, 'artifacts/tapweave.wasm'));
const map_header = 'osu file format v14\n[Difficulty]\nHPDrainRate:5\nCircleSize:5\nOverallDifficulty:5\nApproachRate:5\nSliderMultiplier:1.4\nSliderTickRate:1\n[TimingPoints]\n0,500,4,1,0,100,1,0\n[HitObjects]\n';
const scenarios = [
  { id: 'circle-centre', objects: '256,192,1000,1,0', acceptance: ['H06', 'H10', 'A13', 'A22'], inputs: [{ time_ms: 1000, x: 256, y: 192, actions: 1 }] },
  { id: 'circle-miss', objects: '256,192,1000,1,0', acceptance: ['H06', 'A13', 'A22'], inputs: [] },
  { id: 'circle-great-edge', objects: '256,192,1000,1,0', acceptance: ['H06', 'A13'], inputs: [{ time_ms: 1049.5, x: 256, y: 192, actions: 1 }] },
  { id: 'circle-early', objects: '256,192,1000,1,0', acceptance: ['H06', 'A13', 'A22'], inputs: [{ time_ms: 875, x: 256, y: 192, actions: 1 }] },
  { id: 'circle-late', objects: '256,192,1000,1,0', acceptance: ['H06', 'A13', 'A22'], inputs: [{ time_ms: 1125, x: 256, y: 192, actions: 1 }] },
  { id: 'circle-equal-time', objects: '256,192,1000,1,0\n256,192,1000,1,0', acceptance: ['H06', 'H07', 'A14'], inputs: [{ time_ms: 1000, x: 256, y: 192, actions: 3 }] },
  { id: 'slider-held', objects: '256,192,1000,2,0,L|396:192,1,140', acceptance: ['H05', 'H07', 'A15', 'A22'], inputs: [{ time_ms: 1000, x: 256, y: 192, actions: 1 }, { time_ms: 1500, x: 396, y: 192, actions: 1 }] },
  { id: 'spinner-idle', objects: '256,192,1000,8,0,2000', acceptance: ['H08', 'A16', 'A22'], inputs: [] },
  { id: 'slider-toggle', objects: '256,192,1000,2,0,L|396:192,1,140', acceptance: ['H05', 'H11', 'A15', 'A20', 'A22'], inputs: [
    { time_ms: 1000, x: 256, y: 192, actions: 1 }, { time_ms: 1150, x: 298, y: 192, actions: 0 },
    { time_ms: 1250, x: 326, y: 192, actions: 1 }, { time_ms: 1500, x: 396, y: 192, actions: 1 }] },
  { id: 'spinner-motion', objects: '256,192,1000,8,0,2000', acceptance: ['H08', 'H11', 'A16', 'A20', 'A22'],
    inputs: Array.from({ length: 121 }, (_, sample_index) => ({ time_ms: 1000 + sample_index * 1000 / 120,
      x: Math.fround(256 + 100 * Math.cos(sample_index * Math.PI / 6)),
      y: Math.fround(192 + 100 * Math.sin(sample_index * Math.PI / 6)), actions: 1 })) },
];
const source_test_inventory = {
  "search_scope": [
    "osu.Game.Rulesets.Osu.Tests/TestSceneHitCircle*.cs",
    "osu.Game.Rulesets.Osu.Tests/TestSceneSpinnerJudgement.cs",
    "osu.Game.Rulesets.Osu.Tests/TestSceneOsuHitObjectSamples.cs",
    "osu.Game.Tests/Visual/Gameplay/TestSceneGameplaySamplePlayback.cs",
    "osu.Framework/Testing/Input/ManualInputManager.cs"
  ],
  "cases": [
    {
      "upstream_test": "osu.Game.Rulesets.Osu.Tests/TestSceneHitCircleArea.cs::TestCircleHitCentre",
      "local_fixture": "circle-centre-*",
      "status": "analogous-centre-input-scenario; exact setup/parameter port remains open",
      "acceptance": [
        "A13"
      ]
    },
    {
      "upstream_test": "osu.Game.Rulesets.Osu.Tests/TestSceneSpinnerJudgement.cs::TestHitNothing",
      "local_fixture": "spinner-idle-*",
      "status": "analogous-minimum-results scenario; Player/replay setup not ported",
      "acceptance": [
        "A16",
        "A23"
      ]
    },
    {
      "upstream_test": "osu.Game.Rulesets.Osu.Tests/TestSceneOsuHitObjectSamples.cs",
      "status": "unported; sample lookup observer remains to implement",
      "acceptance": [
        "A20",
        "H11"
      ]
    },
    {
      "upstream_test": "osu.Game.Tests/Visual/Gameplay/TestSceneGameplaySamplePlayback.cs::TestAllSamplesStopDuringSeek",
      "status": "unported; upstream test is marked Ignore at pinned revision; no sample/seek acceptance claimed",
      "acceptance": [
        "A21",
        "H11"
      ]
    }
  ],
  "licence": "Upstream tests/framework are copyright ppy Pty Ltd, MIT; see THIRD_PARTY_NOTICES.md. No upstream test source or assets copied into this increment."
};
const findings = [];
for (const scenario of scenarios) {
  for (const cadence_hz of [30, 60, 144]) {
    for (const stall_ms of [0, 50, 100, 250]) {
      const id = `${scenario.id}-${cadence_hz}hz-stall-${stall_ms}`;
      const schedule_ms = [0];
      for (let frame_index = 1; frame_index / cadence_hz * 1000 <= 3000; frame_index++) {
        const time_ms = frame_index / cadence_hz * 1000;
        if (time_ms > 990 && time_ms < 990 + stall_ms) continue;
        schedule_ms.push(time_ms);
      }
      const fixture = { schema_version: 1, id, profile: 'unmodded-lazer-zero-offset-rate-1',
        map: map_header + scenario.objects, inputs: scenario.inputs, schedule_ms,
        observe_audio: scenario.id === 'slider-toggle' || scenario.id === 'spinner-motion' };
      const fixture_bytes = JSON.stringify(fixture);
      const fixture_path = path.join(artifacts, `${id}.fixture.json`);
      const observation_path = path.join(artifacts, `${id}.upstream.json`);
      await writeFile(fixture_path, fixture_bytes);
      const log = execFileSync(dotnet, [path.join(root, 'reference-host/bin/Debug/net10.0/ReferenceHost.dll'),
        '--scenario', fixture_path, observation_path], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
      await writeFile(path.join(artifacts, `${id}.log`), log);
      const observation_bytes = await readFile(observation_path);
      const upstream = JSON.parse(observation_bytes);
      assert.equal(upstream.fixture_sha256, digest(fixture_bytes));
      assert.equal(upstream.clock_rate, 1);
      assert.equal(upstream.frames.length, schedule_ms.length);
      assert.deepEqual(upstream.frames.map(frame => frame.time_ms), schedule_ms);
      assert.ok(upstream.judgements.length > 0, `${id} has no actual drawable results`);
      const engine = await Engine_Bridge.create(wasm_bytes);
      let local;
      try {
        const prepared = engine.prepare_map(new TextEncoder().encode(fixture.map));
        const session = engine.create_session(prepared.map_handle, {
          input_capacity: Math.max(64, scenario.inputs.length + 8), batch_capacity: Math.max(8, scenario.inputs.length) });
        engine.submit_inputs(session, scenario.inputs.map((input, input_index) => ({
          sequence: BigInt(input_index + 1), raw_time_ms: input.time_ms, effective_time_ms: input.time_ms,
          x: input.x, y: input.y, action_bits: input.actions,
        })));
        const output = engine.advance(session, 3000);
        local = Array.from({ length: output.summary.judgements_count }, (_, judgement_index) => {
          const result = output.record('judgements', judgement_index);
          return { result: result.result, score: Number(result.score_after), combo: result.combo_after };
        });
      } finally {
        engine.dispose();
      }
      const projection = upstream.judgements.map(result => ({ result: result.result, score: result.score, combo: result.combo }));
      const matched = JSON.stringify(local) === JSON.stringify(projection);
      const comparison = { local, upstream: projection };
      await writeFile(path.join(artifacts, `${id}.comparison.json`), JSON.stringify(comparison));
      findings.push({ id, acceptance: scenario.acceptance, cadence_hz, stall_ms,
        fixture_sha256: digest(fixture_bytes), observation_sha256: digest(observation_bytes),
        comparison_sha256: digest(JSON.stringify(comparison)),
        classification: matched ? 'executed-and-matched' : 'executed-different',
        compared_fields: ['ordered result', 'score', 'combo'],
        judgement_count: upstream.judgements.length, frame_count: upstream.frames.length });
      console.log(`${id}: ${findings.at(-1).classification}`);
    }
  }
}
await writeFile(path.join(root, 'reference/findings/m3-scenarios.json'), JSON.stringify({
  schema_version: 1, source_commit: '3c1c96f742e7aae2ff67a7361e058fe91ca3b955',
  framework_commit: 'f02756c5aa5032e6d04729922702b8d56c4bc2eb', lock_sha256,
  command: 'npm --prefix engine run test:scenarios:upstream',
  adapter: 'controlled-drawable-input', profile: 'unmodded-lazer-zero-offset-rate-1',
  input_delivery: 'first declared update at or after receipt; live input quantisation retained',
  source_test_inventory,
  limitations: ['Player health/failure is not integrated', 'replay/recorder scenarios remain open',
    'sound states are sampled; slider-toggle/spinner-motion additionally record ordered virtual-channel calls and first-candidate selection, not audible mixing or asset fallback',
    'visual fields require separate Odin animation comparisons',
    'ten bounded scenarios do not close any whole acceptance family'], findings,
}, null, 2) + '\n');
