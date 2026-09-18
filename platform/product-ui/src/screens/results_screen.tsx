import { For, Show, createSignal, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { SESSION_STATE } from '@browser/abi-records.js';
import {
  accuracy_text,
  max_combo_text,
  rank_class,
  rank_name,
  result_beatmap_labels,
  result_items,
  score_text,
} from './result_display';
import { download_file } from '../services/debug_session';
import { player_session, shell_state } from '../state/session_state';

// Dedicated results route, following the pinned lazer ResultsScreen structure
// (osu 2026.804.2, commit 3c1c96f7, structure/positions only): a two-region
// composition with the score presentation centered in the content region and
// the actions in a bottom bar with a centered button row. SoloResultsScreen
// adds no layout of its own — it presents a single score through the same
// screen. Nothing here copies upstream code or assets, and the rank palette is
// product styling (tokens.css), not lazer's colors. The a11y/test anchors
// (#lifecycle-title, #lifecycle-message, #result-stats, #retry, #watch-replay,
// #save-replay, #back) keep the browser parity suite unmodified.
export const Results_Screen: Component = () => {
  const navigate = useNavigate();
  const [replay_status, set_replay_status] = createSignal('');
  const view = () => shell_state().gameplay;
  const active_selection = () => shell_state().selection.active;

  const watch_replay = () => {
    const session = player_session();
    if (!session?.view.can_watch_replay) return;
    set_replay_status('');
    // Startup failures surface through the recovering lifecycle state; an
    // entry-guard rejection (guarded above) keeps this results context.
    void session.watch_replay().catch(error => {
      set_replay_status(error instanceof Error ? error.message : String(error));
    });
    navigate('/play');
  };

  const save_replay = () => {
    const session = player_session();
    if (!session) return;
    try {
      const replay_bytes = session.export_replay();
      const filename_base = (session.selection.active?.filename ?? 'replay').replace(/\.[^.]+$/, '');
      const score = session.view.result?.summary.score ?? 0n;
      download_file(`${filename_base}-${score}.twreplay`, replay_bytes.slice(), 'application/octet-stream');
      set_replay_status('Replay saved.');
    } catch (error) {
      set_replay_status(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main class="screen results-screen" aria-label="Results">
      <Show
        when={view().result}
        fallback={
          <section class="panel">
            <p role="status">No result available.</p>
            <button type="button" onClick={() => navigate('/select')}>
              Back to selection
            </button>
          </section>
        }
        keyed
      >
        {(finished) => {
          const passed = Number(finished.summary.state) === SESSION_STATE.PASSED;
          const rank = Number(finished.summary.rank);
          return (
            <>
              <section class="results-summary" classList={{ failed: !passed }} aria-label="Attempt summary">
                <Show when={active_selection()} keyed>
                  {(selection) => {
                    const labels = result_beatmap_labels(selection);
                    return (
                      <p class="results-beatmap">
                        <span class="results-beatmap-title">{labels.title}</span>
                        <Show when={labels.version} keyed>
                          {(version) => <span class="results-beatmap-version">{version}</span>}
                        </Show>
                      </p>
                    );
                  }}
                </Show>
                <h2 id="lifecycle-title">{passed ? 'Passed' : 'Failed'}</h2>
                <p id="lifecycle-message" role="status" aria-live="polite">
                  Run complete. Retry or return to selection.
                </p>
                <div
                  class={`rank-emblem ${rank_class(rank) ?? ''}`.trim()}
                  aria-label={`Rank ${rank_name(rank) ?? String(rank)}`}
                >
                  <span aria-hidden="true">{rank_name(rank) ?? String(rank)}</span>
                </div>
                <p class="results-score">{score_text(finished)}</p>
                <p class="results-score-summary">
                  <span>Accuracy {accuracy_text(finished)}</span>
                  <span>Max combo {max_combo_text(finished)}</span>
                </p>
                <dl id="result-stats" class="results-statistics">
                  <For each={result_items(finished)}>
                    {([label, text]) => (
                      <div>
                        <dt>{label}</dt>
                        <dd>{text}</dd>
                      </div>
                    )}
                  </For>
                </dl>
              </section>
              <section class="results-actions" aria-label="Results actions">
                <button id="retry" type="button" disabled={!view().can_retry} onClick={() => {
                  navigate('/play');
                  void player_session()?.retry();
                }}>
                  Retry
                </button>
                <button id="watch-replay" type="button" disabled={!view().can_watch_replay} onClick={watch_replay}>
                  Watch replay
                </button>
                <button id="save-replay" type="button" onClick={save_replay}>
                  Save replay
                </button>
                <button id="back" type="button" onClick={() => {
                  player_session()?.back();
                  navigate('/select');
                }}>
                  Back to selection
                </button>
              </section>
              <p id="replay-status" role="status" aria-live="polite">
                {replay_status()}
              </p>
            </>
          );
        }}
      </Show>
    </main>
  );
};
