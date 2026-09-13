import { require_condition } from './errors.js';

// Structural inspiration: pinned osu!framework LogOverlay (bounded rolling log
// entries with level filtering), PerformanceOverlay (per-frame CPU/GPU timing
// samples), GlobalStatisticsDisplay (named global counters) and TestBrowser
// (searchable scenario listing). The implementation is original Tapweave work
// for the Odin/browser ownership model; see docs/browser-gameplay.md.

export type Debug_Capture_Mode = 'basic' | 'detailed';
export type Debug_Event_Category = 'lifecycle' | 'engine' | 'input' | 'clock' | 'audio' | 'graphics' | 'resource';
export type Debug_Severity = 'info' | 'warning' | 'error';

export const DEBUG_EVENT_CATEGORIES: readonly Debug_Event_Category[] =
  ['lifecycle', 'engine', 'input', 'clock', 'audio', 'graphics', 'resource'];
export const DEBUG_SEVERITIES: readonly Debug_Severity[] = ['info', 'warning', 'error'];

// Ring capacities are fixed product limits; tests may inject smaller ones.
export const DEBUG_RING_CAPACITIES = Object.freeze({ events: 2048, inputs: 8192, frames: 2048 });
const MAXIMUM_SECONDARY_FAILURES = 8;

export interface Debug_Event_Slot {
  sequence: number;
  receipt_ms: number;
  wall_ms: number;
  category: Debug_Event_Category;
  severity: Debug_Severity;
  operation: string;
  status: string | null;
  attempt: number;
  session_handle: string | null;
  epoch: number | null;
  committed_ms: number | null;
  message: string | null;
  detail: Record<string, unknown> | null;
}

// Detailed input records use interned numeric source ids so recording an input
// performs no string or object allocation.
export interface Debug_Input_Slot {
  sequence: number;
  source: number;
  action_bits: number;
  receipt_ms: number;
  mapped_time_ms: number;
  audio_seconds: number;
  x: number;
  y: number;
  batch_position: number;
}

export interface Debug_Frame_Slot {
  frame_index: number;
  receipt_ms: number;
  interval_ms: number;
  audio_seconds: number;
  advance_target_ms: number;
  committed_ms: number;
  clock_discrepancy_ms: number | null;
  stage_input_ms: number;
  stage_engine_ms: number;
  stage_render_ms: number;
  input_queue_depth: number;
  audio_pending: number;
  audio_voices: number;
  wasm_pages: number;
  instances: number;
  batches: number;
  gpu_ms: number | null;
}

export interface Debug_Failure_Record {
  attempt: number;
  operation: string;
  status: string | null;
  message: string;
  stack: string | null;
  receipt_ms: number;
  detail: Record<string, unknown> | null;
}

export interface Debug_Resource_Counters {
  wasm_pages: number;
  map_handles: number;
  session_handles: number;
  input_queue_depth: number;
  audio_pending: number;
  audio_voices: number;
  audio_retiring_voices: number;
  audio_dispatched: number;
  audio_dropped: number;
  audio_stale: number;
  draw_instances: number;
  draw_batches: number;
  static_uploads: number;
  dynamic_bytes: number;
}

export interface Debug_Operation_Counters {
  input_batches: number;
  input_records: number;
  input_rejected_batches: number;
  input_maximum_lateness_ms: number;
  engine_failures: number;
  audio_interruptions: number;
  graphics_losses: number;
  graphics_restorations: number;
  clock_rebindings: number;
}

export interface Debug_Frame_Sample_Input {
  audio_seconds: number;
  advance_target_ms: number;
  committed_ms: number | null;
  stage_input_ms?: number;
  stage_engine_ms?: number;
  stage_render_ms?: number;
  input_queue_depth: number;
  audio_pending: number;
  audio_voices: number;
  wasm_pages: number;
  instances?: number;
  batches?: number;
  gpu_ms?: number | null;
}

export interface Diagnostics_Options {
  now_ms?: () => number;
  wall_ms?: () => number;
  capacities?: { events?: number; inputs?: number; frames?: number };
}

const empty_resource_counters = (): Debug_Resource_Counters => ({ wasm_pages: 0, map_handles: 0, session_handles: 0,
  input_queue_depth: 0, audio_pending: 0, audio_voices: 0, audio_retiring_voices: 0, audio_dispatched: 0,
  audio_dropped: 0, audio_stale: 0, draw_instances: 0, draw_batches: 0, static_uploads: 0, dynamic_bytes: 0 });

