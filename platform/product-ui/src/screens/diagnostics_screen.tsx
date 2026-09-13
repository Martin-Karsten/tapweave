import { createSignal, Show, type Component } from 'solid-js';
import { Engine_Diagnostics_Panel } from '../components/engine_diagnostics';
import { Frame_Probe } from '../components/frame_probe';
import { Hmr_Counter } from '../components/hmr_counter';
import { Virtual_List } from '../components/virtual_list';
import { run_engine_self_check, type Engine_Self_Check_Result } from '../services/engine_self_check';
import { start_input_gate_fixture, stop_input_gate_fixture } from '../services/input_gate_fixture';
import { player_session, shell_state } from '../state/session_state';

interface Stress_Row {
  id: number;
  title: string;
  stars: number;
}

const build_stress_rows = (count: number): Stress_Row[] =>
  Array.from({ length: count }, (_, row_index) => ({
    id: row_index,
    title: `difficulty entry ${row_index}`,
    stars: 1 + ((row_index * 7) % 10) / 2,
  }));

const stringify = (value: unknown) =>
  JSON.stringify(value, (_field_name, field_value) =>
    typeof field_value === 'bigint' ? field_value.toString() : field_value, 2);

export const Diagnostics_Screen: Component = () => {
  const [mounted_at] = createSignal(performance.now());
  const [self_check, set_self_check] = createSignal<Engine_Self_Check_Result | null>(null);
  const [self_check_running, set_self_check_running] = createSignal(false);
  const [self_check_error, set_self_check_error] = createSignal<string | null>(null);
  const [input_fixture_active, set_input_fixture_active] = createSignal(false);

  const diagnostics_text = () => {
    void shell_state(); // Track lifecycle notifications so the report refreshes.
    const session = player_session();
    return session === null ? 'Waiting for engine capabilities.' : stringify(session.diagnostics());
  };

  const run_self_check = async () => {
    if (self_check_running()) return;
    set_self_check_running(true);
    set_self_check_error(null);
    try {
      set_self_check(await run_engine_self_check());
    } catch (error) {
      set_self_check(null);
      set_self_check_error(error instanceof Error ? error.message : String(error));
    } finally {
      set_self_check_running(false);
    }
  };

  const toggle_input_fixture = async () => {
    if (input_fixture_active()) {
      stop_input_gate_fixture();
      set_input_fixture_active(false);
    } else {
      await start_input_gate_fixture();
      set_input_fixture_active(true);
    }
  };

  const download_diagnostics = () => {
    const object_url = URL.createObjectURL(new Blob([diagnostics_text()], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = object_url;
    link.download = 'tapweave-diagnostics.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(object_url), 1000);
  };

  return (
    <main class="screen diagnostics-screen" aria-label="Diagnostics">
      <section class="panel" data-gate="b1">
        <h2>Engine capabilities</h2>
        <Engine_Diagnostics_Panel />
      </section>

      <section class="panel" data-gate="a2">
        <h2>HMR counter fixture</h2>
        <Hmr_Counter step={1} />
      </section>

      <section class="panel" data-gate="b2">
        <h2>Virtualized stress list</h2>
        <p>10,000 entries with bounded DOM (selection gate fixture).</p>
        <Virtual_List
          rows={build_stress_rows(10_000)}
          row_height={44}
          list_name="songs"
          aria_label="Stress test entries"
          render_row={(row) => (
            <span>
              {row.title} — {row.stars.toFixed(1)}★
            </span>
          )}
          on_activate={() => {}}
        />
      </section>

      <section class="panel" data-gate="b3">
        <h2>Per-frame reactivity probe</h2>
        <Frame_Probe />
      </section>

      <section class="panel" data-gate="mount-time">
        <p data-mounted-at={mounted_at()}>mounted this session</p>
      </section>

      <section class="panel" data-gate="self-check">
        <h2>Engine round-trip check</h2>
        <p>Prepares a map, opens a session, transforms coordinates, submits input and reads the result.</p>
        <button type="button" onClick={() => void run_self_check()} disabled={self_check_running()}>
          Run engine round-trip check
        </button>
        <Show when={self_check_error()}>
          <p role="alert" data-self-check="error">
            {self_check_error()}
          </p>
        </Show>
        <Show when={self_check()}>
          <dl data-self-check="result">
            <div>
              <dt>x</dt>
              <dd data-self-check-value="x">{self_check()!.x}</dd>
            </div>
            <div>
              <dt>y</dt>
              <dd data-self-check-value="y">{self_check()!.y}</dd>
            </div>
            <div>
              <dt>state</dt>
              <dd data-self-check-value="state">{self_check()!.state}</dd>
            </div>
            <div>
              <dt>accuracy</dt>
              <dd data-self-check-value="accuracy">{self_check()!.accuracy}</dd>
            </div>
            <div>
              <dt>owned_sessions</dt>
              <dd data-self-check-value="owned_sessions">{self_check()!.owned_sessions}</dd>
            </div>
            <div>
              <dt>owned_maps</dt>
              <dd data-self-check-value="owned_maps">{self_check()!.owned_maps}</dd>
            </div>
          </dl>
        </Show>
      </section>

      <section class="panel" data-gate="input-fixture">
        <h2>Input binding fixture</h2>
        <p>Binds real input listeners to a probe canvas for browser validation.</p>
        <button type="button" data-input-fixture-action="toggle" onClick={() => void toggle_input_fixture()}>
          {input_fixture_active() ? 'Stop input binding fixture' : 'Start input binding fixture'}
        </button>
        <p data-input-fixture-state={input_fixture_active() ? 'active' : 'idle'}>
          {input_fixture_active() ? 'fixture active' : 'fixture idle'}
        </p>
      </section>

      <section class="panel" aria-label="Player diagnostics">
        <h2>Player diagnostics</h2>
        <pre id="diagnostics">{diagnostics_text()}</pre>
        <button id="export" type="button" onClick={download_diagnostics}>
          Download diagnostics
        </button>
      </section>
    </main>
  );
};
