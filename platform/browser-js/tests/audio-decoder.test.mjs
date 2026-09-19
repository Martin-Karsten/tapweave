import test from 'node:test';
import assert from 'node:assert/strict';
import { Audio_Decoder } from '../build/audio-decoder.js';
import { decode_wav } from '../build/wav-fallback.js';

const create_buffer = (channel_count, length, sample_rate) => {
  const channels = Array.from({ length: channel_count }, () => new Float32Array(length));
  return {
    length, numberOfChannels: channel_count, sampleRate: sample_rate,
    getChannelData: channel_index => channels[channel_index],
  };
};

const pcm_bytes = () => {
  const fmt = new Uint8Array(16 + 8);
  const view = new DataView(fmt.buffer);
  fmt.set([0x66, 0x6d, 0x74, 0x20], 0); // 'fmt '
  view.setUint32(4, 16, true);
  view.setUint16(8, 1, true); // PCM
  view.setUint16(10, 1, true); // mono
  view.setUint32(12, 8000, true);
  view.setUint32(16, 16000, true);
  view.setUint16(20, 2, true);
  view.setUint16(22, 16, true);
  const data = new Uint8Array(8 + 4);
  data.set([0x64, 0x61, 0x74, 0x61], 0); // 'data'
  new DataView(data.buffer).setUint32(4, 4, true);
  new DataView(data.buffer).setInt16(8, 16384, true);
  new DataView(data.buffer).setInt16(10, -16384, true);
  const file = new Uint8Array(12 + fmt.length + data.length);
  file.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(file.buffer).setUint32(4, file.length - 8, true);
  file.set([0x57, 0x41, 0x56, 0x45], 8);
  file.set(fmt, 12);
  file.set(data, 12 + fmt.length);
  return file;
};

test('a successful browser decode never touches the wav fallback', async () => {
  let fallback_attempts = 0;
  const decoder = new Audio_Decoder(async () => ({ marker: 'browser' }), {
    create_buffer: (channel_count, length, sample_rate) => {
      fallback_attempts++;
      return create_buffer(channel_count, length, sample_rate);
    },
  });
  const buffer = await decoder.decode(pcm_bytes());
  assert.equal(buffer.marker, 'browser');
  assert.equal(fallback_attempts, 0);
});

test('a browser decode refusal falls back to the in-house pcm parser', async () => {
  const decoder = new Audio_Decoder(async () => {
    throw new Error('decodeAudioData failed');
  }, { create_buffer });
  const buffer = await decoder.decode(pcm_bytes());
  assert.equal(buffer.sampleRate, 8000);
  assert.equal(buffer.getChannelData(0)[0], 16384 / 32768);
});

test('without a factory the original refusal propagates', async () => {
  const decoder = new Audio_Decoder(async () => {
    throw new Error('decodeAudioData failed');
  });
  await assert.rejects(decoder.decode(pcm_bytes()), { message: 'decodeAudioData failed' });
});

test('when the wav fallback also fails the original refusal propagates', async () => {
  const decoder = new Audio_Decoder(async () => {
    throw new Error('decodeAudioData failed');
  }, { create_buffer });
  await assert.rejects(decoder.decode(new Uint8Array([1, 2, 3])), { message: 'decodeAudioData failed' });
});

test('decoder quota refusal happens before any decoding attempt', async () => {
  let browser_attempts = 0;
  const decoder = new Audio_Decoder(async bytes => {
    browser_attempts++;
    return {};
  }, { maximum_encoded_bytes: 8, create_buffer });
  await assert.rejects(decoder.decode(new Uint8Array(16)), { code: 'QUOTA_EXCEEDED' });
  assert.equal(browser_attempts, 0);
});

test('the standalone parser agrees with the fallback path', async () => {
  const direct = decode_wav(pcm_bytes(), create_buffer);
  assert.equal(direct.length, 2);
});
