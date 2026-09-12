import { require_condition } from './errors.mjs';

export class Audio_Clock {
  constructor() {
    this.epoch = 0;
    this.anchor = null;
    this.paused_beatmap_ms = 0;
    this.paused_media_ms = 0;
    this.paused_offsets = null;
  }

  start(audio_seconds, beatmap_ms, offsets = {}) {
    const applied_offsets = { global_ms: 0, device_ms: 0, beatmap_ms: 0, user_ms: 0, ...offsets };
    require_condition(this.anchor === null, 'INVALID_STATE', 'Pause before replacing the clock anchor.');
    require_condition(Object.keys(applied_offsets).length === 4 &&
      [audio_seconds, beatmap_ms, ...Object.values(applied_offsets)].every(Number.isFinite) && audio_seconds >= 0,
      'INVALID_CLOCK', 'Clock values must be finite.');
    const offset_ms = Object.values(applied_offsets).reduce((total_ms, component_ms) => total_ms + component_ms, 0);
    require_condition(Number.isFinite(beatmap_ms + offset_ms), 'INVALID_CLOCK', 'Clock anchor overflow.');
    this.epoch++;
    this.anchor = Object.freeze({ audio_seconds, beatmap_ms: beatmap_ms + offset_ms,
      media_beatmap_ms: beatmap_ms, offsets: Object.freeze(applied_offsets), rate: 1 });
    return this.epoch;
  }

  beatmap_time(audio_seconds) {
    require_condition(Number.isFinite(audio_seconds), 'INVALID_CLOCK', 'Audio time must be finite.');
    if (!this.anchor) {
      return this.paused_beatmap_ms;
    }
    const beatmap_ms = this.anchor.beatmap_ms + (audio_seconds - this.anchor.audio_seconds) * 1000;
    require_condition(Number.isFinite(beatmap_ms), 'INVALID_CLOCK', 'Clock conversion overflow.');
    return beatmap_ms;
  }

  audio_time(beatmap_ms) {
    require_condition(this.anchor !== null && Number.isFinite(beatmap_ms), 'INVALID_CLOCK', 'A running clock is required.');
    const audio_seconds = this.anchor.audio_seconds + (beatmap_ms - this.anchor.beatmap_ms) / 1000;
    require_condition(Number.isFinite(audio_seconds), 'INVALID_CLOCK', 'Clock conversion overflow.');
    return audio_seconds;
  }

  resume(audio_seconds) {
    require_condition(this.paused_offsets !== null, 'INVALID_STATE', 'Pause a running clock before resuming.');
    return this.start(audio_seconds, this.paused_media_ms, this.paused_offsets);
  }

  pause(audio_seconds) {
    require_condition(Number.isFinite(audio_seconds) && (!this.anchor || audio_seconds >= this.anchor.audio_seconds),
      'INVALID_CLOCK', 'Pause cannot precede the active clock anchor.');
    if (!this.anchor) {
      return this.paused_beatmap_ms;
    }
    this.paused_beatmap_ms = this.beatmap_time(audio_seconds);
    this.paused_media_ms = this.anchor.media_beatmap_ms + (audio_seconds - this.anchor.audio_seconds) * 1000;
    this.paused_offsets = this.anchor.offsets;
    this.anchor = null;
    this.epoch++;
    return this.paused_beatmap_ms;
  }
}
