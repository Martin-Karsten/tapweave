import { normalize_asset_path, type Asset_Scope } from '@browser/archive.js';
import { playable_span_of } from '@browser/map-summary.js';
import type { Active_Selection } from '@browser/selection.js';
import { matching_map, valid_selected_map, type Selected_Map } from '../../shared/multiplayer';

export class Incompatible_Map extends Error {}

export async function hash_bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function matching_filename(
  source: Asset_Scope,
  expected: Selected_Map,
): Promise<string> {
  for (const filename of source.list_maps()) {
    const bytes = await source.read(filename);
    if (bytes && (await hash_bytes(bytes)) === expected.map_hash) {
      return filename;
    }
  }
  throw new Incompatible_Map(
    'This set has no matching difficulty. Import the same .osu and music files as the host.',
  );
}

export async function describe_local_map(
  selection: Active_Selection,
  engine_hash: string,
): Promise<Selected_Map> {
  // Copy engine-derived values before asynchronous reads/hashing: cancellation
  // may release the candidate handle while those operations are pending.
  const metadata = selection.descriptor.metadata;
  const end_ms = playable_span_of(selection.descriptor)?.end_ms ?? 0;
  const audio_filename = selection.descriptor.audio_filename;
  const map_bytes = await selection.source.read(selection.filename);
  const directory = selection.filename.includes('/')
    ? selection.filename.slice(0, selection.filename.lastIndexOf('/') + 1)
    : '';
  const music_path = audio_filename ? normalize_asset_path(directory + audio_filename) : null;
  const music_bytes = music_path ? await selection.source.read(music_path) : null;
  if (!map_bytes || !music_bytes) {
    throw new Incompatible_Map(
      'The selected map or its referenced music is missing. Import both files.',
    );
  }
  if (!selection.music_buffer) {
    throw new Error(selection.music_error ?? 'Music preparation failed.');
  }
  const label = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 128);
  const descriptor: Selected_Map = {
    map_hash: await hash_bytes(map_bytes),
    music_hash: await hash_bytes(music_bytes),
    engine_hash,
    title: label(metadata.title),
    artist: label(metadata.artist),
    creator: label(metadata.creator),
    difficulty: label(metadata.version),
    end_ms,
  };
  if (!valid_selected_map(descriptor)) {
    throw new Error('This map has no playable timeline within the four-hour room limit.');
  }
  return descriptor;
}

export function require_matching_map(actual: Selected_Map, expected: Selected_Map) {
  if (!matching_map(actual, expected)) {
    throw new Incompatible_Map(
      'Incompatible map, music, or engine build. Import the exact difficulty and music used by the host.',
    );
  }
}
