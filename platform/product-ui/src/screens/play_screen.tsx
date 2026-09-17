import { Show, createEffect, onCleanup, onMount, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Lifecycle_Panel } from './lifecycle_panel';
import { Debug_Hud } from '../components/debug_hud';
import { debug_dialog_open, debug_hud_visible, open_debug_dialog, toggle_debug_hud } from '../state/debug_state';
import { settings_dialog_open } from '../state/settings_state';
import { player_session, shell_state } from '../state/session_state';

// Gameplay route: a host element only (ADR-006). The canvas, RAF pump and
// audio clock are owned by the player session service; this screen renders
// lifecycle overlays that read service state. Watch mode is non-interactive:
// pause is unavailable and Escape returns to the retained results.
export const Play_Screen: Component = () => {
  const navigate = useNavigate();
  let host_element: HTMLDivElement | null = null;
  let previous_state = '';

  const watching = () => shell_state().gameplay.watching_replay;

  // Any watch exit — Escape or leaving the route, mid-run or after natural
  // completion — normalizes back to the retained results context. The guard
  // makes stop_watch unreachable here unless the flags desync, in which case
  // the page error is the visible report.
  const exit_watch = () => {
    if (!watching()) return;
    player_session()?.stop_watch();
    navigate('/results');
  };

  const watch_keydown = (event: KeyboardEvent) => {
    // Dialog Escapes belong to the modal (both also listen on window, so
    // stopPropagation cannot order them); a second Escape exits the watch.
    if (event.key === 'Escape' && !debug_dialog_open() && !settings_dialog_open()) exit_watch();
  };

  onMount(() => {
    player_session()?.attach_host(host_element!);
    window.addEventListener('keydown', watch_keydown);
  });

  // Leaving the play route pauses a live attempt so gameplay cannot continue
  // unobserved; a watch — running, interrupted or already finished — is
  // normalized back to the original results context on a fresh live session,
  // so watch/save/settings stay usable and Retry means a live retry.
  onCleanup(() => {
    window.removeEventListener('keydown', watch_keydown);
    const session = player_session();
    if (!session) return;
    if (session.view.watching_replay) {
      session.stop_watch();
      return;
    }
    session.pause();
  });

  createEffect(() => {
    const view = shell_state().gameplay;
    if (view.state === 'terminal') {
      navigate('/results');
      return;
    }
    if (previous_state !== view.state) {
      if (view.state === 'running' || view.state === 'resuming') {
        player_session()?.canvas.focus();
      } else if (view.in_attempt) {
        document.getElementById('lifecycle-panel')?.focus();
      }
      previous_state = view.state;
    }
  });

  const view = () => shell_state().gameplay;
  const panel_visible = () => view().in_attempt && view().state !== 'running' && view().state !== 'resuming';

  return (
    <main class="screen play-screen" aria-label="Gameplay">
      <div id="player" class="player" hidden={!view().in_attempt}>
        <div
          ref={(element) => {
            host_element = element;
          }}
          class="playfield-host"
          aria-label="Tapweave playfield host"
        />
        <Show when={watching()}>
          <div id="watch-banner" role="status">
            Watching replay — Escape to exit
          </div>
        </Show>
        <div class="floating-controls">
          <Show when={view().state === 'running'}>
            <button id="debug-open-running" type="button" onClick={open_debug_dialog}>
              Debug
            </button>
          </Show>
          <button id="hud-toggle" type="button" aria-pressed={debug_hud_visible()} onClick={toggle_debug_hud}>
            HUD
          </button>
        </div>
        <Show when={debug_hud_visible()}>
          <Debug_Hud />
        </Show>
        <Show when={view().state === 'running' && !watching()}>
          <button id="pause" type="button" onClick={() => player_session()?.pause()}>
            Pause
          </button>
        </Show>
        <Show when={panel_visible()}>
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
      </div>
      <Show when={!view().in_attempt}>
        <section class="panel" aria-label="Attempt finished">
          <p role="status">No active attempt.</p>
          <button type="button" onClick={() => navigate('/select')}>
            Back to selection
          </button>
        </section>
      </Show>
    </main>
  );
};
