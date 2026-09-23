import { HIT_RESULT_NAMES, RANK_NAMES } from '@browser/abi-records.js';
import type { Session_Output } from '@browser/engine-bridge.js';
import type { Active_Selection } from '@browser/selection.js';

// Shared presentation helpers for finished attempts: the labeled result rows
// used by both the play route's transient terminal overlay and the results
// screen, plus the score/rank/beatmap labels of the dedicated results layout.

export const score_text = (result: Session_Output): string => String(result.summary.score);

export const accuracy_text = (result: Session_Output): string => `${(Number(result.summary.accuracy) * 100).toFixed(2)}%`;

export const max_combo_text = (result: Session_Output): string => String(result.summary.highest_combo);

// Rank letters come from the ABI record names (X/S/A/B/C/D/F); an out-of-range
// rank renders as its raw value.
export const rank_name = (rank: number): string | null => RANK_NAMES[rank] ?? null;

// The results emblem colors each rank through the per-rank product tokens in
// tokens.css; the returned class is empty-safe for unknown rank values.
export const rank_class = (rank: number): string | null => {
  const name = rank_name(rank);
  return name === null ? null : `rank-${name.toLowerCase()}`;
};

// Labeled summary rows for a finished attempt. Score stays the first entry:
// the browser parity suite reads the first dd of #result-stats as the score.
export const result_items = (result: Session_Output): [string, string][] => {
  const summary = result.summary;
  const items: [string, string][] = [['Score', score_text(result)], ['Accuracy', accuracy_text(result)],
    ['Rank', rank_name(Number(summary.rank)) ?? String(summary.rank)], ['Max combo', max_combo_text(result)]];
  for (const count of result.result_counts()) {
    if (Number(count.actual) || Number(count.maximum)) {
      items.push([HIT_RESULT_NAMES[Number(count.result)] ?? `Result ${count.result}`, String(count.actual)]);
    }
  }
  return items;
};

const filename_display_name = (filename: string): string =>
  filename.split('/').at(-1)?.replace(/\.osu$/i, '') ?? filename;

// Beatmap labels for the results header, following the song-select metadata
// rules: decoder-owned fields with fallback only for explicitly empty values,
// and a version that merely repeats the filename base stays hidden (the same
// shape as select_screen's map_name/map_difficulty helpers).
export const result_beatmap_labels = (selection: Active_Selection): { title: string; version: string | null } => {
  const metadata = selection.descriptor.metadata;
  const filename_base = filename_display_name(selection.filename);
  const title = metadata.title !== '' ? metadata.title : filename_base;
  const version = metadata.version !== '' && metadata.version !== filename_base ? metadata.version : null;
  return { title, version };
};
