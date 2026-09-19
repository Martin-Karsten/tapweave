import { RECORD } from './abi-records.js';
import type { Foundation_Description, Prepared_Description } from './engine-bridge.js';

// Plain display data extracted from one difficulty's engine summary. Values
// are copies: no descriptor view, map handle or engine resource stays alive.
export interface Map_Summary {
  filename: string;
  title: string;
  artist: string;
  creator: string;
  version: string;
  hp: number;
  cs: number;
  od: number;
  ar: number;
  // Display-only BPM bounds over uninherited timing points; 0 when the map
  // declares none (engine derivation, not upstream-matched math).
  bpm_min: number;
  bpm_max: number;
  // Playable duration in milliseconds, first object start to last object end;
  // null when the map has no objects.
  duration_ms: number | null;
  objects_count: number;
}

export const map_summary_of = (filename: string, descriptor: Foundation_Description): Map_Summary => ({
  filename,
  title: descriptor.metadata.title,
  artist: descriptor.metadata.artist,
  creator: descriptor.metadata.creator,
  version: descriptor.metadata.version,
  hp: descriptor.summary.hp,
  cs: descriptor.summary.cs,
  od: descriptor.summary.od,
  ar: descriptor.summary.ar,
  bpm_min: descriptor.summary.bpm_min,
  bpm_max: descriptor.summary.bpm_max,
  duration_ms: descriptor.duration_ms(),
  objects_count: descriptor.summary.objects,
});

// Drain time subtracts the break periods overlapping the playable span from
// the playable duration. Breaks arrive time-ordered and non-overlapping from
// the decoder, so a single pass clips each break to the span.
export const drain_ms = (
  start_ms: number,
  end_ms: number,
  breaks: readonly { start_ms: number; end_ms: number }[],
): number => {
  let drain = end_ms - start_ms;
  for (const break_period of breaks) {
    const overlap_start = Math.max(break_period.start_ms, start_ms);
    const overlap_end = Math.min(break_period.end_ms, end_ms);
    if (overlap_end > overlap_start) {
      drain -= overlap_end - overlap_start;
    }
  }
  return drain;
};

// The same playable span for the active selection's prepared descriptor; null
// when the map has no objects.
export const playable_span_of = (descriptor: Prepared_Description): { start_ms: number; end_ms: number } | null => {
  const first_object_ms = descriptor.first_object_ms();
  if (first_object_ms === null) return null;
  let last_object_ms = first_object_ms;
  for (const prepared_object of descriptor.records(descriptor.summary, 'objects', RECORD.prepared_object)) {
    last_object_ms = Math.max(last_object_ms, prepared_object.end_time_ms as number);
  }
  return { start_ms: first_object_ms, end_ms: last_object_ms };
};
