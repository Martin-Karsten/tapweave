import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_SETTINGS, gameplay_accessible_label, gameplay_control_hint, supported_hit_key } from '@browser/player-settings.js';
import { Player_Settings_Service } from '../src/services/player_settings.js';

describe('shared player settings contract', () => {
  it('rejects invalid changes atomically without notifying consumers', () => {
    const service = new Player_Settings_Service();
    const original = service.snapshot;
    let notifications = 0;
    service.subscribe(() => { notifications++; });
    for (const changes of [{ music_volume: NaN }, { effects_volume: 101 }, { music_volume: 0.5 },
      { left_key: 'Escape' }, { left_key: 'KeyX', music_volume: 10 }]) {
      expect(service.update(changes).ok).toBe(false);
      expect(service.snapshot).toBe(original);
    }
    expect(notifications).toBe(0);
  });

  it('publishes owned immutable snapshots and supports unsubscribe and reset', () => {
    const service = new Player_Settings_Service();
    let notifications = 0;
    const unsubscribe = service.subscribe(() => { notifications++; });
    const changes = { left_key: 'Space', mouse_buttons_enabled: false };
    expect(service.update(changes)).toEqual({ ok: true });
    changes.left_key = 'KeyA';
    expect(service.snapshot.settings.left_key).toBe('Space');
    expect(Object.isFrozen(service.snapshot.settings)).toBe(true);
    expect(Object.isFrozen(service.snapshot)).toBe(true);
    expect(gameplay_control_hint(service.snapshot.settings)).toBe('Space / X · Escape to pause');
    expect(gameplay_accessible_label(service.snapshot.settings)).not.toContain('mouse');
    unsubscribe();
    service.reset();
    expect(service.snapshot.settings).toEqual(DEFAULT_PLAYER_SETTINGS);
    expect(service.snapshot.persistence).toBe('not-loaded');
    expect(notifications).toBe(1);
  });

  it('supports the agreed physical keys and excludes navigation and system shortcuts', () => {
    for (const key_code of ['KeyA', 'KeyZ', 'Digit0', 'Digit9', 'ArrowLeft', 'Space']) {
      expect(supported_hit_key(key_code)).toBe(true);
    }
    for (const key_code of ['Tab', 'Enter', 'Escape', 'F1', 'ShiftLeft', 'MetaLeft', 'KeyAA', '']) {
      expect(supported_hit_key(key_code)).toBe(false);
    }
    expect(gameplay_control_hint(DEFAULT_PLAYER_SETTINGS)).toBe('Z / X or mouse buttons · Escape to pause');
  });
});
