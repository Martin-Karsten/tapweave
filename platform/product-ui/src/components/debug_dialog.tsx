import { For, Show, createEffect, createSignal, type Component } from 'solid-js';
import { DEBUG_EVENT_CATEGORIES, type Debug_Event_Category, type Debug_Event_Slot,
  type Debug_Severity } from '@browser/diagnostics.js';
import { parse_debug_report, render_debug_report_text } from '@browser/debug-report.js';
import type { Stored_Report_Summary } from '@browser/debug-store.js';
import { close_debug_dialog, debug_dialog_open, debug_session, debug_view_version } from '../state/debug_state';
import { copy_text, download_text } from '../services/debug_session';

// Debug suite re-homing (ADR-006): the panel follows the pinned osu!framework
// LogOverlay/GlobalStatisticsDisplay structure (bounded entries, severity and
// category filtering, named counters). All rendering is text-only; refresh is
// a plain-snapshot pull tracked by the throttled debug_view_version signal.

const MAXIMUM_LOG_ROWS = 512;
const MAXIMUM_FRAME_ROWS = 48;
const MAXIMUM_INPUT_ROWS = 48;
const MAXIMUM_IMPORTED_TEXT = 400000;
const DEBUG_TABS = ['logs', 'timing', 'audio', 'resources'] as const;
type Debug_Tab = (typeof DEBUG_TABS)[number];

const safe_detail_text = (detail: Record<string, unknown>) => {
  try {
    return JSON.stringify(detail, (_field_name, field_value) =>
      typeof field_value === 'bigint' ? field_value.toString() : field_value);
  } catch {
    return '{unserializable detail}';
  }
};

const definition_row = (entry: [string, string]) => (
  <div>
    <dt>{entry[0]}</dt>
    <dd>{entry[1]}</dd>
  </div>
);

