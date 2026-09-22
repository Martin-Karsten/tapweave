import { afterEach, expect, test, vi } from 'vitest';
import { Room_Chat_Service } from '../src/services/room_chat';
import { canonical_chat_text, parse_client_message, type Chat_Message, type Client_Command } from '../shared/multiplayer';
afterEach(() => vi.useRealTimers());
const message = (message_id = 1): Chat_Message => ({ message_id, client_message_id: 'a'.repeat(32), member_id: 'member', nickname: 'Name', sent_ms: 1000, text: 'Hello' });
function fixture() {
  const commands: Client_Command[] = [];
  const chat = new Room_Chat_Service(command => { commands.push(command); return true; }, () => {});
  chat.connected();
  chat.capability(1);
  chat.receive({ version: 2, type: 'chat_history', messages: [], high_water_id: 0, final: true }, 'member');
  return { chat, commands };
}
test('plain Unicode chat normalization and protocol limits', () => {
  expect(canonical_chat_text('  hello\nworld\t👩‍💻  ')).toBe('hello world 👩‍💻');
  expect(canonical_chat_text('😀'.repeat(500))).toHaveLength(1000);
  expect(canonical_chat_text('<script>alert(1)</script>')).toContain('<script>');
  for (const text of ['', '  ', 'a'.repeat(501), '\uD800', '\uDC00', 'a\u0000b', 'a\u0085b']) {
    expect(() => canonical_chat_text(text)).toThrow();
  }
  for (const extra of [{ nickname: 'Spoof' }, { member_id: 'other' }, { sent_ms: 0 }, { client_message_id: 'bad' }]) {
    expect(() => parse_client_message(JSON.stringify({ version: 2, sequence: 1, type: 'chat_send', client_message_id: 'a'.repeat(32), text: 'hi', ...extra }))).toThrow();
  }
});
test('one pending send reconciles echo without erasing a newer draft', () => {
  const { chat, commands } = fixture();
  chat.set_draft('Hello');
  expect(chat.submit()).toBe(true);
  expect(chat.submit()).toBe(false);
  const pending_id = chat.state.pending!.client_message_id;
  chat.set_draft('next message');
  chat.receive({ version: 2, type: 'chat_message', message: { ...message(), client_message_id: pending_id } }, 'member');
  expect(chat.state.pending).toBeNull();
  expect(chat.state.draft).toBe('next message');
  expect(commands).toHaveLength(2);
  chat.dispose();
});
test('timeout never retries and reconnect history resolves uncertain delivery', () => {
  vi.useFakeTimers();
  const { chat, commands } = fixture();
  chat.set_draft('Hello');
  chat.submit();
  const pending_id = chat.state.pending!.client_message_id;
  vi.advanceTimersByTime(5000);
  expect(chat.state.pending!.uncertain).toBe(true);
  expect(commands).toHaveLength(2);
  chat.disconnected();
  chat.connected();
  chat.capability(1);
  chat.receive({ version: 2, type: 'chat_history', high_water_id: 1, final: true, messages: [{ ...message(), client_message_id: pending_id }] }, 'member');
  expect(chat.state.draft).toBe('');
  expect(chat.state.pending).toBeNull();
  chat.dispose();
});
test('history chunks are bounded, ordered and deduplicated without live announcements', () => {
  const { chat } = fixture();
  chat.receive({ version: 2, type: 'chat_history', high_water_id: 120, final: false, messages: Array.from({ length: 60 }, (_, message_index) => message(message_index + 21)) }, 'member');
  expect(chat.state.messages).toHaveLength(0);
  chat.receive({ version: 2, type: 'chat_history', high_water_id: 120, final: true, messages: Array.from({ length: 40 }, (_, message_index) => message(message_index + 81)) }, 'member');
  expect(chat.state.messages).toHaveLength(100);
  expect(chat.state.live_revision).toBe(0);
  chat.receive({ version: 2, type: 'chat_message', message: message(120) }, 'member');
  expect(chat.state.live_revision).toBe(0);
  chat.receive({ version: 2, type: 'chat_message', message: message(121) }, 'member');
  expect(chat.state.messages[0]!.message_id).toBe(22);
  expect(chat.state.truncated).toBe(true);
  chat.dispose();
});
test('chat rejection preserves draft and missing capability disables sending', () => {
  const { chat } = fixture();
  chat.set_draft('Hello'); chat.submit();
  chat.receive({ version: 2, type: 'chat_error', client_message_id: chat.state.pending!.client_message_id, code: 'REJECTED', message: 'Rejected' }, 'member');
  expect(chat.state.draft).toBe('Hello');
  expect(chat.state.pending).toBeNull();
  chat.disconnected(); chat.connected(); chat.capability();
  expect(chat.state.supported).toBe(false);
  expect(chat.submit()).toBe(false);
  chat.dispose();
});

test('a retyped identical draft is newer than the pending submission', () => {
  const { chat } = fixture();
  chat.set_draft('Hello'); chat.submit();
  const client_message_id = chat.state.pending!.client_message_id;
  chat.set_draft(''); chat.set_draft('Hello');
  chat.receive({ version: 2, type: 'chat_message', message: { ...message(), client_message_id } }, 'member');
  expect(chat.state.draft).toBe('Hello');
  chat.dispose();
});
