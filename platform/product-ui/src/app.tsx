import { createSignal, type Component } from 'solid-js';
import { Hmr_Counter } from './components/hmr_counter';
import { Engine_Diagnostics_Panel } from './components/engine_diagnostics';
import { build_song_rows, Virtual_Song_List } from './components/virtual_song_list';
import { Frame_Probe } from './components/frame_probe';

export const Spike_App: Component = () => {
  const [mounted_at] = createSignal(performance.now());
  return (
    <main>
      <h1>Tapweave product shell — Solid 1.9</h1>
      <section class="panel" data-gate="a2">
        <Hmr_Counter step={1} />
      </section>
      <section class="panel" data-gate="b1">
        <h2>Engine bridge (b1 gate)</h2>
        <Engine_Diagnostics_Panel />
      </section>
      <section class="panel" data-gate="b2">
        <h2>Virtualized song list (b2 gate)</h2>
        <Virtual_Song_List rows={build_song_rows(10_000)} row_height={44} />
      </section>
      <section class="panel" data-gate="b3">
        <h2>Per-frame reactivity probe (b3 gate)</h2>
        <Frame_Probe />
      </section>
      <section class="panel" data-gate="mount-time">
        <p data-mounted-at={mounted_at()}>mounted this session</p>
      </section>
    </main>
  );
};
