import type { Audio_Playback } from './audio-playback.js';
import type { Gameplay_Output } from './engine-bridge.js';
import { record_size, RECORD, SESSION_STATE, type Input_Snapshot_Values } from './abi-records.js';
import { Input_Buffer } from './input.js';
import { Browser_Error, require_condition } from './errors.js';
import type { Diagnostics_Service } from './diagnostics.js';

export interface Debug_Frame_Metrics {
  instances: number;
  batches: number;
  gpu_ms: number | null;
}

export interface Gameplay_Frame_Options {
  diagnostics?: Diagnostics_Service | null;
  frame_metrics?: () => Debug_Frame_Metrics;
}

// One coordinator owns the ordering contract: collect audio-stamped input,
// submit it, then advance the shared audio clock; rendering only consumes the
// resulting state. Input submission, ordinary advancement and pause all pass
// through drain() so results never depend on which RAF callback ran first.
// The renderer consumes borrowed output synchronously, before another engine call.
export class Gameplay_Frame {
  input: Input_Buffer;
  private staging: Input_Snapshot_Values[];
  private batch: Input_Snapshot_Values[] = [];
  private request_id: number | null = null;
  private generation = 0;
  private readonly diagnostics: Diagnostics_Service | null;
  private readonly frame_metrics: (() => Debug_Frame_Metrics) | null;
  error: unknown = null;
  terminal = false;
  on_terminal: (() => void) | null = null;
  on_error: ((error: unknown) => void) | null = null;
  on_terminal_frame: (() => void) | null = null;
  on_pause: ((reason: string) => void) | null = null;

  constructor(readonly playback: Audio_Playback,
    readonly render: (time_ms: number, output: Gameplay_Output) => void,
    maximum_records = 8192,
    readonly request_frame: (callback: FrameRequestCallback) => number = callback => requestAnimationFrame(callback),
    readonly cancel_frame: (request_id: number) => void = request_id => cancelAnimationFrame(request_id),
    options: Gameplay_Frame_Options = {}) {
    this.input = new Input_Buffer(maximum_records);
    this.staging = Array.from({ length: maximum_records }, () => ({}));
    this.diagnostics = options.diagnostics ?? null;
    this.frame_metrics = options.frame_metrics ?? null;
    playback.engine.reserve_input(maximum_records * record_size(RECORD.input_snapshot));
  }

  drain() {
    const { clock, session_handle, engine } = this.playback;
    const mapping = clock.session_mapping;
    require_condition(mapping, 'INVALID_CLOCK', 'Input requires a running session mapping.');
    const audio_seconds = this.playback.context.currentTime;
    this.batch.length = this.input.records.length;
    for (let record_index = 0; record_index < this.input.records.length; record_index++) {
      const source = this.input.records[record_index];
      // Old-epoch input must never be interpreted against the new mapping.
      require_condition(source.clock_epoch === mapping!.browser_epoch, 'INVALID_CLOCK',
        `Input record ${source.sequence} belongs to closed clock epoch ${source.clock_epoch}.`);
      const target = this.staging[record_index];
      const time_ms = clock.input_time(session_handle, mapping!.engine_epoch, source.audio_seconds);
      target.sequence = source.sequence;
      target.raw_time_ms = time_ms;
      target.effective_time_ms = time_ms;
      target.x = source.x;
      target.y = source.y;
      target.action_bits = source.action_bits;
      target.flags = source.flags ?? 0;
      this.batch[record_index] = target;
      this.diagnostics?.note_input(Number(source.sequence), source.source, source.action_bits,
        source.raw_time_ms, time_ms, audio_seconds, source.x, source.y, record_index);
    }
    if (this.batch.length) {
      try { engine.submit_inputs(session_handle, this.batch); }
      catch (error) {
        const committed_ms = this.playback.last_committed_ms;
        const late_index = committed_ms == null ? -1 : this.batch.findIndex(record => Number(record.effective_time_ms) < committed_ms);
        const diagnostic_indices = [...new Set([0, this.batch.length - 1, late_index].filter(record_index => record_index >= 0))];
        const details = { operation: 'oe_session_inputs_from_reserved', last_committed_ms: committed_ms,
          clock_mapping: mapping, audio_seconds, receipt_ms: performance.now(),
          batch_count: this.batch.length, first_late_index: late_index,
          input_samples: diagnostic_indices.map(record_index => ({ record_index,
            receipt: { ...this.input.records[record_index] }, mapped: { ...this.batch[record_index] },
            behind_committed_ms: committed_ms == null ? null : committed_ms - Number(this.batch[record_index].effective_time_ms) })) };
        if (error instanceof Browser_Error) Object.assign(error.details, details);
        // Timing-failure evidence: receipt time, mapped input time, sampled audio
        // time, clock anchors, input sequence, batch position, advance target and
        // lateness. Observation times stay distinct from the authoritative
        // committed gameplay time.
        this.diagnostics?.note_input_rejected(this.batch.length);
        this.diagnostics?.amend_first_failure({ timing_capture: details });
        this.diagnostics?.record_event('input', 'error', 'oe_session_inputs_from_reserved',
          `Input batch of ${this.batch.length} record(s) was rejected.`, { ...details });
        throw error;
      }
      const batch_maximum_lateness = committed_lateness(this.playback.last_committed_ms, this.batch);
      this.diagnostics?.note_input_batch(this.batch.length, batch_maximum_lateness);
    }
    this.input.records.length = 0;
  }