const empty_operation_counters = (): Debug_Operation_Counters => ({ input_batches: 0, input_records: 0,
  input_rejected_batches: 0, input_maximum_lateness_ms: 0, engine_failures: 0, audio_interruptions: 0,
  graphics_losses: 0, graphics_restorations: 0, clock_rebindings: 0 });

// One optional typed service shared by the bridge, frame driver, audio services,
// renderer and lifecycle controller. Basic recording is always enabled; detailed
// mode additionally retains individual inputs and per-frame stage timings. Rings
// are preallocated and overwrite their oldest entries; dropped counts are
// exposed. No JSON serialization or DOM updates happen on the recording paths.
export class Diagnostics_Service {
  readonly events: Debug_Event_Slot[];
  readonly inputs: Debug_Input_Slot[];
  readonly frames: Debug_Frame_Slot[];
  readonly event_capacity: number;
  readonly input_capacity: number;
  readonly frame_capacity: number;
  readonly resource_counters = empty_resource_counters();
  readonly operation_counters = empty_operation_counters();
  capture_mode: Debug_Capture_Mode = 'basic';
  attempt = 0;
  first_failure: Debug_Failure_Record | null = null;
  secondary_failures: Debug_Failure_Record[] = [];
  dropped = { events: 0, inputs: 0, frames: 0, secondary_failures: 0 };
  current_operation = 'idle';
  current_session_handle: string | null = null;
  current_epoch: number | null = null;
  last_committed_ms: number | null = null;
  private readonly now_ms: () => number;
  private readonly wall_ms: () => number;
  private event_sequence = 0;
  private event_write_index = 0;
  private event_count = 0;
  private input_write_index = 0;
  private input_count = 0;
  private frame_write_index = 0;
  private frame_count = 0;
  private previous_frame_receipt_ms: number | null = null;
  private readonly source_ids = new Map<string, number>();
  private readonly source_names: string[] = ['unknown'];

  constructor({ now_ms = () => performance.now(), wall_ms = () => Date.now(),
    capacities = {} }: Diagnostics_Options = {}) {
    this.now_ms = now_ms;
    this.wall_ms = wall_ms;
    this.event_capacity = capacities.events ?? DEBUG_RING_CAPACITIES.events;
    this.input_capacity = capacities.inputs ?? DEBUG_RING_CAPACITIES.inputs;
    this.frame_capacity = capacities.frames ?? DEBUG_RING_CAPACITIES.frames;
    require_condition(this.event_capacity > 0 && this.input_capacity > 0 && this.frame_capacity > 0,
      'INVALID_ARGUMENT', 'Diagnostic ring capacities must be positive.');
    this.events = Array.from({ length: this.event_capacity }, () => ({ sequence: 0, receipt_ms: 0, wall_ms: 0,
      category: 'lifecycle' as Debug_Event_Category, severity: 'info' as Debug_Severity, operation: '',
      status: null, attempt: 0, session_handle: null, epoch: null, committed_ms: null, message: null, detail: null }));
    this.inputs = Array.from({ length: this.input_capacity }, () => ({ sequence: 0, source: 0, action_bits: 0,
      receipt_ms: 0, mapped_time_ms: 0, audio_seconds: 0, x: 0, y: 0, batch_position: -1 }));
    this.frames = Array.from({ length: this.frame_capacity }, () => ({ frame_index: 0, receipt_ms: 0,
      interval_ms: 0, audio_seconds: 0, advance_target_ms: 0, committed_ms: 0, clock_discrepancy_ms: null,
      stage_input_ms: 0, stage_engine_ms: 0, stage_render_ms: 0, input_queue_depth: 0, audio_pending: 0,
      audio_voices: 0, wasm_pages: 0, instances: 0, batches: 0, gpu_ms: null }));
  }

  intern_source(source: string) {
    let identifier = this.source_ids.get(source);
    if (identifier === undefined) {
      identifier = this.source_names.length;
      this.source_names.push(source);
      this.source_ids.set(source, identifier);
    }
    return identifier;
  }

  source_name(identifier: number) {
    return this.source_names[identifier] ?? 'unknown';
  }

  recorded_event_count() { return this.event_count; }
  recorded_input_count() { return this.input_count; }
  recorded_frame_count() { return this.frame_count; }

  // Ordered oldest-to-newest views over the rings; the returned arrays are
  // freshly allocated and intended for report/UI refresh paths only.
  ordered_events(): Debug_Event_Slot[] {
    const result: Debug_Event_Slot[] = [];
    for (let age = Math.min(this.event_count, this.event_capacity); age > 0; age--) {
      result.push(this.events[(this.event_write_index - age + this.event_capacity * 2) % this.event_capacity]);
    }
    return result;
  }

