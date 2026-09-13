import { DEBUG_EVENT_CATEGORIES, type Debug_Event_Category, type Debug_Event_Slot,
  type Diagnostics_Service } from './diagnostics.js';
import { build_debug_report, parse_debug_report, render_debug_report_text, serialize_debug_report,
  type Debug_Report_Identity, type Debug_Report_Reason } from './debug-report.js';
import { Debug_Report_Store, type Stored_Report_Summary } from './debug-store.js';

// Player-facing diagnostics surface. The interactive panel follows the pinned
// osu!framework LogOverlay/GlobalStatisticsDisplay structure (bounded entries,
// severity/category filtering, named counters) and the non-interactive HUD
// follows PerformanceOverlay (frame intervals and CPU/GPU stage timings). All
// rendering is text-only; refresh rides the existing frame driver at most four
// times per second during play.

const PANEL_REFRESH_INTERVAL_MS = 250;
const MAXIMUM_LOG_ROWS = 512;
const MAXIMUM_FRAME_ROWS = 48;
const MAXIMUM_INPUT_ROWS = 48;

export interface Player_Debug_Dependencies {
  diagnostics: Diagnostics_Service;
  identity: () => Debug_Report_Identity;
  store: Debug_Report_Store;
  request_pause: () => void;
  is_playing: () => boolean;
}

export function download_text(filename: string, text: string) {
  const object_url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = object_url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(object_url), 1000);
}

export async function copy_text(text: string, fallback_control: HTMLElement | null, status: (message: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    status('Copied.');
  } catch {
    if (fallback_control instanceof HTMLTextAreaElement || fallback_control instanceof HTMLInputElement) {
      fallback_control.focus();
      fallback_control.select();
      status('Report selected. Press Ctrl+C or Command+C to copy.');
    } else {
      status('Clipboard unavailable.');
    }
  }
}

const element = (identifier: string) => document.getElementById(identifier)!;

function definition_rows(entries: [string, string][]) {
  return entries.map(([term, description]) => {
    const row = document.createElement('div');
    const term_element = document.createElement('dt');
    term_element.textContent = term;
    const description_element = document.createElement('dd');
    description_element.textContent = description;
    row.append(term_element, description_element);
    return row;
  });
}


export class Player_Debug_Panel {
  private active_tab = 'logs';
  private frozen_events: Debug_Event_Slot[] | null = null;
  private last_refresh_ms = 0;
  private readonly selected_categories = new Set<Debug_Event_Category>(DEBUG_EVENT_CATEGORIES);
  private readonly dependencies: Player_Debug_Dependencies;
  private refresh_scheduled = false;

