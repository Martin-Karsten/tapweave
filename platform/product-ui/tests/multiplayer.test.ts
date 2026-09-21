import { expect, test } from 'vitest';
import { clock_sample, scheduled_audio_time } from '../src/services/multiplayer';
import { parse_client_message, ranked_results } from '../shared/multiplayer';

test('clock samples map a server deadline onto the current audio timeline', () => {
  const sample = clock_sample(1000, 1020, 5010);
  expect(sample).toEqual({
    round_trip_ms: 20,
    offset_ms: 4000,
  });
  expect(scheduled_audio_time(10_000, sample, 1100, 20)).toBe(24.9);
  expect(() => scheduled_audio_time(5100, sample, 1100, 20)).toThrow(/deadline/);
  expect(() =>
    scheduled_audio_time(
      10_000,
      {
        ...sample,
        round_trip_ms: 201,
      },
      1100,
      20,
    ),
  ).toThrow(/latency/);
});

test('ranking shares placement for equal final scores and excludes failures and withdrawals', () => {
  const completed = {
    status: 'completed' as const,
    score: 100,
    accuracy: 1,
    combo: 20,
    progress: 1,
  };
  expect(
    ranked_results({
      round_id: 'round',
      start_ms: 0,
      deadline_ms: 100,
      participants: [],
      results: {
        first: completed,
        second: completed,
        third: {
          ...completed,
          score: 90,
        },
        failed: {
          ...completed,
          status: 'failed',
        },
        withdrawn: {
          ...completed,
          status: 'withdrawn',
        },
      },
    }).map((result) => [result.member_id, result.placement]),
  ).toEqual([
    ['first', 1],
    ['second', 1],
    ['third', 3],
  ]);
});

test('protocol validation rejects invalid ranges, binary-sized strings, and unknown versions', () => {
  for (const message of [
    {
      version: 2,
      type: 'start',
      sequence: 1,
    },
    {
      version: 1,
      type: 'start',
      sequence: 0,
    },
    {
      version: 1,
      type: 'unknown',
      sequence: 1,
    },
    {
      version: 1,
      type: 'clock',
      sequence: 1,
      client_ms: null,
    },
    {
      version: 1,
      type: 'score',
      sequence: 1,
      round_id: 'round',
      report: {
        score: -1,
        accuracy: 1,
        combo: 0,
        progress: 1,
      },
    },
    {
      version: 1,
      type: 'ready',
      sequence: 1,
      ready: 'yes',
      identity: 'build',
    },
  ]) {
    expect(() => parse_client_message(JSON.stringify(message))).toThrow();
  }
  expect(() => parse_client_message('é'.repeat(2049))).toThrow(/4 KiB/);
});
