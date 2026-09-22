import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup } from '@solidjs/testing-library';
import { Room_Chat } from '../src/components/room_chat';
import { empty_chat_state } from '../src/services/room_chat';
afterEach(() => { cleanup(); vi.useRealTimers(); });
function fixture(initial_activity: 'playing' | 'break' = 'playing') {
  const [activity, set_activity] = createSignal<'playing' | 'break'>(initial_activity);
  const [state, set_state] = createSignal({ ...empty_chat_state(), supported: true, ready: true });
  const playfield = document.createElement('canvas');
  playfield.tabIndex = 0;
  const ownership = vi.fn();
  const submit = vi.fn(() => true);
  const view = render(() => <Room_Chat state={state()} member_id="member" gameplay activity={activity()}
    set_draft={draft => set_state({ ...state(), draft })} submit={submit} set_text_input_active={ownership} focus_playfield={() => playfield.focus()} />);
  view.container.appendChild(playfield);
  const composer = view.getByLabelText('Message') as HTMLInputElement;
  const key = (code: string, fields = {}) => fireEvent.keyDown(composer === document.activeElement ? composer : window, { code, ...fields });
  return { view, composer, set_activity, set_state, state, ownership, submit, key };
}
// Ports the five focus scenarios in pinned TestSceneGameplayChatDisplay.
test('collapsed active chat opens on Enter and closes on empty Enter', () => {
  vi.useFakeTimers();
  const chat = fixture();
  expect(chat.view.container.querySelector('.room-chat-collapsed')).toBeTruthy();
  chat.key('Enter');
  expect(document.activeElement).toBe(chat.composer);
  expect(chat.ownership).toHaveBeenLastCalledWith(true);
  chat.key('Enter');
  expect(document.activeElement).not.toBe(chat.composer);
  vi.advanceTimersByTime(600);
  expect(chat.view.container.querySelector('.room-chat-collapsed')).toBeTruthy();
});
test('expanded break chat focuses on Enter, then drops focus at gameplay and never restores it automatically', () => {
  const chat = fixture('break');
  chat.key('Enter');
  expect(document.activeElement).toBe(chat.composer);
  chat.set_activity('playing');
  expect(document.activeElement).not.toBe(chat.composer);
  chat.set_activity('break');
  expect(document.activeElement).not.toBe(chat.composer);
  expect(chat.view.container.querySelector('.room-chat-collapsed')).toBeNull();
});
test('Escape dismisses active chat and active pointer interaction is disabled', () => {
  const chat = fixture();
  chat.key('Enter');
  expect(chat.view.container.querySelector('.room-chat-active')).toBeTruthy();
  chat.key('Escape');
  expect(document.activeElement).not.toBe(chat.composer);
  expect(chat.ownership).toHaveBeenLastCalledWith(false);
});
test('active sends release focus; break sends retain it; IME and repeats never submit', () => {
  const chat = fixture();
  chat.key('Enter');
  fireEvent.input(chat.composer, { target: { value: 'hello' } });
  chat.key('Enter', { isComposing: true });
  chat.key('Enter', { repeat: true });
  expect(chat.submit).not.toHaveBeenCalled();
  chat.key('Enter');
  expect(chat.submit).toHaveBeenCalledOnce();
  expect(document.activeElement).not.toBe(chat.composer);
  chat.set_activity('break');
  chat.key('Enter'); chat.key('Enter');
  expect(chat.submit).toHaveBeenCalledTimes(2);
  expect(document.activeElement).toBe(chat.composer);
});
test('messages render literally and initial history is not announced', () => {
  const chat = fixture('break');
  chat.set_state({ ...chat.state(), messages: [{ message_id: 1, client_message_id: 'a', member_id: 'other', nickname: 'Other', sent_ms: 1000, text: '<img src=x onerror=alert(1)>' }] });
  expect(chat.view.container.querySelector('img')).toBeNull();
  expect(chat.view.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  expect(chat.view.container.querySelector('[aria-live="polite"]')?.textContent).toBe('');
});

test('disconnect releases input ownership and keeps the draft', () => {
  const chat = fixture();
  chat.key('Enter');
  fireEvent.input(chat.composer, { target: { value: 'unfinished' } });
  chat.set_state({ ...chat.state(), ready: false });
  expect(document.activeElement).not.toBe(chat.composer);
  expect(chat.ownership).toHaveBeenLastCalledWith(false);
  expect(chat.state().draft).toBe('unfinished');
});
