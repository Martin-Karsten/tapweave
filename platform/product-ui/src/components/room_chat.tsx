import { createEffect, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js';
import { fullscreen_owns_escape } from '@browser/fullscreen.js';
import type { Room_Chat_State } from '../services/room_chat';
import '../styles/components/room_chat.css';

export const Room_Chat: Component<{
  state: Room_Chat_State;
  member_id: string;
  gameplay: boolean;
  activity: 'not_playing' | 'break' | 'playing';
  set_draft: (draft: string) => void;
  submit: () => boolean;
  set_text_input_active: (active: boolean) => void;
  focus_playfield: () => void;
}> = props => {
  let composer!: HTMLInputElement;
  let log!: HTMLDivElement;
  let collapse_timer: ReturnType<typeof setTimeout> | undefined;
  let composing = false;
  let previous_active = false;
  let previous_live_revision = props.state.live_revision;
  const [focused, set_focused] = createSignal(false);
  const [lingering, set_lingering] = createSignal(false);
  const [at_bottom, set_at_bottom] = createSignal(true);
  const [new_messages, set_new_messages] = createSignal(false);
  const [announcement, set_announcement] = createSignal('');
  const active = () => props.gameplay && props.activity === 'playing';
  const expanded = () => !active() || focused() || lingering();
  const scroll_bottom = () => {
    if (log) log.scrollTop = log.scrollHeight;
    set_at_bottom(true);
    set_new_messages(false);
  };
  const release_focus = () => {
    set_focused(false);
    composer?.blur();
    props.set_text_input_active(false);
    if (props.gameplay) props.focus_playfield();
  };
  const send = () => {
    if (composing) return;
    if (!props.state.draft.trim()) {
      if (active()) release_focus();
      return;
    }
    if (props.submit() && active()) release_focus();
  };
  createEffect(() => {
    const now_active = active();
    if (now_active !== previous_active) {
      clearTimeout(collapse_timer);
      set_lingering(false);
      if (now_active && focused()) release_focus();
      previous_active = now_active;
    }
  });
  createEffect(() => {
    const revision = props.state.live_revision;
    const messages = props.state.messages;
    if (revision !== previous_live_revision) {
      if (!at_bottom()) set_new_messages(true);
      if (!active() && expanded() && messages.length) {
        const message = messages[messages.length - 1]!;
        set_announcement(`${message.nickname}: ${message.text}`);
      }
      previous_live_revision = revision;
    }
    if (at_bottom()) queueMicrotask(scroll_bottom);
  });
  createEffect(() => {
    if (!props.state.ready && focused()) release_focus();
  });
  createEffect(() => {
    if (active()) set_announcement('');
  });
  onMount(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.isComposing || composing || event.repeat) return;
      if (event.code === 'Escape' && focused()) {
        if (fullscreen_owns_escape()) return;
        event.preventDefault();
        event.stopPropagation();
        release_focus();
      } else if (event.code === 'Enter' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (document.querySelector('[role="dialog"], dialog[open]')) return;
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target !== composer && target?.closest('input, textarea, select, [contenteditable="true"], button, a')) return;
        event.preventDefault();
        event.stopPropagation();
        if (focused()) send();
        else if (props.state.ready) {
          set_lingering(true);
          composer.focus({ preventScroll: true });
        }
      }
    };
    window.addEventListener('keydown', keyboard, true);
    onCleanup(() => window.removeEventListener('keydown', keyboard, true));
  });
  onCleanup(() => {
    clearTimeout(collapse_timer);
    props.set_text_input_active(false);
  });
  return <section class="panel room-chat" classList={{ 'room-chat-gameplay': props.gameplay, 'room-chat-active': active(), 'room-chat-collapsed': !expanded() }} aria-label="Room chat">
    <h2>Room chat <Show when={props.gameplay}><small>Enter to chat · Escape to return</small></Show></h2>
    <div class="room-chat-body" inert={!expanded()} aria-hidden={!expanded()}>
      <div ref={log} class="room-chat-log" role="log" aria-label="Room messages" aria-live="off" tabindex="0"
        onScroll={() => set_at_bottom(log.scrollHeight - log.scrollTop - log.clientHeight < 32)}>
        <Show when={props.state.truncated}><p class="room-chat-note">Showing the latest 100 messages</p></Show>
        <For each={props.state.messages}>{message => <p class="room-chat-message" classList={{ self: message.member_id === props.member_id }}>
          <time datetime={new Date(message.sent_ms).toISOString()}>{new Date(message.sent_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{' '}
          <bdi class="room-chat-author">{message.nickname}</bdi>{' '}<bdi>{message.text}</bdi>
        </p>}</For>
        <Show when={props.state.pending}>{pending => <p class="room-chat-note">{pending().text} · {pending().uncertain ? 'Delivery not confirmed' : 'Sending…'}</p>}</Show>
      </div>
      <Show when={new_messages()}><button type="button" onClick={scroll_bottom}>New messages ↓</button></Show>
      <form onSubmit={event => { event.preventDefault(); send(); }}>
        <label class="room-chat-label" for="room-chat-composer">Message</label>
        <input ref={composer} id="room-chat-composer" autocomplete="off" value={props.state.draft} disabled={!props.state.ready}
          placeholder="Message the room" onInput={event => props.set_draft(event.currentTarget.value)}
          onPaste={event => {
            const text = event.clipboardData?.getData('text');
            if (text === undefined) return;
            event.preventDefault();
            composer.setRangeText(text.replace(/[\r\n\t\u2028\u2029]/g, ' '), composer.selectionStart ?? 0, composer.selectionEnd ?? 0, 'end');
            props.set_draft(composer.value);
          }}
          onCompositionStart={() => { composing = true; }} onCompositionEnd={() => { composing = false; }}
          onFocus={() => { clearTimeout(collapse_timer); set_focused(true); props.set_text_input_active(true); }}
          onBlur={() => {
            set_focused(false);
            props.set_text_input_active(false);
            if (active()) {
              set_lingering(true);
              clearTimeout(collapse_timer);
              collapse_timer = setTimeout(() => set_lingering(false), 600);
            }
          }} />
        <button type="submit" disabled={!props.state.ready || !props.state.draft.trim() || !!props.state.pending && !props.state.pending.uncertain}>Send</button>
      </form>
      <Show when={!props.state.ready}><p class="room-chat-note">{props.state.supported ? 'Connecting to chat…' : 'Chat requires the updated room server.'}</p></Show>
      <Show when={props.state.error}><p class="room-chat-error" role="status">{props.state.error}</p></Show>
    </div>
    <span class="room-chat-announcement" aria-live="polite">{announcement()}</span>
  </section>;
};
