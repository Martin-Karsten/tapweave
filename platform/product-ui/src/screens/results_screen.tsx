import { Show, createSignal, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Lifecycle_Panel } from './lifecycle_panel';
import { download_file } from '../services/debug_session';
import { player_session, shell_state } from '../state/session_state';

// Results route: reads the authoritative engine result through the session
// service. Retry re-enters the play route; Back releases the attempt. Watch
// replays the retained recording without input; Save downloads the TWREPLAY
// container as {selection filename base}-{score}.twreplay. Both actions serve
// the retained completed run, so they keep working after exiting a watch.
export const Results_Screen: Component = () => {
  const navigate = useNavigate();
  const [replay_status, set_replay_status] = createSignal('');
  const view = () => shell_state().gameplay;

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
      >
        <Lifecycle_Panel
          view={view()}
          on_resume={() => void player_session()?.resume()}
          on_retry={() => {
            navigate('/play');
            void player_session()?.retry();
          }}
          on_back={() => {
            player_session()?.back();
            navigate('/select');
          }}
          on_watch_replay={watch_replay}
          on_save_replay={save_replay}
        />
        <p id="replay-status" role="status" aria-live="polite">
          {replay_status()}
        </p>
      </Show>
    </main>
  );
};
