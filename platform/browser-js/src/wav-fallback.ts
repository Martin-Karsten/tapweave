// In-house RIFF/WAVE fallback for PCM encodings the browser's decodeAudioData
// rejects (24-bit integer, WAVE_FORMAT_EXTENSIBLE and friends). Pure parsing:
// every count is validated before allocation, unsupported encodings (ADPCM
// and friends) and truncated input fail with a plain Error so the caller keeps
// the original decode error as the cause. No dependency on browser decoding.

export type Create_Audio_Buffer = (channel_count: number, length: number, sample_rate: number) => AudioBuffer;

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_IEEE_FLOAT = 3;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;
// Extensible sub-format GUIDs carry the 16-bit format code followed by the
// constant KSDATAFORMAT tail (0000-0010-8000-00aa00389b71).
const SUBFORMAT_TAIL = [0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];
const SUPPORTED_BITS = new Set([8, 16, 24, 32]);
const MAXIMUM_CHANNELS = 8;
const MAXIMUM_SAMPLE_RATE = 384_000;

const parse_error = (detail: string): Error => new Error(`Unsupported WAVE audio: ${detail}.`);

function chunk_view(bytes: Uint8Array, offset: number, size: number): DataView {
  if (offset < 0 || size < 0 || offset + size > bytes.byteLength) {
    throw parse_error('truncated chunk');
  }
  return new DataView(bytes.buffer, bytes.byteOffset + offset, size);
}

function read_format_chunk(bytes: Uint8Array, chunk_offset: number, chunk_size: number) {
  if (chunk_size < 16) {
    throw parse_error('short fmt chunk');
  }
  const view = chunk_view(bytes, chunk_offset, chunk_size);
  let audio_format = view.getUint16(0, true);
  const channel_count = view.getUint16(2, true);
  const sample_rate = view.getUint32(4, true);
  const block_align = view.getUint16(12, true);
  const bits_per_sample = view.getUint16(14, true);
  if (audio_format === WAVE_FORMAT_EXTENSIBLE) {
    if (chunk_size < 40 || view.getUint16(16, true) < 22) {
      throw parse_error('short extensible fmt chunk');
    }
    for (let tail_index = 0; tail_index < SUBFORMAT_TAIL.length; tail_index++) {
      if (view.getUint8(26 + tail_index) !== SUBFORMAT_TAIL[tail_index]) {
        throw parse_error('unsupported extensible sub-format');
      }
    }
    audio_format = view.getUint16(24, true);
  }
  if (audio_format !== WAVE_FORMAT_PCM && audio_format !== WAVE_FORMAT_IEEE_FLOAT) {
    throw parse_error(`format code ${audio_format} is not decodable here`);
  }
  if (audio_format === WAVE_FORMAT_IEEE_FLOAT && bits_per_sample !== 32) {
    throw parse_error(`unsupported float width ${bits_per_sample}`);
  }
  if (!SUPPORTED_BITS.has(bits_per_sample)) {
    throw parse_error(`unsupported bit width ${bits_per_sample}`);
  }
  if (channel_count < 1 || channel_count > MAXIMUM_CHANNELS) {
    throw parse_error(`unsupported channel count ${channel_count}`);
  }
  if (sample_rate < 1 || sample_rate > MAXIMUM_SAMPLE_RATE) {
    throw parse_error(`unsupported sample rate ${sample_rate}`);
  }
  const frame_bytes = channel_count * (bits_per_sample >> 3);
  if (block_align !== frame_bytes) {
    throw parse_error(`block align ${block_align} does not match ${frame_bytes}`);
  }
  return { audio_format, channel_count, sample_rate, bits_per_sample, block_align };
}

function deinterleave(
  view: DataView,
  data_offset: number,
  frame_count: number,
  format: { audio_format: number; channel_count: number; sample_rate: number; bits_per_sample: number; block_align: number },
  create_buffer: Create_Audio_Buffer,
): AudioBuffer {
  const buffer = create_buffer(format.channel_count, frame_count, format.sample_rate);
  for (let channel_index = 0; channel_index < format.channel_count; channel_index++) {
    const channel_data = buffer.getChannelData(channel_index);
    for (let frame_index = 0; frame_index < frame_count; frame_index++) {
      const sample_offset = data_offset + frame_index * format.block_align + channel_index * (format.bits_per_sample >> 3);
      switch (format.bits_per_sample) {
        case 8:
          channel_data[frame_index] = (view.getUint8(sample_offset) - 128) / 128;
          break;
        case 16:
          channel_data[frame_index] = view.getInt16(sample_offset, true) / 32768;
          break;
        case 24: {
          const low = view.getUint16(sample_offset, true);
          const high = view.getUint8(sample_offset + 2);
          const extended = (high << 16 | low) << 8 >> 8;
          channel_data[frame_index] = extended / 8388608;
          break;
        }
        case 32:
          channel_data[frame_index] = format.audio_format === WAVE_FORMAT_IEEE_FLOAT ?
            view.getFloat32(sample_offset, true) : view.getInt32(sample_offset, true) / 2147483648;
          break;
      }
    }
  }
  return buffer;
}

// Decodes PCM WAVE bytes into an AudioBuffer through the given factory.
// Throws a plain Error when the bytes are not a supported PCM WAVE file.
export function decode_wav(bytes: Uint8Array, create_buffer: Create_Audio_Buffer): AudioBuffer {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12 ||
      bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46 ||
      bytes[8] !== 0x57 || bytes[9] !== 0x41 || bytes[10] !== 0x56 || bytes[11] !== 0x45) {
    throw parse_error('missing RIFF/WAVE header');
  }
  const header = chunk_view(bytes, 0, 12);
  const riff_size = header.getUint32(4, true);
  // riff_size counts every byte after offset 8 (the WAVE tag and the chunks).
  const view_length = riff_size >= 4 && riff_size <= bytes.byteLength - 8 ? riff_size : bytes.byteLength - 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, view_length + 8));
  let format: { audio_format: number; channel_count: number; sample_rate: number; bits_per_sample: number; block_align: number } | null = null;
  let data_offset = 0;
  let data_size = 0;
  let chunk_offset = 12;
  while (chunk_offset + 8 <= view.byteLength) {
    const chunk_header = new DataView(bytes.buffer, bytes.byteOffset + chunk_offset, 8);
    const chunk_size = chunk_header.getUint32(4, true);
    if (chunk_offset + 8 + chunk_size > view.byteLength) {
      break; // Truncated trailing chunk: keep what parsed before it.
    }
    const chunk_id = String.fromCharCode(
      bytes[chunk_offset], bytes[chunk_offset + 1], bytes[chunk_offset + 2], bytes[chunk_offset + 3]);
    if (chunk_id === 'fmt ') {
      format = read_format_chunk(bytes, chunk_offset + 8, chunk_size);
    } else if (chunk_id === 'data') {
      data_offset = chunk_offset + 8;
      data_size = chunk_size;
    }
    chunk_offset += 8 + chunk_size + (chunk_size & 1);
  }
  if (!format || data_size === 0) {
    throw parse_error('missing fmt or data chunk');
  }
  const frame_count = Math.floor(data_size / format.block_align);
  if (frame_count < 1 || data_offset + frame_count * format.block_align > bytes.byteLength) {
    throw parse_error('truncated data chunk');
  }
  return deinterleave(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    data_offset, frame_count, format, create_buffer);
}
