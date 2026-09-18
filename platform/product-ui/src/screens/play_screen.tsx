import { Show, createEffect, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { fullscreen_owns_escape, install_fullscreen_escape_guard } from '@browser/fullscreen.js';
import { Lifecycle_Panel } from './lifecycle_panel';
import { Debug_Hud } from '../components/debug_hud';
import { debug_dialog_open, debug_hud_visible, open_debug_dialog, toggle_debug_hud } from '../state/debug_state';
import { open_settings_dialog, settings_dialog_open } from '../state/settings_state';
import { player_session, shell_state } from '../state/session_state';

// Gameplay route: a host element only (ADR-006). The canvas, RAF pump and
// audio clock are owned by the player session service; this screen renders
// lifecycle overlays that read service state. Watch mode is non-interactive:
// pause is unavailable and Escape returns to the retained results.
export const Play_Screen: Component = () => {
  const navigate = useNavigate();
  let host_element: HTMLDivElement | null = null;
  let player_element: HTMLDivElement | null = null;
  let previous_state = '';
  const [fullscreen_active, set_fullscreen_active] = createSignal(false);
  const [fullscreen_available, set_fullscreen_available] = createSignal(false);

  const watching = () => shell_state().gameplay.watching_replay;

  // The fullscreened element is the player wrapper, not the bare canvas host:
  // the floating controls, pause/skip affordances and lifecycle overlays stay
  // reachable inside the top layer. The engine repaints on fullscreenchange
  // (viewport refresh in the gameplay controller); nothing here advances play.
  const toggle_fullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    if (player_element) void player_element.requestFullscreen().catch(() => {});
  };

  const sync_fullscreen = () => set_fullscreen_active(document.fullscreenElement === player_element);

  // Any watch exit — Escape or leaving the route, mid-run or after natural
  // completion — normalizes back to the retained results context. The guard
  // makes stop_watch unreachable here unless the flags desync, in which case
  // the page error is the visible report.
  const exit_watch = () => {
    if (!watching()) return;
    player_session()?.stop_watch();
    navigate('/results');
  };

  const play_keydown = (event: KeyboardEvent) => {
    // Dialog Escapes belong to the modal (both also listen on window, so
    // stopPropagation cannot order them); the browser's fullscreen-exit
    // Escape belongs to the browser in whichever order the engine delivers
    // the exit and the keydown. A second, windowed Escape exits the watch.
    if (event.key === 'Escape' && !fullscreen_owns_escape() && !debug_dialog_open() && !settings_dialog_open()) exit_watch();
    if (event.code !== 'Space') return;
    // The key actuates the #skip affordance under its exact visibility gate,
    // mirroring lazer's InputKey.Space -> GlobalAction.SkipCutscene binding
    // (whose handler clicks the same overlay button). A Space bound as a hit
    // key keeps its gameplay binding; repeats and modifiers are ignored like
    // lazer's IKeyBindingHandler, and open dialogs own the keyboard.
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (debug_dialog_open() || settings_dialog_open()) return;
    const settings = player_session()?.settings.snapshot.settings;
    if (!settings || settings.left_key === 'Space' || settings.right_key === 'Space') return;
    if (view().state !== 'running' || !view().can_skip) return;
    event.preventDefault();
    player_session()?.skip();
  };

  onMount(() => {
    player_session()?.attach_host(host_element!);
    install_fullscreen_escape_guard(document);
    set_fullscreen_available(document.fullscreenEnabled);
    sync_fullscreen();
    document.addEventListener('fullscreenchange', sync_fullscreen);
    window.addEventListener('keydown', play_keydown);
  });

  // Leaving the play route pauses a live attempt so gameplay cannot continue
  // unobserved; a watch — running, interrupted or already finished — is
  // normalized back to the original results context on a fresh live session,
  // so watch/save/settings stay usable and Retry means a live retry. Leaving
  // the route also drops the fullscreened player element, so the browser ends
  // fullscreen on its own; no explicit exit is needed here.
  onCleanup(() => {
    document.removeEventListener('fullscreenchange', sync_fullscreen);
    window.removeEventListener('keydown', play_keydown);
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
      <div
        id="player"
        class="player"
        hidden={!view().in_attempt}
        ref={(element) => {
          player_element = element;
        }}
      >
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
          {/* The frame footer (with its Settings entry) stays hidden on the
              gameplay route, so idle and paused attempts reach the same dialog
              here; running attempts never see it, mirroring the footer. */}
          <Show when={!watching() && ['ready', 'paused'].includes(view().state)}>
            <button
              id="settings-open-play"
              type="button"
              onClick={(event) => {
                event.currentTarget.focus();
                open_settings_dialog();
              }}
            >
              Settings
            </button>
          </Show>
          <Show when={fullscreen_available()}>
            <button
              id="fullscreen-toggle"
              type="button"
              aria-pressed={fullscreen_active()}
              onClick={toggle_fullscreen}
            >
              {fullscreen_active() ? 'Exit fullscreen' : 'Fullscreen'}
            </button>
          </Show>
        </div>
        <Show when={debug_hud_visible()}>
          <Debug_Hud />
        </Show>
        <Show when={view().state === 'running' && !watching()}>
          <button id="pause" type="button" onClick={() => player_session()?.pause()}>
            Pause
          </button>
        </Show>
        {/* Lazer SkipOverlay parity: outside the canvas so its pointer events
            never enter the gameplay input surface. */}
        <Show when={view().state === 'running' && view().can_skip}>
          <button id="skip" type="button" onClick={() => player_session()?.skip()}>
            Skip
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
