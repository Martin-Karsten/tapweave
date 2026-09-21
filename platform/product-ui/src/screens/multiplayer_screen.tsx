import { createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js';
import { A, useNavigate, useParams } from '@solidjs/router';
import { boot_player_session, player_session, shell_state } from '../state/session_state';
import { Multiplayer_Service, type Multiplayer_State } from '../services/multiplayer';
import { ranked_results, type Room_Member } from '../../shared/multiplayer';
import '../styles/screens/multiplayer.css';

export const Multiplayer_Screen: Component = () => {
  const navigate = useNavigate();
  const parameters = useParams();
  const [nickname, set_nickname] = createSignal('');
  const [error, set_error] = createSignal<string | null>(null);
  const [busy, set_busy] = createSignal(false);
  const [state, set_state] = createSignal<Multiplayer_State>({
    room: null,
    connected: false,
    prepared: false,
    busy: false,
    error: null,
    scores: {},
  });
  let service: Multiplayer_Service | null = null;
  let unsubscribe: (() => void) | null = null;
  let playfield_host: HTMLDivElement | undefined;
  let disposed = false;
  let previous_play_state = '';
  const room = () => state().room;
  const local_member = () =>
    room()?.members.find((member) => member.member_id === room()?.member_id);
  const is_host = () => room()?.host_id === room()?.member_id;
  const playing = () =>
    ['starting', 'running'].includes(shell_state().gameplay.state) && room()?.round !== null;
  const invite = () => `${location.origin}/room/${parameters.room_id}`;
  const member_name = (member_id: string) =>
    room()?.members.find((member) => member.member_id === member_id)?.nickname ?? 'Former member';
  const join_label = () => {
    if (busy()) {
      return 'Preparing room…';
    }
    return parameters.room_id ? 'Join room' : 'Create private room';
  };
  const room_status = () => {
    if (!state().connected) {
      return 'Reconnecting…';
    }
    if (room()?.phase === 'countdown') {
      return 'Starting together in five seconds…';
    }
    return `Room: ${room()?.phase}`;
  };
  const ready_label = () => {
    if (local_member()?.ready) {
      return 'Unready';
    }
    return state().busy ? 'Synchronizing…' : 'Ready';
  };
  const toggle_ready = () => {
    if (local_member()?.ready) {
      service?.unready();
    } else {
      void service?.ready();
    }
  };
  const can_start = () =>
    state().connected &&
    (room()?.members.length ?? 0) >= 2 &&
    room()?.members.every((member) => member.ready && member.connected);
  const member_status = (member: Room_Member) => {
    if (!member.connected) {
      return 'Disconnected · stale';
    }
    return member.ready ? 'Ready' : 'Connected';
  };
  const score_label = (member_id: string) => {
    const terminal_status = room()?.round?.results[member_id]?.status;
    if (terminal_status) {
      return terminal_status;
    }
    const score = state().scores[member_id];
    if (!score) {
      return 'Waiting for score';
    }
    return `${score.score.toLocaleString()} · ${(score.accuracy * 100).toFixed(2)}% · ${score.combo}× · ${Math.round(score.progress * 100)}%`;
  };
  const score_is_stale = (member_id: string) => {
    const score = state().scores[member_id];
    const member = room()?.members.find((member) => member.member_id === member_id);
    return score && (performance.now() - score.received_ms > 2000 || !member?.connected);
  };

  const join = async () => {
    set_busy(true);
    set_error(null);
    try {
      await boot_player_session();
      const player = player_session();
      if (!player) {
        throw new Error('Engine could not start. Try solo play or reload.');
      }
      if (disposed) {
        return;
      }
      if (!parameters.room_id) {
        const room_id = await Multiplayer_Service.create(nickname());
        sessionStorage.setItem('tapweave_room_nickname', nickname());
        navigate(`/room/${room_id}`);
        return;
      }
      if (!/^[a-f0-9]{32}$/.test(parameters.room_id)) {
        throw new Error('Invalid invite link.');
      }
      if (!service) {
        service = new Multiplayer_Service(player, parameters.room_id);
        unsubscribe = service.subscribe(() => {
          set_state(service!.state);
          if (player.view.state === 'running' && previous_play_state !== 'running') {
            player.canvas.focus({ preventScroll: true });
          }
          previous_play_state = player.view.state;
        });
      }
      player.attach_host(playfield_host!);
      await service.join(nickname());
    } catch (failure) {
      set_error(failure instanceof Error ? failure.message : String(failure));
    } finally {
      set_busy(false);
    }
  };
  onMount(() => {
    if (parameters.room_id) {
      const saved_nickname = sessionStorage.getItem('tapweave_room_nickname');
      sessionStorage.removeItem('tapweave_room_nickname');
      if (saved_nickname) {
        set_nickname(saved_nickname);
        void join();
      }
    }
  });
  onCleanup(() => {
    disposed = true;
    unsubscribe?.();
    service?.leave();
  });
  return (
    <main
      class="screen multiplayer-screen"
      classList={{ playing: playing() }}
      aria-label="Private multiplayer"
    >
      <header class="multiplayer-heading">
        <h1>Play the demo with friends</h1>
        <p>Private rooms · 2–8 players · Client-reported scores</p>
        <A href="/menu">Back to solo play</A>
        <Show when={playing()}>
          <button class="multiplayer-withdraw" onClick={() => service?.withdraw()}>
            Withdraw
          </button>
        </Show>
      </header>
      <Show when={!room()}>
        <form
          class="panel"
          onSubmit={(event) => {
            event.preventDefault();
            void join();
          }}
        >
          <label for="multiplayer-nickname">Your nickname</label>
          <input
            id="multiplayer-nickname"
            maxlength="24"
            required
            value={nickname()}
            onInput={(event) => set_nickname(event.currentTarget.value)}
          />
          <button type="submit" disabled={busy() || !nickname().trim()}>
            {join_label()}
          </button>
          <p>The bundled Tapweave demo loads automatically. No account needed.</p>
        </form>
      </Show>
      <Show when={error() || state().error}>
        <p role="alert">{error() ?? state().error}</p>
      </Show>
      <Show when={room()}>
        <Show when={!state().connected}>
          <button onClick={() => service?.reconnect()}>Reconnect</button>
        </Show>
        <p role="status">{room_status()}</p>
        <section class="panel multiplayer-lobby" aria-label="Room lobby" hidden={playing()}>
          <Show when={room()?.phase === 'lobby'}>
            <label for="room-invite">Share this private invite link</label>
            <input
              id="room-invite"
              readonly
              value={invite()}
              onFocus={(event) => event.currentTarget.select()}
            />
            <p>
              {state().prepared ? 'Demo prepared. Ready enables audio.' : 'Preparing the demo…'}
            </p>
            <button
              id="room-ready"
              disabled={!state().connected || !state().prepared || state().busy}
              onClick={toggle_ready}
            >
              {ready_label()}
            </button>
            <Show when={is_host()}>
              <button id="room-start" disabled={!can_start()} onClick={() => service?.start()}>
                Start together
              </button>
            </Show>
          </Show>
          <Show when={room()?.phase === 'countdown'}>
            <button onClick={() => service?.unready()}>Cancel readiness</button>
          </Show>
          <ul aria-label="Room members">
            <For each={room()?.members}>
              {(member) => (
                <li>
                  {member.nickname}
                  {member.member_id === room()?.host_id ? ' · Host' : ''} · {member_status(member)}
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
      <div class="multiplayer-round-layout" classList={{ active: playing() }}>
        <div class="multiplayer-playfield" classList={{ active: playing() }}>
          <div ref={playfield_host} class="playfield-host" />
        </div>
        <Show when={room()?.round}>
          <section class="panel multiplayer-scores" aria-label="Client-reported scoreboard">
            <h2>{room()?.phase === 'results' ? 'Shared results' : 'Live scoreboard'}</h2>
            <p>Client-reported · Unverified</p>
            <Show when={room()?.phase !== 'results'}>
              <ul>
                <For each={room()?.round?.participants}>
                  {(member_id) => (
                    <li>
                      {member_name(member_id)} · {score_label(member_id)}
                      {score_is_stale(member_id) ? ' · stale' : ''}
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={room()?.phase === 'results'}>
              <h3>Completed</h3>
              <ol>
                <For each={ranked_results(room()!.round!)}>
                  {(result) => (
                    <li value={result.placement}>
                      {member_name(result.member_id)} · {result.score.toLocaleString()} ·{' '}
                      {(result.accuracy * 100).toFixed(2)}%
                    </li>
                  )}
                </For>
              </ol>
              <h3>Failed runs</h3>
              <ul>
                <For
                  each={Object.entries(room()!.round!.results).filter(
                    ([, result]) => result.status === 'failed',
                  )}
                >
                  {([member_id, result]) => (
                    <li>
                      {member_name(member_id)} · {result.score.toLocaleString()}
                    </li>
                  )}
                </For>
              </ul>
              <h3>Withdrawn · Unranked</h3>
              <ul>
                <For
                  each={Object.entries(room()!.round!.results).filter(
                    ([, result]) => result.status === 'withdrawn',
                  )}
                >
                  {([member_id]) => <li>{member_name(member_id)}</li>}
                </For>
              </ul>
              <Show when={is_host()}>
                <button id="room-rematch" onClick={() => service?.rematch()}>
                  Rematch
                </button>
              </Show>
            </Show>
          </section>
        </Show>
      </div>
    </main>
  );
};
