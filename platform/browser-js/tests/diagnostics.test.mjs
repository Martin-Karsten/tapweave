import test from 'node:test';
import assert from 'node:assert/strict';
import { Diagnostics_Service } from '../build/diagnostics.js';

function fixture(capacities = {}) {
  let clock_ms = 0;
  const service = new Diagnostics_Service({ now_ms: () => clock_ms, wall_ms: () => 1_700_000_000_000 + clock_ms,
    capacities });
  return { service, advance: ms => { clock_ms += ms; } };
}

test('event ring wraps, counts drops and returns ordered newest history', () => {
  const { service } = fixture({ events: 4 });
  for (let event_index = 1; event_index <= 9; event_index++) {
    service.record_event('lifecycle', 'info', `op_${event_index}`, `message ${event_index}`);
  }
  assert.equal(service.recorded_event_count(), 9);
  assert.equal(service.dropped.events, 5);
  const events = service.ordered_events();
  assert.equal(events.length, 4);
  assert.deepEqual(events.map(event => event.operation), ['op_6', 'op_7', 'op_8', 'op_9']);
  assert.deepEqual(events.map(event => event.sequence), [6, 7, 8, 9]);
  assert.equal(events[0].category, 'lifecycle');
  assert.equal(events[0].severity, 'info');
});

test('input ring records only in detailed mode and wraps with drop counts', () => {
  const { service } = fixture({ inputs: 3 });
  service.note_input(1, 'KeyZ', 1, 100, 1000, 1, 256, 192, 0);
  assert.equal(service.recorded_input_count(), 0);
  service.capture_mode = 'detailed';
  for (let input_index = 1; input_index <= 5; input_index++) {
    service.note_input(input_index, 'KeyZ', 1, 100 + input_index, 1000 + input_index, 1, 256, 192, 0);
  }
  assert.equal(service.recorded_input_count(), 5);
  assert.equal(service.dropped.inputs, 2);
  const inputs = service.ordered_inputs();
  assert.equal(inputs.length, 3);
  assert.deepEqual(inputs.map(input => input.sequence), [3, 4, 5]);
  assert.equal(service.source_name(inputs[0].source), 'KeyZ');
  assert.equal(service.intern_source('KeyZ'), inputs[0].source);
});

test('frame samples retain clock observations always and stage timings only in detailed mode', () => {
  const { service } = fixture({ frames: 2 });
  service.record_frame_sample({ audio_seconds: 1, advance_target_ms: 1000, committed_ms: null,
    input_queue_depth: 1, audio_pending: 2, audio_voices: 3, wasm_pages: 17, instances: 9, batches: 2, gpu_ms: null });
  service.record_frame_sample({ audio_seconds: 1.016, advance_target_ms: 1016, committed_ms: 1016,
    stage_input_ms: 0.2, stage_engine_ms: 0.3, stage_render_ms: 0.4,
    input_queue_depth: 0, audio_pending: 0, audio_voices: 1, wasm_pages: 17, instances: 8, batches: 2, gpu_ms: 1.5 });
  const frames = service.ordered_frames();
  assert.equal(frames.length, 2);
  assert.equal(frames[0].clock_discrepancy_ms, null);
  assert.equal(frames[0].stage_input_ms, 0);
  assert.equal(frames[1].clock_discrepancy_ms, 0);
  assert.equal(frames[1].stage_input_ms, 0);
  // Asynchronous GPU measurements are retained regardless of capture mode.
  assert.equal(frames[1].gpu_ms, 1.5);
  service.capture_mode = 'detailed';
  service.record_frame_sample({ audio_seconds: 2, advance_target_ms: 2000, committed_ms: 1990,
    stage_input_ms: 0.2, stage_engine_ms: 0.3, stage_render_ms: 0.4,
    input_queue_depth: 0, audio_pending: 0, audio_voices: 0, wasm_pages: 17, gpu_ms: 2 });
  const detailed_frame = service.latest_frame();
  assert.equal(detailed_frame.stage_input_ms, 0.2);
  assert.equal(detailed_frame.stage_engine_ms, 0.3);
  assert.equal(detailed_frame.stage_render_ms, 0.4);
  assert.equal(detailed_frame.clock_discrepancy_ms, 10);
  assert.equal(detailed_frame.gpu_ms, 2);
  assert.equal(service.dropped.frames, 1);
});

