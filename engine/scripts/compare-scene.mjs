import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { root } from './toolchain.mjs';
import { load_browser_runtime } from './browser-runtime.mjs';
import { schema } from '../abi/records.mjs';
const { Engine_Bridge, Scene_Output } = await load_browser_runtime();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const corrections = process.argv.includes('--corrections');
const artifacts = resolve(root, corrections ? 'artifacts/scene-corrections' : 'artifacts/scene-reference');
await mkdir(artifacts, { recursive: true });
execFileSync(process.execPath, [resolve(root, 'scripts/verify-sources.mjs'), '--require-checkouts'], { stdio: 'inherit' });
const dotnet = process.env.DOTNET_BIN || 'dotnet';
if (!process.argv.includes('--reuse-build')) {
  execFileSync(dotnet, ['restore', resolve(root, 'reference-host/ReferenceHost.csproj'), '--locked-mode'], { stdio: 'inherit' });
  execFileSync(dotnet, ['build', resolve(root, 'reference-host/ReferenceHost.csproj'), '--no-restore', '-t:Rebuild', '-m:1', '-p:RunAnalyzers=false', '-v:quiet'], { stdio: 'inherit' });
}
const wasm = await readFile(resolve(root, 'artifacts/tapweave.wasm'));
const header = 'osu file format v14\n[Difficulty]\nHPDrainRate:0\nApproachRate:5\nSliderMultiplier:1.4\nSliderTickRate:1\n[TimingPoints]\n0,500,4,1,1,100,1,0\n[HitObjects]\n';
const scenarios = [];
for (const spans of [1, 2, 3]) {
  for (const hit of [false, true]) {
    const inputs = hit ? Array.from({ length: spans * 60 + 1 }, (_, sample_index) => {
      const progress = sample_index / 60;
      const span = Math.floor(progress);
      const position = span % 2 ? 1 - progress % 1 : progress % 1;
      return { time_ms: 1000 + sample_index * 500 / 60, x: Math.fround(150 + 140 * position), y: 180, actions: 1 };
    }) : [];
    scenarios.push({ id: `slider-${spans}-span-${hit ? 'hit' : 'miss'}`, map: header + `150,180,1000,2,0,L|290:180,${spans},140`, inputs,
      end_ms: 1000 + spans * 500 });
  }
}
scenarios.push({ id: 'spinner-idle', map: header + '256,192,1000,8,0,2000', inputs: [], end_ms: 2000 });
scenarios.push({ id: 'spinner-motion', map: header + '256,192,1000,8,0,2000', end_ms: 2000,
  inputs: Array.from({ length: 121 }, (_, sample_index) => ({ time_ms: 1000 + sample_index * 1000 / 120,
    x: Math.fround(256 + 100 * Math.cos(sample_index * Math.PI / 6)),
    y: Math.fround(192 + 100 * Math.sin(sample_index * Math.PI / 6)), actions: 1 })) });
