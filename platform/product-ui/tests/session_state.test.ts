import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Player_Settings_Service } from '../src/services/player_settings.js';
import type { Shell_State } from '../src/services/player_session.js';

// The shell state module under test gets a fully controlled player session
// module: only INITIAL_SHELL_STATE and the create factory are consumed.
const shell_module = vi.hoisted(() => {
  const gameplay_view = Object.freeze({
    state: 'ready', can_play: false, can_resume: false, can_retry: false, can_skip: false,
    recovery: null, in_attempt: false, message: 'Starting engine…', error: null, result: null,
  });
  const booting_state: Shell_State = Object.freeze({
    phase: 'booting', boot_error: null,
    selection: Object.freeze({ state: 'empty', active: null, error: null }),
    gameplay: gameplay_view,
  });
  const ready_state: Shell_State = Object.freeze({
    phase: 'ready', boot_error: null,
    selection: Object.freeze({ state: 'empty', active: null, error: null }),
    gameplay: gameplay_view,
  });
  const create_mock = vi.fn();
  return { booting_state, ready_state, create_mock };
});

vi.mock('../src/services/player_session.js', () => ({
  INITIAL_SHELL_STATE: shell_module.booting_state,
  Player_Session_Service: { create: shell_module.create_mock },
}));

const make_service_stub = () => ({
  own_cleanup: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  state: shell_module.ready_state,
  debug: null,
  settings: new Player_Settings_Service(),
});

const load_session_state = async () => await import('../src/state/session_state.js');

describe('session boot state', () => {
  beforeEach(() => {
    vi.resetModules();
    shell_module.create_mock.mockReset();
    delete window.__tapweave_player_probe;
  });

  it('caches the boot promise so repeated calls never re-create the service', async () => {
    shell_module.create_mock.mockResolvedValue(make_service_stub());
    const session_state = await load_session_state();
    await session_state.boot_player_session();
    await session_state.boot_player_session();
    expect(shell_module.create_mock).toHaveBeenCalledOnce();
    expect(session_state.shell_state().phase).toBe('ready');
    expect(session_state.player_session()).toBe(await shell_module.create_mock.mock.results[0].value);
  });

  it('keeps a failed boot unconstructed so nothing needs disposal, and never silently re-runs', async () => {
    shell_module.create_mock.mockRejectedValue(new Error('engine missing'));
    const session_state = await load_session_state();
    await session_state.boot_player_session();
    expect(session_state.shell_state().phase).toBe('boot-failed');
    expect(session_state.shell_state().boot_error).toBe('engine missing');
    // create() failure paths precede resource ownership: no service was
    // published, so a later retry has nothing to dispose.
    expect(session_state.player_session()).toBe(null);
    await session_state.boot_player_session();
    expect(shell_module.create_mock).toHaveBeenCalledOnce();
  });

  it('retry_boot announces booting synchronously, re-creates once, and can succeed', async () => {
    shell_module.create_mock
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValueOnce(make_service_stub());
    const session_state = await load_session_state();
    await session_state.boot_player_session();
    const retry_promise = session_state.retry_boot();
    expect(session_state.shell_state().phase).toBe('booting');
    expect(session_state.shell_state().boot_error).toBe(null);
    await retry_promise;
    expect(shell_module.create_mock).toHaveBeenCalledTimes(2);
    expect(session_state.shell_state().phase).toBe('ready');
    expect(session_state.player_session()).not.toBe(null);
  });

  it('retry_boot outside boot-failed returns the existing boot promise without re-creating', async () => {
    shell_module.create_mock.mockResolvedValue(make_service_stub());
    const session_state = await load_session_state();
    const boot_promise = session_state.boot_player_session();
    await session_state.retry_boot();
    await boot_promise;
    await session_state.retry_boot();
    expect(shell_module.create_mock).toHaveBeenCalledOnce();
  });
});
