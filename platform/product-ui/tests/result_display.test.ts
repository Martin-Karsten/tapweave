import { describe, expect, it } from 'vitest';
import type { Session_Output } from '@browser/engine-bridge.js';
import type { Active_Selection } from '@browser/selection.js';
import { accuracy_text, max_combo_text, rank_class, rank_name, result_beatmap_labels, result_items, score_text }
  from '../src/screens/result_display';

const result_stub = (overrides: Partial<Session_Output['summary']> = {}): Session_Output =>
  ({
    summary: { score: 1234567n, accuracy: 0.987654, rank: 2, highest_combo: 432n,
      ...overrides },
    result_counts: function* () {
      yield { result: 5, actual: 3n, maximum: 3n };
      yield { result: 1, actual: 0n, maximum: 0n };
    },
  }) as unknown as Session_Output;

const selection_stub = (metadata: { title: string; artist: string; creator: string; version: string },
  filename: string): Active_Selection =>
  ({ filename, descriptor: { metadata } }) as unknown as Active_Selection;

describe('result display formatting', () => {
  it('formats score, accuracy and max combo from the result summary', () => {
    const result = result_stub();
    expect(score_text(result)).toBe('1234567');
    expect(accuracy_text(result)).toBe('98.77%');
    expect(max_combo_text(result)).toBe('432');
  });

  it('keeps Score as the first result row and drops all-zero hit counters', () => {
    const items = result_items(result_stub());
    expect(items[0]).toEqual(['Score', '1234567']);
    expect(items).toContainEqual(['Rank', 'A']);
    expect(items).toContainEqual(['Great', '3']);
    expect(items.map(([label]) => label)).not.toContain('Miss');
  });
});

describe('rank helpers', () => {
  it('names every ABI rank and maps it onto its token class', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(rank => rank_name(rank))).toEqual(['X', 'S', 'A', 'B', 'C', 'D', 'F']);
    expect([0, 1, 2, 3, 4, 5, 6].map(rank => rank_class(rank)))
      .toEqual(['rank-x', 'rank-s', 'rank-a', 'rank-b', 'rank-c', 'rank-d', 'rank-f']);
  });

  it('reports null for an out-of-range rank instead of a class', () => {
    expect(rank_name(99)).toBeNull();
    expect(rank_class(99)).toBeNull();
  });
});

describe('results beatmap labels', () => {
  it('prefers decoder metadata and shows a distinct version', () => {
    const labels = result_beatmap_labels(selection_stub(
      { title: 'Mixed Journey', artist: 'An Artist', creator: 'A Creator', version: 'Hard' }, 'mixed.osu'));
    expect(labels).toEqual({ title: 'Mixed Journey', version: 'Hard' });
  });

  it('falls back to the filename base only for explicitly empty fields', () => {
    const labels = result_beatmap_labels(selection_stub(
      { title: '', artist: '', creator: '', version: '' }, 'sets/mixed.osu'));
    expect(labels).toEqual({ title: 'mixed', version: null });
  });

  it('hides a version that only repeats the filename base', () => {
    const labels = result_beatmap_labels(selection_stub(
      { title: 'Mixed Journey', artist: 'An Artist', creator: 'A Creator', version: 'mixed' }, 'mixed.osu'));
    expect(labels).toEqual({ title: 'Mixed Journey', version: null });
  });
});