  ordered_inputs(): Debug_Input_Slot[] {
    const result: Debug_Input_Slot[] = [];
    for (let age = Math.min(this.input_count, this.input_capacity); age > 0; age--) {
      result.push(this.inputs[(this.input_write_index - age + this.input_capacity * 2) % this.input_capacity]);
    }
    return result;
  }

  ordered_frames(): Debug_Frame_Slot[] {
    const result: Debug_Frame_Slot[] = [];
    for (let age = Math.min(this.frame_count, this.frame_capacity); age > 0; age--) {
      result.push(this.frames[(this.frame_write_index - age + this.frame_capacity * 2) % this.frame_capacity]);
    }
    return result;
  }

  latest_frame(): Debug_Frame_Slot | null {
    if (this.frame_count === 0) return null;
    return this.frames[(this.frame_write_index - 1 + this.frame_capacity) % this.frame_capacity];
  }

  // Current engine operation name and identity context for failure attribution.
  note_operation(operation: string, session_handle: string | null = this.current_session_handle) {
    this.current_operation = operation;
    this.current_session_handle = session_handle;
  }

  note_session_context(session_handle: string | null, epoch: number | null, committed_ms: number | null) {
    this.current_session_handle = session_handle;
    this.current_epoch = epoch;
    this.last_committed_ms = committed_ms;
  }

  record_event(category: Debug_Event_Category, severity: Debug_Severity, operation: string,
    message: string | null = null, detail: Record<string, unknown> | null = null) {
    const slot = this.events[this.event_write_index];
    if (this.event_count >= this.event_capacity) this.dropped.events++;
    this.event_sequence++;
    slot.sequence = this.event_sequence;
    slot.receipt_ms = this.now_ms();
    slot.wall_ms = this.wall_ms();
    slot.category = category;
    slot.severity = severity;
    slot.operation = operation;
    slot.status = null;
    slot.attempt = this.attempt;
    slot.session_handle = this.current_session_handle;
    slot.epoch = this.current_epoch;
    slot.committed_ms = this.last_committed_ms;
    slot.message = message;
    slot.detail = detail;
    this.event_write_index = (this.event_write_index + 1) % this.event_capacity;
    this.event_count++;
    return slot;
  }

  // The first failure of an attempt is preserved verbatim before recovery
  // mutates state; later failures append separately and never overwrite it.
  record_engine_failure(operation: string, error: unknown, detail: Record<string, unknown> | null = null) {
    const failure: Debug_Failure_Record = { attempt: this.attempt, operation,
      status: error instanceof Error && 'code' in error ? String((error as { code?: unknown }).code) : null,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
      receipt_ms: this.now_ms(), detail };
    this.operation_counters.engine_failures++;
    const event_detail = { ...detail, failure_status: failure.status };
    this.record_event('engine', 'error', operation, failure.message, event_detail);
    if (this.first_failure === null) {
      this.first_failure = failure;
      return this.first_failure;
    }
    if (this.secondary_failures.length >= MAXIMUM_SECONDARY_FAILURES) {
      this.dropped.secondary_failures++;
      return failure;
    }
    this.secondary_failures.push(failure);
    return failure;
  }

  // Merge additional evidence (timing capture, clock anchors) into the retained
  // first failure while it is still the active attempt failure.
  amend_first_failure(patch: Record<string, unknown>) {
    if (this.first_failure === null) return;
    this.first_failure.detail = { ...this.first_failure.detail, ...patch };
  }

  begin_attempt() {
    this.attempt++;
    this.first_failure = null;
    this.secondary_failures = [];
    this.dropped.secondary_failures = 0;
    this.record_event('lifecycle', 'info', 'attempt_begin', `Attempt ${this.attempt} started.`);
    return this.attempt;
  }

  note_lifecycle(message: string, detail: Record<string, unknown> | null = null) {
    this.record_event('lifecycle', 'info', 'lifecycle', message, detail);
  }

  note_clock_observation(operation: string, message: string | null = null, detail: Record<string, unknown> | null = null) {
    this.record_event('clock', 'info', operation, message, detail);
  }

  note_clock_rebinding(detail: Record<string, unknown>) {
    this.operation_counters.clock_rebindings++;
    this.current_epoch = typeof detail.engine_epoch === 'number' ? detail.engine_epoch : this.current_epoch;
    this.record_event('clock', 'info', 'session_clock_binding', null, detail);
  }

  note_audio_interruption(message: string, detail: Record<string, unknown> | null = null) {
    this.operation_counters.audio_interruptions++;
    this.record_event('audio', 'warning', 'audio_interruption', message, detail);
  }

