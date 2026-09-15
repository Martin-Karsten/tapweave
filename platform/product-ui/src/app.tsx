import { Settings_Dialog } from './components/settings_dialog';
import { open_settings_dialog } from './state/settings_state';
import { onMount, type Component, type ParentProps } from 'solid-js';
import { A, Route, Router } from '@solidjs/router';
import { Select_Screen } from './screens/select_screen';
import { Play_Screen } from './screens/play_screen';
import { Results_Screen } from './screens/results_screen';
import { Diagnostics_Screen } from './screens/diagnostics_screen';
import { Debug_Dialog } from './components/debug_dialog';
import { bind_debug_session, register_debug_shortcuts } from './state/debug_state';
import { boot_player_session, player_session, shell_state } from './state/session_state';

const App_Frame: Component<ParentProps> = (props) => {
  onMount(() => {
    void boot_player_session().then(() => {
      const debug_service = player_session()?.debug;
      if (debug_service) bind_debug_session(debug_service);
    });
    register_debug_shortcuts();
  });

  return (
    <div class="app-frame">
      <header>
        <A href="/" class="brand">
          tapweave<span class="brand-dot">●</span>
        </A>
        <span class="badge">VALIDATION PLAYER</span>
        <nav aria-label="Screens">
          <A href="/select" end>
            Select
          </A>
          <A href="/diagnostics">Diagnostics</A>
          <button type="button" disabled={shell_state().phase !== 'ready' ||
            !['ready', 'paused', 'terminal'].includes(shell_state().gameplay.state)}
            onClick={event => { event.currentTarget.focus(); open_settings_dialog(); }}>Settings</button>
        </nav>
      </header>
      {props.children}
      <Debug_Dialog />
      <Settings_Dialog />
      <p class="gate">Validation build: full upstream compatibility and release-browser certification remain open.</p>
      <footer>Independent rhythm game. Not affiliated with osu! or ppy. <span>Unmodded lazer osu!standard target.</span></footer>
    </div>
  );
};

export const App: Component = () => {
  return (
    <Router root={App_Frame}>
      <Route path="/" component={Select_Screen} />
      <Route path="/select" component={Select_Screen} />
      <Route path="/play" component={Play_Screen} />
      <Route path="/results" component={Results_Screen} />
      <Route path="/diagnostics" component={Diagnostics_Screen} />
    </Router>
  );
};
