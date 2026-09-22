import { canonical_chat_text, CHAT_HISTORY_LIMIT, type Chat_Message, type Client_Command, type Server_Message } from '../../shared/multiplayer';

export interface Room_Chat_State {
  messages: readonly Chat_Message[];
  draft: string;
  ready: boolean;
  supported: boolean;
  truncated: boolean;
  error: string | null;
  pending: { client_message_id: string; text: string; draft: string; draft_revision: number; uncertain: boolean } | null;
  live_revision: number;
}
export const empty_chat_state = (): Room_Chat_State => ({
  messages: [], draft: '', ready: false, supported: false, truncated: false,
  error: null, pending: null, live_revision: 0,
});

// Framework-independent delivery state. Chat failures never become room failures.
export class Room_Chat_Service {
  state = empty_chat_state();
  private subscribed = false;
  private draft_revision = 0;
  private history: Chat_Message[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private send: (command: Client_Command) => boolean, private changed: () => void) {}
  private publish(changes: Partial<Room_Chat_State>) {
    this.state = { ...this.state, ...changes };
    this.changed();
  }
  set_draft(draft: string) {
    this.draft_revision++;
    this.publish({ draft });
  }
  connected() {
    this.subscribed = false;
    this.history = [];
    this.publish({ ready: false });
  }
  capability(version?: 1) {
    this.publish({ supported: version === 1 });
    if (version === 1 && !this.subscribed) {
      this.subscribed = this.send({ type: 'chat_subscribe' });
    }
  }
  disconnected() {
    clearTimeout(this.timer);
    this.subscribed = false;
    this.publish({ ready: false, pending: this.state.pending ? { ...this.state.pending, uncertain: true } : null });
  }
  submit() {
    if (!this.state.ready || (this.state.pending && !this.state.pending.uncertain)) return false;
    let text: string;
    try { text = canonical_chat_text(this.state.draft); }
    catch (error) {
      this.publish({ error: (error as Error).message });
      return false;
    }
    const client_message_id = crypto.randomUUID().replaceAll('-', '');
    if (!this.send({ type: 'chat_send', client_message_id, text })) {
      this.publish({ ready: false, error: 'Reconnect before sending.' });
      return false;
    }
    clearTimeout(this.timer);
    this.publish({ pending: { client_message_id, text, draft: this.state.draft, draft_revision: this.draft_revision, uncertain: false }, error: null });
    this.timer = setTimeout(() => {
      if (this.state.pending?.client_message_id === client_message_id) {
        this.publish({ pending: { ...this.state.pending, uncertain: true }, error: 'Delivery not confirmed. Resending may create a duplicate.' });
      }
    }, 5000);
    return true;
  }
  private reconcile(messages: readonly Chat_Message[], member_id: string) {
    const pending = this.state.pending;
    if (pending && messages.some(message => message.member_id === member_id && message.client_message_id === pending.client_message_id)) {
      clearTimeout(this.timer);
      this.state = { ...this.state, pending: null, error: null,
        draft: this.draft_revision === pending.draft_revision ? '' : this.state.draft };
    }
  }
  receive(event: Server_Message, member_id: string): boolean {
    if (event.type === 'chat_error') {
      if (event.client_message_id === this.state.pending?.client_message_id) {
        clearTimeout(this.timer);
        this.publish({ pending: null, error: event.message });
      } else if (event.client_message_id === null) this.publish({ error: event.message });
      return true;
    }
    if (event.type === 'chat_history') {
      this.history = [...this.history, ...event.messages].slice(-CHAT_HISTORY_LIMIT);
      if (event.final) {
        this.reconcile(this.history, member_id);
        const messages = merge_messages(this.history);
        this.publish({ messages, ready: true, truncated: event.high_water_id > CHAT_HISTORY_LIMIT,
          ...(this.state.pending ? { pending: { ...this.state.pending, uncertain: true }, error: 'Delivery not confirmed in recent history. Resending may create a duplicate.' } : {}) });
        this.history = [];
      }
      return true;
    }
    if (event.type === 'chat_message') {
      this.reconcile([event.message], member_id);
      const is_new = !this.state.messages.some(message => message.message_id === event.message.message_id);
      this.publish({ messages: merge_messages([...this.state.messages, event.message]),
        truncated: this.state.truncated || event.message.message_id > CHAT_HISTORY_LIMIT,
        live_revision: this.state.live_revision + Number(is_new) });
      return true;
    }
    return false;
  }
  dispose() {
    clearTimeout(this.timer);
    this.state = empty_chat_state();
  }
}
function merge_messages(messages: readonly Chat_Message[]) {
  return [...new Map(messages.map(message => [message.message_id, message])).values()]
    .sort((left, right) => left.message_id - right.message_id).slice(-CHAT_HISTORY_LIMIT);
}
