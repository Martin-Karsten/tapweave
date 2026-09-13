import { Audio_Clock } from './clock.js';
import { Audio_Service, type Audio_Service_Limits } from './audio.js';
import { Audio_Admission } from './audio-admission.js';
import { Music_Transport } from './music.js';
import { Voice_Output, Gameplay_Output, type Engine_Bridge } from './engine-bridge.js';
import { SESSION_STATE } from './abi-records.js';
import type { Loaded_Samples } from './sample-assets.js';
import { bind_sample_assets } from './sample-assets.js';
import { require_condition, Browser_Error } from './errors.js';
import type { Diagnostics_Service } from './diagnostics.js';

export interface Playback_Selection {
  music_buffer: AudioBuffer | null;
  samples: Loaded_Samples | null;
}

// Audio integration for an explicitly owned ready session. W06 supplies input
// and the frame driver; W07 supplies the product lifecycle and aggregate Play gate.
export class Audio_Playback {
  engine: Engine_Bridge;
  session_handle: bigint;
  context: AudioContext;
  clock = new Audio_Clock();
  audio: Audio_Service;
  music: Music_Transport;
  admission: Audio_Admission;
  voice_output = new Voice_Output();
  gameplay_output = new Gameplay_Output();
  state: 'ready' | 'starting' | 'running' | 'paused' | 'recovering' | 'disposed' = 'ready';
  error: unknown = null;
  last_committed_ms: number | null = null;
  requested_time_ms: number | null = null;
  diagnostics: Diagnostics_Service | null = null;
  generation = 0;

  constructor(engine: Engine_Bridge, session_handle: bigint, context: AudioContext,
    selection: Playback_Selection, limits: Audio_Service_Limits = {}, reuse_voice_storage = false,
    diagnostics: Diagnostics_Service | null = null) {
    require_condition(selection.music_buffer && selection.samples,
      'MISSING_ASSET', 'Music and prepared hitsounds are required.');
    this.engine = engine;
    this.session_handle = session_handle;
    this.context = context;
    this.diagnostics = diagnostics;
    this.audio = new Audio_Service(context, this.clock, limits);
    this.music = new Music_Transport(context, this.clock);
    this.admission = new Audio_Admission(engine, session_handle, this.audio);
    // Reset retains the same reserved voice arena. Re-reserving would allocate
    // a transactional replacement and unnecessarily raise the WASM high-water mark.
    if (!reuse_voice_storage) {
      const capacity = engine.voice_reserve(session_handle);
      engine.voice_reserve(session_handle, capacity.required_commands, capacity.required_bytes);
    }
    bind_sample_assets(engine, session_handle, selection.samples!);
    this.audio.set_assets(selection.samples!.assets);
    this.music.set_buffer(selection.music_buffer!);
  }

  async start(beatmap_ms = 0, receipt_now: () => number = () => performance.now()) {
    require_condition(this.state === 'ready' || this.state === 'paused', 'INVALID_STATE', 'Playback must be ready or paused.');
    const resuming = this.state === 'paused';
    const generation = ++this.generation;
    this.state = 'starting';
    try {
      this.note('AudioContext.resume');
      await this.context.resume();
      if (generation !== this.generation) return;
      const resumed_state: string = this.context.state;
      if (resumed_state !== 'running') {
        this.diagnostics?.record_engine_failure('AudioContext.resume',
          new Browser_Error('INVALID_STATE', 'Audio output is suspended.'), { audio_state: resumed_state });
        require_condition(this.context.state === 'running', 'INVALID_STATE', 'Audio output is suspended.');
      }
      const audio_seconds = this.context.currentTime;
      if (!resuming) {
        this.note('oe_session_voice_output');
        this.engine.voice_output(this.session_handle, this.voice_output);
        require_condition(beatmap_ms === this.voice_output.summary.committed_ms,
          'INVALID_CLOCK', 'Start must use the ready engine position.');
      }
      if (resuming) {
        this.note('oe_session_resume');
        this.engine.resume(this.session_handle, { beatmap_ms: this.clock.paused_beatmap_ms, audio_seconds });
        this.clock.resume(audio_seconds);
      } else {
        this.clock.start(audio_seconds, beatmap_ms);
      }
      this.note_clock('clock_anchor_start', {
        resuming, audio_seconds, beatmap_ms,
        paused_media_ms: resuming ? this.clock.paused_beatmap_ms : beatmap_ms,
        engine_epoch: Number(this.voice_output.summary.epoch) });
      this.note('oe_session_voice_output');
      this.engine.voice_output(this.session_handle, this.voice_output);
      this.clock.bind_session(this.session_handle, this.voice_output.summary.epoch, receipt_now(), audio_seconds);
      this.diagnostics?.note_clock_rebinding({ session_handle: this.session_handle.toString(),
        engine_epoch: Number(this.voice_output.summary.epoch), receipt_ms: receipt_now(), audio_seconds,
        anchor: { ...this.clock.anchor! } });
      if (resuming) this.audio.resume_one_shots();
      this.note('music start');
      this.music.start();
      this.state = 'running';
      this.pump();
    } catch (error) {
      if (generation === this.generation) this.recover(error);
      throw error;
    }
  }

