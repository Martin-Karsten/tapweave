import type { Audio_Clock } from './clock.js';
import { require_condition } from './errors.js';

// Browser resource execution only. The lifecycle owner establishes the clock
// anchor and decides when to start, pause, resume or recover the engine session.
export class Music_Transport {
  context: AudioContext;
  clock: Audio_Clock;
  source: AudioBufferSourceNode | null = null;
  buffer: AudioBuffer | null = null;

  constructor(audio_context: AudioContext, clock: Audio_Clock, readonly destination: AudioNode = audio_context.destination) {
    this.context = audio_context;
    this.clock = clock;
  }

  set_buffer(buffer: AudioBuffer) {
    require_condition(this.source === null, 'INVALID_STATE', 'Stop music before replacing its buffer.');
    require_condition(Number.isFinite(buffer.duration) && buffer.duration > 0,
      'MISSING_ASSET', 'Decoded main music is required.');
    this.buffer = buffer;
  }

  start() {
    require_condition(this.buffer && this.source === null && this.clock.anchor && this.context.state === 'running',
      'INVALID_STATE', 'Music requires a running audio clock, decoded track and no active source.');
    const anchor = this.clock.anchor!;
    let when_seconds = Math.max(this.context.currentTime, anchor.audio_seconds);
    let offset_seconds = anchor.media_beatmap_ms / 1000 + when_seconds - anchor.audio_seconds;
    require_condition(Number.isFinite(when_seconds) && Number.isFinite(offset_seconds),
      'INVALID_CLOCK', 'Music clock conversion overflow.');
    // Negative map lead-in is silence before media zero, not a negative seek.
    if (offset_seconds < 0) {
      when_seconds -= offset_seconds;
      offset_seconds = 0;
    }
    require_condition(Number.isFinite(when_seconds), 'INVALID_CLOCK', 'Music lead-in overflow.');
    if (offset_seconds >= this.buffer!.duration) {
      return;
    }
    const source = this.context.createBufferSource();
    try {
      source.buffer = this.buffer;
      source.playbackRate.setValueAtTime(1, when_seconds);
      source.connect(this.destination);
      source.onended = () => {
        source.disconnect();
        if (this.source === source) {
          this.source = null;
        }
      };
      source.start(when_seconds, offset_seconds);
      this.source = source;
    } catch (error) {
      source.onended = null;
      source.disconnect();
      throw error;
    }
  }

  cancel() {
    const source = this.source;
    this.source = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } finally {
        source.disconnect();
      }
    }
  }

  dispose() {
    try {
      this.cancel();
    } finally {
      this.buffer = null;
    }
  }
}