  step() {
    const detailed = this.diagnostics !== null && this.diagnostics.capture_mode === 'detailed';
    const queue_depth_before_drain = this.input.records.length;
    const input_started = detailed ? performance.now() : 0;
    try {
      if (this.terminal && this.on_terminal_frame) {
        this.on_terminal_frame();
        return;
      }
      // Audio state can become visible before its queued statechange event.
      // Ask the lifecycle owner to pause before any ordinary advance; that
      // owner drains and freezes input at the unchanged authoritative audio time.
      if (this.playback.context.state !== 'running' && this.on_pause) {
        this.on_pause('Audio output was interrupted.');
        return;
      }
      this.drain();
      const input_finished = detailed ? performance.now() : 0;
      const audio_seconds = this.playback.context.currentTime;
      const output = this.playback.pump(audio_seconds);
      const engine_finished = detailed ? performance.now() : 0;
      this.terminal = output.summary.state === SESSION_STATE.PASSED || output.summary.state === SESSION_STATE.FAILED;
      this.render(this.playback.clock.beatmap_time(audio_seconds), output);
      if (this.diagnostics) {
        // Frame samples are always retained (clock observations, queue depths);
        // per-frame CPU stage timings exist only in detailed capture mode.
        const gpu_metrics = this.frame_metrics?.();
        this.diagnostics.record_frame_sample({
          audio_seconds, advance_target_ms: this.playback.requested_time_ms ?? 0,
          committed_ms: this.playback.last_committed_ms,
          stage_input_ms: detailed ? input_finished - input_started : 0,
          stage_engine_ms: detailed ? engine_finished - input_finished : 0,
          stage_render_ms: detailed ? performance.now() - engine_finished : 0,
          input_queue_depth: queue_depth_before_drain,
          audio_pending: this.playback.audio.pending.length,
          audio_voices: this.playback.audio.voices.size,
          wasm_pages: this.playback.engine.wasm.memory.buffer.byteLength / 65536,
          instances: gpu_metrics?.instances, batches: gpu_metrics?.batches, gpu_ms: gpu_metrics?.gpu_ms ?? null });
      }
      if (this.terminal) this.on_terminal?.();
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  start() {
    require_condition(this.playback.state === 'running' && this.request_id === null && this.error === null,
      'INVALID_STATE', 'Frame driver requires running playback and no active callback.');
    const generation = ++this.generation;
    const frame = () => {
      if (generation !== this.generation) return;
      this.request_id = null;
      try { this.step(); } catch { return; }
      if (generation === this.generation) this.request_id = this.request_frame(frame);
    };
    this.request_id = this.request_frame(frame);
  }

  pause() {
    this.stop();
    try {
      this.drain();
      // Engine pause records retained actions at the exact boundary.
      this.playback.pause();
      this.input.held_sources.clear();
      this.input.focus_epoch++;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  fail(error: unknown) {
    this.stop();
    this.error = error;
    if (this.on_error) this.on_error(error);
    else if (this.playback.state !== 'recovering' && this.playback.state !== 'disposed') this.playback.recover(error);
  }

  stop() {
    this.generation++;
    if (this.request_id !== null) this.cancel_frame(this.request_id);
    this.request_id = null;
  }
}

function committed_lateness(committed_ms: number | null, batch: Input_Snapshot_Values[]) {
  if (committed_ms === null) return 0;
  let maximum_lateness = 0;
  for (let record_index = 0; record_index < batch.length; record_index++) {
    const lateness = committed_ms - Number(batch[record_index].effective_time_ms);
    if (lateness > maximum_lateness) maximum_lateness = lateness;
  }
  return maximum_lateness;
}
