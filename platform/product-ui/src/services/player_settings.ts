import {
  DEFAULT_PLAYER_SETTINGS, validate_player_settings,
  type Player_Settings, type Player_Settings_Snapshot, type Player_Settings_Source,
  type Settings_Update_Result,
} from '@browser/player-settings.js';

// Shared in-memory foundation. Plan 2 owns browser persistence and runtime
// application. No storage, browser resources, or Solid reactivity live here yet.
export class Player_Settings_Service implements Player_Settings_Source {
  private current: Player_Settings_Snapshot = Object.freeze({
    settings: DEFAULT_PLAYER_SETTINGS,
    persistence: 'not-loaded',
  });
  private readonly listeners = new Set<() => void>();

  get snapshot(): Player_Settings_Snapshot { return this.current; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(changes: Partial<Omit<Player_Settings, 'version'>>): Settings_Update_Result {
    const settings: Player_Settings = Object.freeze({ ...this.current.settings, ...changes, version: 1 });
    const error = validate_player_settings(settings);
    if (error !== null) return { ok: false, error };
    this.current = Object.freeze({ settings, persistence: this.current.persistence });
    this.publish();
    return { ok: true };
  }

  reset(): void {
    this.current = Object.freeze({ settings: DEFAULT_PLAYER_SETTINGS, persistence: this.current.persistence });
    this.publish();
  }

  private publish(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
