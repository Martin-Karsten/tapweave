// Shared product policy, not engine judgement or clock configuration.
export const PLAYER_SETTINGS_VERSION = 1;
export const PLAYER_SETTINGS_STORAGE_KEY = 'tapweave.player-settings.v1';

export interface Gameplay_Input_Settings {
  readonly left_key: string;
  readonly right_key: string;
  readonly mouse_buttons_enabled: boolean;
}

export interface Player_Settings extends Gameplay_Input_Settings {
  readonly version: 1;
  readonly music_volume: number;
  readonly effects_volume: number;
}

export const DEFAULT_PLAYER_SETTINGS: Player_Settings = Object.freeze({
  version: PLAYER_SETTINGS_VERSION,
  music_volume: 70,
  effects_volume: 80,
  left_key: 'KeyZ',
  right_key: 'KeyX',
  mouse_buttons_enabled: true,
});

export type Settings_Validation_Error = 'INVALID_VOLUME' | 'INVALID_BINDINGS' | 'INVALID_MOUSE_SETTING';
export type Settings_Update_Result =
  { readonly ok: true } | { readonly ok: false; readonly error: Settings_Validation_Error };

export interface Player_Settings_Snapshot {
  readonly settings: Player_Settings;
  readonly persistence: 'not-loaded' | 'saved' | 'unavailable';
}

export interface Player_Settings_Source {
  readonly snapshot: Player_Settings_Snapshot;
  subscribe(listener: () => void): () => void;
  update(changes: Partial<Omit<Player_Settings, 'version'>>): Settings_Update_Result;
  reset(): void;
}

export const supported_hit_key = (key_code: string): boolean =>
  /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space)$/.test(key_code);

export const validate_player_settings = (settings: Player_Settings): Settings_Validation_Error | null => {
  if (![settings.music_volume, settings.effects_volume].every(volume =>
    Number.isInteger(volume) && volume >= 0 && volume <= 100)) return 'INVALID_VOLUME';
  if (!supported_hit_key(settings.left_key) || !supported_hit_key(settings.right_key) ||
    settings.left_key === settings.right_key) return 'INVALID_BINDINGS';
  if (typeof settings.mouse_buttons_enabled !== 'boolean') return 'INVALID_MOUSE_SETTING';
  return null;
};

export const hit_key_label = (key_code: string): string => {
  if (/^Key[A-Z]$/.test(key_code)) return key_code.slice(3);
  if (/^Digit[0-9]$/.test(key_code)) return key_code.slice(5);
  if (key_code.startsWith('Arrow')) return `${key_code.slice(5)} arrow`;
  return key_code;
};

export const gameplay_control_hint = (settings: Gameplay_Input_Settings): string =>
  `${hit_key_label(settings.left_key)} / ${hit_key_label(settings.right_key)}` +
  `${settings.mouse_buttons_enabled ? ' or mouse buttons' : ''} · Escape to pause`;

export const gameplay_accessible_label = (settings: Gameplay_Input_Settings): string =>
  `Tapweave playfield. ${hit_key_label(settings.left_key)} and ${hit_key_label(settings.right_key)}` +
  `${settings.mouse_buttons_enabled ? ' or mouse buttons' : ''} to play. Escape pauses.`;
