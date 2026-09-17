import { close_debug_dialog } from './debug_state.js';
import { createSignal } from 'solid-js';
import { DEFAULT_PLAYER_SETTINGS, type Player_Settings_Snapshot, type Player_Settings_Source } from '@browser/player-settings.js';
import { player_session } from './session_state.js';

const [settings_snapshot, set_settings_snapshot] = createSignal<Player_Settings_Snapshot>(Object.freeze({
  settings: DEFAULT_PLAYER_SETTINGS, persistence: 'not-loaded',
}));
const [settings_dialog_open, set_settings_dialog_open] = createSignal(false);
let settings_source: Player_Settings_Source | null = null;
let unsubscribe_settings: (() => void) | null = null;

// The page owner binds once and unregisters on disposal.
export const bind_player_settings = (source: Player_Settings_Source): (() => void) => {
  unsubscribe_settings?.();
  settings_source = source;
  const refresh = () => set_settings_snapshot(source.snapshot);
  const unsubscribe = source.subscribe(refresh);
  unsubscribe_settings = unsubscribe;
  refresh();
  return () => {
    unsubscribe();
    if (unsubscribe_settings !== unsubscribe) return;
    settings_source = null;
    unsubscribe_settings = null;
    set_settings_dialog_open(false);
    set_settings_snapshot(Object.freeze({ settings: DEFAULT_PLAYER_SETTINGS, persistence: 'not-loaded' }));
  };
};

export const player_settings = (): Player_Settings_Source | null => settings_source;

// No empty dialog is exposed: callers must wait for the settings owner to bind.
export const open_settings_dialog = (): boolean => {
  const session = player_session();
  if (settings_source === null || session === null) return false;
  // Watch playback is non-interactive and cannot pause for a modal.
  if (session.view.watching_replay) return false;
  if ((session.view.state === 'running' || session.view.state === 'resuming')) session.pause('Settings opened.');
  if (!['ready', 'paused', 'terminal'].includes(session.view.state)) return false;
  close_debug_dialog();
  set_settings_dialog_open(true);
  return true;
};

export const close_settings_dialog = (): void => { set_settings_dialog_open(false); };
export { settings_snapshot, settings_dialog_open };
