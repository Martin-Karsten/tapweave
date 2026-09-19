import test from 'node:test';
import assert from 'node:assert/strict';
import { decode_wav } from '../build/wav-fallback.js';

const create_buffer = (channel_count, length, sample_rate) => {
  const channels = Array.from({ length: channel_count }, () => new Float32Array(length));
  return {
    length, numberOfChannels: channel_count, sampleRate: sample_rate,
    getChannelData: channel_index => channels[channel_index],
  };
};

const chunk = (id, payload) => {
  const bytes = new Uint8Array(8 + payload.length + (payload.length & 1));
  for (let index = 0; index < 4; index++) bytes[index] = id.charCodeAt(index);
  new DataView(bytes.buffer).setUint32(4, payload.length, true);
  bytes.set(payload, 8);
  return bytes;
};

const concat = (...parts) => {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
};

const fmt_chunk = ({ format = 1, channels = 1, sample_rate = 8000, bits = 16, block_align = null, extensible = false } = {}) => {
  const align = block_align ?? channels * (bits >> 3);
  if (!extensible) {
    const payload = new Uint8Array(16);
    const view = new DataView(payload.buffer);
    view.setUint16(0, format, true);
    view.setUint16(2, channels, true);
    view.setUint32(4, sample_rate, true);
    view.setUint32(8, sample_rate * align, true);
    view.setUint16(12, align, true);
    view.setUint16(14, bits, true);
    return chunk('fmt ', payload);
  }
  const payload = new Uint8Array(40);
  const view = new DataView(payload.buffer);
  view.setUint16(0, 0xfffe, true);
  view.setUint16(2, channels, true);
  view.setUint32(4, sample_rate, true);
  view.setUint32(8, sample_rate * align, true);
  view.setUint16(12, align, true);
  view.setUint16(14, bits, true);
  view.setUint16(16, 22, true);
  view.setUint16(18, bits, true);
  view.setUint32(20, channels === 1 ? 4 : 3, true);
  payload[24] = format & 0xff;
  payload[25] = format >> 8;
  payload.set([0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71], 26);
  return chunk('fmt ', payload);
};

const s16_bytes = samples => {
  const payload = new Uint8Array(samples.length * 2);
  const view = new DataView(payload.buffer);
  samples.forEach((value, index) => view.setInt16(index * 2, value, true));
  return payload;
};

const wav_file = (...chunks) => {
  const file = concat(new Uint8Array([0x52, 0x49, 0x46, 0x46]), new Uint8Array(4),
    new Uint8Array([0x57, 0x41, 0x56, 0x45]), ...chunks);
  new DataView(file.buffer).setUint32(4, file.length - 8, true);
  return file;
};

test('16-bit PCM decodes to exact normalized samples', () => {
  const samples = [0, 1024, -1024, 32767, -32768];
  const buffer = decode_wav(wav_file(fmt_chunk(), chunk('data', s16_bytes(samples))), create_buffer);
  assert.equal(buffer.sampleRate, 8000);
  assert.equal(buffer.numberOfChannels, 1);
  assert.equal(buffer.length, samples.length);
  assert.deepEqual([...buffer.getChannelData(0)], samples.map(value => value / 32768));
});

test('8-bit unsigned PCM decodes with the 128 offset removed', () => {
  const buffer = decode_wav(wav_file(fmt_chunk({ bits: 8 }), chunk('data', new Uint8Array([128, 255, 0]))), create_buffer);
  assert.deepEqual([...buffer.getChannelData(0)].map(value => Math.round(value * 128)), [0, 127, -128]);
});

test('24-bit PCM sign-extends and normalizes', () => {
  const payload = new Uint8Array([0xff, 0xff, 0x7f, 0x00, 0x00, 0x80, 0x00, 0x10, 0x00]);
  const buffer = decode_wav(wav_file(fmt_chunk({ bits: 24 }), chunk('data', payload)), create_buffer);
  const decoded = [...buffer.getChannelData(0)];
  assert.ok(Math.abs(decoded[0] - (8388607 / 8388608)) < 1e-6);
  assert.equal(decoded[1], -1);
  assert.equal(decoded[2], 4096 / 8388608);
});

