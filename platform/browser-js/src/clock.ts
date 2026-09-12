import { require_condition } from './errors.js';

export interface Clock_Offsets {
  global_ms: number;
  device_ms: number;
  beatmap_ms: number;
  user_ms: number;
}

export interface Clock_Anchor {
  readonly audio_seconds: number;
  readonly beatmap_ms: number;
  readonly media_beatmap_ms: number;
  readonly offsets: Readonly<Clock_Offsets>;
  readonly rate: number;
}

export interface Session_Mapping {
  readonly session_handle: bigint;
  readonly engine_epoch: number;
  readonly browser_epoch: number;
  readonly receipt_ms: number;
  readonly audio_seconds: number;
  readonly anchor: Clock_Anchor;
}

export class Audio_Clock {
  epoch = 0;
  anchor: Clock_Anchor | null = null;
  paused_beatmap_ms = 0;
  paused_media_ms = 0;
  paused_offsets: Readonly<Clock_Offsets> | null = null;
  session_mapping: Session_Mapping | null = null;

  start(audio_seconds: number, beatmap_ms: number, offsets: Partial<Clock_Offsets> = {}) {
    const applied_offsets: Clock_Offsets = { global_ms: 0, device_ms: 0, beatmap_ms: 0, user_ms: 0, ...offsets };
    require_condition(this.anchor === null, 'INVALID_STATE', 'Pause before replacing the clock anchor.');
    require_condition(Object.keys(applied_offsets).length === 4 &&
      [audio_seconds, beatmap_ms, ...Object.values(applied_offsets)].every(Number.isFinite) && audio_seconds >= 0,
      'INVALID_CLOCK', 'Clock values must be finite.');
    const offset_ms = Object.values(applied_offsets).reduce((total_ms, component_ms) => total_ms + component_ms, 0);
    require_condition(Number.isFinite(beatmap_ms + offset_ms), 'INVALID_CLOCK', 'Clock anchor overflow.');
    require_condition(this.epoch < 0xffffffff, 'QUOTA_EXCEEDED', 'Clock epoch exhausted.');
    this.epoch++;
    this.session_mapping = null;
    this.anchor = Object.freeze({ audio_seconds, beatmap_ms: beatmap_ms + offset_ms,
      media_beatmap_ms: beatmap_ms, offsets: Object.freeze(applied_offsets), rate: 1 });
    return this.epoch;
  }

  bind_session(session_handle: bigint, engine_epoch: number, receipt_ms: number, audio_seconds: number) {
    const anchor = this.anchor;
    require_condition(anchor !== null && typeof session_handle === 'bigint' && session_handle > 0n &&
      session_handle <= 0xffffffffffffffffn &&
      Number.isInteger(engine_epoch) && engine_epoch >= 0 && engine_epoch <= 0xffffffff &&
      Number.isFinite(receipt_ms) && Number.isFinite(audio_seconds) && audio_seconds >= anchor.audio_seconds,
      'INVALID_CLOCK', 'A valid running session and receipt/audio pair are required.');
    require_condition(this.session_mapping === null, 'INVALID_STATE', 'Session clock mapping is immutable until pause.');
    const mapping: Session_Mapping = Object.freeze({ session_handle, engine_epoch, browser_epoch: this.epoch,
      receipt_ms, audio_seconds, anchor });
    this.session_mapping = mapping;
    return mapping;
  }

  mapped_epoch(session_handle: bigint, engine_epoch: number) {
    const mapping = this.session_mapping;
    require_condition(mapping && mapping.session_handle === session_handle && mapping.engine_epoch === engine_epoch &&
      mapping.browser_epoch === this.epoch && mapping.anchor === this.anchor,
      'INVALID_CLOCK', 'Session output has no active browser clock mapping.');
    return mapping.browser_epoch;
  }

  input_time(session_handle: bigint, engine_epoch: number, receipt_ms: number) {
    this.mapped_epoch(session_handle, engine_epoch);
    require_condition(Number.isFinite(receipt_ms), 'INVALID_CLOCK', 'Input receipt time must be finite.');
    const mapping = this.session_mapping;
    return this.beatmap_time(mapping!.audio_seconds + (receipt_ms - mapping!.receipt_ms) / 1000);
  }

  beatmap_time(audio_seconds: number) {
    require_condition(Number.isFinite(audio_seconds), 'INVALID_CLOCK', 'Audio time must be finite.');
    if (!this.anchor) {
      return this.paused_beatmap_ms;
    }
    const beatmap_ms = this.anchor.beatmap_ms + (audio_seconds - this.anchor.audio_seconds) * 1000;
    require_condition(Number.isFinite(beatmap_ms), 'INVALID_CLOCK', 'Clock conversion overflow.');
    return beatmap_ms;
  }

  audio_time(beatmap_ms: number) {
    require_condition(this.anchor !== null && Number.isFinite(beatmap_ms), 'INVALID_CLOCK', 'A running clock is required.');
    const audio_seconds = this.anchor!.audio_seconds + (beatmap_ms - this.anchor!.beatmap_ms) / 1000;
    require_condition(Number.isFinite(audio_seconds), 'INVALID_CLOCK', 'Clock conversion overflow.');
    return audio_seconds;
  }

  resume(audio_seconds: number) {
    require_condition(this.paused_offsets !== null, 'INVALID_STATE', 'Pause a running clock before resuming.');
    return this.start(audio_seconds, this.paused_media_ms, this.paused_offsets);
  }

  pause(audio_seconds: number) {
    require_condition(Number.isFinite(audio_seconds) && (!this.anchor || audio_seconds >= this.anchor.audio_seconds),
      'INVALID_CLOCK', 'Pause cannot precede the active clock anchor.');
    if (!this.anchor) {
      return this.paused_beatmap_ms;
    }
    const beatmap_ms = this.beatmap_time(audio_seconds);
    const media_ms = this.anchor.media_beatmap_ms + (audio_seconds - this.anchor.audio_seconds) * 1000;
    require_condition(Number.isFinite(media_ms), 'INVALID_CLOCK', 'Media clock overflow.');
    require_condition(this.epoch < 0xffffffff, 'QUOTA_EXCEEDED', 'Clock epoch exhausted.');
    this.paused_beatmap_ms = beatmap_ms;
    this.paused_media_ms = media_ms;
    this.paused_offsets = this.anchor.offsets;
    this.anchor = null;
    this.session_mapping = null;
    this.epoch++;
    return this.paused_beatmap_ms;
  }
}
