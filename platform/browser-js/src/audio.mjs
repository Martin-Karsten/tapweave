import { require_condition } from './errors.mjs';

// Executes generated engine intent on the shared browser audio clock.
export class Audio_Service {
  constructor(audio_context, clock, { maximum_voices = 256, maximum_pending = 4096, lookahead_ms = 25 } = {}) {
    require_condition(Number.isSafeInteger(maximum_voices) && maximum_voices > 0 &&
      Number.isSafeInteger(maximum_pending) && maximum_pending > 0 &&
      Number.isFinite(lookahead_ms) && lookahead_ms >= 0 && lookahead_ms <= 1000,
      'INVALID_ARGUMENT', 'Invalid audio service limits.');
    this.context = audio_context;
    this.clock = clock;
    this.maximum_voices = maximum_voices;
    this.maximum_pending = maximum_pending;
    this.lookahead_ms = lookahead_ms;
    this.assets = new Map();
    this.voices = new Map();
    this.retiring_voices = new Set();
    this.pending = [];
    this.available_events = Array.from({ length: maximum_pending }, () => ({}));
    this.suspended_pending = [];
    this.suspended = false;
    this.last_sequence = 0n;
    this.epoch = clock.epoch;
    this.metrics = { dispatched: 0, dropped: 0, stale: 0, maximum_lateness_ms: 0 };
  }

  set_assets(assets) {
    require_condition(this.voices.size === 0 && this.retiring_voices.size === 0 && this.pending.length === 0 && !this.suspended,
      'INVALID_STATE', 'Cancel audio before replacing assets.');
    this.assets = new Map(assets);
  }

  enqueue(events) {
    require_condition(!this.suspended, 'INVALID_STATE', 'Resume suspended audio before admitting more events.');
    let current_epoch_event_count = 0;
    let previous_sequence = this.clock.epoch === this.epoch ? this.last_sequence : 0n;
    for (const event of events) {
      require_condition(typeof event.sequence === 'bigint' && event.sequence > previous_sequence && event.sequence <= 0xffffffffffffffffn &&
        Number.isInteger(event.epoch) && event.epoch >= 0 && event.epoch <= 0xffffffff &&
        typeof event.voice_id === 'bigint' && event.voice_id > 0n && event.voice_id <= 0xffffffffffffffffn &&
        typeof event.asset_id === 'bigint' && event.asset_id >= 0n && event.asset_id <= 0xffffffffffffffffn &&
        ['one_shot', 'loop_start', 'loop_stop', 'param_ramp'].includes(event.kind) &&
        ['drop', 'immediate'].includes(event.policy) &&
        [event.beatmap_time_ms, event.volume, event.pan, event.rate, event.duration_ms].every(Number.isFinite) &&
        event.volume >= 0 && event.volume <= 1 && event.pan >= -1 && event.pan <= 1 &&
        event.rate > 0 && event.duration_ms >= 0 &&
        (event.parameter_mask === undefined || Number.isInteger(event.parameter_mask) && event.parameter_mask >= 0 && event.parameter_mask <= 7) &&
        Number.isFinite(event.lateness_threshold_ms) && event.lateness_threshold_ms >= 0,
        'INVALID_AUDIO_EVENT', 'Malformed audio event.');
      previous_sequence = event.sequence;
      if (event.epoch === this.clock.epoch) {
        current_epoch_event_count++;
      }
    }
    const retained_event_count = this.clock.epoch === this.epoch ? this.pending.length : 0;
    const scheduled_future_count = this.clock.epoch === this.epoch ?
      [...this.voices.values()].filter(voice => voice.when_seconds > this.context.currentTime).length : 0;
    require_condition(current_epoch_event_count <= this.maximum_pending - retained_event_count - scheduled_future_count,
      'QUOTA_EXCEEDED', 'Audio event queue is full.');
    if (this.clock.epoch !== this.epoch) {
      this.cancel();
    }
    for (const event of events) {
      if (event.epoch === this.clock.epoch) {
        this.pending.push(Object.assign(this.available_events.pop(), event));
      } else {
        this.metrics.stale++;
      }
    }
    this.last_sequence = previous_sequence;
    this.pending.sort((first_event, second_event) => first_event.beatmap_time_ms - second_event.beatmap_time_ms ||
      (first_event.sequence < second_event.sequence ? -1 : 1));
  }

  pump() {
    if (this.suspended) return;
    if (this.clock.epoch !== this.epoch) {
      this.cancel();
    }
    if (!this.clock.anchor || this.context.state !== 'running') {
      return;
    }
    let processed_count = 0;
    try {
      while (processed_count < this.pending.length) {
        const event = this.pending[processed_count];
        const requested_seconds = this.clock.audio_time(event.beatmap_time_ms);
        if (requested_seconds > this.context.currentTime + this.lookahead_ms / 1000) {
          break;
        }
        const lateness_ms = Math.max(0, (this.context.currentTime - requested_seconds) * 1000);
        this.metrics.maximum_lateness_ms = Math.max(this.metrics.maximum_lateness_ms, lateness_ms);
        // Stops must take effect even when late; otherwise a loop could leak forever.
        if (event.kind === 'one_shot' && event.policy === 'drop' && lateness_ms > event.lateness_threshold_ms) {
          this.metrics.dropped++;
        } else {
          this.dispatch(event, Math.max(this.context.currentTime, requested_seconds));
        }
        processed_count++;
      }
    } catch (error) {
      // A failed start must not block queued stops and leave existing loops audible.
      this.cancel();
      throw error;
    } finally {
      // Compact once per dispatch batch; repeated shift() makes dense batches quadratic.
      for (let event_index = 0; event_index < Math.min(processed_count, this.pending.length); event_index++) {
        this.available_events.push(this.pending[event_index]);
      }
      this.pending.splice(0, processed_count);
    }
  }

