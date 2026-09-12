import { beatmap, input } from './gameplay-fixtures.mjs';

// Local capacity/cadence regressions, not upstream acceptance. Every object is
// judged, so early failure cannot turn a large fixture into a short smoke test.
export function gameplayWorkloads() {
  return [
    { id: 'dense-10000-circles', count: 10000, interval_ms: 1 },
    { id: 'long-ten-minute-replay', count: 1200, interval_ms: 500 },
  ].map(({ id, count, interval_ms }) => {
    const objects = [];
    const inputs = [];
    for (let object_index = 0; object_index < count; object_index++) {
      const time_ms = 1000 + object_index * interval_ms;
      const x = object_index % 2 === 0 ? 64 : 448;
      objects.push(`${x},192,${time_ms},1,0`);
      inputs.push(input(time_ms, x, 192, 1), input(time_ms + 0.25, x, 192));
    }
    return { id, map: beatmap(objects, { hp: 0 }).replace('Mode:0', 'Mode:0\nStackLeniency:0'), inputs,
      end_ms: 2000 + (count - 1) * interval_ms, replay: true,
      expected: { assertion: 'all_max', judgement_count: count, state: 'PASSED' },
      acceptance: [], upstream_tests: [], adaptation: 'Synthetic local resource and long-session regression; no upstream oracle.' };
  });
}
