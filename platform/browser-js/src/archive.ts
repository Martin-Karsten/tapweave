import { Inflate } from 'fflate';
import { require_condition } from './errors.js';
import type { Decode_Audio } from './audio-decoder.js';

export interface Asset_Limits {
  archive_bytes: number;
  entry_count: number;
  entry_bytes: number;
  extracted_bytes: number;
  decoded_audio_bytes: number;
}

export interface Asset_Access {
  read(filename: string): Promise<Uint8Array | null>;
  decode_music(filename: string, bytes: Uint8Array, decode_audio: Decode_Audio): Promise<AudioBuffer>;
}

export interface Asset_Scope extends Asset_Access {
  dispose(): void;
  list_maps(): string[];
}

export const ASSET_LIMITS: Asset_Limits = Object.freeze({
  archive_bytes: 128 * 1024 * 1024,
  entry_count: 4096,
  entry_bytes: 64 * 1024 * 1024,
  extracted_bytes: 256 * 1024 * 1024,
  decoded_audio_bytes: 256 * 1024 * 1024,
});

export function normalize_asset_path(filename: string) {
  require_condition(typeof filename === 'string' && filename.length > 0 && !/[\u0000-\u001f\u007f]/u.test(filename),
    'INVALID_ASSET_PATH', 'Invalid asset filename.');
  const normalized = filename.replaceAll('\\', '/').normalize('NFC');
  require_condition(!normalized.startsWith('/') && !normalized.includes(':'),
    'INVALID_ASSET_PATH', 'Absolute asset paths are unsupported.');
  const segments = normalized.split('/');
  require_condition(segments.every(segment => segment !== '..' && segment !== '.' && segment.length > 0),
    'INVALID_ASSET_PATH', 'Ambiguous asset path.');
  return normalized.toLowerCase();
}

function require_bytes(view: DataView, offset: number, count: number) {
  require_condition(Number.isSafeInteger(offset) && Number.isSafeInteger(count) && offset >= 0 && count >= 0 &&
    offset <= view.byteLength && count <= view.byteLength - offset, 'MALFORMED_ARCHIVE', 'Truncated ZIP record.');
}

const crc_table = new Uint32Array(256);
for (let table_index = 0; table_index < crc_table.length; table_index++) {
  let checksum = table_index;
  for (let bit_index = 0; bit_index < 8; bit_index++) {
    checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0);
  }
  crc_table[table_index] = checksum;
}

function crc32(bytes: Uint8Array) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum = crc_table[(checksum ^ byte) & 255] ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

interface Archive_Entry {
  filename: string;
  payload_offset: number;
  compressed_size: number;
  original_size: number;
  checksum: number;
  compression: number;
}

// Shared map-set lifetime for raw and decoded assets.
class Asset_Source<Entry_Type> {
  limits: Asset_Limits;
  entries = new Map<string, Entry_Type>();
  cache = new Map<string, Uint8Array>();
  decoded_audio = new Map<string, AudioBuffer>();
  pending_audio = new Map<string, Promise<AudioBuffer>>();
  decoded_audio_bytes = 0;
  extracted_bytes = 0;
  disposed = false;

  constructor(limits: Asset_Limits) {
    this.limits = limits;
  }

  list_maps() {
    return [...this.entries.keys()].filter(filename => filename.endsWith('.osu')).sort();
  }

  async decode_music(filename: string, bytes: Uint8Array, decode_audio: Decode_Audio) {
    const normalized_name = normalize_asset_path(filename);
    require_condition(!this.disposed, 'DISPOSED', 'Asset scope is disposed.');
    if (this.decoded_audio.has(normalized_name)) {
      return this.decoded_audio.get(normalized_name)!;
    }
    if (this.pending_audio.has(normalized_name)) {
      return this.pending_audio.get(normalized_name)!;
    }
    const pending = this.decode_and_retain(normalized_name, bytes, decode_audio);
    this.pending_audio.set(normalized_name, pending);
    try {
      return await pending;
    } finally {
      this.pending_audio.delete(normalized_name);
    }
  }

