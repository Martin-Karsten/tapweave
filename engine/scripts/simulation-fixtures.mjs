// Deterministic explicit-input fixtures. None synthesizes prepared map behavior.
function adjacent(value, direction) {
  if (value === 0) return direction * Number.MIN_VALUE;
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value);
  let floatBits = view.getBigUint64(0);
  floatBits += BigInt((value > 0) === (direction > 0) ? 1 : -1);
  view.setBigUint64(0, floatBits);
  return view.getFloat64(0);
}

export function simulationFixtures() {
  const fixtures = [{ id: 'result-properties', kind: 'properties' }];
  const addScore = (id, maximum, actual, extra = {}) => {
    fixtures.push({ id, kind: 'score', maximum, actual, ...extra });
  };
  addScore('great-ok', [5, 5], [5, 3]);
  addScore('perfect', [5, 5, 5], [5, 5, 5]);
  addScore('miss-combo', [5, 5, 5, 5], [5, 1, 3, 5]);
  addScore('nested-and-parent', [5, 10, 10, 16, 14], [5, 10, 9, 16, 14]);
  addScore('ignored-tail', [5, 10, 16, 14], [5, 10, 13, 14]);
  addScore('small-ticks', [8, 8, 8], [8, 7, 8]);
  addScore('bonus-above-million', [5, 12, 11], [5, 12, 11]);
  addScore('ignored-bonus', [5, 12, 11], [5, 13, 13]);
  addScore('combo-break', [5, 14, 5], [5, 15, 5]);
  addScore('ignored-only', [14, 14], [14, 13]);
  addScore('bonus-only', [12, 11], [12, 11]);
  addScore('suppressed-after-failure', [5, 5, 5], [5, 1, 5], { failed_before: [false, false, true] });
  addScore('all-basic', [6, 6, 6, 6, 6, 6], [1, 2, 3, 4, 5, 6]);
  for (let resultId = 1; resultId <= 6; resultId++) {
    addScore(`basic-${resultId}`, [6], [resultId]);
  }
  // Dense deterministic mixed streams expose cumulative precision/rounding drift.
  for (let seed = 1; seed <= 12; seed++) {
    let randomState = seed;
    const maximum = [];
    const actual = [];
    for (let judgementIndex = 0; judgementIndex < 512; judgementIndex++) {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      const resultPair = [
        [5, 5], [5, 3], [5, 2], [5, 1], [10, 10], [10, 9],
        [16, 16], [16, 13], [8, 8], [8, 7], [12, 12], [14, 14],
      ][randomState % 12];
      maximum.push(resultPair[0]);
      actual.push(resultPair[1]);
    }
    addScore(`mixed-${seed}`, maximum, actual);
  }
  for (const difficulty of [0, 1, 2.5, 4.9, 5, 5.1, 7.5, 9, 10]) {
    const range = (minimum, middle, maximum) => difficulty > 5
      ? middle + (maximum - middle) * ((difficulty - 5) / 5)
      : middle + (middle - minimum) * ((difficulty - 5) / 5);
    const boundaries = [
      Math.floor(range(80, 50, 20)) - .5,
      Math.floor(range(140, 100, 60)) - .5,
      Math.floor(range(200, 150, 100)) - .5,
      400,
    ];
    const offsets = [0, ...boundaries.flatMap(boundary => [boundary, -boundary].flatMap(
      signedBoundary => [adjacent(signedBoundary, -1), signedBoundary, adjacent(signedBoundary, 1)],
    ))];
    fixtures.push({ id: `windows-${difficulty}`, kind: 'windows', difficulty, offsets });
  }
  for (const [id, deltas] of [
    ['clockwise', Array(30).fill(90)],
    ['counterclockwise', Array(30).fill(-90)],
    ['reversal', [90, 90, -90, -90, -90, -90, -90, -90, 90, 90]],
    ['cheese', Array.from({ length: 100 }, (_, sampleIndex) => sampleIndex % 2 ? -179 : 179)],
    ['partial', [0, 1, 89, 179, 91, 90, -180, 180, 180]],
    ['fractional', Array(2000).fill(0.1)],
    ['zero', Array(5).fill(0)],
  ]) {
    fixtures.push({ id: `spin-${id}`, kind: 'spin', deltas });
  }
  for (const difficulty of [0, 5, 10]) {
    for (const [name, times, break_end_times] of [
      ['empty', [], []],
      ['single', [1000], []],
      ['stream', [1000, 2000, 3000, 4000], []],
      ['break', [1000, 2000, 10000, 11000], [9000]],
      ['same-time', [1000, 1000, 1000], []],
      ['nested-order', [1000, 2000, 1500, 2500], []],
    ]) {
      fixtures.push({
        id: `drain-${difficulty}-${name}`, kind: 'drain', difficulty, drain_start_ms: 0,
        break_end_times, increases: times.map(time_ms => ({ time_ms, amount: 0.03 })),
      });
    }
  }
  fixtures.push({
    id: 'round-midpoints', kind: 'round',
    values: [0, 0.5, 1.5, 2.5, 3.5, 399176.5, 399177.5, 1000000.5, adjacent(.5, -1), adjacent(.5, 1)],
  });
  for (const spans of [1, 2, 3, 5]) {
    fixtures.push({ id: `slider-position-${spans}`, kind: 'slider_position', spans,
      targets: [-1, 0, 1 / 3, .99, 1, 1.01, spans - .01, spans, spans + 1] });
  }
  fixtures.push({ id: 'upstream-replay-interpolation', kind: 'replay',
    frames: [[1000, 1 / 3, 0], [1100, 100.1, 1], [1100, 100.1, 2], [1200, 200.2, 0]].map(([time, x, action_bits], frameIndex) => ({
      sequence: frameIndex + 1, raw_time_ms: time, effective_time_ms: time, x, y: 0, action_bits, source: 0, focus_epoch: 0, flags: 0,
    })), targets: [900, 1000, 1000.001, 1033.333333333, 1099.99, 1100, 1150, 1200, 1300] });
  return fixtures;
}