  constructor(dependencies: Player_Debug_Dependencies) {
    this.dependencies = dependencies;
    const panel = element('debug-dialog');
    element('debug-close').addEventListener('click', () => this.close());
    const category_container = element('debug-dialog').querySelector<HTMLFieldSetElement>('.debug-categories')!;
    for (const category of DEBUG_EVENT_CATEGORIES) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `category-${category}`;
      checkbox.checked = true;
      label.append(checkbox, document.createTextNode(category));
      category_container.append(label);
    }
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.stopPropagation(); this.close(); return; }
      if (event.key !== 'Tab') return;
      const focusable: HTMLButtonElement[] = [];
      panel.querySelectorAll<HTMLButtonElement>('button, input, select').forEach(control => {
        if (!control.hidden && !control.closest('[hidden]') && !control.disabled) focusable.push(control);
      });
      if (!focusable.length) return;
      const focused_index = focusable.indexOf(document.activeElement as HTMLButtonElement);
      if (focused_index < 0 || (!event.shiftKey && focused_index === focusable.length - 1) ||
        (event.shiftKey && focused_index === 0)) {
        event.preventDefault();
        focusable[event.shiftKey ? focusable.length - 1 : 0].focus();
      }
    });
    for (const tab of ['logs', 'timing', 'audio', 'resources'] as const) {
      element(`tab-${tab}`).addEventListener('click', () => this.show_tab(tab));
    }
    element('debug-search').addEventListener('input', () => this.render_logs());
    element('debug-severity').addEventListener('change', () => this.render_logs());
    element('debug-freeze').addEventListener('change', () => {
      this.frozen_events = (element('debug-freeze') as HTMLInputElement).checked ?
        this.dependencies.diagnostics.ordered_events() : null;
      this.render_logs();
    });
    for (const category of DEBUG_EVENT_CATEGORIES) {
      element(`category-${category}`).addEventListener('change', () => {
        const checked = (element(`category-${category}`) as HTMLInputElement).checked;
        if (checked) this.selected_categories.add(category);
        else this.selected_categories.delete(category);
        this.render_logs();
      });
    }
    element('debug-detailed').addEventListener('change', () => {
      this.dependencies.diagnostics.capture_mode =
        (element('debug-detailed') as HTMLInputElement).checked ? 'detailed' : 'basic';
      this.dependencies.diagnostics.record_event('lifecycle', 'info', 'capture_mode',
        `Capture mode set to ${this.dependencies.diagnostics.capture_mode}.`);
    });
    element('debug-export').addEventListener('click', () => { void this.export_report('manual'); });
    element('debug-import').addEventListener('click', () => element('debug-import-file').click());
    element('debug-import-file').addEventListener('change', async event => {
      const file = (event.target as HTMLInputElement).files?.[0];
      (event.target as HTMLInputElement).value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const report = parse_debug_report(text);
        const imported = element('debug-imported');
        imported.hidden = false;
        imported.textContent = render_debug_report_text(report).slice(0, 400000);
        element('debug-import-status').textContent =
          `Imported report (${text.length} bytes) from ${file.name}. Rendered as text only.`;
        this.show_tab('resources');
      } catch (error) {
        element('debug-import-status').textContent = error instanceof Error ? error.message : String(error);
      }
    });
    element('debug-refresh-stored').addEventListener('click', () => { void this.render_stored_reports(); });
  }

  open() {
    if (this.dependencies.is_playing()) this.dependencies.request_pause();
    element('debug-dialog').hidden = false;
    element('debug-open').setAttribute('aria-expanded', 'true');
    this.refresh(true);
    element('debug-close').focus();
  }

  close() {
    element('debug-dialog').hidden = true;
    element('debug-open').setAttribute('aria-expanded', 'false');
  }

  get open_state() { return !element('debug-dialog').hidden; }

  // Driven by the gameplay frame driver (and by UI events when not playing);
  // never more than four refreshes per second.
  request_refresh() {
    if (!this.open_state || this.refresh_scheduled) return;
    const now_ms = performance.now();
    if (now_ms - this.last_refresh_ms < PANEL_REFRESH_INTERVAL_MS) return;
    this.last_refresh_ms = now_ms;
    this.refresh_scheduled = true;
    queueMicrotask(() => {
      this.refresh_scheduled = false;
      this.refresh(false);
    });
  }

  refresh(focus_logs: boolean) {
    if (!this.open_state) return;
    if (this.active_tab === 'logs') this.render_logs();
    else if (this.active_tab === 'timing') this.render_timing();
    else if (this.active_tab === 'audio') this.render_audio();
    else this.render_resources();
    if (focus_logs) this.show_tab('logs');
  }

  private show_tab(tab: 'logs' | 'timing' | 'audio' | 'resources') {
    this.active_tab = tab;
    for (const candidate of ['logs', 'timing', 'audio', 'resources'] as const) {
      element(`tab-${candidate}`).setAttribute('aria-selected', String(candidate === tab));
      element(`panel-${candidate}`).hidden = candidate !== tab;
    }
    this.refresh(false);
  }

  private filtered_events(): Debug_Event_Slot[] {
    const events = this.frozen_events ?? this.dependencies.diagnostics.ordered_events();
    const severity = (element('debug-severity') as HTMLSelectElement).value;
    const search = (element('debug-search') as HTMLInputElement).value.trim().toLowerCase();
    return events.filter(event => this.selected_categories.has(event.category) &&
      (severity === 'all' || event.severity === severity) &&
      (!search || `${event.operation} ${event.message ?? ''} ${event.category}`.toLowerCase().includes(search)));
  }

  private render_logs() {
    const events = this.filtered_events();
    const list = element('debug-log');
    const frozen = this.frozen_events !== null;
    list.replaceChildren(...events.slice(-MAXIMUM_LOG_ROWS).map(event => {
      const row = document.createElement('div');
      row.className = `debug-event debug-${event.severity}`;
      const time_text = new Date(event.wall_ms).toISOString().slice(11, 23);
      const headline = document.createElement('span');
      headline.textContent = `[${event.sequence}] ${time_text} ${event.category}/${event.severity} ${event.operation}` +
        `${event.message ? `: ${event.message}` : ''}`;
      row.append(headline);
      if (event.detail) {
        const detail = document.createElement('span');
        detail.className = 'debug-detail';
        detail.textContent = safe_detail_text(event.detail);
        row.append(detail);
      }
      return row;
    }));
    element('debug-log-count').textContent =
      `${events.length} event(s)${frozen ? ' · display frozen (recording continues)' : ''}` +
      `${events.length > MAXIMUM_LOG_ROWS ? ` · showing newest ${MAXIMUM_LOG_ROWS}` : ''}`;
  }

  private render_timing() {
    const diagnostics = this.dependencies.diagnostics;
    const counters = diagnostics.operation_counters;
    const frames = diagnostics.ordered_frames().slice(-MAXIMUM_FRAME_ROWS);
    const inputs = diagnostics.ordered_inputs().slice(-MAXIMUM_INPUT_ROWS);
    const definition_list = element('debug-timing-counters');
    const entries: [string, string][] = [
      ['Capture mode', diagnostics.capture_mode],
      ['Attempt', String(diagnostics.attempt)],
      ['Input batches / records', `${counters.input_batches} / ${counters.input_records}`],
      ['Rejected batches', String(counters.input_rejected_batches)],
      ['Maximum input lateness', `${counters.input_maximum_lateness_ms.toFixed(2)} ms`],
      ['Clock rebindings', String(counters.clock_rebindings)],
      ['Dropped events / inputs / frames', `${diagnostics.dropped.events} / ${diagnostics.dropped.inputs} / ${diagnostics.dropped.frames}`],
    ];
    definition_list.replaceChildren(...definition_rows(entries));
    const frame_rows = frames.map(frame =>
      `#${frame.frame_index} interval ${frame.interval_ms.toFixed(1)} ms · target ${frame.advance_target_ms.toFixed(1)}` +
      ` committed ${frame.committed_ms.toFixed(1)} · discrepancy ${frame.clock_discrepancy_ms === null ? 'unavailable' : frame.clock_discrepancy_ms.toFixed(1)} ms` +
      ` · stages input ${frame.stage_input_ms.toFixed(2)} / engine ${frame.stage_engine_ms.toFixed(2)} / render ${frame.stage_render_ms.toFixed(2)} ms` +
      ` · queue ${frame.input_queue_depth}`);
    element('debug-frames').textContent = frame_rows.length ? frame_rows.join('\n') : 'No frame samples yet.';
    const input_rows = inputs.map(input =>
      `[${input.sequence}] ${diagnostics.source_name(input.source)} actions ${input.action_bits}` +
        ` receipt ${input.receipt_ms.toFixed(1)} → mapped ${input.mapped_time_ms.toFixed(1)} ms` +
        ` (audio ${input.audio_seconds.toFixed(3)} s, batch position ${input.batch_position})`);
    element('debug-inputs').textContent = input_rows.length ?
      input_rows.join('\n') : 'No detailed input records. Enable detailed capture for the next attempt.';
  }

  private render_audio() {
    const diagnostics = this.dependencies.diagnostics;
    const counters = diagnostics.operation_counters;
    const resources = diagnostics.resource_counters;
    const audio_events = diagnostics.ordered_events().filter(event => event.category === 'audio').slice(-MAXIMUM_LOG_ROWS / 2);
    const identity = this.dependencies.identity().audio;
    const entries: [string, string][] = [
      ['Configuration', identity === null ? 'unavailable' : JSON.stringify(identity)],
      ['Interruptions', String(counters.audio_interruptions)],
      ['Dispatched / dropped / stale', `${resources.audio_dispatched} / ${resources.audio_dropped} / ${resources.audio_stale}`],
      ['Pending / voices / retiring', `${resources.audio_pending} / ${resources.audio_voices} / ${resources.audio_retiring_voices}`],
    ];
    const definition_list = element('debug-audio-counters');
    definition_list.replaceChildren(...definition_rows(entries));
    element('debug-audio-events').textContent = audio_events.length ?
      audio_events.map(event => `[${event.sequence}] ${event.severity} ${event.operation}: ${event.message ?? ''}`).join('\n') :
      'No audio events recorded.';
  }

  private render_resources() {
    const diagnostics = this.dependencies.diagnostics;
    const resources = diagnostics.resource_counters;
    const engine_identity = this.dependencies.identity().engine;
    const entries: [string, string][] = [
      ['WASM pages', String(resources.wasm_pages)],
      ['WASM hash', this.dependencies.identity().wasm_sha256 ?? 'unavailable'],
      ['Map handles', String(resources.map_handles)],
      ['Session handles', String(resources.session_handles)],
      ['Input queue depth', String(resources.input_queue_depth)],
      ['Draw instances / batches', `${resources.draw_instances} / ${resources.draw_batches}`],
      ['Static uploads', String(resources.static_uploads)],
      ['Dynamic bytes', String(resources.dynamic_bytes)],
      ['Engine', engine_identity === null ? 'unavailable' : JSON.stringify(engine_identity)],
    ];
    const definition_list = element('debug-resource-counters');
    definition_list.replaceChildren(...definition_rows(entries));
    void this.render_stored_reports();
  }

  async render_stored_reports() {
    const list = element('debug-stored');
    const warning = this.dependencies.store.warning;
    const { summaries, warning: list_warning } = await this.dependencies.store.list();
    const warning_text = warning ?? list_warning;
    element('debug-storage-warning').textContent = warning_text ?? '';
    list.replaceChildren(...summaries.map(summary => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${summary.created_iso} · ${summary.reason} · ${summary.capture_mode} · ` +
        `${summary.size_bytes} bytes${summary.failure_operation ? ` · ${summary.failure_operation}` : ''}`;
      item.append(label);
      for (const [action, title, handler] of [
        ['view', 'View', () => { void this.view_stored_report(summary); }],
        ['copy', 'Copy', () => { void this.copy_stored_report(summary); }],
        ['download', 'Download', () => { void this.download_stored_report(summary); }],
        ['delete', 'Delete', () => { void this.delete_stored_report(summary); }],
      ] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = title;
        button.className = `debug-store-${action}`;
        button.addEventListener('click', handler);
        item.append(button);
      }
      return item;
    }));
    if (!summaries.length && !warning_text) {
      const empty_item = document.createElement('li');
      empty_item.textContent = 'No stored reports yet.';
      list.replaceChildren(empty_item);
    }
  }

  private async view_stored_report(summary: Stored_Report_Summary) {
    const text = await this.dependencies.store.text(summary.key);
    const output = element('debug-imported');
    if (text === null) {
      output.textContent = 'Stored report could not be read.';
    } else {
      try {
        output.textContent = render_debug_report_text(parse_debug_report(text)).slice(0, 400000);
      } catch (error) {
        output.textContent = `Stored report failed validation: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    output.hidden = false;
    element('debug-import-status').textContent = `Viewing stored report from ${summary.created_iso}.`;
  }

  private async copy_stored_report(summary: Stored_Report_Summary) {
    const text = await this.dependencies.store.text(summary.key);
    if (text === null) {
      element('debug-import-status').textContent = 'Stored report could not be read.';
      return;
    }
    await copy_text(text, element('debug-imported'), message => {
      element('debug-import-status').textContent = message;
    });
  }

  private async download_stored_report(summary: Stored_Report_Summary) {
    const text = await this.dependencies.store.text(summary.key);
    if (text === null) return;
    download_text(`tapweave-report-${summary.created_iso.replace(/[:.]/g, '-')}.json`, text);
  }

  private async delete_stored_report(summary: Stored_Report_Summary) {
    await this.dependencies.store.remove(summary.key);
    await this.render_stored_reports();
  }

  async export_report(reason: Debug_Report_Reason) {
    const report = build_debug_report(this.dependencies.diagnostics, this.dependencies.identity(), reason);
    const text = serialize_debug_report(report);
    const result = await this.dependencies.store.persist(text, { created_iso: report.created_iso, reason,
      capture_mode: report.capture_mode,
      failure_operation: report.failure ? `${report.failure.operation}: ${report.failure.message}` : null });
    element('debug-storage-warning').textContent = result.warning ?? '';
    download_text(`tapweave-report-${report.created_iso.replace(/[:.]/g, '-')}.json`, text);
    return text;
  }
}

export class Player_Debug_HUD {
  private last_refresh_ms = 0;
  private readonly diagnostics: Diagnostics_Service;

  constructor(diagnostics: Diagnostics_Service) {
    this.diagnostics = diagnostics;
  }

  get visible() { return !element('debug-hud').hidden; }

  toggle() {
    element('debug-hud').hidden = this.visible;
    if (this.visible) this.refresh();
  }

  // Called from the frame driver callback; at most four refreshes per second.
  request_refresh() {
    if (!this.visible) return;
    const now_ms = performance.now();
    if (now_ms - this.last_refresh_ms < PANEL_REFRESH_INTERVAL_MS) return;
    this.last_refresh_ms = now_ms;
    this.refresh();
  }

  refresh() {
    const diagnostics = this.diagnostics;
    const frame = diagnostics.latest_frame();
    const resources = diagnostics.resource_counters;
    const recent_frames = diagnostics.ordered_frames().slice(-60);
    const average_interval = recent_frames.length > 1 ?
      (recent_frames[recent_frames.length - 1].receipt_ms - recent_frames[0].receipt_ms) / (recent_frames.length - 1) : null;
    const entries: [string, string][] = [
      ['Frame interval', frame === null ? 'unavailable' : `${average_interval === null ? frame.interval_ms.toFixed(1) : average_interval.toFixed(1)} ms`],
      ['CPU stages', frame === null ? 'unavailable' :
        `${frame.stage_input_ms.toFixed(1)} / ${frame.stage_engine_ms.toFixed(1)} / ${frame.stage_render_ms.toFixed(1)} ms`],
      ['Clock discrepancy', frame?.clock_discrepancy_ms == null ? 'unavailable' : `${frame.clock_discrepancy_ms.toFixed(1)} ms`],
      ['Input queue', String(resources.input_queue_depth)],
      ['Audio pending / voices', `${resources.audio_pending} / ${resources.audio_voices}`],
      ['WASM pages', String(resources.wasm_pages)],
      ['Draws', `${resources.draw_instances} inst / ${resources.draw_batches} batch`],
      ['GPU time', frame?.gpu_ms == null ? 'unavailable' : `${frame.gpu_ms.toFixed(2)} ms`],
    ];
    const definition_list = element('hud-metrics');
    definition_list.replaceChildren(...definition_rows(entries));
  }
}

function safe_detail_text(detail: Record<string, unknown>) {
  try {
    return JSON.stringify(detail, (_field_name, field_value) =>
      typeof field_value === 'bigint' ? field_value.toString() : field_value);
  } catch {
    return '{unserializable detail}';
  }
}

export function register_debug_shortcuts(panel: Player_Debug_Panel, hud: Player_Debug_HUD) {
  window.addEventListener('keydown', event => {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (event.code === 'F10') {
      event.preventDefault();
      if (panel.open_state) panel.close();
      else panel.open();
    } else if (event.code === 'F11') {
      event.preventDefault();
      hud.toggle();
    }
  }, { capture: true });
}
