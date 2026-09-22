import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type Component,
} from 'solid-js';
import { A, useNavigate, useParams } from '@solidjs/router';
import { Virtual_List } from '../components/virtual_list';
import { boot_player_session, player_session, shell_state } from '../state/session_state';
import { Multiplayer_Service, type Multiplayer_State } from '../services/multiplayer';
import {
  difficulty_row_label,
  format_duration_ms,
  row_meta_text,
  set_count_text,
  set_title_for,
} from '../services/selection_display';
import type { Selection_Set_Snapshot } from '../services/player_session';
import { ranked_results, type Room_Member } from '../../shared/multiplayer';
import '../styles/screens/multiplayer.css';
import '../styles/screens/multiplayer_lobby.css';
import '../styles/screens/multiplayer_round.css';

// Lobby picker row model: the host's whole session library, one header per
// set with its difficulty rows underneath.
type Room_Picker_Row =
  | { kind: 'set'; set: Selection_Set_Snapshot }
  | { kind: 'difficulty'; set: Selection_Set_Snapshot; filename: string };

export const Multiplayer_Screen: Component = () => {
  const navigate = useNavigate();
  const parameters = useParams();
  const [nickname, set_nickname] = createSignal('');
  const [error, set_error] = createSignal<string | null>(null);
  const [busy, set_busy] = createSignal(false);
  const [copied, set_copied] = createSignal(false);
  const [countdown_seconds, set_countdown_seconds] = createSignal<number | null>(null);
  const [state, set_state] = createSignal<Multiplayer_State>({
    room: null,
    connected: false,
    prepared: false,
    availability: 'missing',
    busy: false,
    error: null,
    scores: {},
  });
  let service: Multiplayer_Service | null = null;
  let unsubscribe: (() => void) | null = null;
  let playfield_host: HTMLDivElement | undefined;
  let disposed = false;
  let previous_play_state = '';
  let copied_timer: ReturnType<typeof setTimeout> | null = null;
  const room = () => state().room;
  const local_member = () =>
    room()?.members.find((member) => member.member_id === room()?.member_id);
  const is_host = () => room()?.host_id === room()?.member_id;
  const playing = () =>
    ['starting', 'running'].includes(shell_state().gameplay.state) && room()?.round !== null;
  const in_lobby = () => room()?.phase === 'lobby' || room()?.phase === 'countdown';
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
      const seconds = countdown_seconds();
      return seconds !== null && seconds > 0
        ? `Starting together in ${seconds}…`
        : 'Starting together…';
    }
    if (room()?.phase === 'playing') {
      return 'Round in progress';
    }
    if (room()?.phase === 'results') {
      return 'Shared results';
    }
    return 'Waiting in lobby';
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
  const start_hint = () => {
    if (!state().connected) {
      return 'Reconnect to the room first.';
    }
    if ((room()?.members.length ?? 0) < 2) {
      return 'Waiting for another player to join.';
    }
    const waiting = (room()?.members ?? [])
      .filter((member) => !member.ready || !member.connected)
      .map((member) => member.nickname);
    if (waiting.length > 0) {
      return `Waiting for ${waiting.join(', ')} to be ready.`;
    }
    return 'Launch a synchronized round for every ready player.';
  };
  const availability_label = (availability: string) =>
    ({
      missing: 'Missing map',
      checking: 'Checking',
      incompatible: 'Incompatible files',
      failed: 'Preparation failure',
      available: 'Available',
    })[availability] ?? availability;
  const selected_duration_text = (): string => {
    const end_ms = room()?.selected_map?.end_ms ?? 0;
    return end_ms > 0 ? format_duration_ms(end_ms) : '';
  };
  // Host picker rows over the full session library; publishing a choice goes
  // through the same revision-fenced select command as before.
  const active_selection = () => shell_state().selection.active;
  const host_picker_rows = (): readonly Room_Picker_Row[] => {
    const rows: Room_Picker_Row[] = [];
    for (const loaded_set of shell_state().selection.sets) {
      rows.push({ kind: 'set', set: loaded_set });
      for (const filename of loaded_set.filenames) {
        rows.push({ kind: 'difficulty', set: loaded_set, filename });
      }
    }
    return rows;
  };
  const picker_row_is_published = (row: Room_Picker_Row): boolean => {
    if (row.kind !== 'difficulty') return false;
    const current = active_selection();
    return !!current && current.set_id === row.set.set_id && current.filename === row.filename;
  };
  const activate_host_row = (row_index: number) => {
    const row = host_picker_rows()[row_index];
    // A newer choice may queue while an earlier publication is still being
    // acknowledged (the service serializes them), so busy never blocks picks.
    if (!row || row.kind !== 'difficulty' || !state().connected) return;
    if (picker_row_is_published(row)) return;
    void service?.select_map(row.set.set_id, row.filename);
  };
  const member_status = (member: Room_Member) => {
    if (!member.connected) {
      return 'Disconnected';
    }
    return member.ready ? 'Ready' : availability_label(member.availability);
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
  // Leaderboard order: live scores descending, ties keep join order so every
  // client renders identical scoreboard text.
  const ranked_participants = () => {
    const participants = room()?.round?.participants ?? [];
    return [...participants].sort((left, right) => {
      const left_score = state().scores[left]?.score ?? -1;
      const right_score = state().scores[right]?.score ?? -1;
      if (left_score !== right_score) {
        return right_score - left_score;
      }
      return participants.indexOf(left) - participants.indexOf(right);
    });
  };
  const progress_percent = (member_id: string) =>
    `${Math.round(Math.min(1, Math.max(0, state().scores[member_id]?.progress ?? 0)) * 100)}%`;
  const copy_invite = async () => {
    try {
      await navigator.clipboard.writeText(invite());
    } catch {
      const invite_input = document.getElementById('room-invite') as HTMLInputElement | null;
      invite_input?.select();
      document.execCommand('copy');
    }
    set_copied(true);
    if (copied_timer) {
      clearTimeout(copied_timer);
    }
    copied_timer = setTimeout(() => set_copied(false), 2000);
  };
  const leave_room = () => {
    service?.leave();
    navigate('/menu');
  };
  // Lobby countdown text only; the audio anchor remains the judgement clock.
  createEffect(() => {
    const round = room()?.round;
    if (room()?.phase !== 'countdown' || !round) {
      set_countdown_seconds(null);
      return;
    }
    const update_countdown = () => {
      const server_now = service?.server_now_ms;
      set_countdown_seconds(
        server_now === null || server_now === undefined
          ? null
          : Math.max(0, Math.ceil((round.start_ms - server_now) / 1000)),
      );
    };
    update_countdown();
    const countdown_timer = setInterval(update_countdown, 250);
    onCleanup(() => clearInterval(countdown_timer));
  });

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
    if (copied_timer) {
      clearTimeout(copied_timer);
    }
  });
  return (
    <main
      class="screen multiplayer-screen"
      classList={{ playing: playing() }}
      aria-label="Private multiplayer"
    >
      <header class="multiplayer-topbar">
        <div class="multiplayer-heading">
          <h1 class="multiplayer-title">Multiplayer</h1>
          <p class="multiplayer-tagline">Private rooms · 2–8 players · Client-reported scores</p>
        </div>
        <Show when={room()}>
          <p role="status" class="multiplayer-status">
            {room_status()}
          </p>
        </Show>
        <div class="multiplayer-topbar-actions">
          <Show when={playing()}>
            <button class="multiplayer-withdraw" onClick={() => service?.withdraw()}>
              <span>Withdraw</span>
            </button>
          </Show>
          <A href="/menu">Back to solo play</A>
        </div>
      </header>
      <Show when={error() || state().error}>
        <p role="alert" class="multiplayer-alert">
          {error() ?? state().error}
        </p>
      </Show>
      <Show when={!room()}>
        <form
          class="panel multiplayer-entry"
          onSubmit={(event) => {
            event.preventDefault();
            void join();
          }}
        >
          <p class="eyebrow">Get started</p>
          <label for="multiplayer-nickname">Your nickname</label>
          <input
            id="multiplayer-nickname"
            maxlength="24"
            required
            value={nickname()}
            onInput={(event) => set_nickname(event.currentTarget.value)}
          />
          <button type="submit" class="multiplayer-cta" disabled={busy() || !nickname().trim()}>
            {join_label()}
          </button>
          <p class="multiplayer-note">
            Import your own matching map files. No account needed. Files stay on your device.
          </p>
        </form>
      </Show>
      <Show when={room()}>
        <Show when={!state().connected && !playing()}>
          <div class="multiplayer-reconnect">
            <button onClick={() => service?.reconnect()}>
              <span>Reconnect</span>
            </button>
          </div>
        </Show>
      </Show>
      <Show when={room() && !playing() && in_lobby()}>
        <div class="multiplayer-lobby">
          <Show when={room()?.phase === 'lobby'}>
            <section class="panel multiplayer-invite" aria-label="Room invite">
              <label class="eyebrow" for="room-invite">
                Share this private invite link
              </label>
              <div class="multiplayer-invite-row">
                <input
                  id="room-invite"
                  readonly
                  value={invite()}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button onClick={() => void copy_invite()}>
                  <span>{copied() ? 'Copied ✓' : 'Copy link'}</span>
                </button>
              </div>
            </section>
          </Show>
          <div class="multiplayer-columns">
            <Show when={room()?.phase === 'lobby'}>
              <section class="panel multiplayer-map" aria-label="Selected map">
                <div class="wedge-shear-edge">
                  <p class="eyebrow">Selected map</p>
                </div>
                <div class="multiplayer-map-content">
                  <Show
                    when={room()?.selected_map}
                    fallback={<h2>Waiting for the host to choose a difficulty</h2>}
                  >
                    <h2 class="multiplayer-map-title">{room()?.selected_map?.title}</h2>
                    <p class="map-metadata">
                      {room()?.selected_map?.artist} · mapped by {room()?.selected_map?.creator}
                    </p>
                    <p class="map-metadata">
                      Difficulty: {room()?.selected_map?.difficulty}
                      <Show when={selected_duration_text()}>
                        {(duration) => <span> · {duration()}</span>}
                      </Show>
                    </p>
                  </Show>
                  <p class="multiplayer-availability">
                    <span
                      class="chip multiplayer-chip"
                      classList={{ ready: state().availability === 'available' }}
                    >
                      {availability_label(state().availability)}
                    </span>{' '}
                    · Ready enables audio.
                  </p>
                  <div class="multiplayer-map-actions">
                    <label class="file-control">
                      Import map (.osz or loose .osu and music files)
                      <input
                        id="room-map-import"
                        type="file"
                        multiple
                        disabled={!state().connected}
                        onChange={(event) => {
                          void service?.import_files(Array.from(event.currentTarget.files ?? []));
                          event.currentTarget.value = '';
                        }}
                      />
                    </label>
                    <button
                      onClick={() => void service?.select_demo()}
                      disabled={!state().connected}
                    >
                      <span>Use Tapweave demo</span>
                    </button>
                    <button
                      onClick={() => void service?.check_map()}
                      disabled={state().busy || !state().connected}
                    >
                      <span>Check loaded map</span>
                    </button>
                  </div>
                  <p class="multiplayer-map-hint">
                    Matching is by file content: import the exact difficulty and music the host
                    chose. Files never leave your device, and every import stays available for
                    later host choices.
                  </p>
                  <Show when={is_host() && shell_state().selection.sets.length > 0}>
                    <div class="multiplayer-host-picker">
                      <p class="eyebrow" id="room-difficulty-label">
                        Choose difficulty from your library
                      </p>
                      <div id="room-difficulty" class="multiplayer-host-list" role="listbox" aria-labelledby="room-difficulty-label">
                        <Virtual_List
                          rows={host_picker_rows()}
                          row_height={40}
                          list_name="room difficulties"
                          aria_label="Room difficulty picker"
                          disabled={!state().connected}
                          render_row={(row) =>
                            row.kind === 'set' ? (
                              <span class="difficulty-row set-header-row" data-set-id={row.set.set_id}>
                                <span class="set-header-title">
                                  {set_title_for(row.set, active_selection())}
                                </span>
                                <span class="set-header-count">{set_count_text(row.set)}</span>
                              </span>
                            ) : (
                              <span
                                class="difficulty-row"
                                data-map-filename={row.filename}
                                classList={{ 'room-pick-published': picker_row_is_published(row) }}
                              >
                                <span class="difficulty-row-label">
                                  {difficulty_row_label(row.set, active_selection(), row.filename)}
                                </span>
                                <Show when={row_meta_text(row.set, row.filename)} keyed>
                                  {(meta) => <span class="difficulty-row-meta">{meta}</span>}
                                </Show>
                              </span>
                            )
                          }
                          on_activate={activate_host_row}
                        />
                      </div>
                    </div>
                  </Show>
                </div>
              </section>
            </Show>
            <section class="panel multiplayer-players" aria-label="Room members">
              <div class="wedge-shear-edge">
                <p class="eyebrow">Players · {room()?.members.length ?? 0}/8</p>
              </div>
              <ul aria-label="Room members">
                <For each={room()?.members}>
                  {(member) => (
                    <li
                      class="multiplayer-member"
                      classList={{
                        ready: member.ready,
                        disconnected: !member.connected,
                        local: member.member_id === room()?.member_id,
                      }}
                    >
                      <span class="multiplayer-member-name">{member.nickname}</span>
                      <Show when={member.member_id === room()?.host_id}>
                        <span class="chip multiplayer-chip-host">Host</span>
                      </Show>
                      <span
                        class="chip multiplayer-chip-status"
                        classList={{ ready: member.ready, disconnected: !member.connected }}
                      >
                        {member_status(member)}
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          </div>
          <footer class="multiplayer-footer">
            <p class="multiplayer-footer-note">
              Session-only imports. Map and audio files never pass through the room server.
            </p>
            <div class="multiplayer-footer-buttons">
              <button class="multiplayer-leave" onClick={leave_room}>
                <span>Leave room</span>
              </button>
              <Show when={room()?.phase === 'countdown'}>
                <button onClick={() => service?.unready()}>
                  <span>Cancel readiness</span>
                </button>
              </Show>
              <Show when={room()?.phase === 'lobby'}>
                <button
                  id="room-ready"
                  disabled={!state().connected || !state().prepared || state().busy}
                  onClick={toggle_ready}
                >
                  <span>{ready_label()}</span>
                </button>
                <Show when={is_host()}>
                  <button
                    id="room-start"
                    class="multiplayer-cta"
                    disabled={!can_start()}
                    title={start_hint()}
                    onClick={() => service?.start()}
                  >
                    <span>Start together</span>
                  </button>
                </Show>
              </Show>
            </div>
          </footer>
        </div>
      </Show>
      <div class="multiplayer-round-layout" classList={{ active: playing() }}>
        <div class="multiplayer-playfield" classList={{ active: playing() }}>
          <div ref={playfield_host} class="playfield-host" />
        </div>
        <Show when={room()?.round}>
          <section class="panel multiplayer-scores" aria-label="Client-reported scoreboard">
            <h2>{room()?.phase === 'results' ? 'Shared results' : 'Live scoreboard'}</h2>
            <p class="multiplayer-scores-note">Client-reported · Unverified</p>
            <Show when={room()?.phase !== 'results'}>
              <ol class="multiplayer-scoreboard">
                <For each={ranked_participants()}>
                  {(member_id, placement) => (
                    <li
                      class="multiplayer-score-row"
                      classList={{
                        local: member_id === room()?.member_id,
                        stale: score_is_stale(member_id),
                      }}
                    >
                      <span class="multiplayer-score-place">{placement() + 1}</span>
                      <div class="multiplayer-score-main">
                        <span class="multiplayer-score-name">{member_name(member_id)}</span>
                        <span class="multiplayer-score-detail">{score_label(member_id)}</span>
                        <div class="stat-track">
                          <div
                            class="stat-fill"
                            style={{ '--stat-fill': progress_percent(member_id) }}
                          />
                        </div>
                      </div>
                    </li>
                  )}
                </For>
              </ol>
            </Show>
            <Show when={room()?.phase === 'results'}>
              <h3>Completed</h3>
              <ol class="multiplayer-results">
                <For each={ranked_results(room()!.round!)}>
                  {(result) => (
                    <li value={result.placement} classList={{ winner: result.placement === 1 }}>
                      <span class="multiplayer-score-place">#{result.placement}</span>
                      <span class="multiplayer-score-name">{member_name(result.member_id)}</span>
                      <span class="multiplayer-score-detail">
                        {result.score.toLocaleString()} · {(result.accuracy * 100).toFixed(2)}%
                      </span>
                    </li>
                  )}
                </For>
              </ol>
              <h3>Failed runs</h3>
              <ul class="multiplayer-secondary-results">
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
              <ul class="multiplayer-secondary-results">
                <For
                  each={Object.entries(room()!.round!.results).filter(
                    ([, result]) => result.status === 'withdrawn',
                  )}
                >
                  {([member_id]) => <li>{member_name(member_id)}</li>}
                </For>
              </ul>
              <Show when={is_host()}>
                <button id="room-rematch" class="multiplayer-cta" onClick={() => service?.rematch()}>
                  <span>Return to lobby</span>
                </button>
              </Show>
            </Show>
          </section>
        </Show>
      </div>
    </main>
  );
};