export function localSimulationFixtures() {
  const events = [];
  let eventId = 1;
  for (const time_ms of [0, 50, 100, 150, 400, 1000]) {
    for (const phase of ['INPUT', 'TRACKING', 'JUDGEMENT', 'PARENT', 'SCORE_HEALTH', 'OUTPUT']) {
      for (let objectIndex = 0; objectIndex < 3; objectIndex++) {
        events.push({
          id: eventId++,
          key: {
            time_ms, phase, object_index: phase === 'INPUT' ? 0 : objectIndex,
            component_index: 0, input_sequence: phase === 'INPUT' ? objectIndex + 1 : 0,
          },
        });
      }
    }
  }
  const fixtures = [];
  const schedules = [
    ['direct', [1000]],
    ...[30, 60, 120, 144].map(frequencyHz => [
      `${frequencyHz}hz`,
      Array.from({ length: frequencyHz + 1 }, (_, frameIndex) => frameIndex * 1000 / frequencyHz),
    ]),
  ];
  for (const stallDuration of [50, 100, 250]) {
    for (const stallStart of [0, 50, 100, 150, 400]) {
      schedules.push([`stall-${stallDuration}-at-${stallStart}`, [0, stallStart, stallStart + stallDuration, 1000]]);
    }
  }
  for (const [id, targets] of schedules) {
    fixtures.push({ id: `events-${id}`, kind: 'events', events: [...events].reverse(), targets });
  }
  const frame = (sequence, timeMs, x, action_bits) => ({
    sequence, raw_time_ms: timeMs, effective_time_ms: timeMs, x, y: 0,
    action_bits, source: 0, focus_epoch: 0, flags: 0,
  });
  for (const [id, frames, committed_ms] of [
    ['equal-time', [frame(1, 100, 0, 1), frame(2, 100, 0, 0)], 100],
    ['unknown-action', [frame(1, 100, 0, 1), frame(2, 100, 0, 8)], 100],
    ['late', [frame(1, 99, 0, 0)], 100],
    ['sequence-reuse', [frame(1, 100, 0, 0), frame(1, 100, 0, 1)], 100],
    ['time-reversal', [frame(1, 100, 0, 0), frame(2, 99, 0, 1)], 0],
    ['capacity', Array.from({ length: 5 }, (_, frameIndex) => frame(frameIndex + 1, 100, 0, 0)), 100],
  ]) {
    fixtures.push({ id: `inputs-${id}`, kind: 'inputs', frames, committed_ms });
  }
  fixtures.push({ id: 'codec-empty', kind: 'codec', frames: [] });
  fixtures.push({
    id: 'codec-frames', kind: 'codec',
    frames: [frame(1, -100, 1 / 3, 0), frame(2, 100, 100, 1), frame(3, 100, 100, 0)],
  });
  fixtures.push({
    id: 'replay-equal-time', kind: 'replay',
    frames: [
      frame(1, 1000, 0, 0), frame(2, 1100, 100, 1), frame(3, 1100, 100, 0),
      frame(4, 1100, 100, 2), frame(5, 1200, 200, 2),
    ],
    targets: [900, 1000, 1050, 1100, 1150, 1200, 1300],
  });
  fixtures.push({ id: 'queue-overlapping-buffers', kind: 'queue_overlap' });
  for (const [id, startTime, endTime, sampleTime] of [
    ['subnormal-positive', 0, 3 * Number.MIN_VALUE, Number.MIN_VALUE],
    ['subnormal-negative', -3 * Number.MIN_VALUE, 0, -2 * Number.MIN_VALUE],
  ]) {
    fixtures.push({
      id: `replay-${id}`, kind: 'replay',
      frames: [frame(1, startTime, 0, 1), frame(2, endTime, 300, 2)], targets: [sampleTime],
    });
  }
  return fixtures;
}
