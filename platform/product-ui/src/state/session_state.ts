import { createSignal } from 'solid-js';
import { INITIAL_SHELL_STATE, Player_Session_Service, type Shell_State } from '../services/player_session.js';

// Module-level app state: Solid signals live here (and in components), never
// inside services. The service is created once per page load.
let boot_promise: Promise<void> | null = null;
let service: Player_Session_Service | null = null;
const [shell_state, set_shell_state] = createSignal<Shell_State>(INITIAL_SHELL_STATE);

export const boot_player_session = (): Promise<void> => {
  boot_promise ??= (async () => {
    try {
      const created = await Player_Session_Service.create();
      service = created;
      created.subscribe(() => set_shell_state(created.state));
      set_shell_state(created.state);
    } catch (error) {
      const failed_state: Shell_State = { ...INITIAL_SHELL_STATE, phase: 'boot-failed',
        boot_error: error instanceof Error ? error.message : String(error) };
      set_shell_state(failed_state);
    }
  })();
  return boot_promise;
};

export { shell_state };

// Command access for screens; null until boot finishes or fails.
export const player_session = (): Player_Session_Service | null => service;
