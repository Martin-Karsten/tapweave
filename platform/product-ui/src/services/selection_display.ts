import type { Active_Selection } from '@browser/selection.js';
import type { Selection_Set_Snapshot } from './player_session';

// Presentation helpers shared by the solo select screen and the multiplayer
// lobby picker. Everything here is pure formatting over the selection
// snapshot: no reactivity, no browser APIs.

export type Display_Metadata_Field = 'title' | 'artist' | 'creator' | 'version';

// Decoder-owned song-select metadata, with filename fallback for explicitly
// empty fields. The decoder fills the pinned lazer defaults ("Unknown" /
// "Unknown" / "Unknown Creator" / "Normal"; lazer Beatmap.cs constructor at
// the pinned commit) for maps without a [Metadata] section, and those are
// legitimate values a beatmap can also set deliberately — they display like
// any other string, matching lazer's own song select. Only an empty value
// counts as absent.
export const metadata_field = (selection: Active_Selection, field: Display_Metadata_Field): string | null => {
  const value = selection.descriptor.metadata[field];
  return value !== '' ? value : null;
};

export const map_display_name = (filename: string): string =>
  filename.split('/').at(-1)?.replace(/\.osu$/i, '') ?? filename;

export const format_duration_ms = (duration_ms: number | null | undefined): string => {
  if (duration_ms === null || duration_ms === undefined) return '';
  const total_seconds = Math.round(duration_ms / 1000);
  const minutes = Math.floor(total_seconds / 60);
  const seconds = String(total_seconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

// Display BPM as a single value or a min–max range; 0 bounds mean the map
// declares no uninherited timing points.
export const format_bpm = (bpm_min: number, bpm_max: number): string => {
  if (bpm_max <= 0) return '';
  const minimum = Math.round(bpm_min);
  const maximum = Math.round(bpm_max);
  return minimum === maximum ? `${maximum}` : `${minimum}–${maximum}`;
};

// Filename-derived stand-in for the lazer set panel title: the shared prefix
// of the set's difficulty filenames, falling back to the given difficulty
// when decoder-owned title metadata is absent.
export const set_display_title = (filenames: readonly string[], active_filename: string): string => {
  let shared_prefix = map_display_name(filenames[0] ?? active_filename);
  for (const filename of filenames.slice(1)) {
    const display_name = map_display_name(filename);
    let shared_length = 0;
    const shared_limit = Math.min(shared_prefix.length, display_name.length);
    while (shared_length < shared_limit && shared_prefix[shared_length] === display_name[shared_length]) {
      shared_length += 1;
    }
    shared_prefix = shared_prefix.slice(0, shared_length);
  }
  shared_prefix = shared_prefix.replace(/[\s\-_.([{$]+$/, '');
  return shared_prefix || map_display_name(active_filename);
};

// Row labels prefer the background summary's decoder-owned version name so
// every difficulty is labelled consistently; the active difficulty falls
// back to its own prepared metadata before the summary pass reaches it, and
// unsummarized rows keep their filename labels.
export const difficulty_row_label = (loaded_set: Selection_Set_Snapshot,
  active_selection: Active_Selection | null, filename: string): string => {
  const summary = loaded_set.summaries.get(filename);
  if (summary && summary.version !== '') return summary.version;
  if (active_selection && active_selection.set_id === loaded_set.set_id && filename === active_selection.filename) {
    const version = metadata_field(active_selection, 'version');
    if (version !== null) return version;
  }
  return map_display_name(filename);
};

// Set titles prefer the active difficulty's decoder-owned metadata, then any
// difficulty summary in the set, then the filename-prefix fallback.
export const set_title_for = (loaded_set: Selection_Set_Snapshot,
  active_selection: Active_Selection | null): string => {
  if (active_selection && active_selection.set_id === loaded_set.set_id) {
    const title = metadata_field(active_selection, 'title');
    if (title !== null) return title;
  }
  for (const filename of loaded_set.filenames) {
    const summary_title = loaded_set.summaries.get(filename)?.title;
    if (summary_title) return summary_title;
  }
  return set_display_title(loaded_set.filenames, loaded_set.active_filename ?? loaded_set.filenames[0] ?? '');
};

export const set_artist_for = (loaded_set: Selection_Set_Snapshot): string | null => {
  for (const filename of loaded_set.filenames) {
    const artist = loaded_set.summaries.get(filename)?.artist;
    if (artist) return artist;
  }
  return null;
};

export const set_count_text = (loaded_set: Selection_Set_Snapshot): string => {
  const count = loaded_set.filenames.length;
  return `${count} ${count === 1 ? 'difficulty' : 'difficulties'}`;
};

export const row_meta_text = (loaded_set: Selection_Set_Snapshot, filename: string): string => {
  const summary = loaded_set.summaries.get(filename);
  if (!summary) return '';
  const parts = [format_duration_ms(summary.duration_ms), format_bpm(summary.bpm_min, summary.bpm_max)];
  return parts.filter(Boolean).join(' · ');
};
