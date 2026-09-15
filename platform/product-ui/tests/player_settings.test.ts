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

describe('persistent player settings', () => {
  const storage_fixture = (initial: string | null = null) => {
    let stored = initial;
    return { getItem: () => stored, setItem: (_key: string, text: string) => { stored = text; } };
  };

  it('reads once, defaults invalid fields individually and invalid binding pairs together', () => {
    const storage = storage_fixture(JSON.stringify({ version: 1, music_volume: 0, effects_volume: 100.5,
      left_key: 'Space', right_key: 'Space', mouse_buttons_enabled: false, offset: 123 }));
    const service = new Player_Settings_Service(storage);
    expect(service.snapshot.settings).toEqual({ ...DEFAULT_PLAYER_SETTINGS, music_volume: 0, mouse_buttons_enabled: false });
    storage.setItem('', JSON.stringify({ ...DEFAULT_PLAYER_SETTINGS, music_volume: 100 }));
    expect(service.snapshot.settings.music_volume).toBe(0);
    expect(service.snapshot.persistence).toBe('saved');
  });

  it('reloads committed settings and reset, without persisting arbitrary fields', () => {
    const storage = storage_fixture();
    const service = new Player_Settings_Service(storage);
    service.update({ music_volume: 0, effects_volume: 100, left_key: 'ArrowLeft', right_key: 'Digit0' });
    expect(new Player_Settings_Service(storage).snapshot.settings).toEqual(service.snapshot.settings);
    service.update({ offset: 12 } as never);
    expect(storage.getItem()).not.toContain('offset');
    service.reset();
    expect(new Player_Settings_Service(storage).snapshot.settings).toEqual(DEFAULT_PLAYER_SETTINGS);
  });

  it('preserves unknown versions and corrupt data until an explicit command', () => {
    for (const text of ['{', 'null', '[]', JSON.stringify({ version: 2, music_volume: 3, future: true })]) {
      const storage = storage_fixture(text);
      const service = new Player_Settings_Service(storage);
      expect(service.snapshot.settings).toEqual(DEFAULT_PLAYER_SETTINGS);
      expect(storage.getItem()).toBe(text);
      service.update({ music_volume: 101 });
      expect(storage.getItem()).toBe(text);
      service.reset();
      expect(JSON.parse(storage.getItem()!)).toEqual(DEFAULT_PLAYER_SETTINGS);
    }
  });

  it('survives storage access/read/write failures, publishes memory edits, and recovers writes', () => {
    const inaccessible = new Player_Settings_Service(() => { throw Error('blocked'); });
    inaccessible.update({ music_volume: 0 });
    expect(inaccessible.snapshot.persistence).toBe('unavailable');
    expect(inaccessible.snapshot.settings.music_volume).toBe(0);
    let blocked = true;
    const storage = { getItem: () => { throw Error('read blocked'); }, setItem: () => { if (blocked) throw Error('full'); } };
    const service = new Player_Settings_Service(storage);
    service.update({ effects_volume: 0 });
    expect(service.snapshot.persistence).toBe('unavailable');
    expect(service.snapshot.settings.effects_volume).toBe(0);
    blocked = false;
    service.reset();
    expect(service.snapshot.persistence).toBe('saved');
  });
});
