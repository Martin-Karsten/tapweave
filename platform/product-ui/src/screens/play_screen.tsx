import { Show, createEffect, onCleanup, onMount, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Lifecycle_Panel } from './lifecycle_panel';
import { Debug_Hud } from '../components/debug_hud';
import { debug_hud_visible, open_debug_dialog, toggle_debug_hud } from '../state/debug_state';
import { player_session, shell_state } from '../state/session_state';

// Gameplay route: a host element only (ADR-006). The canvas, RAF pump and
// audio clock are owned by the player session service; this screen renders
// lifecycle overlays that read service state.
export const Play_Screen: Component = () => {
  const navigate = useNavigate();
  let host_element: HTMLDivElement | null = null;
  let previous_state = '';

  onMount(() => {
    player_session()?.attach_host(host_element!);
  });

  // Leaving the play route pauses a live attempt so gameplay cannot continue
  // unobserved; terminal/recovering/paused states are unaffected.
  onCleanup(() => {
    player_session()?.pause();
  });

  createEffect(() => {
    const view = shell_state().gameplay;
    if (view.state === 'terminal') {
      navigate('/results');
      return;
    }
    if (previous_state !== view.state) {
      if (view.state === 'running') {
        player_session()?.canvas.focus();
      } else if (view.in_attempt) {
        document.getElementById('lifecycle-panel')?.focus();
      }
      previous_state = view.state;
    }
  });

  const view = () => shell_state().gameplay;
  const panel_visible = () => view().in_attempt && view().state !== 'running';

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
        <Show when={view().state === 'running'}>
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