  note_graphics_event(severity: Debug_Severity, message: string, detail: Record<string, unknown> | null = null) {
    if (message.includes('lost')) this.operation_counters.graphics_losses++;
    if (message.includes('restor')) this.operation_counters.graphics_restorations++;
    this.record_event('graphics', severity, 'graphics', message, detail);
  }

  // Batch summaries are always recorded as in-place counters; the rejected
  // batch itself is an engine failure event with its timing evidence attached.
  note_input_batch(record_count: number, maximum_lateness_ms: number) {
    this.operation_counters.input_batches++;
    this.operation_counters.input_records += record_count;
    if (maximum_lateness_ms > this.operation_counters.input_maximum_lateness_ms) {
      this.operation_counters.input_maximum_lateness_ms = maximum_lateness_ms;
    }
  }

  note_input_rejected(record_count: number) {
    this.operation_counters.input_rejected_batches++;
  }

  // Detailed mode only: one preallocated slot per individual input.
  note_input(sequence: number, source: string, action_bits: number, receipt_ms: number,
    mapped_time_ms: number, audio_seconds: number, x: number, y: number, batch_position: number) {
    if (this.capture_mode !== 'detailed') return;
    const slot = this.inputs[this.input_write_index];
    if (this.input_count >= this.input_capacity) this.dropped.inputs++;
    slot.sequence = sequence;
    slot.source = this.intern_source(source);
    slot.action_bits = action_bits;
    slot.receipt_ms = receipt_ms;
    slot.mapped_time_ms = mapped_time_ms;
    slot.audio_seconds = audio_seconds;
    slot.x = x;
    slot.y = y;
    slot.batch_position = batch_position;
    this.input_write_index = (this.input_write_index + 1) % this.input_capacity;
    this.input_count++;
  }

  record_frame_sample(sample: Debug_Frame_Sample_Input) {
    const slot = this.frames[this.frame_write_index];
    if (this.frame_count >= this.frame_capacity) this.dropped.frames++;
    const detailed = this.capture_mode === 'detailed';
    const receipt_ms = this.now_ms();
    slot.frame_index = this.frame_count;
    slot.receipt_ms = receipt_ms;
    slot.interval_ms = this.previous_frame_receipt_ms === null ? 0 : receipt_ms - this.previous_frame_receipt_ms;
    this.previous_frame_receipt_ms = receipt_ms;
    slot.audio_seconds = sample.audio_seconds;
    slot.advance_target_ms = sample.advance_target_ms;
    slot.committed_ms = sample.committed_ms ?? 0;
    // Discrepancy between the requested advance time and the authoritative
    // committed gameplay time; null marks an unavailable observation.
    slot.clock_discrepancy_ms = sample.committed_ms === null ? null : sample.advance_target_ms - sample.committed_ms;
    slot.stage_input_ms = detailed ? sample.stage_input_ms ?? 0 : 0;
    slot.stage_engine_ms = detailed ? sample.stage_engine_ms ?? 0 : 0;
    slot.stage_render_ms = detailed ? sample.stage_render_ms ?? 0 : 0;
    slot.input_queue_depth = sample.input_queue_depth;
    slot.audio_pending = sample.audio_pending;
    slot.audio_voices = sample.audio_voices;
    slot.wasm_pages = sample.wasm_pages;
    slot.instances = sample.instances ?? 0;
    slot.batches = sample.batches ?? 0;
    slot.gpu_ms = sample.gpu_ms ?? null;
    if (sample.committed_ms !== null) this.last_committed_ms = sample.committed_ms;
    this.frame_write_index = (this.frame_write_index + 1) % this.frame_capacity;
    this.frame_count++;
    return slot;
  }

  update_resources(patch: Partial<Debug_Resource_Counters>) {
    Object.assign(this.resource_counters, patch);
  }

  // Clear retained history for a fresh scenario run; identity metadata and
  // counters persist so repeated workspace runs stay comparable.
  reset_history() {
    this.event_sequence = 0;
    this.event_write_index = 0;
    this.event_count = 0;
    this.input_write_index = 0;
    this.input_count = 0;
    this.frame_write_index = 0;
    this.frame_count = 0;
    this.previous_frame_receipt_ms = null;
    this.dropped = { events: 0, inputs: 0, frames: 0, secondary_failures: 0 };
    this.first_failure = null;
    this.secondary_failures = [];
    Object.assign(this.resource_counters, empty_resource_counters());
    Object.assign(this.operation_counters, empty_operation_counters());
  }
}
