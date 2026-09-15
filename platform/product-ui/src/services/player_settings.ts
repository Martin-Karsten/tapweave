import {
  DEFAULT_PLAYER_SETTINGS, PLAYER_SETTINGS_STORAGE_KEY, supported_hit_key, validate_player_settings,
  type Player_Settings, type Player_Settings_Snapshot, type Player_Settings_Source,
  type Settings_Update_Result,
} from '@browser/player-settings.js';

export interface Settings_Storage {
  getItem(key: string): string | null;
  setItem(key: string, text: string): void;
}

const valid_volume = (volume: unknown): volume is number =>
  typeof volume === 'number' && Number.isInteger(volume) && volume >= 0 && volume <= 100;

// Reads once. Unknown versions are never rewritten until an explicit edit/reset.
// Storage is injected; the service has no browser globals or reactive runtime.
export class Player_Settings_Service implements Player_Settings_Source {
  private current: Player_Settings_Snapshot;
  private storage: Settings_Storage | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(storage?: Settings_Storage | (() => Settings_Storage)) {
    let settings = DEFAULT_PLAYER_SETTINGS;
    let persistence: Player_Settings_Snapshot['persistence'] = 'not-loaded';
    if (storage !== undefined) {
      try {
        this.storage = typeof storage === 'function' ? storage() : storage;
        const text = this.storage.getItem(PLAYER_SETTINGS_STORAGE_KEY);
        let record: unknown = null;
        try { record = text === null ? null : JSON.parse(text); } catch { /* Corrupt preferences use defaults. */ }
        if (record !== null && typeof record === 'object' && 'version' in record && record.version === 1) {
          const fields = record as Record<string, unknown>;
          const valid_bindings = typeof fields.left_key === 'string' && supported_hit_key(fields.left_key) &&
            typeof fields.right_key === 'string' && supported_hit_key(fields.right_key) && fields.left_key !== fields.right_key;
          settings = Object.freeze({ version: 1,
            music_volume: valid_volume(fields.music_volume) ? fields.music_volume : DEFAULT_PLAYER_SETTINGS.music_volume,
            effects_volume: valid_volume(fields.effects_volume) ? fields.effects_volume : DEFAULT_PLAYER_SETTINGS.effects_volume,
            left_key: valid_bindings ? fields.left_key as string : DEFAULT_PLAYER_SETTINGS.left_key,
            right_key: valid_bindings ? fields.right_key as string : DEFAULT_PLAYER_SETTINGS.right_key,
            mouse_buttons_enabled: typeof fields.mouse_buttons_enabled === 'boolean' ? fields.mouse_buttons_enabled : true });
        }
        persistence = 'saved';
      } catch { persistence = 'unavailable'; }
    }
    this.current = Object.freeze({ settings, persistence });
  }

  get snapshot(): Player_Settings_Snapshot { return this.current; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(changes: Partial<Omit<Player_Settings, 'version'>>): Settings_Update_Result {
    const candidate = { ...this.current.settings, ...changes };
    // Copy only agreed fields: no offsets or arbitrary caller properties persist.
    const settings: Player_Settings = Object.freeze({ version: 1, music_volume: candidate.music_volume,
      effects_volume: candidate.effects_volume, left_key: candidate.left_key, right_key: candidate.right_key,
      mouse_buttons_enabled: candidate.mouse_buttons_enabled });
    const error = validate_player_settings(settings);
    if (error !== null) return { ok: false, error };
    this.commit(settings);
    return { ok: true };
  }

  reset(): void { this.commit(DEFAULT_PLAYER_SETTINGS); }

  private commit(settings: Player_Settings): void {
    let persistence = this.current.persistence;
    if (this.storage !== null) {
      try {
        this.storage.setItem(PLAYER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        persistence = 'saved';
      } catch { persistence = 'unavailable'; }
    }
    this.current = Object.freeze({ settings, persistence });
    for (const listener of [...this.listeners]) listener();
  }
}
