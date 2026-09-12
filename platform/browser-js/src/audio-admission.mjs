import { Gameplay_Output } from './engine-bridge.mjs';
import { require_condition } from './errors.mjs';

// One owner per engine session, shared by every compact-output consumer. The
// watermark survives output-token replacement, dispatch failure and clock pause.
// A new engine epoch invalidates it; a browser epoch alone does not.
export class Audio_Admission {
  constructor(engine, session_handle, audio_service) {
    this.engine = engine;
    this.session_handle = session_handle;
    this.audio_service = audio_service;
    this.engine_epoch = null;
    this.admitted_sequence = 0n;
    this.audio_record = {};
    this.events = [];
  }

  admit(output) {
    require_condition(output instanceof Gameplay_Output && output.valid,
      'INVALID_ARGUMENT', 'A valid compact gameplay output is required.');
    const engine_epoch = output.summary.epoch;
    const browser_epoch = this.audio_service.clock.mapped_epoch(this.session_handle, engine_epoch);
    const anchor = this.audio_service.clock.anchor;
    require_condition(anchor.rate === 1 && anchor.offsets.global_ms === 0 && anchor.offsets.device_ms === 0 &&
      anchor.offsets.beatmap_ms === 0 && anchor.offsets.user_ms === 0,
    'UNSUPPORTED_CLOCK_PROFILE', 'Production one-shot admission requires rate 1 and zero offsets.');
    require_condition(this.engine_epoch === null || engine_epoch >= this.engine_epoch,
      'INVALID_STATE', 'Cannot admit an earlier engine epoch.');
    const retained_sequence = engine_epoch === this.engine_epoch ? this.admitted_sequence : 0n;
    let previous_sequence = 0n;
    this.events.length = 0;
    for (let event_index = 0; event_index < output.audio.count; event_index++) {
      const event = output.record_into(output.audio, event_index, this.audio_record);
      require_condition(event.epoch === engine_epoch && event.kind === 1 &&
        event.sequence > previous_sequence && event.sequence > 0n &&
        (event.flags === 0 || event.flags === 1) && (event.asset_id === 0n) === (event.flags === 1) &&
        Number.isFinite(event.time_ms) && Number.isFinite(event.volume) && event.volume >= 0 && event.volume <= 1,
      'INVALID_AUDIO_EVENT', 'Malformed production one-shot event.');
      previous_sequence = event.sequence;
      if (event.sequence <= retained_sequence) {
        continue;
      }
      require_condition(this.events.length < this.audio_service.maximum_pending,
        'QUOTA_EXCEEDED', 'Production audio batch exceeds admission capacity.');
      this.events.push({ sequence: event.sequence, epoch: browser_epoch, kind: 'one_shot',
        policy: 'immediate', beatmap_time_ms: event.time_ms, voice_id: event.sequence,
        asset_id: event.asset_id, volume: event.volume, pan: 0, rate: 1,
        duration_ms: 0, lateness_threshold_ms: 0 });
    }
    // enqueue validates the complete batch before changing the executor queue.
    // Save the watermark before acknowledgement, whose token may have expired.
    this.audio_service.enqueue(this.events);
    this.engine_epoch = engine_epoch;
    this.admitted_sequence = previous_sequence > retained_sequence ? previous_sequence : retained_sequence;
    this.events.length = 0;
    this.engine.acknowledge(this.session_handle, output.summary.batch_token);
  }
}
