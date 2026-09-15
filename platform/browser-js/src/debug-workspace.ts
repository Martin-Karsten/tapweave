import { debug_scenarios, Debug_Scenario_Run, type Debug_Scenario_Definition,
  type Scenario_Run_Summary } from './debug-scenarios.js';
import { Diagnostics_Service } from './diagnostics.js';
import { build_debug_report, serialize_debug_report, PINNED_SOURCE_REVISIONS,
  type Debug_Report_Identity } from './debug-report.js';

// Developer workspace for the debug scenario corpus. The searchable listing,
// per-scenario controls and run-all structure follow the pinned osu!framework
// TestBrowser; every scenario executes through the production WASM engine and
// the production browser services. The mixed-scene scrubber remains available
// at /renderer-debug.html.

const download_text = (filename: string, text: string) => {
  const object_url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = object_url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(object_url), 1000);
};

const element = (identifier: string) => document.getElementById(identifier)!;
const definitions = debug_scenarios();
const diagnostics = new Diagnostics_Service();
// The workspace always profiles the full detail profile for its runs.
diagnostics.capture_mode = 'detailed';
let wasm_bytes: Uint8Array | null = null;
let active_run: Debug_Scenario_Run | null = null;
let active_definition: Debug_Scenario_Definition | null = null;
let running_all = false;

const scenario_identity = (): Debug_Report_Identity => ({
  engine: null, wasm_sha256: null,
  sources: PINNED_SOURCE_REVISIONS,
  map: active_definition ? { filename: 'scenario://mixed.osu', scenario_id: active_definition.id } : null,
  browser: { user_agent: navigator.userAgent },
  audio: null, capabilities: null,
  notes: ['Scenario reports use the workspace diagnostics service; the player report carries full identity metadata.'],
});

function filtered_definitions(): Debug_Scenario_Definition[] {
  const search = (element('scenario-search') as HTMLInputElement).value.trim().toLowerCase();
  return definitions.filter(definition => !search ||
    `${definition.id} ${definition.title} ${definition.description} ${definition.group}`.toLowerCase().includes(search));
}

function render_list() {
  const list = element('scenario-list');
  list.replaceChildren(...filtered_definitions().map(definition => {
    const item = document.createElement('li');
    item.setAttribute('role', 'option');
    item.tabIndex = 0;
    item.dataset.scenarioId = definition.id;
    item.setAttribute('aria-selected', String(definition === active_definition));
    item.className = definition.synthetic ? 'scenario-synthetic' : 'scenario-real';
    const title = document.createElement('strong');
    title.textContent = definition.title;
    const meta = document.createElement('span');
    meta.textContent = `${definition.group}${definition.synthetic ? '' : ' · real browser resources'}`;
    item.append(title, meta);
    const select = () => { void select_definition(definition); };
    item.addEventListener('click', select);
    item.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });
    return item;
  }));
}

async function select_definition(definition: Debug_Scenario_Definition) {
  if (running_all) return;
  await dispose_active_run();
  active_definition = definition;
  element('scenario-title').textContent = definition.title;
  element('scenario-description').textContent = definition.description +
    (definition.requires_user_gesture ? ' Run supplies the required user gesture.' : '');
  const parameters = element('scenario-parameters');
  const entries = Object.entries(definition.parameters);
  parameters.replaceChildren(...(entries.length ? entries : [['schedule', 'default 60 Hz']]).map(([name, value]) => {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = name;
    const description = document.createElement('dd');
    description.textContent = String(value);
    row.append(term, description);
    return row;
  }));
  for (const control of ['scenario-run', 'scenario-step', 'scenario-reset', 'scenario-report'] as const) {
    (element(control) as HTMLButtonElement).disabled = false;
  }
  element('scenario-results').hidden = true;
  element('scenario-canvas').hidden = definition.group !== 'graphics';
  element('scenario-status').textContent = definition.synthetic ?
    'Ready. Run executes the synthetic schedule deterministically.' :
    'Ready. This scenario uses real browser resources.';
  render_list();
}

async function dispose_active_run() {
  if (active_run) {
    active_run.dispose();
    active_run = null;
  }
}

async function ensure_run(): Promise<Debug_Scenario_Run> {
  if (active_run) return active_run;
  if (!active_definition) throw new Error('Select a scenario first.');
  diagnostics.reset_history();
  diagnostics.capture_mode = 'detailed';
  active_run = await Debug_Scenario_Run.create(wasm_bytes!, active_definition,
    { diagnostics, canvas: element('scenario-canvas') as HTMLCanvasElement });
  return active_run;
}

