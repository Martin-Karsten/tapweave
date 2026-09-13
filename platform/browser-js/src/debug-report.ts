import { DEBUG_EVENT_CATEGORIES, DEBUG_SEVERITIES, type Debug_Capture_Mode, type Debug_Event_Category,
  type Debug_Event_Slot, type Debug_Failure_Record, type Debug_Frame_Slot, type Debug_Input_Slot,
  type Debug_Operation_Counters, type Debug_Resource_Counters, type Debug_Severity, Diagnostics_Service } from './diagnostics.js';
import { Browser_Error, require_condition } from './errors.js';

export const DEBUG_REPORT_FORMAT = 'tapweave-debug-report';
export const DEBUG_REPORT_VERSION = 1;
export const MAXIMUM_REPORT_BYTES = 2 * 1024 * 1024;

// Pinned upstream revisions, mirroring engine/reference/source-manifest.json.
// The debug suite documents its osu!framework inspiration against these pins.
export const PINNED_SOURCE_REVISIONS = Object.freeze({
  osu: Object.freeze({ repository: 'ppy/osu', version: '2026.804.2-lazer', commit: '3c1c96f742e7aae2ff67a7361e058fe91ca3b955' }),
  framework: Object.freeze({ repository: 'ppy/osu-framework', version: '2026.731.0', commit: 'f02756c5aa5032e6d04729922702b8d56c4bc2eb' }),
});

export type Debug_Report_Reason = 'manual' | 'failure' | 'scenario' | 'import';

export interface Debug_Report_Identity {
  engine: Record<string, unknown> | null;
  wasm_sha256: string | null;
  sources: typeof PINNED_SOURCE_REVISIONS;
  map: Record<string, unknown> | null;
  browser: Record<string, unknown> | null;
  audio: Record<string, unknown> | null;
  capabilities: Record<string, unknown> | null;
  notes: string[];
}

export interface Debug_Report_Truncation {
  events_dropped_by_ring: number;
  inputs_dropped_by_ring: number;
  frames_dropped_by_ring: number;
  secondary_failures_dropped: number;
  events_dropped_by_bound: number;
  inputs_dropped_by_bound: number;
  frames_dropped_by_bound: number;
  serialized_bytes: number;
  bounded_to_bytes: number;
}

export interface Debug_Report {
  format: typeof DEBUG_REPORT_FORMAT;
  version: typeof DEBUG_REPORT_VERSION;
  created_iso: string;
  reason: Debug_Report_Reason;
  capture_mode: Debug_Capture_Mode;
  identity: Debug_Report_Identity;
  truncation: Debug_Report_Truncation;
  timing_provenance: Record<string, unknown>;
  failure: Debug_Failure_Record | null;
  secondary_failures: Debug_Failure_Record[];
  counters: { operations: Debug_Operation_Counters; resources: Debug_Resource_Counters;
    retained: { events: number; inputs: number; frames: number; attempt: number } };
  source_names: string[];
  events: Debug_Event_Slot[];
  inputs: Debug_Input_Slot[];
  frames: Debug_Frame_Slot[];
}

const stringify_identifier = (value: unknown) => JSON.stringify(value, (_field_name, field_value) =>
  typeof field_value === 'bigint' ? field_value.toString() : field_value);

// Assemble the in-memory report. Failure context and metadata are always
// preserved; serialize_debug_report applies the byte bound afterwards.
export function build_debug_report(service: Diagnostics_Service, identity: Debug_Report_Identity,
  reason: Debug_Report_Reason): Debug_Report {
  const events = service.ordered_events();
  const inputs = service.ordered_inputs();
  const frames = service.ordered_frames();
  return {
    format: DEBUG_REPORT_FORMAT,
    version: DEBUG_REPORT_VERSION,
    created_iso: new Date().toISOString(),
    reason,
    capture_mode: service.capture_mode,
    identity,
    truncation: { events_dropped_by_ring: service.dropped.events, inputs_dropped_by_ring: service.dropped.inputs,
      frames_dropped_by_ring: service.dropped.frames, secondary_failures_dropped: service.dropped.secondary_failures,
      events_dropped_by_bound: 0, inputs_dropped_by_bound: 0, frames_dropped_by_bound: 0,
      serialized_bytes: 0, bounded_to_bytes: MAXIMUM_REPORT_BYTES },
    timing_provenance: { receipt_clock: 'performance.now() (browser monotonic observation)',
      audio_clock: 'AudioContext.currentTime (sampled audio timeline)',
      gameplay_time: 'engine committed_ms (authoritative judgement timeline)',
      input_mapping: 'Audio_Clock.input_time: audio anchor plus receipt delta',
      note: 'Observation timestamps (receipt/audio) are distinct from authoritative gameplay timestamps.' },
    failure: service.first_failure === null ? null : { ...service.first_failure },
    secondary_failures: service.secondary_failures.map(failure => ({ ...failure })),
    counters: { operations: { ...service.operation_counters }, resources: { ...service.resource_counters },
      retained: { events: events.length, inputs: inputs.length, frames: frames.length, attempt: service.attempt } },
    source_names: [...new Set(['unknown', ...inputs.map(input => service.source_name(input.source))])],
    events,
    inputs,
    frames,
  };
}

