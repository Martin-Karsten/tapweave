import { For, createEffect, onCleanup, onMount, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Brand_Mark } from '../components/brand_mark';
import { debug_dialog_open } from '../state/debug_state';
import { settings_dialog_open } from '../state/settings_state';
import { shell_state } from '../state/session_state';

interface Menu_Entry {
  readonly id: string;
  readonly label: string;
  readonly target: string;
}

// Lazer MainMenu structure (structure reference only): the pulsing logo
// anchors the center while every rendered column action is live.
const MENU_ENTRIES: readonly Menu_Entry[] = [
  { id: 'menu-play', label: 'Play', target: '/select' },
  { id: 'menu-multiplayer', label: 'Multiplayer', target: '/multiplayer' },
  { id: 'menu-diagnostics', label: 'Diagnostics', target: '/diagnostics' },
];

export const Main_Menu_Screen: Component = () => {
  const navigate = useNavigate();
  let menu_nav: HTMLElement | undefined;

  createEffect((previously_ready: boolean | undefined) => {
    const ready = shell_state().phase === 'ready';
    if (ready && !previously_ready) {
      document.getElementById('menu-play')?.focus();
    }
    return ready;
  }, undefined);

  const menu_buttons = (): HTMLButtonElement[] =>
    menu_nav ? [...menu_nav.querySelectorAll<HTMLButtonElement>('button')] : [];

  const focus_menu_button = (from_index: number, step: number): void => {
    const buttons = menu_buttons();
    if (buttons.length === 0) return;
    const next_index =
      from_index < 0
        ? step > 0
          ? 0
          : buttons.length - 1
        : (from_index + step + buttons.length) % buttons.length;
    buttons[next_index]?.focus();
  };

  const handle_menu_keydown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const focused_button = document.activeElement;
    const from_index =
      focused_button instanceof HTMLButtonElement ? menu_buttons().indexOf(focused_button) : -1;
    focus_menu_button(from_index, step);
  };

  onMount(() => {
    const handle_window_keydown = (event: KeyboardEvent): void => {
      if (settings_dialog_open() || debug_dialog_open()) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key !== 'p' && event.key !== 'P') return;
      if (event.repeat) return;
      event.preventDefault();
      navigate('/select');
    };
    window.addEventListener('keydown', handle_window_keydown);
    onCleanup(() => window.removeEventListener('keydown', handle_window_keydown));
  });

  return (
    <main class="screen menu-screen" aria-label="Main menu">
      <div class="menu-logo">
        <Brand_Mark />
        <h1 class="wordmark-title">
          tapweave<span class="brand-dot">●</span>
        </h1>
      </div>
      <nav
        class="menu-buttons"
        aria-label="Main menu"
        ref={menu_nav}
        onKeyDown={handle_menu_keydown}
      >
        <For each={MENU_ENTRIES}>
          {(entry) => (
            <button
              id={entry.id}
              type="button"
              data-menu-target={entry.target}
              onClick={() => navigate(entry.target)}
            >
              {entry.label}
            </button>
          )}
        </For>
      </nav>
    </main>
  );
};
