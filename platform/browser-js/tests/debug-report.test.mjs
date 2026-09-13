import test from 'node:test';
import assert from 'node:assert/strict';
import { Diagnostics_Service } from '../build/diagnostics.js';
import { build_debug_report, parse_debug_report, render_debug_report_text, serialize_debug_report,
  MAXIMUM_REPORT_BYTES, PINNED_SOURCE_REVISIONS } from '../build/debug-report.js';
import { Browser_Error } from '../build/errors.js';

const identity = { engine: { build_id: '17' }, wasm_sha256: 'a'.repeat(64), sources: PINNED_SOURCE_REVISIONS,
  map: { filename: 'mixed.osu' }, browser: null, audio: null, capabilities: null, notes: [] };

test('report serialization encodes bigint identifiers as decimal strings and round-trips', () => {
  const service = new Diagnostics_Service();
  service.begin_attempt();
  service.record_engine_failure('oe_session_pause', Object.assign(new Error('failure'), { code: 'ENGINE_3' }),
    { session_handle: 0xffffffffffffffffn, batch_token: 12345678901234567890n });
  service.record_event('clock', 'info', 'session_clock_binding', null, { handle: 42n });
  const report = build_debug_report(service, identity, 'failure');
  const text = serialize_debug_report(report);
  assert.ok(!text.includes('12345678901234567890n'));
  assert.ok(text.includes('"12345678901234567890"'));
  const parsed = parse_debug_report(text);
  assert.equal(parsed.format, 'tapweave-debug-report');
  assert.equal(parsed.version, 1);
  assert.equal(parsed.reason, 'failure');
  assert.equal(parsed.failure.detail.session_handle, '18446744073709551615');
  assert.equal(parsed.failure.detail.batch_token, '12345678901234567890');
  assert.equal(parsed.truncation.serialized_bytes, text.length);
  assert.ok(parsed.truncation.serialized_bytes <= MAXIMUM_REPORT_BYTES);
  assert.equal(parsed.timing_provenance.gameplay_time, 'engine committed_ms (authoritative judgement timeline)');
});

test('report bounds to 2 MiB by dropping oldest history while preserving failure and metadata', () => {
  const service = new Diagnostics_Service();
  service.begin_attempt();
  service.record_engine_failure('oe_session_inputs_from_reserved', Object.assign(new Error('late'), { code: 'ENGINE_7' }),
    { evidence: 'x'.repeat(64) });
  service.capture_mode = 'detailed';
  for (let event_index = 0; event_index < 600; event_index++) {
    service.record_event('clock', 'info', 'observation', 'y'.repeat(2048), { payload: 'z'.repeat(2048) });
  }
  for (let input_index = 0; input_index < 512; input_index++) {
    service.note_input(input_index + 1, 'KeyZ', 1, input_index, input_index * 16, 1, 256, 192, 0);
  }
  const report = build_debug_report(service, identity, 'manual');
  const text = serialize_debug_report(report);
  assert.ok(text.length <= MAXIMUM_REPORT_BYTES, `report was ${text.length} bytes`);
  const parsed = parse_debug_report(text);
  assert.equal(parsed.failure.operation, 'oe_session_inputs_from_reserved');
  assert.equal(parsed.identity.wasm_sha256, identity.wasm_sha256);
  assert.ok(parsed.truncation.events_dropped_by_bound > 0);
  assert.equal(parsed.truncation.events_dropped_by_bound + parsed.events.length, report.events.length);
  assert.ok(parsed.events.length > 0);
  const newest_event = parsed.events.at(-1);
  assert.equal(newest_event.sequence, report.events.at(-1).sequence);
  assert.ok(parsed.truncation.inputs_dropped_by_bound > 0 || parsed.inputs.length <= report.inputs.length);
});

test('parse rejects oversized, malformed and unknown-structure reports', async () => {
  const service = new Diagnostics_Service();
  const valid = serialize_debug_report(build_debug_report(service, identity, 'manual'));
  for (const rejection of [
    () => parse_debug_report('x'.repeat(MAXIMUM_REPORT_BYTES + 1)),
    () => parse_debug_report('{not json'),
    () => parse_debug_report('[]'),
    () => parse_debug_report('{}'),
    () => parse_debug_report(valid.replace('"version":1', '"version":99')),
    () => parse_debug_report(valid.replace('"reason":"manual"', '"reason":"inject"')),
  ]) {
    await assert.rejects(async () => rejection(),
      error => error instanceof Browser_Error && error.code === 'INVALID_REPORT');
  }
  const bad_event = JSON.parse(valid);
  bad_event.events.push({ sequence: 1, category: 'scenario_injection', severity: 'info', operation: 'x' });
  await assert.rejects(async () => parse_debug_report(JSON.stringify(bad_event)),
    error => error.code === 'INVALID_REPORT');
  const bad_severity = JSON.parse(valid);
  if (bad_severity.events.length) bad_severity.events[0].severity = 'critical';
  else bad_severity.secondary_failures = 'not-an-array';
  await assert.rejects(async () => parse_debug_report(JSON.stringify(bad_severity)),
    error => error.code === 'INVALID_REPORT');
  const parsed = parse_debug_report(valid);
  assert.equal(parsed.capture_mode, 'basic');
});

test('text rendering is plain text with pinned source provenance and unavailable markers', () => {
  const service = new Diagnostics_Service();
  service.begin_attempt();
  service.record_engine_failure('oe_session_pause', Object.assign(new Error('bad state'), { code: 'ENGINE_3' }));
  service.record_event('graphics', 'warning', 'graphics', 'context lost');
  const report = build_debug_report(service, { ...identity, wasm_sha256: null, engine: null }, 'scenario');
  const text = render_debug_report_text(report);
  assert.ok(text.includes('tapweave-debug-report'));
  assert.ok(text.includes('wasm: unavailable'));
  assert.ok(text.includes('3c1c96f742e7aae2ff67a7361e058fe91ca3b955'));
  assert.ok(text.includes('f02756c5aa5032e6d04729922702b8d56c4bc2eb'));
  assert.ok(text.includes('oe_session_pause'));
  assert.ok(text.includes('context lost'));
  assert.ok(!text.includes('<script'));
});

test('retained counters and ring drop counts survive into the report', () => {
  const service = new Diagnostics_Service({ capacities: { events: 2 } });
  service.begin_attempt();
  for (let event_index = 0; event_index < 5; event_index++) service.record_event('lifecycle', 'info', 'op');
  const report = build_debug_report(service, identity, 'manual');
  assert.equal(report.truncation.events_dropped_by_ring, 4);
  assert.equal(report.counters.retained.events, 2);
  assert.equal(report.counters.retained.attempt, 1);
});