const findings = [];
for (const scenario of scenarios) {
  for (const cadence of (corrections ? [30, 60, 120, 144] : [30, 60, 144])) {
    for (const stall of [0, 50, 100, 250]) {
      const id = `${scenario.id}-${cadence}hz-${stall}ms`;
      const schedule_ms = [0];
      for (let frame_index = 1; frame_index * 1000 / cadence <= scenario.end_ms + 300; frame_index++) {
        const time_ms = frame_index * 1000 / cadence;
        if (time_ms > 990 && time_ms < 990 + stall) continue;
        schedule_ms.push(time_ms);
      }
      const fixture = { schema_version: 1, id, profile: 'unmodded-lazer-zero-offset-rate-1', map: scenario.map,
        inputs: scenario.inputs, schedule_ms, observe_presentation: true,
        ...(corrections ? { canonical_playfield: true } : {}) };
      const fixture_bytes = JSON.stringify(fixture);
      const fixture_path = resolve(artifacts, `${id}.fixture.json`);
      const observation_path = resolve(artifacts, `${id}.upstream.json`);
      await writeFile(fixture_path, fixture_bytes);
      const log = execFileSync(dotnet, [resolve(root, 'reference-host/bin/Debug/net10.0/ReferenceHost.dll'), '--scenario', fixture_path, observation_path],
        { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
      await writeFile(resolve(artifacts, `${id}.log`), log);
      const observation_bytes = await readFile(observation_path);
      const observation = JSON.parse(observation_bytes);
      assert.equal(observation.fixture_sha256, hash(fixture_bytes));
      assert.equal(observation.clock_rate, 1);
      const engine = await Engine_Bridge.create(wasm);
      const comparisons = [];
      let sampled_session;
      let sampled_output;
      let previous_tracking = false;
      try {
        const map = engine.prepare_map(new TextEncoder().encode(scenario.map));
        const prepared_object = map.descriptor.records(map.descriptor.summary, 'objects', schema.records.find(record => record.name === 'prepared_object').kind).next().value;
        const resources = engine.scene_resources(map.map_handle);
        const session = engine.create_session(map.map_handle, { input_capacity: 1024, batch_capacity: 1024 });
        const capacity = engine.scene_reserve(session);
        engine.scene_reserve(session, capacity.required_instances, capacity.required_bytes);
        const epoch = engine.snapshot(session, 0).summary.epoch;
        const output = new Scene_Output(resources, epoch);
        if (corrections && scenario.id.startsWith('spinner')) {
          sampled_session = engine.create_session(map.map_handle, { input_capacity: 1024, batch_capacity: 1024 });
          const sampled_capacity = engine.scene_reserve(sampled_session);
          engine.scene_reserve(sampled_session, sampled_capacity.required_instances, sampled_capacity.required_bytes);
          sampled_output = new Scene_Output(resources, engine.snapshot(sampled_session, 0).summary.epoch);
          // Diagnostic only: feed the actual position sampled once per upstream
          // tracker update. Production keeps every receipt-time input segment.
          const sampled_inputs = observation.frames.filter(frame => frame.objects[0].spinner_input.x !== null).map((frame, frame_index) => {
            const input = frame.objects[0].spinner_input;
            return { sequence: BigInt(frame_index + 1), raw_time_ms: frame.time_ms, effective_time_ms: frame.time_ms,
              x: 256 + (Math.fround(input.x) - input.centre_x), y: 192 + (Math.fround(input.y) - input.centre_y),
              action_bits: frame.input_cursor.actions };
          });
          engine.submit_inputs(sampled_session, sampled_inputs);
        }
        // Explicit delivery diagnostic: match the adapter's declared delivery
        // updates. Original receipt-time gameplay compatibility remains separate.
        engine.submit_inputs(session, scenario.inputs.map((input, input_index) => {
          const delivered_ms = schedule_ms.find(time_ms => time_ms >= input.time_ms);
          return { sequence: BigInt(input_index + 1), raw_time_ms: delivered_ms, effective_time_ms: delivered_ms,
            x: input.x, y: input.y, action_bits: input.actions };
        }));
        const instance = {};
        for (const frame of observation.frames) {
          if (corrections) assert.deepEqual(frame.playfield_size, { width: 512, height: 384 });
          engine.advance(session, frame.time_ms);
          engine.scene_draw(session, frame.time_ms, { css_left: 0, css_top: 0, css_width: 512, css_height: 384, device_pixel_ratio: 1 }, output);
          const upstream = frame.objects[0];
          if (upstream.slider_visual) {
            assert.equal(upstream.slider_visual.snaking_in, true);
            assert.equal(upstream.slider_visual.snaking_out, true);
          }
          let spinner_progress = 0;
          let ball_present = false;
          let tracking_present = false;
          for (let instance_index = 0; instance_index < output.instances.count; instance_index++) {
            output.record_into(output.instances, instance_index, instance);
            if (instance.primitive === 4 && upstream.slider_visual && frame.time_ms < scenario.end_ms) {
              comparisons.push({ time_ms: frame.time_ms, field: 'snaked_start', local: instance.clip_start, upstream: upstream.slider_visual.snaked_start,
                error: Math.abs(instance.clip_start - upstream.slider_visual.snaked_start) });
              comparisons.push({ time_ms: frame.time_ms, field: 'snaked_end', local: instance.clip_end, upstream: upstream.slider_visual.snaked_end,
                error: Math.abs(instance.clip_end - upstream.slider_visual.snaked_end) });
            }
            if (upstream.slider_visual && instance.layer === 35) {
              if (instance.primitive === 1 && instance.ordinal === 0) {
                ball_present = true;
                // DrawableSlider.Ball is relative to the slider origin. These
                // fixtures have no stacking; compare canonical GPU f32 positions.
                for (const [field, local, upstream_position] of [
                  ['ball_x', instance.x, Math.fround(150 + upstream.slider_visual.ball_x)],
                  ['ball_y', instance.y, Math.fround(180 + upstream.slider_visual.ball_y)],
                ]) comparisons.push({ time_ms: frame.time_ms, field, local, upstream: upstream_position,
                  error: Math.abs(local - upstream_position), tolerance: 1e-4 });
              }
              if (instance.primitive === 2 && instance.ordinal === 1) tracking_present = true;
            }
            if (scenario.id.startsWith('spinner') && instance.primitive === 2 && instance.layer === 20 && instance.ordinal === 1 && frame.time_ms >= 1000 && frame.time_ms <= 2000) {
              spinner_progress = instance.progress;
            }
          }
          if (scenario.id.startsWith('spinner') && frame.time_ms >= 1000 && frame.time_ms <= 2000) {
            const comparison = { time_ms: frame.time_ms, field: 'spinner_progress', local: spinner_progress, upstream: upstream.spinner_progress,
              error: Math.abs(spinner_progress - upstream.spinner_progress), tolerance: 1e-6 };
            if (sampled_session) {
              engine.advance(sampled_session, frame.time_ms);
              engine.scene_draw(sampled_session, frame.time_ms, { css_left: 0, css_top: 0, css_width: 512, css_height: 384, device_pixel_ratio: 1 }, sampled_output);
              let sampled_progress = 0;
              for (let instance_index = 0; instance_index < sampled_output.instances.count; instance_index++) {
                sampled_output.record_into(sampled_output.instances, instance_index, instance);
                if (instance.primitive === 2 && instance.layer === 20 && instance.ordinal === 1) sampled_progress = instance.progress;
              }
              comparison.sampled_input_progress = sampled_progress;
              comparison.sampled_input_error = Math.abs(sampled_progress - upstream.spinner_progress);
              if (stall > 0 && comparison.error > comparison.tolerance && comparison.sampled_input_error <= comparison.tolerance) {
                comparison.disposition = 'accepted-spinner-update-sampling';
              }
              comparisons.push({ time_ms: frame.time_ms, field: 'sampled_spinner_progress', local: sampled_progress,
                upstream: upstream.spinner_progress, error: comparison.sampled_input_error, tolerance: 1e-6 });
              // Do not let the progress clamp hide excess/missing rotation.
              // Use the same 1e-6 progress tolerance, expressed in degrees.
              const rotation_tolerance = 1e-6 * 360 * Math.max(1, prepared_object.spins_required);
              const local_rotation = engine.snapshot(session, frame.time_ms).record('objects', 0).rotation;
              const sampled_rotation = engine.snapshot(sampled_session, frame.time_ms).record('objects', 0).rotation;
              const upstream_rotation = Math.fround(upstream.spinner_rotation);
              const sampled_rotation_error = Math.abs(sampled_rotation - upstream_rotation);
              const rotation_comparison = { time_ms: frame.time_ms, field: 'spinner_rotation', local: local_rotation,
                upstream: upstream_rotation, error: Math.abs(local_rotation - upstream_rotation), tolerance: rotation_tolerance,
                sampled_input_rotation: sampled_rotation, sampled_input_error: sampled_rotation_error };
              if (stall > 0 && rotation_comparison.error > rotation_tolerance && sampled_rotation_error <= rotation_tolerance) {
                rotation_comparison.disposition = 'accepted-spinner-update-sampling';
              }
              comparisons.push(rotation_comparison, { time_ms: frame.time_ms, field: 'sampled_spinner_rotation', local: sampled_rotation,
                upstream: upstream_rotation, error: sampled_rotation_error, tolerance: rotation_tolerance });
            }
            comparisons.push(comparison);
          }
          if (upstream.slider_visual && frame.time_ms >= 1000 && frame.time_ms <= scenario.end_ms) {
            comparisons.push({ time_ms: frame.time_ms, field: 'ball_present', local: ball_present, upstream: true,
              error: ball_present ? 0 : 1, tolerance: 0 });
            const comparison = { time_ms: frame.time_ms, field: 'tracking_indicator_present', local: tracking_present,
              upstream: upstream.tracking, error: tracking_present === upstream.tracking ? 0 : 1, tolerance: 0 };
            if (corrections) {
              comparison.tracking_after_children = upstream.tracking_after_children;
              comparison.previous_tracking_after_children = previous_tracking;
              if (stall === 250 && frame.time_ms === schedule_ms.find(time_ms => time_ms >= 990 + stall) &&
                comparison.error && tracking_present === upstream.tracking_after_children && upstream.tracking === previous_tracking) {
                comparison.disposition = 'accepted-slider-feedback-update-lag';
              }
              comparisons.push({ time_ms: frame.time_ms, field: 'tracking_after_children', local: tracking_present,
                upstream: upstream.tracking_after_children, error: tracking_present === upstream.tracking_after_children ? 0 : 1, tolerance: 0 });
            }
            comparisons.push(comparison);
          }
          previous_tracking = upstream.tracking_after_children;
        }
      } finally { engine.dispose(); }
      const differences = comparisons.filter(comparison => comparison.error > (comparison.tolerance ?? (comparison.field === 'spinner_progress' ? 1e-6 : 1e-12)));
      const unresolved = differences.filter(comparison => !comparison.disposition);
      const comparison_bytes = JSON.stringify(comparisons);
      await writeFile(resolve(artifacts, `${id}.comparison.json`), comparison_bytes);
      findings.push({ id, fixture_sha256: hash(fixture_bytes), observation_sha256: hash(observation_bytes),
        comparison_sha256: hash(comparison_bytes), compared: comparisons.length, differences: differences.length,
        ...(corrections ? { unresolved: unresolved.length, dispositions: Object.fromEntries(
          ['accepted-spinner-update-sampling', 'accepted-slider-feedback-update-lag'].map(disposition =>
            [disposition, differences.filter(comparison => comparison.disposition === disposition).length])) } : {}),
        classification: comparisons.length === 0 ? 'observed-no-compared-visible-state' : unresolved.length ? 'executed-different' :
          differences.length ? 'executed-with-classified-divergence' : 'executed-and-matched' });
      console.log(`${id}: ${comparisons.length} comparisons, ${differences.length} differences`);
    }
  }
}
const manifest = JSON.parse(await readFile(resolve(root, 'reference/source-manifest.json')));
await writeFile(resolve(root, corrections ? 'reference/findings/m3-scene-corrections.json' : 'reference/findings/m3-scene-presentation.json'), JSON.stringify({
  schema_version: 1, source_commit: manifest.osu.commit, framework_commit: manifest.framework.commit,
  lock_sha256: hash(await readFile(resolve(root, 'reference-host/packages.lock.json'))), acceptance: ['A22'], complete: false,
  command: corrections ? 'npm --prefix engine run compare:scene:corrections' : 'npm --prefix engine run compare:scene:upstream',
  ...(corrections ? { legacy_findings_sha256: hash(await readFile(resolve(root, 'reference/findings/m3-scene-presentation.json'))),
    adapter_sha256: hash(await readFile(resolve(root, 'reference-host/ScenarioObservation.cs'))),
    comparison_script_sha256: hash(await readFile(resolve(root, 'scripts/compare-scene.mjs'))),
    layout: 'Explicit absolute 512x384 playfield; legacy relative-size observations retained unchanged.',
    diagnostic_policy: 'Spinner sampled input is an intervention using actual upstream tracker coordinates; slider compares current and previous child tracking. No production input retiming.',
    source_evidence: await Promise.all([
      'osu.Game/Rulesets/UI/Playfield.cs',
      'osu.Game.Rulesets.Osu/Skinning/Default/SpinnerRotationTracker.cs',
      'osu.Game.Rulesets.Osu/Objects/Drawables/DrawableSpinner.cs',
      'osu.Game.Rulesets.Osu/Objects/Drawables/DrawableSlider.cs',
      'osu.Game.Rulesets.Osu/Objects/Drawables/SliderInputManager.cs',
      'osu.Game.Rulesets.Osu.Tests/TestSceneSpinnerRotation.cs',
      'osu.Game.Rulesets.Osu.Tests/TestSceneSliderInput.cs',
    ].map(async path => ({ path, sha256: hash(await readFile(resolve(process.env.OSU_REFERENCE_CHECKOUT, path))) }))),
    local_regressions: { source: 'presentation_trace/cases.odin::semantic_values', cases: 7,
      classification: 'source-derived local contract; not exact upstream test-body ports',
      search_notes: 'TestRotationDirection asserts damped disc direction after autoplay seek; TestMidSliderTrackingAcquired asserts tail results from replay. Neither tests the first post-stall update. Existing slider and spinner judgement ports remain in the gameplay suite.' } } : {}),
  input_policy: 'delivery diagnostic at declared upstream updates; not original timestamp session equivalence',
  search_scope: ['osu.Game.Rulesets.Osu.Tests/TestSceneSliderSnaking.cs', 'osu.Game.Rulesets.Osu.Tests/TestSceneSliderInput.cs',
    'osu.Game.Rulesets.Osu.Tests/TestSceneSpinnerRotation.cs', 'osu.Game.Rulesets.Osu.Tests/TestSceneSpinnerJudgement.cs',
    'osu.Game.Rulesets.Osu.Tests/Visual', 'osu.Framework/Graphics/Transforms/DefaultEasingFunction.cs'],
  test_ports: [{ source: 'TestSceneSliderSnaking.TestSnakingEnabled(0,1,2)', local: 'scene_snaking_enabled_upstream_assertion_port',
    adaptation: 'Odin supplied prepared path, semantic head hit and explicit sample times; Player/autoplay/seek infrastructure not ported',
    exclusions: ['TestSnakingDisabled: non-default setting', 'TestRepeatArrowDoesNotMove: adaptive arrow smoothing acceptance remains open'] }],
  limitations: ['Compares visible body clipping, slider ball positions and presence, tracking indicator presence, and spinner progress; adapter also records head/tail/nested states.',
    'Complete nested transforms, follow points, cursor/trail and HUD appearance acceptance remain open.',
    'Original semantic trail is a deterministic cosmetic policy; it does not reproduce framework sprite sampling.'], findings,
}, null, 2) + '\n');
if (findings.some(finding => corrections ? finding.unresolved : finding.differences)) process.exitCode = 1;
