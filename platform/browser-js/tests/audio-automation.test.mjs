import test from 'node:test';
import assert from 'node:assert/strict';
import { Audio_Automation } from '../build/audio-automation.js';

function parameter_fixture() {
  const calls = [];
  return { calls,
    cancelScheduledValues: time => calls.push(['cancel', time]),
    setValueAtTime: (amplitude, time) => calls.push(['set', amplitude, time]),
    linearRampToValueAtTime: (amplitude, time) => calls.push(['ramp', amplitude, time]),
  };
}

test('future replacement retains the preceding linear segment without cancelAndHoldAtTime', () => {
  const parameter = parameter_fixture();
  const automation = new Audio_Automation(0, 8);
  automation.replace(parameter, 0, 1, 2, 1);
  parameter.calls.length = 0;
  automation.replace(parameter, 0, 2, 1, 0);
  assert.deepEqual(parameter.calls, [
    ['cancel', 2], ['ramp', 0.5, 2], ['set', 0.5, 2], ['ramp', 0, 3],
  ]);
  // A later batch can replace before the most recently scheduled start.
  parameter.calls.length = 0;
  automation.replace(parameter, 0, 1.5, 1, 1);
  assert.deepEqual(parameter.calls, [
    ['cancel', 1.5], ['ramp', 0.25, 1.5], ['set', 0.25, 1.5], ['ramp', 1, 2.5],
  ]);
});

test('replacement before a ramp, at its boundary, and after completion retains the correct value', () => {
  const parameter = parameter_fixture();
  const automation = new Audio_Automation(0.5, 8);
  automation.replace(parameter, 0, 2, 1, 1);
  automation.replace(parameter, 0, 1, 1, 0);
  parameter.calls.length = 0;
  automation.replace(parameter, 2, 2, 0, 0.25);
  assert.deepEqual(parameter.calls, [['cancel', 2], ['set', 0, 2], ['set', 0.25, 2]]);
  parameter.calls.length = 0;
  automation.replace(parameter, 3, 3, 1, 1);
  assert.deepEqual(parameter.calls, [['cancel', 3], ['set', 0.25, 3], ['ramp', 1, 4]]);
});

test('equal-time replacements retain instantaneous targets and replace future ramps in sequence order', () => {
  const parameter = parameter_fixture();
  const automation = new Audio_Automation(0, 2);
  automation.replace(parameter, 0, 1, 0, 0.5);
  automation.replace(parameter, 0, 1, 2, 1);
  parameter.calls.length = 0;
  automation.replace(parameter, 0, 1, 1, 0);
  assert.deepEqual(parameter.calls, [['cancel', 1], ['set', 0.5, 1], ['ramp', 0, 2]]);
});

test('a future replacement exactly at the old endpoint preserves the entire incoming ramp', () => {
  const parameter = parameter_fixture();
  const automation = new Audio_Automation(1, 4);
  automation.replace(parameter, 0, 1, 1, 0);
  parameter.calls.length = 0;
  automation.replace(parameter, 0, 2, 0, 0.25);
  assert.deepEqual(parameter.calls, [['cancel', 2], ['ramp', 0, 2], ['set', 0, 2], ['set', 0.25, 2]]);
});

test('unrendered automation is bounded and completed history is reclaimed', () => {
  const parameter = parameter_fixture();
  const automation = new Audio_Automation(0, 2);
  automation.replace(parameter, 0, 1, 1, 1);
  automation.replace(parameter, 0, 3, 1, 0);
  parameter.calls.length = 0;
  assert.throws(() => automation.replace(parameter, 0, 5, 1, 1), { code: 'QUOTA_EXCEEDED' });
  assert.deepEqual(parameter.calls, []);
  automation.replace(parameter, 4, 5, 1, 1);
  assert.deepEqual(parameter.calls, [['cancel', 5], ['set', 0, 5], ['ramp', 1, 6]]);
});
