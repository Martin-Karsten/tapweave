import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Retain evidence from completed cases, including unsuccessful overall runs.
// This records observations; it never promotes local measurements to acceptance.
const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function attachment(path) {
  const bytes = await readFile(resolve(root, path));
  return { path, sha256: hash(bytes), bytes: bytes.length };
}
async function workload_reports(directory) {
  const reports = [];
  for (const entry of (await readdir(resolve(root, directory), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const path = `${directory}/${entry.name}/renderer-workloads.json`;
    let bytes;
    try { bytes = await readFile(resolve(root, path)); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    reports.push({ artifact: { path, sha256: hash(bytes) }, report: JSON.parse(bytes) });
  }
  return reports;
}
const scene = JSON.parse(await readFile(resolve(root, 'engine/reference/findings/m3-scene-presentation.json')));
const source_paths = execFileSync('git', ['ls-files', 'engine/presentation', 'engine/render_webgl', 'engine/runtime/scene*',
  'engine/abi', 'engine/scripts/compare-scene.mjs', 'engine/tests/scene_test.odin', 'engine/tests/preparation_test.odin', 'platform/browser-js/src/renderer*',
  'platform/browser-js/src/webgl-resources.ts', 'platform/browser-js/src/render-resources.ts', 'platform/browser-js/src/engine-bridge.ts',
  'platform/browser-js/tests/scene.test.mjs', 'platform/browser-js/tests/webgl-resources.test.mjs', 'platform/browser-js/renderer-debug.html', 'platform/browser-js/tests/browser/scene*.mjs'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const logs = [
  'engine/artifacts/renderer-engine-test.log', 'engine/artifacts/renderer-circle.log', 'engine/artifacts/renderer-reference.log',
  'platform/browser-js/artifacts/renderer-unit.log', 'platform/browser-js/artifacts/renderer-build.log',
  'platform/browser-js/artifacts/renderer-browsers.log', 'platform/browser-js/artifacts/renderer-final-scene.log',
  'platform/browser-js/artifacts/renderer-validation.log', 'platform/browser-js/artifacts/renderer-matrix.log',
  'platform/browser-js/artifacts/renderer-long-matrix.log', 'platform/browser-js/artifacts/renderer-webkit-install.log',
];
const reports = [];
for (const directory of ['platform/browser-js/artifacts/browser-results',
  'platform/browser-js/artifacts/renderer-matrix-results', 'platform/browser-js/artifacts/renderer-long-matrix-results']) {
  reports.push(...await workload_reports(directory));
}
const findings = {
  schema_version: 1, generated_at: new Date().toISOString(), classification: 'local-renderer-increment-not-acceptance',
  complete: false, acceptance: ['A22', 'A24', 'A25'],
  base_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  source_note: 'Source hashes describe this evidence capture; workload reports include earlier smoke harness runs. Consult each report and log, not just the base commit.',
  source_commit: scene.source_commit, framework_commit: scene.framework_commit,
  wasm: await attachment('engine/artifacts/tapweave.wasm'),
  sources: await Promise.all(source_paths.map(attachment)), logs: await Promise.all(logs.map(attachment)),
  pinned_scene: { artifact: await attachment('engine/reference/findings/m3-scene-presentation.json'),
    cases: scene.findings.length, compared: scene.findings.reduce((sum, item) => sum + item.compared, 0),
    differences: scene.findings.reduce((sum, item) => sum + item.differences, 0) },
  workload_reports: reports,
  limitations: [
    'Full A22 remains open: spinner progress and post-stall tracking differences; incomplete nested/feedback/follow/cursor evidence.',
    'Firefox 1543 and WebKit 2359 launch blocked by unavailable executables; download attempts timed out.',
    'Workload measurements use SwiftShader, include concurrent development load and are unapproved diagnostics.',
    'GPU sample count zero means unavailable. Idle RAF intervals are not loaded frame pacing. WASM pages are not total retained/peak memory.',
    'Full matrix and shipping limit derivation remain open. The 10000-object workload renders only a three-second prefix.',
    'Play, integrated lifecycle and full M3 remain gated.',
  ],
};
const output = resolve(root, 'engine/reference/findings/m3-renderer.json');
await writeFile(output, JSON.stringify(findings, null, 2) + '\n');
console.log(`Recorded ${reports.length} completed workload reports in ${relative(root, output)}; acceptance remains open.`);