  private note(operation: string) {
    this.diagnostics?.note_operation(operation, this.session_handle.toString());
  }

  private note_clock(operation: string, detail: Record<string, unknown>) {
    this.diagnostics?.note_clock_observation(operation, null, detail);
  }

  pump(audio_seconds: number = this.context.currentTime) {
    require_condition(this.state === 'running', 'INVALID_STATE', 'Audio playback is not running.');
    try {
      if (this.context.state !== 'running') {
        this.diagnostics?.note_audio_interruption('Audio output was interrupted during playback.',
          { audio_seconds, state: this.context.state, last_committed_ms: this.last_committed_ms });
        this.diagnostics?.record_engine_failure('audio_pump',
          new Browser_Error('INVALID_STATE', 'Audio output was suspended.'),
          { audio_seconds, audio_state: this.context.state, requested_time_ms: this.requested_time_ms });
      }
      require_condition(this.context.state === 'running', 'INVALID_STATE', 'Audio output was suspended.');
      const time_ms = this.clock.beatmap_time(audio_seconds);
      this.note('oe_session_advance_output');
      this.requested_time_ms = time_ms;
      this.engine.advance_output(this.session_handle, time_ms, this.gameplay_output);
      this.last_committed_ms = this.gameplay_output.summary.committed_ms;
      this.note('oe_session_voice_output');
      this.engine.voice_output(this.session_handle, this.voice_output);
      this.note('voice admission');
      this.admission.admit(this.voice_output);
      this.note('audio pump');
      this.audio.pump();
      // Voice output changes the acknowledgement token. Reacquire compact output
      // before consuming its judgements; the returned borrowed records remain
      // readable until the next pump and are delivered only once.
      this.note('oe_session_advance_output');
      this.requested_time_ms = time_ms;
      this.engine.advance_output(this.session_handle, time_ms, this.gameplay_output);
      this.last_committed_ms = this.gameplay_output.summary.committed_ms;
      this.note('oe_session_acknowledge');
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
      const time_ms = this.clock.beatmap_time(audio_seconds);
      this.note('oe_session_pause');
      this.requested_time_ms = time_ms;
      const output = this.engine.pause(this.session_handle, time_ms);
      this.note_clock('clock_anchor_pause', { audio_seconds, requested_ms: time_ms,
        committed_ms: Number(output.summary.committed_ms), state: Number(output.summary.state) });
      if (output.summary.state === SESSION_STATE.PASSED || output.summary.state === SESSION_STATE.FAILED) {
        if (this.context.state === 'running') this.pump(audio_seconds);
        return output.summary.state;
      }
      this.music.cancel();
      this.clock.pause(audio_seconds);
      this.audio.suspend_one_shots();
      this.state = 'paused';
      return SESSION_STATE.PAUSED;
    } catch (error) {
      this.recover(error);
      throw error;
    }
  }

  get pending_sounds() {
    return this.audio.pending.length + this.audio.voices.size + this.audio.retiring_voices.size;
  }

  // Recovery-context observation for the lifecycle owner; sampled before any
  // recovery cleanup mutates clock or audio state.
  failure_context() {
    return { operation: this.diagnostics?.current_operation ?? 'idle',
      requested_time_ms: this.requested_time_ms, last_committed_ms: this.last_committed_ms,
      clock_mapping: this.clock.session_mapping, audio_seconds: this.context.currentTime,
      audio_state: this.context.state, sample_rate: this.context.sampleRate,
      base_latency_seconds: this.context.baseLatency, output_latency_seconds: this.context.outputLatency,
      receipt_ms: performance.now() };
  }

  finish() {
    this.music.cancel();
    this.audio.cancel();
    if (this.clock.anchor) this.clock.pause(this.context.currentTime);
  }

  recover(error: unknown) {
    // Recovery-context evidence is recorded before cleanup mutates clock state.
    // Engine-level failures were already captured by their owning layer; this
    // appends the sampled audio/browser observation context around them and
    // retains audio-service failures that no inner layer recorded.
    const recovery_context = this.failure_context();
    if (this.diagnostics && this.diagnostics.first_failure === null) {
      this.diagnostics.record_engine_failure('playback_recover', error, { ...recovery_context });
    }
    this.diagnostics?.record_event('audio', 'error', 'playback_recover',
      error instanceof Error ? error.message : String(error), { ...recovery_context });
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
