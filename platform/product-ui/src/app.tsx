import { Settings_Dialog } from './components/settings_dialog';
import { open_settings_dialog } from './state/settings_state';
import { onMount, Show, type Component, type ParentProps } from 'solid-js';
import { Route, Router, useLocation } from '@solidjs/router';
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
  // The service pointer itself is not reactive: tracking the shell phase
  // re-reads it once the engine capabilities exist to quote in the footer.
  const ready_player_session = () =>
    shell_state().phase === 'ready' ? player_session() : null;

  onMount(() => {
    void boot_player_session().then(() => {
      const debug_service = player_session()?.debug;
      if (debug_service) bind_debug_session(debug_service);
    });
    register_debug_shortcuts();
  });

  return (
    <div class="app-frame">
      {props.children}
      <Debug_Dialog />
      <Settings_Dialog />
      {/* The intro screen carries its own prominent disclaimer, so the frame
          footer (with the relocated Settings entry point) stays hidden there. */}
      <Show when={location.pathname !== '/'}>
        <footer>
          <p class="footer-note">
            <span>Independent rhythm game. Not affiliated with osu! or ppy.</span>
            <span>Unmodded lazer osu!standard target.</span>
            <Show when={ready_player_session()}>
              {(session) => (
                <span
                  class="footer-baseline"
                  data-footer-baseline={session().engine.capabilities.lazer_version}
                >
                  Compatibility baseline: lazer {session().engine.capabilities.lazer_version}.
                </span>
              )}
            </Show>
            <span>
              Validation build: full upstream compatibility and release-browser certification remain
              open. Validation player.
            </span>
          </p>
          <div class="footer-actions">
            <button type="button" disabled={shell_state().phase !== 'ready' ||
              !['ready', 'paused', 'terminal'].includes(shell_state().gameplay.state)}
              onClick={event => { event.currentTarget.focus(); open_settings_dialog(); }}>Settings</button>
          </div>
        </footer>
      </Show>
    </div>
  );
};

export const App: Component = () => {
  return (
    <Router root={App_Frame}>
      <Route path="/" component={Intro_Screen} />
      <Route path="/menu" component={Main_Menu_Screen} />
      <Route path="/select" component={Select_Screen} />
      <Route path="/play" component={Play_Screen} />
      <Route path="/results" component={Results_Screen} />
      <Route path="/diagnostics" component={Diagnostics_Screen} />
    </Router>
  );
};