test('32-bit integer PCM decodes to normalized samples', () => {
  const payload = new Uint8Array(8);
  const view = new DataView(payload.buffer);
  view.setInt32(0, 1073741824, true);
  view.setInt32(4, -1073741824, true);
  const buffer = decode_wav(wav_file(fmt_chunk({ bits: 32 }), chunk('data', payload)), create_buffer);
  assert.deepEqual([...buffer.getChannelData(0)], [0.5, -0.5]);
});

test('32-bit float PCM decodes to exact values', () => {
  const payload = new Uint8Array(8);
  new DataView(payload.buffer).setFloat32(0, 0.5, true);
  new DataView(payload.buffer).setFloat32(4, -0.25, true);
  const buffer = decode_wav(wav_file(fmt_chunk({ format: 3, bits: 32 }), chunk('data', payload)), create_buffer);
  assert.deepEqual([...buffer.getChannelData(0)], [0.5, -0.25]);
});

test('stereo frames deinterleave into per-channel data', () => {
  const buffer = decode_wav(wav_file(fmt_chunk({ channels: 2 }), chunk('data', s16_bytes([100, -200, 300, -400]))), create_buffer);
  assert.equal(buffer.numberOfChannels, 2);
  assert.deepEqual([...buffer.getChannelData(0)].map(value => value * 32768), [100, 300]);
  assert.deepEqual([...buffer.getChannelData(1)].map(value => value * 32768), [-200, -400]);
});

test('extensible PCM headers with the PCM sub-format decode', () => {
  const buffer = decode_wav(wav_file(fmt_chunk({ channels: 2, extensible: true }), chunk('data', s16_bytes([5, -6]))), create_buffer);
  assert.equal(buffer.numberOfChannels, 2);
  assert.equal(buffer.getChannelData(0)[0], 5 / 32768);
  assert.equal(buffer.getChannelData(1)[0], -6 / 32768);
});

test('unknown chunks are skipped and odd chunk payloads keep their padding byte', () => {
  const list_payload = new Uint8Array([0x49, 0x4e, 0x46]); // INF, odd length
  const buffer = decode_wav(wav_file(
    chunk('LIST', list_payload),
    fmt_chunk(),
    chunk('data', s16_bytes([16384])),
  ), create_buffer);
  assert.equal(buffer.getChannelData(0)[0], 16384 / 32768);
});

test('a riff size beyond the bytes still parses the available chunks', () => {
  const file = wav_file(fmt_chunk(), chunk('data', s16_bytes([-16384])));
  new DataView(file.buffer).setUint32(4, 0xffffffff, true);
  const buffer = decode_wav(file, create_buffer);
  assert.equal(buffer.getChannelData(0)[0], -16384 / 32768);
});

test('unsupported and malformed inputs fail with plain errors', () => {
  const factory = create_buffer;
  const adpcm = wav_file(fmt_chunk({ format: 2 }), chunk('data', new Uint8Array(4)));
  assert.throws(() => decode_wav(adpcm, factory), /format code 2/);
  // An extensible header carrying a non-PCM sub-format code is refused too.
  const adpcm_extensible = wav_file(fmt_chunk({ format: 2, extensible: true }), chunk('data', new Uint8Array(4)));
  assert.throws(() => decode_wav(adpcm_extensible, factory), /format code 2/);
  const float_wide = wav_file(fmt_chunk({ format: 3, bits: 16 }), chunk('data', new Uint8Array(4)));
  assert.throws(() => decode_wav(float_wide, factory), /unsupported float width/);
  const bad_align = wav_file(fmt_chunk({ block_align: 3 }), chunk('data', s16_bytes([1, 2])));
  assert.throws(() => decode_wav(bad_align, factory), /block align/);
  const zero_rate = wav_file(fmt_chunk({ sample_rate: 0 }), chunk('data', s16_bytes([1])));
  assert.throws(() => decode_wav(zero_rate, factory), /sample rate/);
  const no_data = wav_file(fmt_chunk());
  assert.throws(() => decode_wav(no_data, factory), /missing fmt or data/);
  // A data chunk whose declared size runs past the bytes leaves no decodable
  // data chunk at all.
  const oversized = wav_file(fmt_chunk(), chunk('data', new Uint8Array(64)));
  new DataView(oversized.buffer).setUint32(12 + 8 + 16 + 4, 4096, true);
  assert.throws(() => decode_wav(oversized, factory), /missing fmt or data/);
  assert.throws(() => decode_wav(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), factory), /RIFF\/WAVE header/);
  assert.throws(() => decode_wav(new Uint8Array(0), factory), /RIFF\/WAVE header/);
});