  async decode_and_retain(normalized_name: string, bytes: Uint8Array, decode_audio: Decode_Audio) {
    const buffer = await decode_audio(bytes);
    require_condition(!this.disposed, 'DISPOSED', 'Asset scope was disposed during decoding.');
    const decoded_bytes = buffer.length * buffer.numberOfChannels * 4;
    require_condition(Number.isSafeInteger(decoded_bytes) && decoded_bytes >= 0 &&
      decoded_bytes <= this.limits.decoded_audio_bytes - this.decoded_audio_bytes,
      'QUOTA_EXCEEDED', 'Decoded music exceeds the audio quota.');
    this.decoded_audio.set(normalized_name, buffer);
    this.decoded_audio_bytes += decoded_bytes;
    return buffer;
  }

  dispose() {
    this.disposed = true;
    this.entries.clear();
    this.cache.clear();
    this.decoded_audio.clear();
    this.pending_audio.clear();
    this.decoded_audio_bytes = 0;
    this.extracted_bytes = 0;
  }
}

// Index and validate the ZIP envelope here; fflate owns DEFLATE decoding.
// ZIP64, encrypted, multi-disk and non-UTF8 non-ASCII names are explicit errors.
export class Archive_Assets extends Asset_Source<Archive_Entry> {
  bytes: Uint8Array | null;

