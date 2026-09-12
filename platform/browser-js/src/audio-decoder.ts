import { require_condition } from './errors.js';

export type Decode_Audio = (encoded: ArrayBuffer | Uint8Array) => Promise<AudioBuffer>;

// One owner per browser player, shared across every replacement asset scope.
// Browser decoding is uninterruptible: cancelled work keeps its admission slot
// until the underlying promise settles, even after its candidate is released.
export class Audio_Decoder {
  decode_audio: Decode_Audio;
  maximum_concurrent: number;
  maximum_encoded_bytes: number;
  active_count = 0;
  encoded_bytes = 0;

  constructor(decode_audio: Decode_Audio, { maximum_concurrent = 2, maximum_encoded_bytes = 128 * 1024 * 1024 } = {}) {
    require_condition(typeof decode_audio === 'function' && Number.isSafeInteger(maximum_concurrent) &&
      maximum_concurrent > 0 && Number.isSafeInteger(maximum_encoded_bytes) && maximum_encoded_bytes > 0,
      'INVALID_ARGUMENT', 'Invalid audio decoder limits.');
    this.decode_audio = decode_audio;
    this.maximum_concurrent = maximum_concurrent;
    this.maximum_encoded_bytes = maximum_encoded_bytes;
  }

  async decode(bytes: Uint8Array) {
    require_condition(bytes instanceof Uint8Array, 'INVALID_ARGUMENT', 'Audio bytes are required.');
    require_condition(this.active_count < this.maximum_concurrent &&
      bytes.byteLength <= this.maximum_encoded_bytes - this.encoded_bytes,
      'QUOTA_EXCEEDED', 'Audio decoder is busy. Retry after pending decoding finishes.');
    const byte_count = bytes.byteLength;
    this.active_count++;
    this.encoded_bytes += byte_count;
    try {
      return await this.decode_audio(bytes.slice().buffer);
    } finally {
      this.active_count--;
      this.encoded_bytes -= byte_count;
    }
  }
}
