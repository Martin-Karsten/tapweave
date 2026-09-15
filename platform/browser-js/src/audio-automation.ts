import { require_condition } from './errors.js';

interface Linear_Segment {
  start_seconds: number;
  end_seconds: number;
  initial: number;
  target: number;
}

// Only set/linear automation is emitted by the engine. Keep the unrendered
// prefix as well as the latest ramp: lookahead can replace a ramp in the future,
// and a later batch can replace automation before an already scheduled start.
export class Audio_Automation {
  private segments: Linear_Segment[] = [];
  private initial: number;

  constructor(initial: number, private readonly maximum_segments: number) {
    this.initial = Math.fround(initial);
  }

  replace(parameter: AudioParam, now_seconds: number, start_seconds: number, duration_seconds: number, target: number): void {
    // Completed segments cannot be revisited: dispatch clamps late audio to now.
    let completed_count = 0;
    while (completed_count < this.segments.length && this.segments[completed_count].end_seconds <= now_seconds) {
      this.initial = this.segments[completed_count++].target;
    }
    if (completed_count > 0) this.segments.splice(0, completed_count);

    let held = this.initial;
    let retained_count = 0;
    let crossing: Linear_Segment | undefined;
    for (const segment of this.segments) {
      if (segment.start_seconds > start_seconds) break;
      const progress = segment.end_seconds <= start_seconds ? 1 :
        (start_seconds - segment.start_seconds) / (segment.end_seconds - segment.start_seconds);
      held = segment.initial + (segment.target - segment.initial) * progress;
      if (segment.start_seconds < start_seconds) {
        retained_count++;
        if (segment.end_seconds >= start_seconds) crossing = segment;
      }
    }
    held = Math.fround(held);
    require_condition(retained_count < this.maximum_segments, 'QUOTA_EXCEEDED', 'Audio automation queue is full.');

    parameter.cancelScheduledValues(start_seconds);
    // Removing a ramp endpoint removes its entire interpolation. Restore its
    // prefix before anchoring the replacement, even when start is ahead of now.
    if (crossing) {
      parameter.linearRampToValueAtTime(held, start_seconds);
      crossing.end_seconds = start_seconds;
      crossing.target = held;
    }
    parameter.setValueAtTime(held, start_seconds);
    const rounded_target = Math.fround(target);
    const end_seconds = start_seconds + duration_seconds;
    if (duration_seconds === 0) parameter.setValueAtTime(rounded_target, start_seconds);
    else parameter.linearRampToValueAtTime(rounded_target, end_seconds);
    this.segments.length = retained_count;
    this.segments.push({ start_seconds, end_seconds, initial: held, target: rounded_target });
  }
}
