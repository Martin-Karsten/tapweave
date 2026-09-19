import { require_condition } from './errors.js';
import { decode_wav, type Create_Audio_Buffer } from './wav-fallback.js';

export type Decode_Audio = (encoded: ArrayBuffer | Uint8Array) => Promise<AudioBuffer>;

export interface Audio_Decoder_Options {
  maximum_concurrent?: number;
  maximum_encoded_bytes?: number;
  // Optional in-house PCM/WAVE fallback used only when the browser's
  // decodeAudioData rejects a file; without it a rejection propagates as-is.
  create_buffer?: Create_Audio_Buffer | null;
}

// One owner per browser player, shared across every replacement asset scope.
// Browser decoding is uninterruptible: cancelled work keeps its admission slot
// until the underlying promise settles, even after its candidate is released.
export class Audio_Decoder {
  decode_audio: Decode_Audio;
  maximum_concurrent: number;
  maximum_encoded_bytes: number;
  create_buffer: Create_Audio_Buffer | null;
  active_count = 0;
  encoded_bytes = 0;

  constructor(decode_audio: Decode_Audio, { maximum_concurrent = 2, maximum_encoded_bytes = 128 * 1024 * 1024,
    create_buffer = null }: Audio_Decoder_Options = {}) {
    require_condition(typeof decode_audio === 'function' && Number.isSafeInteger(maximum_concurrent) &&
      maximum_concurrent > 0 && Number.isSafeInteger(maximum_encoded_bytes) && maximum_encoded_bytes > 0 &&
      (create_buffer === null || create_buffer === undefined || typeof create_buffer === 'function'),
      'INVALID_ARGUMENT', 'Invalid audio decoder limits.');
    this.decode_audio = decode_audio;
    this.maximum_concurrent = maximum_concurrent;
    this.maximum_encoded_bytes = maximum_encoded_bytes;
    this.create_buffer = create_buffer ?? null;
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
      return await this.decode_with_fallback(bytes);
    } finally {
      this.active_count--;
      this.encoded_bytes -= byte_count;
    }
  }

  // The browser decoder stays authoritative: the in-house PCM parser only runs
  // when it rejects, and a fallback failure rethrows the original error so the
  // warning path reports the browser's own refusal.
  private async decode_with_fallback(bytes: Uint8Array): Promise<AudioBuffer> {
    let original_error: unknown;
    try {
      return await this.decode_audio(bytes.slice().buffer);
    } catch (error) {
      if (!this.create_buffer) {
        throw error;
      }
      original_error = error;
    }
    try {
      return decode_wav(bytes, this.create_buffer);
    } catch {
      throw original_error;
    }
  }
}
