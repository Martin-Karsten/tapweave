import { Voice_Output } from './engine-bridge.mjs';
import { require_condition } from './errors.mjs';

// One owner per engine session. The retained engine-epoch/sequence watermark
// survives output-token replacement, dispatch failure and clock pause. A new
// engine epoch invalidates it; a browser epoch alone does not.
export class Audio_Admission {
  constructor(engine, session_handle, audio_service) {
    this.engine = engine;
    this.session_handle = session_handle;
    this.audio_service = audio_service;
    this.engine_epoch = null;
    this.admitted_sequence = 0n;
    this.audio_record = {};
    this.events = [];
    this.staging = Array.from({ length: audio_service.maximum_pending }, () => ({}));
  }

  admit(output) {
    require_condition(output instanceof Voice_Output && output.valid,
      'INVALID_ARGUMENT', 'A valid voice output is required.');
    const engine_epoch = output.summary.epoch;
    const browser_epoch = this.audio_service.clock.mapped_epoch(this.session_handle, engine_epoch);
    const anchor = this.audio_service.clock.anchor;
    require_condition(anchor.rate === 1 && Object.values(anchor.offsets).every(offset => offset === 0),
      'UNSUPPORTED_CLOCK_PROFILE', 'Production voice admission requires rate 1 and zero offsets.');
    require_condition(this.engine_epoch === null || engine_epoch >= this.engine_epoch,
      'INVALID_STATE', 'Cannot admit an earlier engine epoch.');
    const retained_sequence = engine_epoch === this.engine_epoch ? this.admitted_sequence : 0n;
    let previous_sequence = retained_sequence;
    this.events.length = 0;
    const kinds = ['one_shot', 'loop_start', 'loop_stop', 'param_ramp'];
    for (let command_index = 0; command_index < output.summary.commands_count; command_index++) {
      const command = output.record_into(command_index, this.audio_record);
      require_condition((this.engine.transport_capabilities.voice_command_mask & (1 << (command.command_kind - 1))) !== 0,
        'UNSUPPORTED', 'The producer has not enabled this voice command family.');
      if (command.sequence <= retained_sequence) continue;
      this.events.push(Object.assign(this.staging[this.events.length], { sequence: command.sequence, epoch: browser_epoch,
        kind: kinds[command.command_kind - 1], policy: command.late_policy === 1 ? 'immediate' : 'drop',
        beatmap_time_ms: command.time_ms, voice_id: command.voice_id, asset_id: command.asset_id,
        volume: command.volume, pan: command.pan, rate: command.rate, duration_ms: command.duration_ms,
        parameter_mask: command.parameter_mask, lateness_threshold_ms: command.lateness_threshold_ms }));
      previous_sequence = command.sequence;
    }
    // enqueue validates the complete batch before changing the executor queue.
    // Save the watermark before acknowledgement, whose token may have expired.
    this.audio_service.enqueue(this.events);
    this.engine_epoch = engine_epoch;
    this.admitted_sequence = previous_sequence;
    this.events.length = 0;
    this.engine.acknowledge(this.session_handle, output.summary.batch_token);
  }

  suspend_after_clock_pause() {
    require_condition(this.engine_epoch !== null, 'INVALID_STATE', 'No admitted session epoch to suspend.');
    this.audio_service.suspend_one_shots();
    this.suspended_engine_epoch = this.engine_epoch;
  }

  resume_after_clock_bind() {
    require_condition(this.suspended_engine_epoch === this.engine_epoch,
      'INVALID_STATE', 'Reset/replacement must discard suspended output.');
    this.audio_service.clock.mapped_epoch(this.session_handle, this.engine_epoch);
    this.audio_service.resume_one_shots();
    this.suspended_engine_epoch = null;
  }
}