  constructor(bytes: Uint8Array, limits: Asset_Limits = ASSET_LIMITS) {
    super(limits);
    require_condition(bytes instanceof Uint8Array && bytes.length <= limits.archive_bytes,
      'QUOTA_EXCEEDED', 'Archive exceeds the compressed byte quota.');
    this.bytes = bytes;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    require_bytes(view, 0, 22);
    let end_offset = -1;
    for (let candidate_offset = bytes.length - 22; candidate_offset >= Math.max(0, bytes.length - 65557); candidate_offset--) {
      if (view.getUint32(candidate_offset, true) === 0x06054b50 &&
          candidate_offset + 22 + view.getUint16(candidate_offset + 20, true) === bytes.length) {
        end_offset = candidate_offset;
        break;
      }
    }
    require_condition(end_offset >= 0, 'MALFORMED_ARCHIVE', 'ZIP end record is missing.');
    const entry_count = view.getUint16(end_offset + 10, true);
    const directory_size = view.getUint32(end_offset + 12, true);
    const directory_start = view.getUint32(end_offset + 16, true);
    require_condition(view.getUint16(end_offset + 4, true) === 0 && view.getUint16(end_offset + 6, true) === 0 &&
      view.getUint16(end_offset + 8, true) === entry_count && entry_count !== 65535 && directory_start !== 0xffffffff &&
      directory_size !== 0xffffffff, 'UNSUPPORTED_ARCHIVE', 'ZIP64 and multi-disk archives are unsupported.');
    require_condition(entry_count <= limits.entry_count, 'QUOTA_EXCEEDED', 'Archive has too many entries.');
    require_condition(directory_start + directory_size === end_offset,
      'MALFORMED_ARCHIVE', 'Invalid ZIP directory bounds.');
    require_bytes(view, directory_start, directory_size);
    let directory_offset = directory_start;
    let declared_total_bytes = 0;
    const occupied_ranges: [number, number][] = [];
    const known_paths = new Set<string>();
    for (let entry_index = 0; entry_index < entry_count; entry_index++) {
      require_bytes(view, directory_offset, 46);
      require_condition(view.getUint32(directory_offset, true) === 0x02014b50, 'MALFORMED_ARCHIVE', 'Invalid ZIP directory entry.');
      const flags = view.getUint16(directory_offset + 8, true);
      const compression = view.getUint16(directory_offset + 10, true);
      const checksum = view.getUint32(directory_offset + 16, true);
      const compressed_size = view.getUint32(directory_offset + 20, true);
      const original_size = view.getUint32(directory_offset + 24, true);
      const name_size = view.getUint16(directory_offset + 28, true);
      const extra_size = view.getUint16(directory_offset + 30, true);
      const comment_size = view.getUint16(directory_offset + 32, true);
      const local_offset = view.getUint32(directory_offset + 42, true);
      require_condition((flags & ~0x080e) === 0 && (compression === 0 || compression === 8) &&
        view.getUint16(directory_offset + 34, true) === 0 && local_offset !== 0xffffffff &&
        compressed_size !== 0xffffffff && original_size !== 0xffffffff,
        'UNSUPPORTED_ARCHIVE', 'Unsupported ZIP flags, compression, or ZIP64 entry.');
      require_bytes(view, directory_offset + 46, name_size + extra_size + comment_size);
      const name_bytes = bytes.subarray(directory_offset + 46, directory_offset + 46 + name_size);
      require_condition((flags & 0x800) !== 0 || name_bytes.every(byte => byte < 128),
        'UNSUPPORTED_ARCHIVE', 'Non-UTF8 archive filenames are unsupported.');
      const filename = new TextDecoder('utf-8', { fatal: true }).decode(name_bytes);
      const is_directory = filename.endsWith('/');
      const normalized_name = normalize_asset_path(is_directory ? filename.slice(0, -1) : filename);
      require_condition(!known_paths.has(normalized_name), 'DUPLICATE_ASSET', 'Archive contains ambiguous filenames.');
      known_paths.add(normalized_name);
      require_condition(original_size <= limits.entry_bytes && original_size <= limits.extracted_bytes - declared_total_bytes,
        'QUOTA_EXCEEDED', 'Archive exceeds the extracted byte quota.');
      declared_total_bytes += original_size;
      require_bytes(view, local_offset, 30);
      const local_name_size = view.getUint16(local_offset + 26, true);
      const local_extra_size = view.getUint16(local_offset + 28, true);
      const payload_offset = local_offset + 30 + local_name_size + local_extra_size;
      require_bytes(view, local_offset + 30, local_name_size + local_extra_size);
      require_bytes(view, payload_offset, compressed_size);
      require_condition(view.getUint32(local_offset, true) === 0x04034b50 &&
        view.getUint16(local_offset + 6, true) === flags && view.getUint16(local_offset + 8, true) === compression &&
        local_name_size === name_size && name_bytes.every((byte, name_index) => byte === bytes[local_offset + 30 + name_index]) &&
        payload_offset + compressed_size <= directory_start,
        'MALFORMED_ARCHIVE', 'ZIP local entry disagrees with directory.');
      let entry_end = payload_offset + compressed_size;
      if ((flags & 8) === 0) {
        require_condition(view.getUint32(local_offset + 14, true) === checksum &&
          view.getUint32(local_offset + 18, true) === compressed_size &&
          view.getUint32(local_offset + 22, true) === original_size,
          'MALFORMED_ARCHIVE', 'ZIP local sizes or checksum disagree.');
      } else {
        // The optional signature can also be a valid unsigned descriptor CRC.
        // Match the complete tuple before choosing either representation.
        const descriptor_matches = (checksum_offset: number) => checksum_offset + 12 <= directory_start &&
          view.getUint32(checksum_offset, true) === checksum &&
          view.getUint32(checksum_offset + 4, true) === compressed_size &&
          view.getUint32(checksum_offset + 8, true) === original_size;
        if (entry_end + 16 <= directory_start && view.getUint32(entry_end, true) === 0x08074b50 &&
            descriptor_matches(entry_end + 4)) {
          entry_end += 16;
        } else {
          require_condition(descriptor_matches(entry_end),
            'MALFORMED_ARCHIVE', 'ZIP data descriptor is missing or disagrees with directory.');
          entry_end += 12;
        }
      }
      require_condition(compression !== 8 || compressed_size > 0, 'MALFORMED_ARCHIVE', 'Empty DEFLATE payload.');
      require_condition(compression !== 0 || compressed_size === original_size, 'MALFORMED_ARCHIVE', 'Stored ZIP size mismatch.');
      occupied_ranges.push([local_offset, entry_end]);
      if (!is_directory) {
        this.entries.set(normalized_name, { filename, payload_offset, compressed_size, original_size, checksum, compression });
      }
      directory_offset += 46 + name_size + extra_size + comment_size;
    }
    require_condition(directory_offset === end_offset, 'MALFORMED_ARCHIVE', 'ZIP entry count mismatch.');
    occupied_ranges.sort((first_range, second_range) => first_range[0] - second_range[0]);
    for (let range_index = 1; range_index < occupied_ranges.length; range_index++) {
      require_condition(occupied_ranges[range_index][0] >= occupied_ranges[range_index - 1][1],
        'MALFORMED_ARCHIVE', 'Overlapping ZIP entries.');
    }
  }