// Serialize with bigint identifiers as decimal strings, bounded to 2 MiB.
// Metadata and failure context are always retained; when the newest history
// does not fit, the oldest history is dropped first and the truncation record
// reports how much was removed.
export function serialize_debug_report(report: Debug_Report): string {
  const bound_report: Debug_Report = { ...report, truncation: { ...report.truncation } };
  for (let attempt_index = 0; attempt_index < 24; attempt_index++) {
    const serialized_bytes = stringify_identifier(bound_report).length;
    if (serialized_bytes <= MAXIMUM_REPORT_BYTES || bound_report.events.length + bound_report.inputs.length + bound_report.frames.length === 0) {
      bound_report.truncation.serialized_bytes = serialized_bytes;
      let final_text = stringify_identifier(bound_report);
      // Writing the byte count can itself change the serialized length; one
      // corrective pass makes the recorded size exact.
      if (final_text.length !== serialized_bytes) {
        bound_report.truncation.serialized_bytes = final_text.length;
        final_text = stringify_identifier(bound_report);
      }
      return final_text;
    }
    bound_report.events = bound_report.events.slice(Math.ceil(bound_report.events.length / 2));
    bound_report.truncation.events_dropped_by_bound = report.events.length - bound_report.events.length;
    bound_report.inputs = bound_report.inputs.slice(Math.ceil(bound_report.inputs.length / 2));
    bound_report.truncation.inputs_dropped_by_bound = report.inputs.length - bound_report.inputs.length;
    bound_report.frames = bound_report.frames.slice(Math.ceil(bound_report.frames.length / 2));
    bound_report.truncation.frames_dropped_by_bound = report.frames.length - bound_report.frames.length;
  }
  throw new Browser_Error('QUOTA_EXCEEDED', 'Diagnostic report cannot fit the size bound.',
    { serialized_bytes: bound_report.truncation.serialized_bytes });
}

const valid_categories = new Set<string>(DEBUG_EVENT_CATEGORIES);
const valid_severities = new Set<string>(DEBUG_SEVERITIES);
const valid_reasons = new Set<string>(['manual', 'failure', 'scenario', 'import']);

function require_report_condition(condition: boolean, message: string, details: Record<string, unknown> = {}) {
  if (!condition) throw new Browser_Error('INVALID_REPORT', message, details);
}

// Validate an imported report. Imported reports are inspection data only: they
// never execute code and cannot inject scenarios. Identifiers stay decimal
// strings exactly as exported.
export function parse_debug_report(text: string): Debug_Report {
  require_report_condition(typeof text === 'string' && text.length > 0, 'Report text is required.');
  require_report_condition(text.length <= MAXIMUM_REPORT_BYTES, 'Report exceeds the size bound.',
    { length: text.length, bound: MAXIMUM_REPORT_BYTES });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Browser_Error('INVALID_REPORT', 'Report is not valid JSON.', { reason: String(error) });
  }
  const report = parsed as Debug_Report;
  require_report_condition(report !== null && typeof report === 'object' && !Array.isArray(report),
    'Report must be a JSON object.');
  require_report_condition(report.format === DEBUG_REPORT_FORMAT, 'Unknown report format.',
    { format: String((report as { format?: unknown }).format) });
  require_report_condition(report.version === DEBUG_REPORT_VERSION, 'Unsupported report version.',
    { version: (report as { version?: unknown }).version });
  require_report_condition(typeof report.created_iso === 'string', 'Report creation time is required.');
  require_report_condition(valid_reasons.has(report.reason ?? ''), 'Unknown report reason.',
    { reason: String((report as { reason?: unknown }).reason) });
  require_report_condition(report.capture_mode === 'basic' || report.capture_mode === 'detailed',
    'Unknown capture mode.');
  require_report_condition(report.identity !== null && typeof report.identity === 'object' &&
    typeof report.truncation === 'object' && report.truncation !== null &&
    typeof report.timing_provenance === 'object' && report.timing_provenance !== null,
    'Report metadata is incomplete.');
  for (const [field_name, history] of [['events', report.events], ['inputs', report.inputs], ['frames', report.frames],
    ['secondary_failures', report.secondary_failures]] as const) {
    require_report_condition(Array.isArray(history), `Report ${field_name} must be an array.`);
  }
  for (const event of report.events ?? []) {
    require_report_condition(event !== null && typeof event === 'object' && valid_categories.has(event.category ?? '') &&
      valid_severities.has(event.severity ?? '') && typeof event.operation === 'string',
    'Report contains a malformed event.', { event });
  }
  require_report_condition(Array.isArray(report.source_names) && report.source_names.every(name => typeof name === 'string'),
    'Report source names must be strings.');
  return report;
}

