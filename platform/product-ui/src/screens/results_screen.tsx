import { Show, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Lifecycle_Panel } from './lifecycle_panel';
import { player_session, shell_state } from '../state/session_state';

// Results route: reads the authoritative engine result through the session
// service. Retry re-enters the play route; Back releases the attempt.
export const Results_Screen: Component = () => {
  const navigate = useNavigate();
  const view = () => shell_state().gameplay;

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
        />
      </Show>
    </main>
  );
};
