import { createSignal, onCleanup, onMount, type Component } from 'solid-js';

declare global {
  interface Window {
    __tapweave_frame_probe: {
      started_at: number;
      frame_intervals: number[];
      last_frame_count: number;
      reactive_writes: number;
      baseline_writes: number;
    };
  }
}

export const Frame_Probe: Component = () => {
  let baseline_element: HTMLDivElement | null = null;
  let animation_handle = 0;
  const [transform_text, set_transform_text] = createSignal('translateX(0px)');
  const [frame_count, set_frame_count] = createSignal(0);
  const [running, set_running] = createSignal(false);

  onMount(() => {
    window.__tapweave_frame_probe = { started_at: 0, frame_intervals: [], last_frame_count: 0, reactive_writes: 0, baseline_writes: 0 };
  });

  const start_probe = () => {
    if (running()) return;
    const stats = window.__tapweave_frame_probe;
    stats.started_at = performance.now();
    stats.frame_intervals = [];
    let previous_time = performance.now();
    let count = 0;
    set_running(true);

    const step = () => {
      const current_time = performance.now();
      count += 1;
      stats.frame_intervals.push(current_time - previous_time);
      if (stats.frame_intervals.length > 8000) stats.frame_intervals.shift();
      previous_time = current_time;
      const position = (count * 3) % 600;
      // Reactive shell pattern: signal write bound into JSX.
      set_frame_count(count);
      set_transform_text(`translateX(${position}px)`);
      stats.reactive_writes += 1;
      // Vanilla baseline: direct DOM write in the same frame.
      if (baseline_element !== null) {
        baseline_element.style.transform = `translateX(${position}px)`;
        stats.baseline_writes += 1;
      }
      stats.last_frame_count = count;
      animation_handle = requestAnimationFrame(step);
    };
    animation_handle = requestAnimationFrame(step);
  };

  const stop_probe = () => {
    if (!running()) return;
    cancelAnimationFrame(animation_handle);
    set_running(false);
  };

  onCleanup(() => cancelAnimationFrame(animation_handle));

  return (
    <div data-frame-probe="solid">
      <div
        data-probe-box="reactive"
        style={{ width: '40px', height: '40px', background: '#5b8cff', transform: transform_text() }}
      />
      <div
        ref={(element) => {
          baseline_element = element;
        }}
        data-probe-box="baseline"
        style={{ width: '40px', height: '40px', background: '#8c5bff', transform: 'translateX(0px)' }}
      />
      <p data-frame-count={frame_count()}>frames: {frame_count()}</p>
      <button type="button" onClick={start_probe} data-probe-action="start">
        start probe
      </button>
      <button type="button" onClick={stop_probe} data-probe-action="stop">
        stop probe
      </button>
    </div>
  );
};