  dispatch(event, when_seconds) {
    if (event.kind === 'loop_stop') {
      const voice = this.voices.get(event.voice_id);
      if (voice && !voice.stopping) {
        voice.stopping = true;
        voice.source.stop(when_seconds);
        this.voices.delete(event.voice_id);
        this.retiring_voices.add(voice);
      }
      return;
    }
    if (event.kind === 'param_ramp') {
      const voice = this.voices.get(event.voice_id);
      if (voice) {
        const until_seconds = when_seconds + event.duration_ms / 1000;
        for (const [parameter, target, mask] of [[voice.gain.gain, event.volume, 1], [voice.panner.pan, event.pan, 2], [voice.source.playbackRate, event.rate, 4]]) {
          if (((event.parameter_mask ?? 7) & mask) === 0) continue;
          parameter.cancelAndHoldAtTime(when_seconds);
          parameter.linearRampToValueAtTime(target, until_seconds);
        }
      }
      return;
    }
    const buffer = this.assets.get(event.asset_id);
    if (!buffer) {
      this.metrics.dropped++;
      return;
    }
    require_condition(!this.voices.has(event.voice_id), 'INVALID_AUDIO_EVENT', 'Voice ID is already active.');
    require_condition(this.voices.size + this.retiring_voices.size < this.maximum_voices, 'QUOTA_EXCEEDED', 'Audio voice quota exceeded.');
    const voice = { source: null, gain: null, panner: null, stopping: false, event: { ...event }, when_seconds };
    try {
      voice.source = this.context.createBufferSource();
      voice.gain = this.context.createGain();
      voice.panner = this.context.createStereoPanner();
      const { source, gain, panner } = voice;
      source.buffer = buffer;
      source.loop = event.kind === 'loop_start';
      source.playbackRate.setValueAtTime(event.rate, when_seconds);
      gain.gain.setValueAtTime(event.volume, when_seconds);
      panner.pan.setValueAtTime(event.pan, when_seconds);
      source.connect(gain);
      gain.connect(panner);
      panner.connect(this.context.destination);
      source.onended = () => this.release_voice(voice, false);
      source.start(when_seconds);
      this.voices.set(event.voice_id, voice);
      this.metrics.dispatched++;
    } catch (error) {
      this.release_voice(voice);
      throw error;
    }
  }

  release_voice(voice, stop = true) {
    if (voice.source) {
      voice.source.onended = null;
      if (stop) {
        try { voice.source.stop(); } catch { /* An unstarted source has nothing to cancel. */ }
      }
    }
    for (const node of [voice.source, voice.gain, voice.panner]) node?.disconnect();
    this.retiring_voices.delete(voice);
    if (this.voices.get(voice.event.voice_id) === voice) this.voices.delete(voice.event.voice_id);
  }

  suspend_one_shots() {
    require_condition(this.clock.anchor === null && !this.suspended,
      'INVALID_STATE', 'Pause the clock once before suspending audio.');
    // The engine pause boundary releases input and retires its loop identities.
    // Resume recreates loops only in response to fresh authoritative starts.
    let retained_count = 0;
    for (const event of this.pending) {
      if (event.kind === 'one_shot') this.pending[retained_count++] = event;
      else this.available_events.push(event);
    }
    this.pending.length = retained_count;
    for (const voice of [...this.voices.values(), ...this.retiring_voices]) {
      if (voice.event.kind !== 'loop_start') continue;
      this.release_voice(voice);
    }
    const future_voices = [...this.voices.values()].filter(voice => voice.when_seconds > this.context.currentTime);
    require_condition(this.pending.length + future_voices.length <= this.maximum_pending,
      'QUOTA_EXCEEDED', 'Suspended future one-shots exceed retention capacity.');
    for (const event of this.pending) this.suspended_pending.push(event);
    for (const voice of future_voices) {
      this.suspended_pending.push(Object.assign(this.available_events.pop(), voice.event));
    }
    this.suspended_pending.sort((left, right) => left.sequence < right.sequence ? -1 : 1);
    this.pending.length = 0;
    for (const voice of future_voices) {
      this.release_voice(voice);
    }
    // Already-started non-looping samples finish naturally, matching the pinned
    // PausableSkinnableSound policy. Future requests retain nominal map times.
    this.suspended = true;
    this.epoch = this.clock.epoch;
    this.last_sequence = 0n;
  }

  resume_one_shots() {
    require_condition(this.suspended && this.clock.anchor !== null,
      'INVALID_STATE', 'Resume the clock before restoring future one-shots.');
    this.suspended = false;
    this.epoch = this.clock.epoch;
    this.last_sequence = 0n;
    for (const event of this.suspended_pending) {
      event.epoch = this.clock.epoch;
      this.pending.push(event);
      this.last_sequence = event.sequence > this.last_sequence ? event.sequence : this.last_sequence;
    }
    this.suspended_pending.length = 0;
    this.pending.sort((left, right) => left.beatmap_time_ms - right.beatmap_time_ms || (left.sequence < right.sequence ? -1 : 1));
  }

  cancel() {
    if (this.epoch !== this.clock.epoch) {
      this.last_sequence = 0n;
    }
    this.epoch = this.clock.epoch;
    for (const event of this.pending) this.available_events.push(event);
    for (const event of this.suspended_pending) this.available_events.push(event);
    this.pending.length = 0;
    this.suspended_pending.length = 0;
    this.suspended = false;
    for (const voice of [...this.voices.values(), ...this.retiring_voices]) {
      // stop() may replace a future stop; disconnect cancels audible output now.
      this.release_voice(voice);
    }
    this.voices.clear();
    this.retiring_voices.clear();
  }

  dispose() {
    this.cancel();
    this.assets.clear();
  }
}
