import { settings_dialog_open } from './settings_state.js';
import { createSignal } from 'solid-js';
import { player_session } from './session_state.js';
import type { Debug_Session_Service } from '../services/debug_session.js';

// Debug UI state (ADR-006): signals live here, never inside services. The
// service is bound once after boot; its throttled publishes bump
// debug_view_version so components re-pull plain snapshots.

let debug_service: Debug_Session_Service | null = null;
const [debug_dialog_open, set_debug_dialog_open] = createSignal(false);
const [debug_hud_visible, set_debug_hud_visible] = createSignal(false);
const [debug_view_version, set_debug_view_version] = createSignal(0);

export const bind_debug_session = (service: Debug_Session_Service) => {
  if (debug_service !== null) return;
  debug_service = service;
  service.subscribe_view(() => set_debug_view_version(version => version + 1));
};

export const debug_session = (): Debug_Session_Service | null => debug_service;

// Opening the panel while running requests the normal pause path first, so
// gameplay state changes stay owned by the gameplay controller.
export const open_debug_dialog = () => {
  if (settings_dialog_open()) return;
  const session = player_session();
  if ((session?.view.state === 'running' || session?.view.state === 'resuming')) session.pause('Debug panel opened.');
  set_debug_dialog_open(true);
};

export const close_debug_dialog = () => {
  set_debug_dialog_open(false);
};

export const toggle_debug_hud = () => {
  const enabled = !debug_hud_visible();
  set_debug_hud_visible(enabled);
  if (enabled) debug_service?.diagnostics.record_event('lifecycle', 'info', 'hud', 'Live HUD enabled.');
};

// Best-effort shortcuts: browsers may reserve or drop function-key chords, so
// visible controls remain the required path.
export const register_debug_shortcuts = () => {
  window.addEventListener('keydown', event => {
    if (settings_dialog_open()) return;
    if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (event.code === 'F10') {
      event.preventDefault();
      if (debug_dialog_open()) close_debug_dialog();
      else open_debug_dialog();
    } else if (event.code === 'F11') {
      event.preventDefault();
      toggle_debug_hud();
    }
  }, { capture: true });
};

export { debug_dialog_open, debug_hud_visible, debug_view_version };
