import { Engine_Bridge } from './engine-bridge.js';
import { HIT_RESULT_NAMES, RANK_NAMES, type Engine_Diagnostic, type Prepared_Descriptor_Record } from './abi-records.js';
import { Selection_Controller, type Active_Selection } from './selection.js';
import { create_fallback_audio } from './fallback-audio.js';
import { Gameplay_Controller, type Gameplay_View } from './gameplay-controller.js';
import { Browser_Error } from './errors.js';
import { Diagnostics_Service } from './diagnostics.js';
import { PINNED_SOURCE_REVISIONS, build_debug_report, serialize_debug_report, type Debug_Report_Identity } from './debug-report.js';
import { Debug_Report_Store, IndexedDB_Report_Backend } from './debug-store.js';
import { Player_Debug_HUD, Player_Debug_Panel, copy_text, download_text, register_debug_shortcuts } from './debug-ui.js';

const WASM_PAGE_BYTES = 65536;

const element = (identifier: string) => document.getElementById(identifier)!;
const diagnostics_service = new Diagnostics_Service();
const report_store = new Debug_Report_Store(new IndexedDB_Report_Backend());
const stringify = (value: unknown) => JSON.stringify(value, (_field_name, field_value) =>
  typeof field_value === 'bigint' ? field_value.toString() : field_value, 2);
let engine: Engine_Bridge | undefined;
let selection: Selection_Controller | undefined;
let audio_context: AudioContext | undefined;
let gameplay: Gameplay_Controller | undefined;
let debug_panel: Player_Debug_Panel | undefined;
let debug_hud: Player_Debug_HUD | undefined;
let previous_state = '';
let persisted_recovery_at: string | null = null;

const digest_hex = (summary: Prepared_Descriptor_Record) =>
  [summary.prepared_digest_0, summary.prepared_digest_1, summary.prepared_digest_2, summary.prepared_digest_3]
    .map(part => part.toString(16).padStart(16, '0')).join('');

const report_identity = (): Debug_Report_Identity => {
  const active = selection?.active ?? null;
  const summary = active?.descriptor.summary;
  const notes: string[] = [];
  notes.push('GPU interval timings are asynchronous; unavailable or disjoint results are shown as unavailable.');
  if (engine?.wasm_sha256 == null) notes.push('WASM module digest was not captured.');
  return {
    engine: engine ? { build_id: engine.capabilities.build_id.toString(), behavior_id: engine.capabilities.behavior_id,
      numeric_mode: engine.capabilities.numeric_mode, abi: `${engine.capabilities.abi_major}.${engine.capabilities.abi_minor}`,
      lazer_version: engine.capabilities.lazer_version, raw_bytes_limit: engine.capabilities.raw_bytes.toString(),
      arena_bytes_limit: engine.capabilities.arena_bytes.toString() } : null,
    wasm_sha256: engine?.wasm_sha256 ?? null,
    sources: PINNED_SOURCE_REVISIONS,
    map: summary ? { filename: active!.filename, format_version: summary.format_version,
      objects_count: summary.objects_count, hp: summary.hp, cs: summary.cs, od: summary.od, ar: summary.ar,
      prepared_digest: digest_hex(summary), music: active!.music_status } : null,
    browser: { user_agent: navigator.userAgent, platform: (navigator as { platform?: string }).platform ?? null,
      language: navigator.language, hardware_concurrency: navigator.hardwareConcurrency ?? null,
      device_memory_gb: (navigator as { deviceMemory?: number }).deviceMemory ?? null,
      max_touch_points: navigator.maxTouchPoints ?? null, pixel_ratio: window.devicePixelRatio,
      view: `${window.innerWidth}x${window.innerHeight}` },
    audio: audio_context ? { state: audio_context.state, sample_rate: audio_context.sampleRate,
      base_latency_seconds: audio_context.baseLatency, output_latency_seconds: audio_context.outputLatency } : null,
    capabilities: engine ? { simulation_flags: engine.simulation_capabilities.flags,
      simulation_max_inputs: engine.simulation_capabilities.max_inputs, output_flags: engine.output_capabilities.flags,
      transport_flags: engine.transport_capabilities.flags,
      voice_command_mask: engine.transport_capabilities.voice_command_mask } : null,
    notes,
  };
};

