import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './toolchain.mjs';

execFileSync(process.execPath, [resolve(root, 'scripts/verify-sources.mjs'), '--require-checkouts'], { stdio: 'inherit' });
const checkout = process.env.OSU_REFERENCE_CHECKOUT ?? resolve(root, '.reference/osu');
const upstream_path = 'osu.Game.Tests/Visual/Gameplay/TestScenePauseInputHandling.cs';
const original = readFileSync(resolve(checkout, upstream_path), 'utf8');
let expected_port = original.replaceAll('\r\n', '\n').replace('using osu.Game.Rulesets.Mania;\n', '');
// Keep all standard setup, sequences and assertions unchanged. Omit only the
// out-of-scope Mania methods, then rename the class to avoid type collisions.
const mania_methods = [...expected_port.matchAll(/        \[Test\]\n        public void TestMania\w+\(\)\n        \{/g)];
for (const method of mania_methods.reverse()) {
  let end = method.index + method[0].length;
  let depth = 1;
  while (depth) {
    if (expected_port[end] === '{') depth++;
    if (expected_port[end] === '}') depth--;
    assert.ok(end < expected_port.length, 'Unterminated upstream method');
    end++;
  }
  expected_port = expected_port.slice(0, method.index) + expected_port.slice(end);
}
expected_port = expected_port.replaceAll('TestScenePauseInputHandling', 'PinnedPauseInputScene');
assert.equal(readFileSync(resolve(root, 'reference-host/PinnedPauseInputScene.cs'), 'utf8'), expected_port,
  'Pinned pause port must preserve all standard test bodies');
const dotnet = process.env.DOTNET_BIN || 'dotnet';
const project = resolve(root, 'reference-host/ReferenceHost.csproj');
execFileSync(dotnet, ['restore', project, '--locked-mode'], { stdio: 'inherit' });
execFileSync(dotnet, ['build', project, '--no-restore', '-t:Rebuild', '-m:1', '-p:RunAnalyzers=false', '-v:quiet'], { stdio: 'inherit' });
const directory = resolve(root, 'artifacts/pause');
mkdirSync(directory, { recursive: true });
const observation_path = resolve(directory, 'upstream.json');
const log = execFileSync(dotnet, [resolve(root, 'reference-host/bin/Debug/net10.0/ReferenceHost.dll'), '--pause', observation_path],
  { timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
writeFileSync(resolve(directory, 'upstream.log'), log);
const observation = JSON.parse(readFileSync(observation_path, 'utf8'));
const expected_methods = [...original.matchAll(/public void (TestOsu\w+)\(\)/g)].map(match => match[1]);
const additional_methods = ['TestOsuNewKeyHeldWhilePausedIsNotRestored', 'TestOsuReleasedKeyboardSourceResumesWithMouseSource'];
assert.deepEqual([...observation.completed].sort(), [...expected_methods, ...additional_methods].sort());
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const local_paths = ['reference-host/PinnedPauseInputScene.cs', 'reference-host/PauseObservation.cs',
  'reference-host/PauseAdditionalScene.cs',
  'tests/resume_test.odin', '../platform/browser-js/tests/resume.test.mjs', '../platform/product-ui/tests/browser/resume.spec.mjs',
  '../platform/product-ui/tests/browser/settings.spec.mjs'];
const source_paths = [
  ['osu', 'osu.Game.Rulesets.Osu/UI/OsuResumeOverlay.cs'],
  ['osu', 'osu.Game/Rulesets/UI/DrawableRuleset.cs'],
  ['osu', 'osu.Game/Screens/Play/BreakTracker.cs'],
  ['osu', 'osu.Game/Beatmaps/Timing/BreakPeriod.cs'],
  ['osu', 'osu.Game/Screens/Play/Player.cs'],
  ['osu', 'osu.Game.Rulesets.Osu/UI/Cursor/OsuCursor.cs'],
  ['osu', 'osu.Game/Configuration/OsuConfigManager.cs'],
  ['framework', 'osu.Framework/Input/PassThroughInputManager.cs'],
  ['framework', 'osu.Framework/Graphics/Containers/DrawSizePreservingFillContainer.cs'],
];
const framework_checkout = process.env.OSU_FRAMEWORK_CHECKOUT ?? resolve(root, '.reference/framework');
const source_files = source_paths.map(([repository, path]) => ({ repository, path,
  sha256: digest(readFileSync(resolve(repository === 'osu' ? checkout : framework_checkout, path))) }));
writeFileSync(resolve(root, 'reference/findings/pause-resume.json'), JSON.stringify({ schema_version: 1,
  acceptance: ['A21', 'A23', 'A24'], complete: false, ...observation,
  oracle: 'actual-pinned-upstream-test-bodies', original_test_methods: expected_methods, source_derived_probes: additional_methods,
  local_path_base: 'engine', source_files, upstream_path, upstream_sha256: digest(Buffer.from(original)),
  observation_sha256: digest(readFileSync(observation_path)),
  local_sources: local_paths.map(path => ({ path, sha256: digest(readFileSync(resolve(root, path))) })),
  classifications: { omitted: 'Mania test methods; outside the osu!standard profile',
    fixture: 'Retained test-only inherited NoFail setup; local HP0 maps isolate the unmodded input assertions',
    remaining: 'Full pause UI/cooldown, inactive-player and physical-device acceptance remain open' },
  reproduce: 'npm --prefix engine run test:pause:upstream'
}, null, 2) + '\n');
console.log(`${expected_methods.length} pinned osu!standard pause-input test bodies and ${additional_methods.length} source-derived probes passed; full lifecycle acceptance remains open.`);