function present(summary: Scenario_Run_Summary, prefix: string) {
  const results = element('scenario-results');
  results.hidden = false;
  const assertion_lines = summary.assertions.map(assertion =>
    `${assertion.passed ? 'PASS' : 'FAIL'}  ${assertion.description} (observed ${assertion.observed})`);
  results.textContent = [`${prefix}${summary.definition.id}`,
    `state=${summary.final_state} committed=${summary.committed_ms} failure=${summary.failure_status}`,
    ...assertion_lines].join('\n');
  const failed = summary.assertions.filter(assertion => !assertion.passed).length;
  element('scenario-status').textContent = failed === 0 ?
    `${summary.definition.id}: all ${summary.assertions.length} assertion(s) passed.` :
    `${summary.definition.id}: ${failed} of ${summary.assertions.length} assertion(s) failed.`;
}

async function run_active() {
  if (!active_definition || running_all) return;
  try {
    const run = await ensure_run();
    const summary = await run.run_to_completion();
    present(summary, 'Run · ');
  } catch (error) {
    element('scenario-status').textContent = `Scenario failed to execute: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function run_all() {
  if (running_all) return;
  running_all = true;
  (element('run-all') as HTMLButtonElement).disabled = true;
  const results: string[] = [];
  let passed_count = 0;
  let failed_count = 0;
  let skipped_count = 0;
  try {
    const runnable = filtered_definitions();
    for (const definition of runnable) {
      // Real-audio scenarios require a fresh user gesture per AudioContext;
      // Run All cannot supply one, so they are reported as skipped.
      if (definition.requires_user_gesture) {
        skipped_count++;
        results.push(`SKIP ${definition.id}: requires an individual user gesture (Run).`);
        continue;
      }
      await dispose_active_run();
      active_definition = definition;
      try {
        const run = await Debug_Scenario_Run.create(wasm_bytes!, definition,
          { diagnostics, canvas: element('scenario-canvas') as HTMLCanvasElement });
        active_run = run;
        const summary = await run.run_to_completion();
        const failed = summary.assertions.filter(assertion => !assertion.passed);
        if (failed.length === 0) passed_count++;
        else failed_count++;
        results.push(`${failed.length === 0 ? 'PASS' : 'FAIL'} ${definition.id}` +
          (failed.length ? `\n  ${failed.map(assertion => `${assertion.description} (observed ${assertion.observed})`).join('\n  ')}` : ''));
      } catch (error) {
        failed_count++;
        results.push(`ERROR ${definition.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      element('scenario-status').textContent =
        `Run All: ${passed_count + failed_count}/${runnable.length} executed (${skipped_count} gesture-gated).`;
    }
  } finally {
    running_all = false;
    (element('run-all') as HTMLButtonElement).disabled = false;
    const results_element = element('scenario-results');
    results_element.hidden = false;
    results_element.textContent = results.join('\n');
    element('scenario-status').textContent =
      `Run All complete: ${passed_count} passed, ${failed_count} failed or unavailable, ${skipped_count} skipped.`;
  }
}

async function step_active() {
  if (!active_definition || running_all) return;
  try {
    const run = await ensure_run();
    const done = await run.step();
    present(run.collect(), done ? 'Step (complete) · ' : 'Step · ');
  } catch (error) {
    element('scenario-status').textContent = `Scenario failed to execute: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function reset_active() {
  if (running_all) return;
  await dispose_active_run();
  diagnostics.reset_history();
  element('scenario-results').hidden = true;
  element('scenario-status').textContent = 'Scenario reset. Run or Step to execute again.';
}

function export_scenario_report() {
  if (!active_definition) return;
  const report = build_debug_report(diagnostics, scenario_identity(), 'scenario');
  const text = serialize_debug_report(report);
  download_text(`tapweave-scenario-${active_definition.id}.json`, text);
}

element('scenario-search').addEventListener('input', render_list);
element('scenario-run').addEventListener('click', () => { void run_active(); });
element('scenario-step').addEventListener('click', () => { void step_active(); });
element('scenario-reset').addEventListener('click', () => { void reset_active(); });
element('run-all').addEventListener('click', () => { void run_all(); });
element('scenario-report').addEventListener('click', export_scenario_report);
render_list();

try {
  const response = await fetch('/tapweave.wasm');
  if (!response.ok) throw new Error('Engine download failed. Build the browser assets first.');
  wasm_bytes = new Uint8Array(await response.arrayBuffer());
  element('scenario-status').textContent = `${definitions.length} scenario definitions loaded. Select one to begin.`;
} catch (error) {
  element('scenario-status').textContent = error instanceof Error ? error.message : String(error);
}