// Text-only rendering for imported reports. No HTML is produced anywhere; the
// UI assigns these strings through textContent.
export function render_debug_report_text(report: Debug_Report): string {
  const lines: string[] = [];
  lines.push(`Tapweave debug report (${report.format} v${report.version})`);
  lines.push(`created: ${report.created_iso}  reason: ${report.reason}  capture: ${report.capture_mode}`);
  lines.push(`engine: ${JSON.stringify(report.identity?.engine ?? null, null, 0) ?? 'unavailable'}`);
  lines.push(`wasm: ${report.identity?.wasm_sha256 ?? 'unavailable'}`);
  lines.push(`sources: osu ${PINNED_SOURCE_REVISIONS.osu.version} (${PINNED_SOURCE_REVISIONS.osu.commit})`);
  lines.push(`        framework ${PINNED_SOURCE_REVISIONS.framework.version} (${PINNED_SOURCE_REVISIONS.framework.commit})`);
  lines.push(`map: ${JSON.stringify(report.identity?.map ?? null)}`);
  lines.push(`browser: ${JSON.stringify(report.identity?.browser ?? null)}`);
  lines.push(`audio: ${JSON.stringify(report.identity?.audio ?? null)}`);
  if (report.identity?.notes?.length) lines.push(`notes: ${report.identity.notes.join('; ')}`);
  const truncation = report.truncation as unknown as Record<string, unknown>;
  lines.push(`truncation: ${JSON.stringify(truncation)}`);
  if (report.failure) {
    lines.push(`failure: ${report.failure.operation} ${report.failure.status ?? ''} ${report.failure.message}`);
    if (report.failure.stack) lines.push(report.failure.stack);
    if (report.failure.detail) lines.push(`detail: ${JSON.stringify(report.failure.detail, null, 1)}`);
  }
  for (const failure of report.secondary_failures ?? []) {
    lines.push(`secondary: ${failure.operation} ${failure.status ?? ''} ${failure.message}`);
  }
  lines.push(`counters: ${JSON.stringify(report.counters, null, 1)}`);
  lines.push('events:');
  for (const event of report.events ?? []) {
    const detail = event.detail ? ` ${JSON.stringify(event.detail)}` : '';
    lines.push(`  [${event.sequence}] ${event.category}/${event.severity} ${event.operation}` +
      `${event.message ? `: ${event.message}` : ''}${detail}`);
  }
  if ((report.inputs ?? []).length) {
    lines.push(`inputs (${report.inputs.length}):`);
    for (const input of report.inputs) {
      lines.push(`  [${input.sequence}] source=${report.source_names?.[input.source] ?? input.source}` +
        ` actions=${input.action_bits} receipt=${input.receipt_ms} mapped=${input.mapped_time_ms} audio=${input.audio_seconds}`);
    }
  }
  if ((report.frames ?? []).length) {
    lines.push(`frames (${report.frames.length}; last 64):`);
    for (const frame of report.frames.slice(-64)) {
      lines.push(`  #${frame.frame_index} interval=${frame.interval_ms} target=${frame.advance_target_ms}` +
        ` committed=${frame.committed_ms} discrepancy=${frame.clock_discrepancy_ms ?? 'unavailable'}` +
        ` stages=${frame.stage_input_ms}/${frame.stage_engine_ms}/${frame.stage_render_ms}` +
        ` gpu=${frame.gpu_ms ?? 'unavailable'} queue=${frame.input_queue_depth}`);
    }
  }
  return lines.join('\n');
}

export function report_failure_summary(report: Debug_Report): string | null {
  return report.failure ? `${report.failure.operation}: ${report.failure.message}` : null;
}

export function report_size_bytes(text: string) {
  require_condition(typeof text === 'string', 'INVALID_ARGUMENT', 'Report text is required.');
  return text.length;
}
