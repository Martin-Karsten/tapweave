import { bind_player_settings } from './settings_state.js';
import { createSignal } from 'solid-js';
import { INITIAL_SHELL_STATE, Player_Session_Service, type Shell_State } from '../services/player_session.js';

// Module-level app state: Solid signals live here (and in components), never
// inside services. The service is created once per page load.

declare global {
  interface Window {
    // Browser-spec probe (mirrors the diagnostics input fixture): exposes the
    // session service so Playwright can inspect state and inject
    // deterministic clock faults on the playback clock probe.
    __tapweave_player_probe?: { session: Player_Session_Service };
  }
}

let boot_promise: Promise<void> | null = null;
let service: Player_Session_Service | null = null;
const [shell_state, set_shell_state] = createSignal<Shell_State>(INITIAL_SHELL_STATE);

export const boot_player_session = (): Promise<void> => {
  boot_promise ??= (async () => {
    try {
      const created = await Player_Session_Service.create();
      service = created;
      created.own_cleanup(bind_player_settings(created.settings));
      created.own_cleanup(created.subscribe(() => set_shell_state(created.state)));
      set_shell_state(created.state);
      window.__tapweave_player_probe = { session: created };
    } catch (error) {
      const failed_state: Shell_State = { ...INITIAL_SHELL_STATE, phase: 'boot-failed',
        boot_error: error instanceof Error ? error.message : String(error) };
      set_shell_state(failed_state);
    }
  })();
  return boot_promise;
};

// A failed boot never constructed the service: Player_Session_Service.create
// failure paths run before resource ownership is published, so a retry only
// needs to drop the cached failure and start a fresh attempt. Calling outside
// the boot-failed phase returns the existing (or resolved) boot promise, which
// also makes repeated Retry clicks idempotent through boot_player_session's
// boot_promise ??= pattern.
export const retry_boot = (): Promise<void> => {
  if (shell_state().phase !== 'boot-failed') {
    return boot_promise ?? Promise.resolve();
  }
  boot_promise = null;
  set_shell_state(INITIAL_SHELL_STATE);
  return boot_player_session();
};

export { shell_state };

// Command access for screens; null until boot finishes or fails.
export const player_session = (): Player_Session_Service | null => service;
