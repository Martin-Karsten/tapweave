import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const package_root = new URL('../', import.meta.url);
const gates_root = new URL('../artifacts/gates/', import.meta.url);

const run = (command, arguments_, allow_failure = false) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd: fileURLToPath(package_root), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (exit_code) => {
      if (exit_code === 0 || allow_failure) resolve({ output, exit_code });
      else reject(new Error(`${command} ${arguments_.join(' ')} exited with ${exit_code}`));
    });
  });

// Every probe prints one JSON document on stdout; its boolean gate fields are
// asserted so a regression fails the suite instead of only logging.
const probe_expectations = {
  'hmr_probe.mjs': (result) => ({
    hmr_label_updated: result.hmr_label_updated === true,
    page_reload_avoided: result.page_reload_avoided === true,
    mounted_marker_stable: result.mounted_marker_stable === true,
    reactivity_alive_after_hmr: result.reactivity_alive_after_hmr === true,
  }),  'b1_probe.mjs': (result) => ({
    engine_ready: result.engine_ready === true,
    wasm_pages_positive: result.wasm_pages_positive === true,
    no_console_errors: Array.isArray(result.console_errors) && result.console_errors.length === 0,
  }),
  'b2_probe.mjs': (result) => ({
    dom_stays_bounded: result.dom_stays_bounded === true,
    keyboard_navigation_works: result.keyboard_navigation_works === true,
    jump_navigation_works: result.jump_navigation_works === true,
  }),
  'b3_probe.ts': (result) => ({
    frames_rendered: result.frame_count > 0,
    // The recorded gate is ~60 fps with no long tasks and no heap growth;
    // the bounds below keep CI (short probe) meaningful without being flaky.
    effective_fps_at_least_50: result.effective_fps >= 50,
    no_long_tasks: Array.isArray(result.long_task_durations) && result.long_task_durations.length === 0,
    heap_growth_bounded: result.heap_delta_bytes === null || result.heap_delta_bytes <= 2 * 1024 * 1024,
  }),
};

const parse_probe_json = (output) => {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('probe printed no JSON document');
  }
  return JSON.parse(output.slice(start, end + 1));
};

await mkdir(gates_root, { recursive: true });

await run('npm', ['run', 'prepare-assets']);
await run('npm', ['run', 'typecheck']);

// Styling conventions: tokens.css is the only home for raw colors, z-index
// values, px font sizes and the spacing scale; see scripts/gates/css_lint.mjs.
await run('node', ['scripts/gates/css_lint.mjs']);
console.log('gate css-lint passed');

// The expected-errors project deliberately re-includes src/expected_errors
// (its `exclude: []` quirk) so tsgo must fail with the recorded diagnostic
// codes; their absence would mean the checker or fixtures drifted.
const expected_errors = await run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.expected-errors.json'], true);
const expected_codes = ['TS2322', 'TS2769', 'TS1484'];
const missing_codes = expected_codes.filter((code) => !expected_errors.output.includes(code));
if (expected_errors.exit_code === 0 || missing_codes.length > 0) {
  throw new Error(`expected-errors gate failed: exit ${expected_errors.exit_code}, missing codes ${missing_codes.join(', ') || 'none'}`);
}
console.log('gate expected-errors passed');

await run('npm', ['run', 'build']);
await run('npm', ['run', 'test']);

const gate_report = { probes: {} };
let gates_failed = false;
for (const [probe_name, expectation] of Object.entries(probe_expectations)) {
  const probe = await run('node', ['scripts/gates/' + probe_name]);
  const result = parse_probe_json(probe.output);
  const checks = expectation(result);
  gate_report.probes[probe_name] = { result, checks };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([check_name]) => check_name);
  if (failed.length > 0) {
    gates_failed = true;
    console.error(`gate ${probe_name} FAILED: ${failed.join(', ')}`);
  } else {
    console.log(`gate ${probe_name} passed`);
  }
}

await writeFile(new URL('gates.json', gates_root), JSON.stringify(gate_report, null, 2) + '\n');

if (gates_failed) {
  throw new Error('one or more product-ui gates failed');
}
console.log('all product-ui gates passed');
