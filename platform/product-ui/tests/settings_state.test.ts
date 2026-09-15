import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Player_Settings_Service } from '../src/services/player_settings.js';

const session_stub = vi.hoisted(() => ({
  view: { state: 'ready' },
  pause: vi.fn(),
}));
vi.mock('../src/state/session_state.js', () => ({ player_session: () => session_stub }));

import {
  bind_player_settings, close_settings_dialog, open_settings_dialog,
  player_settings, settings_dialog_open, settings_snapshot,
} from '../src/state/settings_state.js';

describe('shared settings dialog entry points', () => {
  beforeEach(() => {
    close_settings_dialog();
    session_stub.view.state = 'ready';
    session_stub.pause.mockReset();
  });

  it('pauses through the lifecycle owner before opening and never resumes on close', () => {
    const cleanup = bind_player_settings(new Player_Settings_Service());
    session_stub.view.state = 'running';
    session_stub.pause.mockImplementation(() => { session_stub.view.state = 'paused'; });
    expect(open_settings_dialog()).toBe(true);
    expect(session_stub.pause).toHaveBeenCalledOnce();
    expect(settings_dialog_open()).toBe(true);
    close_settings_dialog();
    expect(session_stub.view.state).toBe('paused');
    cleanup();
  });

  it('does not open before binding or when pause cannot reach a safe lifecycle state', () => {
    expect(open_settings_dialog()).toBe(false);
    const cleanup = bind_player_settings(new Player_Settings_Service());
    for (const state of ['loading', 'starting', 'recovering', 'disposed', 'running']) {
      session_stub.view.state = state;
      expect(open_settings_dialog()).toBe(false);
      expect(settings_dialog_open()).toBe(false);
    }
    cleanup();
  });

  it('keeps the latest subscription when an older binding is cleaned up', () => {
    const service = new Player_Settings_Service();
    const cleanup_previous = bind_player_settings(service);
    const cleanup_current = bind_player_settings(service);
    cleanup_previous();
    expect(player_settings()).toBe(service);
    service.update({ music_volume: 25 });
    expect(settings_snapshot().settings.music_volume).toBe(25);
    cleanup_current();
    expect(player_settings()).toBe(null);
    expect(settings_snapshot().settings.music_volume).toBe(70);
  });
});
