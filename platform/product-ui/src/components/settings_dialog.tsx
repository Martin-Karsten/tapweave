import { player_session } from '../state/session_state.js';
import { For, Show, createEffect, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import { fullscreen_owns_escape, install_fullscreen_escape_guard } from '@browser/fullscreen.js';
import { hit_key_label, supported_hit_key } from '@browser/player-settings.js';
import { close_settings_dialog, player_settings, settings_dialog_open, settings_snapshot } from '../state/settings_state.js';

type Binding_Field = 'left_key' | 'right_key';

export const Settings_Dialog: Component = () => {
  const [capturing, set_capturing] = createSignal<Binding_Field | null>(null);
  const [announcement, set_announcement] = createSignal('');
  let dialog: HTMLDialogElement | undefined;
  let opener: HTMLElement | null = null;
  const settings = () => settings_snapshot().settings;

  createEffect(() => {
    if (settings_dialog_open()) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      set_capturing(null);
      set_announcement('Changes apply immediately. Closing settings does not resume play.');
      dialog?.showModal();
    } else if (dialog?.open) {
      dialog.close();
      set_capturing(null);
      if (opener?.isConnected) opener.focus();
      opener = null;
    }
  });

  const cancel_capture = () => {
    set_capturing(null);
    set_announcement('Key capture cancelled.');
  };

  onMount(() => {
    const listeners = new AbortController();
    install_fullscreen_escape_guard(document);
    window.addEventListener('keydown', event => {
      if (!settings_dialog_open()) return;
      player_session()?.quarantine_input(event.code);
      // Keep other window observers (physical held-state tracking) alive, but
      // never deliver modal keys to the canvas, route panels or document.
      event.stopPropagation();
      if (event.code === 'Escape') {
        event.preventDefault();
        if (event.repeat) return;
        // The browser's fullscreen-exit Escape must not also close the modal.
        if (fullscreen_owns_escape()) return;
        if (capturing()) cancel_capture();
        else close_settings_dialog();
        return;
      }
      const binding = capturing();
      if (binding === null) {
        if (event.code === 'Tab' && dialog) {
          const controls = [...dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')]
            .filter(control => !control.disabled && !control.hidden);
          const focused_index = controls.indexOf(document.activeElement as HTMLButtonElement | HTMLInputElement);
          if (controls.length && (focused_index < 0 ||
            (!event.shiftKey && focused_index === controls.length - 1) || (event.shiftKey && focused_index === 0))) {
            event.preventDefault();
            controls[event.shiftKey ? controls.length - 1 : 0].focus();
          }
        }
        return;
      }
      event.preventDefault();
      if (event.repeat) return;
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || !supported_hit_key(event.code)) {
        set_announcement('Use a single letter, digit, arrow key or Space, without modifiers. Escape cancels.');
        return;
      }
      const result = player_settings()?.update({ [binding]: event.code });
      if (!result?.ok) {
        set_announcement('That key is already assigned. Choose a different key.');
        return;
      }
      set_capturing(null);
      set_announcement(`${binding === 'left_key' ? 'Left' : 'Right'} hit key set to ${hit_key_label(event.code)}.`);
    }, { capture: true, signal: listeners.signal });
    window.addEventListener('pointerdown', event => {
      if (settings_dialog_open() && event.pointerType === 'mouse') player_session()?.quarantine_input(`mouse:${event.button}`);
    }, { capture: true, signal: listeners.signal });
    window.addEventListener('keyup', event => {
      if (settings_dialog_open()) event.stopPropagation();
    }, { capture: true, signal: listeners.signal });
    window.addEventListener('blur', () => {
      if (capturing()) cancel_capture();
    }, { signal: listeners.signal });
    onCleanup(() => listeners.abort());
  });

  return <dialog ref={dialog} class="settings-dialog" aria-labelledby="settings-title"
    onCancel={event => { event.preventDefault(); if (fullscreen_owns_escape()) return; if (capturing()) cancel_capture(); else close_settings_dialog(); }}>
    <h2 id="settings-title">Settings</h2>
    <fieldset>
      <legend>Audio</legend>
      <For each={['music_volume', 'effects_volume'] as const}>{field =>
        <label class="settings-volume">
          {field === 'music_volume' ? 'Music' : 'Effects'}
          <input type="range" min="0" max="100" step="1" value={settings()[field]}
            aria-valuetext={`${settings()[field]} percent${settings()[field] === 0 ? ', muted' : ''}`}
            onChange={event => player_settings()?.update({ [field]: Number(event.currentTarget.value) })} />
          <output>{settings()[field]}%{settings()[field] === 0 ? ' (muted)' : ''}</output>
        </label>
      }</For>
    </fieldset>
    <fieldset>
      <legend>Controls</legend>
      <p>Physical key positions apply regardless of keyboard layout. Use letters, digits, arrows or Space.</p>
      <For each={['left_key', 'right_key'] as const}>{field =>
        <button type="button" aria-pressed={capturing() === field}
          onClick={() => { set_capturing(field); set_announcement('Press one key. Escape cancels.'); }}>
          {field === 'left_key' ? 'Left' : 'Right'} hit key: {hit_key_label(settings()[field])}
          {capturing() === field ? ' — press a key' : ''}
        </button>
      }</For>
      <label class="settings-mouse"><input type="checkbox" checked={settings().mouse_buttons_enabled}
        onChange={event => player_settings()?.update({ mouse_buttons_enabled: event.currentTarget.checked })} />
        Mouse buttons hit objects</label>
      <p>Aiming with the pointer remains active when mouse hits are disabled.</p>
    </fieldset>
    <p role="status" aria-label="Settings status">{announcement()}</p>
    <Show when={settings_snapshot().persistence === 'unavailable'}>
      <p role="alert">Settings apply for this visit but could not be saved.</p>
    </Show>
    <div class="settings-actions">
      <button type="button" onClick={() => {
        set_capturing(null); player_settings()?.reset(); set_announcement('Default settings restored.');
      }}>Reset to defaults</button>
      <button type="button" onClick={close_settings_dialog}>Close settings</button>
    </div>
  </dialog>;
};
