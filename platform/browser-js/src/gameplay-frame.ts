import type { Audio_Playback } from './audio-playback.js';
import type { Gameplay_Output } from './engine-bridge.js';
import type { Input_Snapshot_Values } from './abi-records.js';
import { record_size } from './abi-records.js';
import { Input_Buffer } from './input.js';
import { require_condition } from './errors.js';

// One owner drains receipt-stamped input before advancing the shared audio clock.
// The renderer consumes borrowed output synchronously, before another engine call.
export class Gameplay_Frame {
  input: Input_Buffer;
  private staging: Input_Snapshot_Values[];
  private batch: Input_Snapshot_Values[] = [];
  private request_id: number | null = null;
  private generation = 0;
  error: unknown = null;
  terminal = false;

  constructor(readonly playback: Audio_Playback,
    readonly render: (time_ms: number, output: Gameplay_Output) => void,
    maximum_records = 8192,
    readonly request_frame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
    readonly cancel_frame: (request_id: number) => void = cancelAnimationFrame) {
    this.input = new Input_Buffer(maximum_records);
    this.staging = Array.from({ length: maximum_records }, () => ({}));
    playback.engine.reserve_input(maximum_records * record_size(23));
  }

  drain() {
    const { clock, session_handle, engine } = this.playback;
    const mapping = clock.session_mapping;
    require_condition(mapping, 'INVALID_CLOCK', 'Input requires a running session mapping.');
    this.batch.length = this.input.records.length;
    for (let record_index = 0; record_index < this.input.records.length; record_index++) {
      const source = this.input.records[record_index];
      const target = this.staging[record_index];
      const time_ms = clock.input_time(session_handle, mapping!.engine_epoch, source.raw_time_ms);
      target.sequence = source.sequence;
      target.raw_time_ms = time_ms;
      target.effective_time_ms = time_ms;
      target.x = source.x;
      target.y = source.y;
      target.action_bits = source.action_bits;
      this.batch[record_index] = target;
    }
    if (this.batch.length) engine.submit_inputs(session_handle, this.batch);
    this.input.records.length = 0;
  }

  step() {
    try {
      this.drain();
      const audio_seconds = this.playback.context.currentTime;
      const output = this.playback.pump(audio_seconds);
      this.terminal = output.summary.state === 3 || output.summary.state === 4;
      this.render(this.playback.clock.beatmap_time(audio_seconds), output);
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
      // Engine pause appends the authoritative exact-boundary release snapshot.
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
    if (this.playback.state !== 'recovering' && this.playback.state !== 'disposed') this.playback.recover(error);
  }

  stop() {
    this.generation++;
    if (this.request_id !== null) this.cancel_frame(this.request_id);
    this.request_id = null;
  }
}