  async read(filename: string) {
    require_condition(!this.disposed, 'DISPOSED', 'Archive is disposed.');
    const normalized_name = normalize_asset_path(filename);
    if (this.cache.has(normalized_name)) {
      return this.cache.get(normalized_name)!;
    }
    const entry = this.entries.get(normalized_name);
    if (!entry) {
      return null;
    }
    require_condition(entry.original_size <= this.limits.extracted_bytes - this.extracted_bytes,
      'QUOTA_EXCEEDED', 'Extracted assets exceed quota.');
    const output = new Uint8Array(entry.original_size);
    let output_offset = 0;
    const receive_chunk = (chunk: Uint8Array) => {
      require_condition(chunk.length <= output.length - output_offset,
        'MALFORMED_ARCHIVE', 'ZIP output exceeds declared size.');
      output.set(chunk, output_offset);
      output_offset += chunk.length;
    };
    const compressed = this.bytes!.subarray(entry.payload_offset, entry.payload_offset + entry.compressed_size);
    if (entry.compression === 0) {
      receive_chunk(compressed);
    } else {
      const inflater = new Inflate(receive_chunk);
      // Bound each decoder expansion; never hand a hostile full stream to inflateSync.
      for (let compressed_offset = 0; compressed_offset < compressed.length; compressed_offset += 1024) {
        inflater.push(compressed.subarray(compressed_offset, compressed_offset + 1024), compressed_offset + 1024 >= compressed.length);
      }
    }
    require_condition(output_offset === entry.original_size && crc32(output) === entry.checksum,
      'MALFORMED_ARCHIVE', 'ZIP size or CRC mismatch.');
    this.extracted_bytes += output.length;
    this.cache.set(normalized_name, output);
    return output;
  }

  override dispose() {
    super.dispose();
    this.bytes = null;
  }
}

export class Loose_Assets extends Asset_Source<File> {
  constructor(files: File[], limits: Asset_Limits = ASSET_LIMITS) {
    super(limits);
    let total_bytes = 0;
    require_condition(files.length <= limits.entry_count, 'QUOTA_EXCEEDED', 'Too many selected files.');
    for (const file of files) {
      const filename = normalize_asset_path(file.webkitRelativePath || file.name);
      require_condition(!this.entries.has(filename), 'DUPLICATE_ASSET', 'Selected files have ambiguous names.');
      require_condition(file.size <= limits.entry_bytes && file.size <= limits.extracted_bytes - total_bytes,
        'QUOTA_EXCEEDED', 'Selected assets exceed quota.');
      total_bytes += file.size;
      this.entries.set(filename, file);
    }
  }

  async read(filename: string) {
    require_condition(!this.disposed, 'DISPOSED', 'Asset scope is disposed.');
    const file = this.entries.get(normalize_asset_path(filename));
    if (!file) {
      return null;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    require_condition(!this.disposed, 'DISPOSED', 'Asset scope was disposed during loading.');
    require_condition(bytes.length === file.size, 'MALFORMED_ASSET', 'File size changed during reading.');
    return bytes;
  }
}