export const Debug_Dialog: Component = () => {
  const service = () => debug_session();
  const [active_tab, set_active_tab] = createSignal<Debug_Tab>('logs');
  const [frozen_events, set_frozen_events] = createSignal<Debug_Event_Slot[] | null>(null);
  const [search_text, set_search_text] = createSignal('');
  const [severity_filter, set_severity_filter] = createSignal<'all' | Debug_Severity>('all');
  const [selected_categories, set_selected_categories] =
    createSignal<ReadonlySet<Debug_Event_Category>>(new Set(DEBUG_EVENT_CATEGORIES));
  const [detailed_capture, set_detailed_capture] = createSignal(false);
  const [import_status, set_import_status] = createSignal('');
  const [imported_text, set_imported_text] = createSignal<string | null>(null);
  const [stored_summaries, set_stored_summaries] = createSignal<Stored_Report_Summary[]>([]);
  const [storage_warning, set_storage_warning] = createSignal<string | null>(null);
  let close_button: HTMLButtonElement | null = null;
  let import_file_input: HTMLInputElement | null = null;
  let dialog_element: HTMLElement | null = null;

  const refresh_stored_reports = async () => {
    const session = service();
    if (!session) return;
    const { summaries, warning } = await session.stored_reports();
    set_stored_summaries(summaries);
    set_storage_warning(session.store_warning ?? warning);
  };

  createEffect(() => {
    if (!debug_dialog_open()) return;
    set_active_tab('logs');
    void refresh_stored_reports();
    queueMicrotask(() => close_button?.focus());
  });

  const filtered_events = (): Debug_Event_Slot[] => {
    debug_view_version();
    const session = service();
    if (!session) return [];
    const events = frozen_events() ?? session.diagnostics.ordered_events();
    const query = search_text().trim().toLowerCase();
    const level = severity_filter();
    const categories = selected_categories();
    return events.filter(event => categories.has(event.category) &&
      (level === 'all' || event.severity === level) &&
      (!query || `${event.operation} ${event.message ?? ''} ${event.category}`.toLowerCase().includes(query)));
  };

  const visible_events = () => filtered_events().slice(-MAXIMUM_LOG_ROWS);

  const log_count_text = () => {
    const event_count = filtered_events().length;
    return `${event_count} event(s)${frozen_events() !== null ? ' · display frozen (recording continues)' : ''}` +
      `${event_count > MAXIMUM_LOG_ROWS ? ` · showing newest ${MAXIMUM_LOG_ROWS}` : ''}`;
  };

  const toggle_category = (category: Debug_Event_Category, checked: boolean) => {
    const categories = new Set(selected_categories());
    if (checked) categories.add(category);
    else categories.delete(category);
    set_selected_categories(categories);
  };

  const toggle_freeze = (checked: boolean) => {
    const session = service();
    set_frozen_events(checked && session ? session.diagnostics.ordered_events() : null);
  };

  const toggle_detailed = (checked: boolean) => {
    set_detailed_capture(checked);
    service()?.set_detailed_capture(checked);
  };

  const export_report = async () => {
    const session = service();
    if (!session) return;
    const result = await session.export_manual_report();
    set_storage_warning(result.warning);
    await refresh_stored_reports();
  };

  const import_report_file = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const report = parse_debug_report(text);
      set_imported_text(render_debug_report_text(report).slice(0, MAXIMUM_IMPORTED_TEXT));
      set_import_status(`Imported report (${text.length} bytes) from ${file.name}. Rendered as text only.`);
      set_active_tab('resources');
    } catch (error) {
      set_import_status(error instanceof Error ? error.message : String(error));
    }
  };

  const view_stored_report = async (summary: Stored_Report_Summary) => {
    const session = service();
    if (!session) return;
    const text = await session.stored_text(summary.key);
    if (text === null) {
      set_imported_text('Stored report could not be read.');
    } else {
      try {
        set_imported_text(render_debug_report_text(parse_debug_report(text)).slice(0, MAXIMUM_IMPORTED_TEXT));
      } catch (error) {
        set_imported_text(`Stored report failed validation: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    set_import_status(`Viewing stored report from ${summary.created_iso}.`);
  };

  const copy_stored_report = async (summary: Stored_Report_Summary) => {
    const session = service();
    if (!session) return;
    const text = await session.stored_text(summary.key);
    if (text === null) {
      set_import_status('Stored report could not be read.');
      return;
    }
    await copy_text(text, dialog_element?.querySelector('#debug-imported') ?? null, set_import_status);
  };

  const download_stored_report = async (summary: Stored_Report_Summary) => {
    const session = service();
    if (!session) return;
    const text = await session.stored_text(summary.key);
    if (text === null) return;
    download_text(`tapweave-report-${summary.created_iso.replace(/[:.]/g, '-')}.json`, text);
  };

  const delete_stored_report = async (summary: Stored_Report_Summary) => {
    const session = service();
    if (!session) return;
    await session.remove_stored(summary.key);
    await refresh_stored_reports();
  };

  const timing_snapshot = () => {
    debug_view_version();
    const session = service();
    if (!session) return { entries: [] as [string, string][], frame_text: '', input_text: '' };
    const diagnostics = session.diagnostics;
    const counters = diagnostics.operation_counters;
    const entries: [string, string][] = [
      ['Capture mode', diagnostics.capture_mode],
      ['Attempt', String(diagnostics.attempt)],
      ['Input batches / records', `${counters.input_batches} / ${counters.input_records}`],
      ['Rejected batches', String(counters.input_rejected_batches)],
      ['Maximum input lateness', `${counters.input_maximum_lateness_ms.toFixed(2)} ms`],
      ['Clock rebindings', String(counters.clock_rebindings)],
      ['Dropped events / inputs / frames', `${diagnostics.dropped.events} / ${diagnostics.dropped.inputs} / ${diagnostics.dropped.frames}`],
    ];
    const frame_rows = diagnostics.ordered_frames().slice(-MAXIMUM_FRAME_ROWS).map(frame =>
      `#${frame.frame_index} interval ${frame.interval_ms.toFixed(1)} ms · target ${frame.advance_target_ms.toFixed(1)}` +
      ` committed ${frame.committed_ms.toFixed(1)} · discrepancy ${frame.clock_discrepancy_ms === null ? 'unavailable' : frame.clock_discrepancy_ms.toFixed(1)} ms` +
      ` · stages input ${frame.stage_input_ms.toFixed(2)} / engine ${frame.stage_engine_ms.toFixed(2)} / render ${frame.stage_render_ms.toFixed(2)} ms` +
      ` · queue ${frame.input_queue_depth}`);
    const input_rows = diagnostics.ordered_inputs().slice(-MAXIMUM_INPUT_ROWS).map(input =>
      `[${input.sequence}] ${diagnostics.source_name(input.source)} actions ${input.action_bits}` +
        ` receipt ${input.receipt_ms.toFixed(1)} → mapped ${input.mapped_time_ms.toFixed(1)} ms` +
        ` (audio ${input.audio_seconds.toFixed(3)} s, batch position ${input.batch_position})`);
    return {
      entries,
      frame_text: frame_rows.length ? frame_rows.join('\n') : 'No frame samples yet.',
      input_text: input_rows.length ? input_rows.join('\n') :
        'No detailed input records. Enable detailed capture for the next attempt.',
    };
  };

  const audio_snapshot = () => {
    debug_view_version();
    const session = service();
    if (!session) return { entries: [] as [string, string][], event_text: '' };
    const diagnostics = session.diagnostics;
    const counters = diagnostics.operation_counters;
    const resources = diagnostics.resource_counters;
    const identity = session.report_identity().audio;
    const audio_events = diagnostics.ordered_events()
      .filter(event => event.category === 'audio').slice(-Math.floor(MAXIMUM_LOG_ROWS / 2));
    const entries: [string, string][] = [
      ['Configuration', identity === null ? 'unavailable' : JSON.stringify(identity)],
      ['Interruptions', String(counters.audio_interruptions)],
      ['Dispatched / dropped / stale', `${resources.audio_dispatched} / ${resources.audio_dropped} / ${resources.audio_stale}`],
      ['Pending / voices / retiring', `${resources.audio_pending} / ${resources.audio_voices} / ${resources.audio_retiring_voices}`],
    ];
    return {
      entries,
      event_text: audio_events.length ?
        audio_events.map(event => `[${event.sequence}] ${event.severity} ${event.operation}: ${event.message ?? ''}`).join('\n') :
        'No audio events recorded.',
    };
  };

  const resource_snapshot = () => {
    debug_view_version();
    const session = service();
    if (!session) return [] as [string, string][];
    const resources = session.diagnostics.resource_counters;
    const identity = session.report_identity();
    const entries: [string, string][] = [
      ['WASM pages', String(resources.wasm_pages)],
      ['WASM hash', identity.wasm_sha256 ?? 'unavailable'],
      ['Map handles', String(resources.map_handles)],
      ['Session handles', String(resources.session_handles)],
      ['Input queue depth', String(resources.input_queue_depth)],
      ['Draw instances / batches', `${resources.draw_instances} / ${resources.draw_batches}`],
      ['Static uploads', String(resources.static_uploads)],
      ['Dynamic bytes', String(resources.dynamic_bytes)],
      ['Engine', identity.engine === null ? 'unavailable' : JSON.stringify(identity.engine)],
    ];
    return entries;
  };

  const trap_keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close_debug_dialog();
      return;
    }
    if (event.key !== 'Tab' || dialog_element === null) return;
    const focusable: HTMLButtonElement[] = [];
    dialog_element.querySelectorAll<HTMLButtonElement>('button, input, select').forEach(control => {
      if (!control.hidden && !control.closest('[hidden]') && !control.disabled) focusable.push(control);
    });
    if (!focusable.length) return;
    const focused_index = focusable.indexOf(document.activeElement as HTMLButtonElement);
    if (focused_index < 0 || (!event.shiftKey && focused_index === focusable.length - 1) ||
      (event.shiftKey && focused_index === 0)) {
      event.preventDefault();
      focusable[event.shiftKey ? focusable.length - 1 : 0].focus();
    }
  };

  const event_time_text = (wall_ms: number) => new Date(wall_ms).toISOString().slice(11, 23);

  return (
    <Show when={debug_dialog_open()}>
      <section id="debug-dialog" aria-labelledby="debug-title">
        <div
          class="debug-frame"
          role="dialog"
          aria-labelledby="debug-title"
          ref={(element) => {
            dialog_element = element;
          }}
          onKeyDown={trap_keys}
        >
          <h2 id="debug-title">Diagnostics</h2>
          <div class="debug-toolbar">
            <label class="debug-toggle">
              <input type="checkbox" id="debug-detailed" checked={detailed_capture()}
                onChange={(event) => toggle_detailed(event.currentTarget.checked)} /> Detailed capture (next attempt)
            </label>
            <button id="debug-export" type="button" onClick={() => void export_report()}>Export report</button>
            <button id="debug-import" type="button" onClick={() => import_file_input?.click()}>Import report</button>
            <input
              ref={(element) => {
                import_file_input = element;
              }}
              id="debug-import-file"
              type="file"
              accept="application/json"
              hidden
              onChange={(event) => void import_report_file(event)}
            />
            <button
              ref={(element) => {
                close_button = element;
              }}
              id="debug-close"
              type="button"
              onClick={close_debug_dialog}
            >
              Close
            </button>
          </div>
          <p id="debug-import-status" role="status">{import_status()}</p>
          <div role="tablist" aria-label="Diagnostic categories">
            <For each={DEBUG_TABS}>
              {(tab) => (
                <button role="tab" id={`tab-${tab}`} aria-selected={active_tab() === tab}
                  aria-controls={`panel-${tab}`} onClick={() => set_active_tab(tab)}>
                  {tab === 'logs' ? 'Logs' : tab === 'timing' ? 'Timing' : tab === 'audio' ? 'Audio' : 'Resources'}
                </button>
              )}
            </For>
          </div>
          <div role="tabpanel" id="panel-logs" aria-labelledby="tab-logs" hidden={active_tab() !== 'logs'}>
            <div class="debug-filters">
              <label>
                Search{' '}
                <input id="debug-search" type="search" value={search_text()}
                  onInput={(event) => set_search_text(event.currentTarget.value)} />
              </label>
              <label>
                Severity{' '}
                <select id="debug-severity" value={severity_filter()}
                  onChange={(event) => set_severity_filter(event.currentTarget.value as 'all' | Debug_Severity)}>
                  <option value="all">all</option>
                  <option value="info">info</option>
                  <option value="warning">warning</option>
                  <option value="error">error</option>
                </select>
              </label>
              <label class="debug-toggle">
                <input id="debug-freeze" type="checkbox"
                  onChange={(event) => toggle_freeze(event.currentTarget.checked)} /> Freeze display
              </label>
            </div>
            <fieldset class="debug-categories">
              <legend>Categories</legend>
              <For each={DEBUG_EVENT_CATEGORIES}>
                {(category) => (
                  <label>
                    <input
                      id={`category-${category}`}
                      type="checkbox"
                      checked={selected_categories().has(category)}
                      onChange={(event) => toggle_category(category, event.currentTarget.checked)}
                    />
                    {category}
                  </label>
                )}
              </For>
            </fieldset>
            <p id="debug-log-count" role="status">{log_count_text()}</p>
            <div id="debug-log" class="debug-log" aria-label="Diagnostic events">
              <For each={visible_events()}>
                {(event) => (
                  <div class={`debug-event debug-${event.severity}`}>
                    <span>
                      {`[${event.sequence}] ${event_time_text(event.wall_ms)} ${event.category}/${event.severity} ${event.operation}` +
                        `${event.message ? `: ${event.message}` : ''}`}
                    </span>
                    <Show when={event.detail}>
                      <span class="debug-detail">{safe_detail_text(event.detail!)}</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
          <div role="tabpanel" id="panel-timing" aria-labelledby="tab-timing" hidden={active_tab() !== 'timing'}>
            <dl id="debug-timing-counters">
              <For each={timing_snapshot().entries}>{(entry) => definition_row(entry)}</For>
            </dl>
            <h3>Frame samples</h3>
            <pre id="debug-frames">{timing_snapshot().frame_text}</pre>
            <h3>Detailed inputs</h3>
            <pre id="debug-inputs">{timing_snapshot().input_text}</pre>
          </div>
          <div role="tabpanel" id="panel-audio" aria-labelledby="tab-audio" hidden={active_tab() !== 'audio'}>
            <dl id="debug-audio-counters">
              <For each={audio_snapshot().entries}>{(entry) => definition_row(entry)}</For>
            </dl>
            <h3>Audio events</h3>
            <pre id="debug-audio-events">{audio_snapshot().event_text}</pre>
          </div>
          <div role="tabpanel" id="panel-resources" aria-labelledby="tab-resources" hidden={active_tab() !== 'resources'}>
            <dl id="debug-resource-counters">
              <For each={resource_snapshot()}>{(entry) => definition_row(entry)}</For>
            </dl>
            <p id="debug-storage-warning" role="status">{storage_warning() ?? ''}</p>
            <h3>Stored reports (latest five)</h3>
            <ul id="debug-stored">
              <For each={stored_summaries()} fallback={<li>No stored reports yet.</li>}>
                {(summary) => (
                  <li>
                    <span>
                      {`${summary.created_iso} · ${summary.reason} · ${summary.capture_mode} · ` +
                        `${summary.size_bytes} bytes${summary.failure_operation ? ` · ${summary.failure_operation}` : ''}`}
                    </span>
                    <button type="button" onClick={() => void view_stored_report(summary)}>View</button>
                    <button type="button" onClick={() => void copy_stored_report(summary)}>Copy</button>
                    <button type="button" onClick={() => void download_stored_report(summary)}>Download</button>
                    <button type="button" onClick={() => void delete_stored_report(summary)}>Delete</button>
                  </li>
                )}
              </For>
            </ul>
            <button id="debug-refresh-stored" type="button" onClick={() => void refresh_stored_reports()}>
              Refresh stored reports
            </button>
            <h3>Report text</h3>
            <Show when={imported_text()}>
              {(text) => <pre id="debug-imported">{text()}</pre>}
            </Show>
          </div>
        </div>
      </section>
    </Show>
  );
};
