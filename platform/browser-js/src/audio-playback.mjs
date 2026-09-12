import { Audio_Clock } from './clock.mjs';
import { Audio_Service } from './audio.mjs';
import { Audio_Admission } from './audio-admission.mjs';
import { Music_Transport } from './music.mjs';
import { Voice_Output, Gameplay_Output } from './engine-bridge.mjs';
import { bind_sample_assets } from './sample-assets.mjs';
import { require_condition } from './errors.mjs';

// Audio integration for an explicitly owned ready session. W06 supplies input
// and the frame driver; W07 supplies the product lifecycle and aggregate Play gate.
export class Audio_Playback {
  constructor(engine, session_handle, context, selection, limits = {}) {
    require_condition(selection.music_buffer && selection.samples, 'MISSING_ASSET', 'Music and prepared hitsounds are required.');
    this.engine = engine;
    this.session_handle = session_handle;
    this.context = context;
    this.clock = new Audio_Clock();
    this.audio = new Audio_Service(context, this.clock, limits);
    this.music = new Music_Transport(context, this.clock);
    this.admission = new Audio_Admission(engine, session_handle, this.audio);
    this.voice_output = new Voice_Output();
    this.gameplay_output = new Gameplay_Output();
    this.state = 'ready';
    this.error = null;
    this.generation = 0;
    const capacity = engine.voice_reserve(session_handle);
    engine.voice_reserve(session_handle, capacity.required_commands, capacity.required_bytes);
    bind_sample_assets(engine, session_handle, selection.samples);
    this.audio.set_assets(selection.samples.assets);
    this.music.set_buffer(selection.music_buffer);
  }

  async start(beatmap_ms = 0, receipt_now = () => performance.now()) {
    require_condition(this.state === 'ready' || this.state === 'paused', 'INVALID_STATE', 'Playback must be ready or paused.');
    const resuming = this.state === 'paused';
    const generation = ++this.generation;
    this.state = 'starting';
    try {
      await this.context.resume();
      if (generation !== this.generation) return;
      require_condition(this.context.state === 'running', 'INVALID_STATE', 'Audio output is suspended.');
      const audio_seconds = this.context.currentTime;
      if (!resuming) {
        this.engine.voice_output(this.session_handle, this.voice_output);
        require_condition(beatmap_ms === this.voice_output.summary.committed_ms, 'INVALID_CLOCK', 'Start must use the ready engine position.');
      }
      if (resuming) {
        this.engine.resume(this.session_handle, { beatmap_ms: this.clock.paused_beatmap_ms, audio_seconds });
        this.clock.resume(audio_seconds);
      } else {
        this.clock.start(audio_seconds, beatmap_ms);
      }
      this.engine.voice_output(this.session_handle, this.voice_output);
      this.clock.bind_session(this.session_handle, this.voice_output.summary.epoch, receipt_now(), audio_seconds);
      if (resuming) this.audio.resume_one_shots();
      this.music.start();
      this.state = 'running';
      this.pump();
    } catch (error) {
      if (generation === this.generation) this.recover(error);
      throw error;
    }
  }

  pump(audio_seconds = this.context.currentTime) {
    require_condition(this.state === 'running', 'INVALID_STATE', 'Audio playback is not running.');
    try {
      require_condition(this.context.state === 'running', 'INVALID_STATE', 'Audio output was suspended.');
      const time_ms = this.clock.beatmap_time(audio_seconds);
      this.engine.advance_output(this.session_handle, time_ms, this.gameplay_output);
      this.engine.voice_output(this.session_handle, this.voice_output);
      this.admission.admit(this.voice_output);
      this.audio.pump();
      // Voice output changes the acknowledgement token. Reacquire compact output
      // before consuming its judgements; the returned borrowed records remain
      // readable until the next pump and are delivered only once.
      this.engine.advance_output(this.session_handle, time_ms, this.gameplay_output);
      this.engine.acknowledge(this.session_handle, this.gameplay_output.summary.batch_token);
      return this.gameplay_output;
    } catch (error) {
      this.recover(error);
      throw error;
    }
  }

  pause() {
    require_condition(this.state === 'running', 'INVALID_STATE', 'Only running playback can pause.');
    try {
      const audio_seconds = this.context.currentTime;
      this.pump(audio_seconds);
      const time_ms = this.clock.beatmap_time(audio_seconds);
      this.engine.pause(this.session_handle, time_ms);
      this.music.cancel();
      this.clock.pause(audio_seconds);
      this.audio.suspend_one_shots();
      this.state = 'paused';
    } catch (error) {
      this.recover(error);
      throw error;
    }
  }

  recover(error) {
    this.generation++;
    this.error = error;
    this.state = 'recovering';
    try { this.music.cancel(); } finally {
      this.audio.cancel();
      if (this.clock.anchor) this.clock.pause(this.context.currentTime);
    }
  }

  dispose() {
    this.generation++;
    try { this.music.dispose(); } finally {
      this.audio.dispose();
      this.state = 'disposed';
    }
  }
}