function update(controller: Selection_Controller) {
  const active = controller.active;
  element('status').textContent = controller.state === 'loading' ? 'Preparing beatmap…' :
    active ? 'Beatmap prepared successfully.' : 'Engine ready. Open a beatmap to begin.';
  element('error').hidden = !controller.error;
  element('error').textContent = controller.error ? controller.error.message : '';
  const difficulty = element('difficulty') as HTMLSelectElement;
  difficulty.disabled = !active || controller.state === 'loading';
  if (active) {
    difficulty.replaceChildren(...active.source.list_maps().map(filename => {
      const option = document.createElement('option');
      option.value = filename;
      option.textContent = filename;
      option.selected = filename === active.filename;
      return option;
    }));
    element('map-name').textContent = active.filename.split('/').at(-1)?.replace(/\.osu$/i, '') ?? active.filename;
    element('map-detail').textContent = active.music_error || 'Music decoded. Prepared map and assets are ready.';
    const summary: Prepared_Descriptor_Record = active.descriptor.summary;
    element('stats').hidden = false;
    element('objects').textContent = summary.objects_count.toLocaleString();
    element('circle-size').textContent = String(summary.cs);
    element('approach-rate').textContent = String(summary.ar);
    diagnostics_service.record_event('resource', 'info', 'map_selected', `Selected ${active.filename}.`,
      { filename: active.filename, objects_count: summary.objects_count, music: active.music_status });
  }
  diagnostics_service.update_resources({ map_handles: engine?.map_handles.size ?? 0,
    session_handles: engine?.session_handles.size ?? 0,
    wasm_pages: engine ? engine.wasm.memory.buffer.byteLength / WASM_PAGE_BYTES : 0 });
  render_selection_diagnostics(controller);
}

// Selection-level summary for the existing collapsible diagnostics block; the
// full event history lives in the debug panel.
function render_selection_diagnostics(controller: Selection_Controller) {
  const active = controller.active;
  const summary = { scope: 'M3 integrated validation player', upstream_verified: false,
    browser: navigator.userAgent,
    error: controller.error ? { code: controller.error.code, message: controller.error.message } : null,
    map: active ? { filename: active.filename, music: active.music_status,
      objects: active.descriptor.summary.objects_count } : null,
    counters: { ...diagnostics_service.operation_counters, ...diagnostics_service.resource_counters },
    capture_mode: diagnostics_service.capture_mode,
    engine_messages: diagnostics_service.ordered_events().filter(event => event.operation === 'engine_log')
      .slice(-8).map(event => event.message) };
  element('diagnostics').textContent = stringify(summary);
}

function lifecycle_title(view: Gameplay_View) {
  if (view.state === 'terminal') return view.message;
  if (view.state === 'recovering') return 'Playback interrupted';
  if (view.state === 'starting') return 'Starting…';
  return 'Paused';
}

function update_gameplay(view: Gameplay_View) {
  if (selection) update(selection);
  const start = element('start') as HTMLButtonElement;
  start.disabled = !view.can_play;
  element('play-gate').textContent = view.message;
  (element('files') as HTMLInputElement).disabled = view.in_attempt || view.state === 'loading' || view.state === 'disposed';
  (element('difficulty') as HTMLSelectElement).disabled = !selection?.active || view.in_attempt || view.state === 'loading';
  element('player').hidden = !view.in_attempt;
  document.querySelector<HTMLElement>('.workspace')!.hidden = view.in_attempt;
  document.querySelector<HTMLElement>('.intro')!.hidden = view.in_attempt;
  const panel_visible = view.in_attempt && view.state !== 'running';
  element('lifecycle-panel').hidden = !panel_visible;
  element('pause').hidden = view.state !== 'running';
  element('debug-open-running').hidden = view.state !== 'running';
  element('resume').hidden = view.state !== 'paused';
  (element('resume') as HTMLButtonElement).disabled = !view.can_resume;
  (element('retry') as HTMLButtonElement).disabled = !view.can_retry;
  element('lifecycle-title').textContent = lifecycle_title(view);
  element('lifecycle-message').textContent = view.state === 'terminal' ? 'Run complete. Retry or return to selection.' : view.message;
  element('result-stats').hidden = !view.result;
  if (view.result) {
    const summary = view.result.summary;
    const items: [string, string][] = [['Score', String(summary.score)], ['Accuracy', `${(Number(summary.accuracy) * 100).toFixed(2)}%`],
      ['Rank', RANK_NAMES[Number(summary.rank)] ?? String(summary.rank)], ['Max combo', String(summary.highest_combo)]];
    for (const count of view.result.result_counts()) {
      if (Number(count.actual) || Number(count.maximum)) {
        items.push([HIT_RESULT_NAMES[Number(count.result)] ?? `Result ${count.result}`, String(count.actual)]);
      }
    }
    element('result-stats').replaceChildren(...items.map(([label, text]) => {
      const item = document.createElement('div');
      const term = document.createElement('dt'); term.textContent = label;
      const description = document.createElement('dd'); description.textContent = text;
      item.append(term, description); return item;
    }));
  }
  // Automatic failure reports: build once per recovery, persist locally, and
  // keep the copyable text visible even when storage fails.
  element('recovery-diagnostics').hidden = !view.recovery;
  if (view.recovery) {
    const captured_at = String(view.recovery.captured_at);
    if (persisted_recovery_at !== captured_at) {
      persisted_recovery_at = captured_at;
      const report = build_debug_report(diagnostics_service, report_identity(), 'failure');
      const text = serialize_debug_report(report);
      (element('recovery-report') as HTMLTextAreaElement).value = text;
      void report_store.persist(text, { created_iso: report.created_iso, reason: 'failure',
        capture_mode: report.capture_mode,
        failure_operation: report.failure ? `${report.failure.operation}: ${report.failure.message}` : null })
        .then(result => {
          if (result.warning) diagnostics_service.record_event('resource', 'warning', 'report_storage', result.warning);
        });
    }
  } else {
    persisted_recovery_at = null;
  }
  debug_panel?.request_refresh();
  if (previous_state !== view.state) {
    if (view.state === 'running') element('playfield').focus();
    else if (panel_visible && !debug_panel?.open_state) element('lifecycle-panel').focus();
    else if (view.can_play && previous_state !== '') start.focus();
    previous_state = view.state;
  }
}