test('first failure is preserved, secondary failures append and amendments merge', () => {
  const { service, advance } = fixture();
  service.begin_attempt();
  advance(5);
  const first = service.record_engine_failure('oe_session_advance_output',
    Object.assign(new Error('engine one'), { code: 'ENGINE_7' }), { status: 7, status_name: 'LATE_INPUT' });
  advance(10);
  service.record_engine_failure('playback_recover', new Error('secondary one'), { context: true });
  service.record_engine_failure('later', new Error('secondary two'));
  service.amend_first_failure({ timing_capture: { lateness: 12 } });
  assert.equal(service.first_failure, first);
  assert.equal(service.first_failure.operation, 'oe_session_advance_output');
  assert.equal(service.first_failure.status, 'ENGINE_7');
  assert.equal(service.first_failure.receipt_ms, 5);
  assert.deepEqual(Object.keys(service.first_failure.detail), ['status', 'status_name', 'timing_capture']);
  assert.equal(service.secondary_failures.length, 2);
  assert.equal(service.secondary_failures[0].operation, 'playback_recover');
  assert.equal(service.operation_counters.engine_failures, 3);
  const failure_events = service.ordered_events().filter(event => event.severity === 'error');
  assert.equal(failure_events.length, 3);
  assert.equal(failure_events[0].detail.failure_status, 'ENGINE_7');
});

test('secondary failures are bounded and drops counted', () => {
  const { service } = fixture();
  for (let failure_index = 0; failure_index < 12; failure_index++) {
    service.record_engine_failure('op', new Error(`failure ${failure_index}`));
  }
  assert.equal(service.secondary_failures.length, 8);
  assert.equal(service.dropped.secondary_failures, 3);
  assert.equal(service.operation_counters.engine_failures, 12);
});

test('begin_attempt isolates failures between attempts while retaining history', () => {
  const { service } = fixture();
  service.begin_attempt();
  service.record_engine_failure('first_attempt_op', new Error('attempt one failure'));
  assert.ok(service.first_failure);
  service.begin_attempt();
  assert.equal(service.first_failure, null);
  assert.equal(service.secondary_failures.length, 0);
  assert.equal(service.attempt, 2);
  const attempt_events = service.ordered_events().filter(event => event.operation === 'attempt_begin');
  assert.equal(attempt_events.length, 2);
  assert.deepEqual(service.ordered_events().map(event => event.attempt), [1, 1, 2]);
  const retained = service.ordered_events().find(event => event.operation === 'first_attempt_op');
  assert.equal(retained.attempt, 1);
});

test('batch summaries update counters including maximum lateness and rejections', () => {
  const { service } = fixture();
  service.note_input_batch(4, 0);
  service.note_input_batch(2, 17.5);
  service.note_input_batch(1, 3);
  service.note_input_rejected(1);
  assert.equal(service.operation_counters.input_batches, 3);
  assert.equal(service.operation_counters.input_records, 7);
  assert.equal(service.operation_counters.input_maximum_lateness_ms, 17.5);
  assert.equal(service.operation_counters.input_rejected_batches, 1);
});

test('audio, graphics and clock counters classify their observations', () => {
  const { service } = fixture();
  service.note_audio_interruption('suspended');
  service.note_graphics_event('error', 'context lost');
  service.note_graphics_event('info', 'context restored');
  service.note_clock_rebinding({ engine_epoch: 3 });
  assert.equal(service.operation_counters.audio_interruptions, 1);
  assert.equal(service.operation_counters.graphics_losses, 1);
  assert.equal(service.operation_counters.graphics_restorations, 1);
  assert.equal(service.operation_counters.clock_rebindings, 1);
  assert.equal(service.current_epoch, 3);
});

test('reset_history clears rings and counters for isolated scenario runs', () => {
  const { service } = fixture({ events: 2 });
  service.begin_attempt();
  service.record_engine_failure('op', new Error('failure'));
  service.note_input_batch(3, 1);
  service.update_resources({ wasm_pages: 10 });
  service.reset_history();
  assert.equal(service.recorded_event_count(), 0);
  assert.equal(service.ordered_events().length, 0);
  assert.equal(service.first_failure, null);
  assert.equal(service.operation_counters.input_batches, 0);
  assert.equal(service.resource_counters.wasm_pages, 0);
  assert.equal(service.attempt, 1);
});

test('operation context tracking exposes identity for failure attribution', () => {
  const { service } = fixture();
  service.note_operation('oe_session_advance_output', '12345');
  assert.equal(service.current_operation, 'oe_session_advance_output');
  assert.equal(service.current_session_handle, '12345');
  service.note_session_context('99999', 7, 4321);
  service.record_event('clock', 'info', 'op');
  const event = service.ordered_events().at(-1);
  assert.equal(event.session_handle, '99999');
  assert.equal(event.epoch, 7);
  assert.equal(event.committed_ms, 4321);
});
