import test from 'node:test';
import assert from 'node:assert/strict';
import { Input_Buffer, ACTION } from '../build/input.js';

test('physical bindings aggregate and event coordinates survive later resize', () => {
  const input = new Input_Buffer();
  const inverse_transform = [0.5, 0, 0, 0.5, -10, -20];
  input.receive({ source_id: 'mouse:0', action: ACTION.LEFT, held: true,
    audio_seconds: 0.1, clock_epoch: 1, raw_time_ms: 100, client_x: 200, client_y: 300, inverse_transform });
  inverse_transform[0] = 10;
  input.receive({ source_id: 'keyboard:KeyZ', action: ACTION.LEFT, held: true, audio_seconds: 0.1, clock_epoch: 1 });
  input.receive({ source_id: 'mouse:0', action: ACTION.LEFT, held: false, audio_seconds: 0.101, clock_epoch: 1 });
  assert.deepEqual(input.records.map(record => record.action_bits), [1, 1, 1]);
  assert.deepEqual([input.records[0].x, input.records[0].y], [90, 130]);
  assert.deepEqual(input.records.map(record => record.audio_seconds), [0.1, 0.1, 0.101]);
  input.release_all(0.102, 1);
  assert.equal(input.records.at(-1).action_bits, 0);
  assert.equal(input.held_sources.size, 0);
  assert.deepEqual(input.records.map(record => record.sequence), [1n, 2n, 3n, 4n]);
});

test('equal audio stamps keep sequence order and closed epochs are rejected at the buffer level', () => {
  const input = new Input_Buffer();
  input.receive({ source_id: 'keyboard:KeyZ', action: ACTION.LEFT, held: true, audio_seconds: 0.5, clock_epoch: 2 });
  input.receive({ source_id: 'keyboard:KeyZ', action: ACTION.LEFT, held: false, audio_seconds: 0.5, clock_epoch: 2 });
  assert.deepEqual(input.records.map(record => record.sequence), [1n, 2n]);
  assert.deepEqual(input.records.map(record => record.clock_epoch), [2, 2]);
  assert.throws(() => input.receive({ source_id: 'keyboard:KeyZ', action: ACTION.LEFT, held: true,
    audio_seconds: 0.6, clock_epoch: -1 }), { code: 'INVALID_INPUT' });
  assert.throws(() => input.receive({ source_id: 'keyboard:KeyZ', action: ACTION.LEFT, held: true,
    audio_seconds: Number.NaN, clock_epoch: 2 }), { code: 'INVALID_INPUT' });
});

test('failed input submission and overflow preserve pending input', () => {
  const input = new Input_Buffer(1);
  input.receive({ source_id: 'keyboard:KeyZ', action: ACTION.LEFT, held: true,
    audio_seconds: 0.1, clock_epoch: 1, raw_time_ms: 100 });
  assert.throws(() => input.receive({ source_id: 'keyboard:KeyZ', action: ACTION.LEFT, held: false,
    audio_seconds: 0.101, clock_epoch: 1 }), { code: 'QUOTA_EXCEEDED' });
  assert.throws(() => input.flush(() => { throw new Error('LATE_INPUT'); }));
  assert.equal(input.records.length, 1);
  assert.equal(input.held_sources.size, 1);
  input.flush(records => {
    assert.equal(records[0].audio_seconds, 0.1);
    assert.equal(records[0].raw_time_ms, 100);
  });
  assert.equal(input.records.length, 0);
});
