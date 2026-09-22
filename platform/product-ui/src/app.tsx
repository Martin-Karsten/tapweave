import { Multiplayer_Screen } from './screens/multiplayer_screen';
import { Settings_Dialog } from './components/settings_dialog';
import { open_settings_dialog } from './state/settings_state';
import { onMount, Show, type Component, type ParentProps } from 'solid-js';
import { Route, Router, useLocation, useParams } from '@solidjs/router';
import { Intro_Screen } from './screens/intro_screen';
import { Main_Menu_Screen } from './screens/main_menu_screen';
import { Select_Screen } from './screens/select_screen';
import { Play_Screen } from './screens/play_screen';
import { Results_Screen } from './screens/results_screen';
import { Diagnostics_Screen } from './screens/diagnostics_screen';
import { Debug_Dialog } from './components/debug_dialog';
import { bind_debug_session, register_debug_shortcuts } from './state/debug_state';
import { boot_player_session, player_session, shell_state } from './state/session_state';

const App_Frame: Component<ParentProps> = (props) => {
  const location = useLocation();
  // The play route owns the whole window: the immersive class keeps it marked
  // as chrome-free while every route shares the full-viewport frame, and the
  // frame footer below is route-guarded off it (and the intro) as before.
  const immersive_route = () => location.pathname === '/play';

  onMount(() => {
    void boot_player_session().then(() => {
      const debug_service = player_session()?.debug;
      if (debug_service) bind_debug_session(debug_service);
    });
    register_debug_shortcuts();
  });

  return (
    <div class="app-frame" classList={{ immersive: immersive_route() }}>
      {props.children}
      <Debug_Dialog />
      <Settings_Dialog />
      {/* The intro screen carries its own prominent disclaimer, so the frame
          footer (with the relocated Settings entry point) stays hidden there;
          the gameplay route hides it too so play owns the full window. */}
      <Show when={location.pathname !== '/' && !immersive_route()}>
        <footer class="app-footer">
          <p class="footer-note">Independent rhythm game. Not affiliated with osu! or ppy.</p>
          <div class="footer-actions">
            {/* GitHub mark-github path (GitHub Octicons, MIT; see
                THIRD_PARTY_NOTICES.md). */}
            <a
              class="footer-github"
              href="https://github.com/Martin-Karsten/tapweave"
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Tapweave on GitHub"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
              </svg>
            </a>
            <button type="button" disabled={shell_state().phase !== 'ready' ||
              shell_state().gameplay.watching_replay ||
              !['ready', 'paused', 'terminal'].includes(shell_state().gameplay.state)}
              onClick={event => { event.currentTarget.focus(); open_settings_dialog(); }}>Settings</button>
          </div>
        </footer>
      </Show>
    </div>
  );
};

const Room_Screen: Component = () => {
  const parameters = useParams();
  return <Show when={parameters.room_id} keyed>{(_room_id) => <Multiplayer_Screen />}</Show>;
};

export const App: Component = () => {
  return (
    <Router root={App_Frame}>
      <Route path="/" component={Intro_Screen} />
      <Route path="/multiplayer" component={Multiplayer_Screen} />
      <Route path="/room/:room_id" component={Room_Screen} />
      <Route path="/menu" component={Main_Menu_Screen} />
      <Route path="/select" component={Select_Screen} />
      <Route path="/play" component={Play_Screen} />
      <Route path="/results" component={Results_Screen} />
      <Route path="/diagnostics" component={Diagnostics_Screen} />
    </Router>
  );
};
