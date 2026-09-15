import { For, type Component } from 'solid-js';
import { debug_session, debug_view_version } from '../state/debug_state';

// Non-interactive live metrics following the pinned osu!framework
// PerformanceOverlay (frame intervals, CPU/GPU stage timings); refresh is a
// plain-snapshot pull tracked by the throttled debug_view_version signal.
// Unavailable or disjoint measurements are marked honestly.
export const Debug_Hud: Component = () => {
  const hud_entries = (): [string, string][] => {
    debug_view_version();
    const session = debug_session();
    if (!session) return [];
    const diagnostics = session.diagnostics;
    const frame = diagnostics.latest_frame();
    const resources = diagnostics.resource_counters;
    const recent_frames = diagnostics.ordered_frames().slice(-60);
    const average_interval = recent_frames.length > 1 ?
      (recent_frames[recent_frames.length - 1].receipt_ms - recent_frames[0].receipt_ms) / (recent_frames.length - 1) : null;
    return [
      ['Frame interval', frame === null ? 'unavailable' : `${average_interval === null ? frame.interval_ms.toFixed(1) : average_interval.toFixed(1)} ms`],
      ['CPU stages', frame === null ? 'unavailable' :
        `${frame.stage_input_ms.toFixed(1)} / ${frame.stage_engine_ms.toFixed(1)} / ${frame.stage_render_ms.toFixed(1)} ms`],
      ['Clock discrepancy', frame?.clock_discrepancy_ms == null ? 'unavailable' : `${frame.clock_discrepancy_ms.toFixed(1)} ms`],
      ['Input queue', String(resources.input_queue_depth)],
      ['Audio pending / voices', `${resources.audio_pending} / ${resources.audio_voices}`],
      ['WASM pages', String(resources.wasm_pages)],
      ['Draws', `${resources.draw_instances} inst / ${resources.draw_batches} batch`],
      ['GPU time', frame?.gpu_ms == null ? 'unavailable' : `${frame.gpu_ms.toFixed(2)} ms`],
    ];
  };

  return (
    <div id="debug-hud" aria-hidden="true">
      <dl id="hud-metrics">
        <For each={hud_entries()}>
          {([term, description]) => (
            <div>
              <dt>{term}</dt>
              <dd>{description}</dd>
            </div>
          )}
        </For>
      </dl>
    </div>
  );
};