try {
  const response = await fetch('/tapweave.wasm');
  if (!response.ok) {
    throw new Error('Engine download failed. Build the browser assets and try again.');
  }
  engine = await Engine_Bridge.create(await response.arrayBuffer(), {
    diagnostics: diagnostics_service,
    on_engine_log: (message: Engine_Diagnostic) => {
      diagnostics_service.record_event('engine', 'info', 'engine_log', message.message,
        { file_descriptor: message.file_descriptor });
    },
  });
  diagnostics_service.note_operation('player_start');
  diagnostics_service.note_lifecycle('Validation player started.');
  audio_context = new AudioContext();
  const fallback_assets = new Map<string, AudioBuffer>();
  selection = new Selection_Controller(engine, {
    fallback_assets,
    on_change: () => {},
    decode_audio: async bytes => {
      audio_context ??= new AudioContext();
      if (fallback_assets.size === 0) {
        for (const [name, buffer] of create_fallback_audio(audio_context)) fallback_assets.set(name, buffer);
      }
      return audio_context.decodeAudioData(bytes as ArrayBuffer);
    },
  });
  debug_hud = new Player_Debug_HUD(diagnostics_service);
  debug_panel = new Player_Debug_Panel({ diagnostics: diagnostics_service, identity: report_identity,
    store: report_store,
    request_pause: () => gameplay?.pause('Debug panel opened.'),
    is_playing: () => gameplay?.view.state === 'running' });
  gameplay = new Gameplay_Controller(engine, selection, audio_context, element('playfield') as HTMLCanvasElement,
    { on_change: update_gameplay, diagnostics: diagnostics_service,
      on_frame: () => {
        debug_panel?.request_refresh();
        debug_hud?.request_refresh();
      } });
  register_debug_shortcuts(debug_panel, debug_hud);
  const open_panel = () => debug_panel?.open();
  element('debug-open').addEventListener('click', open_panel);
  element('debug-open-lifecycle').addEventListener('click', open_panel);
  element('debug-open-running').addEventListener('click', open_panel);
  element('hud-toggle').addEventListener('click', () => {
    debug_hud?.toggle();
    (element('hud-toggle') as HTMLButtonElement).setAttribute('aria-pressed', String(debug_hud?.visible));
    if (debug_hud?.visible) diagnostics_service.record_event('lifecycle', 'info', 'hud', 'Live HUD enabled.');
  });
  element('files').addEventListener('change', event => {
    const files = [...((event.target as HTMLInputElement).files ?? [])];
    if (files.length) {
      void gameplay!.load_files(files);
    }
    (event.target as HTMLInputElement).value = '';
  });
  element('difficulty').addEventListener('change', event => {
    void gameplay!.select_map((event.target as HTMLSelectElement).value);
  });
} catch (error) {
  element('status').textContent = 'Engine unavailable.';
  element('error').hidden = false;
  element('error').textContent = error instanceof Browser_Error || error instanceof Error ? error.message : String(error);
  (element('files') as HTMLInputElement).disabled = true;
  selection?.dispose();
  engine?.dispose();
  void audio_context?.close();
}

element('export').addEventListener('click', () => {
  download_text('tapweave-diagnostics.json', element('diagnostics').textContent ?? '{}');
});

element('copy-recovery').addEventListener('click', async () => {
  const report = element('recovery-report') as HTMLTextAreaElement;
  await copy_text(report.value, report, message => {
    element('copy-status').textContent = message;
  });
});

element('download-recovery').addEventListener('click', () => {
  const report = element('recovery-report') as HTMLTextAreaElement;
  if (!report.value) return;
  const created = JSON.parse(report.value).created_iso ?? new Date().toISOString();
  download_text(`tapweave-report-${String(created).replace(/[:.]/g, '-')}.json`, report.value);
});

for (const command of ['play', 'pause', 'resume', 'retry', 'back'] as const) {
  element(command === 'play' ? 'start' : command).addEventListener('click', () => { void gameplay?.[command](); });
}

// Keep keyboard navigation inside an active lifecycle overlay. Gameplay bindings
// are detached before this panel is shown, so Enter/Space cannot submit hits.
element('lifecycle-panel').addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const buttons = [...element('lifecycle-panel').querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button, textarea')]
    .filter(button => !button.hidden && !button.closest('[hidden]') && !button.disabled);
  if (!buttons.length) return;
  const focused_index = buttons.indexOf(document.activeElement as HTMLButtonElement | HTMLTextAreaElement);
  if (focused_index < 0 || (!event.shiftKey && focused_index === buttons.length - 1) ||
    (event.shiftKey && focused_index === 0)) {
    event.preventDefault();
    buttons[event.shiftKey ? buttons.length - 1 : 0].focus();
  }
});
