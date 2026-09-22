import type { Selection_Request } from '@browser/selection.js';
import {
  describe_local_map,
  hash_bytes,
  matching_filename,
  require_matching_map,
  Incompatible_Map,
} from './multiplayer_map';
import {
  PROTOCOL_VERSION,
  type Map_Availability,
  type Selected_Map,
  RECONNECT_MS,
  type Client_Command,
  type Room_Snapshot,
  type Score_Report,
  type Server_Message,
  type Terminal_Report,
} from '../../shared/multiplayer';
import build_identity from '../../artifacts/multiplayer_identity.json';
import { SESSION_STATE, RANK, FAIL_POLICY } from '@browser/abi-records.js';
import type { Player_Session_Service } from './player_session';

export interface Multiplayer_State {
  room: Room_Snapshot | null;
  connected: boolean;
  prepared: boolean;
  availability: Map_Availability;
  busy: boolean;
  error: string | null;
  scores: Readonly<
    Record<
      string,
      Score_Report & {
        received_ms: number;
      }
    >
  >;
}
type Map_Preparation_Action =
  | { type: 'import'; files: File[] }
  | { type: 'difficulty'; set_id: number; filename: string }
  | { type: 'demo' }
  | { type: 'check' };

interface Map_Preparation_Operation {
  generation: number;
  selection_revision: number;
  member_id: string;
  selects_room_map: boolean;
  expected_map: Selected_Map | null;
  room_engine_hash: string;
}

interface Clock_Sample {
  round_trip_ms: number;
  offset_ms: number;
}
export function clock_sample(
  client_ms: number,
  received_ms: number,
  server_ms: number,
): Clock_Sample {
  return {
    round_trip_ms: received_ms - client_ms,
    offset_ms: server_ms - (client_ms + received_ms) / 2,
  };
}
export function scheduled_audio_time(
  server_ms: number,
  sample: Clock_Sample,
  client_ms: number,
  audio_seconds: number,
) {
  if (
    !Number.isFinite(sample.offset_ms) ||
    sample.round_trip_ms < 0 ||
    sample.round_trip_ms > 200
  ) {
    throw new Error('Connection latency is too high for a synchronized start.');
  }
  const remaining_ms = server_ms - (client_ms + sample.offset_ms);
  if (remaining_ms < 200) {
    throw new Error(
      'Start deadline missed. You have withdrawn; return to the lobby for a rematch.',
    );
  }
  return audio_seconds + remaining_ms / 1000;
}

// Framework-independent owner of room I/O and browser-session coordination.
// No hit judgement, cursor transport or music transport crosses this protocol.
export class Multiplayer_Service {
  private state_value: Multiplayer_State = {
    room: null,
    connected: false,
    prepared: false,
    availability: 'missing',
    busy: false,
    error: null,
    scores: {},
  };
  private listeners = new Set<() => void>();
  private socket: WebSocket | null = null;
  private sequence = 0;
  private readonly connection_id = crypto.randomUUID().replaceAll('-', '');
  private disposed = false;
  private reconnect_timer: ReturnType<typeof setTimeout> | null = null;
  private disconnected_ms: number | null = null;
  private score_interval: ReturnType<typeof setInterval>;
  private clock_samples: Clock_Sample[] = [];
  private pending_clock_requests = new Map<
    number,
    {
      resolve: () => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private local_round_id: string | null = null;
  private terminal_report: Terminal_Report | null = null;
  private terminal_report_sent = false;
  private preparation_generation = 0;
  private prepared_revision = -1;
  private check_on_snapshot = true;
  private host_preparation_generation: number | null = null;
  private selection_acknowledgement: Promise<void> | null = null;
  private readonly unsubscribe_player: () => void;
  private readonly pagehide = () => this.leave();
  private readonly audio_changed = () => {
    if (this.player.audio_context.state !== 'running') {
      if (this.local_round_id) {
        this.withdraw('Audio was interrupted. You have withdrawn.');
      } else if (this.local_member?.ready) {
        this.send_command({
          type: 'ready',
          ready: false,
          selection_revision: this.state.room?.selection_revision ?? 0,
        });
      }
    }
  };
  constructor(
    readonly player: Player_Session_Service,
    readonly room_id: string,
  ) {
    // ADR-008: rounds run the pinned multiplayer fail policy — reaching zero
    // health marks the F rank while play and scoring continue (osu!lazer
    // MultiplayerPlayer). Solo navigation restores terminal failure on dispose.
    player.set_fail_policy(FAIL_POLICY.MARK_AND_CONTINUE);
    this.unsubscribe_player = player.subscribe(() => this.observe_player());
    this.score_interval = setInterval(() => this.report_score(), 550);
    window.addEventListener('pagehide', this.pagehide);
    player.audio_context.addEventListener('statechange', this.audio_changed);
  }
  get state() {
    return this.state_value;
  }
  get local_member() {
    return this.state.room?.members.find(
      (member) => member.member_id === this.state.room?.member_id,
    );
  }
  // Presentational estimate of server time from the best clock sample, for
  // UI text such as the lobby countdown. The audio anchor stays the only
  // judgement clock (ADR-004); null means no synchronized sample exists yet.
  get server_now_ms(): number | null {
    const sample = [...this.clock_samples].sort(
      (left, right) => left.round_trip_ms - right.round_trip_ms,
    )[0];
    return sample ? performance.now() + sample.offset_ms : null;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private publish(patch: Partial<Multiplayer_State>) {
    this.state_value = {
      ...this.state_value,
      ...patch,
    };
    for (const listener of this.listeners) {
      listener();
    }
  }

  private report_error(error: unknown) {
    this.publish({
      error: error instanceof Error ? error.message : String(error),
      busy: false,
    });
  }
  static async create(nickname: string): Promise<string> {
    const response = await fetch('/api/multiplayer/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(
        `${result.error ?? 'Connection failure'}: ${result.message ?? 'Try again. Solo play remains available.'}`,
      );
    }
    return result.room_id;
  }

  async join(nickname: string) {
    this.publish({
      busy: true,
      error: null,
    });
    try {
      const response = await fetch(`/api/multiplayer/${this.room_id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(
          `${result.error ?? 'Connection failure'}: ${result.message ?? 'Try again.'}`,
        );
      }
      if (this.disposed) {
        return;
      }
      this.open_socket();
    } catch (error) {
      this.report_error(error);
    } finally {
      if (!this.disposed) {
        this.publish({ busy: false });
      }
    }
  }

  private set_availability(availability: Map_Availability) {
    this.publish({ availability, prepared: availability === 'available' });
    const room = this.state.room;
    if (room?.phase === 'lobby') {
      this.send_command({
        type: 'availability',
        availability,
        selection_revision: room.selection_revision,
      });
    }
  }

  private is_current_preparation(operation: Map_Preparation_Operation): boolean {
    const room = this.state.room;
    if (this.disposed || operation.generation !== this.preparation_generation) {
      return false;
    }
    if (!room || room.phase !== 'lobby') {
      return false;
    }
    if (operation.selects_room_map) {
      // A newer host choice can wait for an earlier choice's acknowledgement.
      // Its revision changes during that wait, but its local intent stays valid.
      return room.host_id === operation.member_id;
    }
    return room.selection_revision === operation.selection_revision;
  }

  private require_compatible_build(operation: Map_Preparation_Operation) {
    if (operation.room_engine_hash !== build_identity.engine_hash) {
      throw new Incompatible_Map('Incompatible engine build. Reload this page.');
    }
    if (
      operation.expected_map &&
      operation.expected_map.engine_hash !== build_identity.engine_hash
    ) {
      throw new Incompatible_Map('Incompatible engine build. Reload this page.');
    }
  }

  private async load_preparation_candidate(
    action: Map_Preparation_Action,
    operation: Map_Preparation_Operation,
    request: Selection_Request,
  ) {
    switch (action.type) {
      case 'import':
        await this.player.add_files(action.files, request);
        return;
      case 'demo': {
        const response = await fetch('/demo/tapweave-demo.osz');
        if (!response.ok) {
          throw new Error('Demo could not load. Try again.');
        }
        const demo_archive = new File([await response.arrayBuffer()], 'tapweave-demo.osz');
        if (this.is_current_preparation(operation)) {
          await this.player.add_files([demo_archive], request);
        }
        return;
      }
      case 'difficulty':
        await this.player.select_map(action.set_id, action.filename, request);
        return;
      case 'check': {
        if (!operation.expected_map) {
          return;
        }
        // Match against the whole session library: guests import their sets
        // once and stay available for any difficulty the host publishes.
        const match = await this.player.selection.find_map_by_hash(
          hash_bytes,
          operation.expected_map.map_hash,
        );
        if (!match) {
          throw new Incompatible_Map(
            'This set has no matching difficulty. Import the same .osu and music files as the host.',
          );
        }
        if (this.is_current_preparation(operation)) {
          await this.player.select_map(match.set_id, match.filename, request);
        }
        return;
      }
    }
  }

  private async prepare_matching_candidate(
    action: Map_Preparation_Action,
    operation: Map_Preparation_Operation,
  ): Promise<Selected_Map | null> {
    let prepared_map: Selected_Map | null = null;
    const request: Selection_Request = {
      validate: async (candidate) => {
        const candidate_map = await describe_local_map(candidate, build_identity.engine_hash);
        if (operation.expected_map) {
          require_matching_map(candidate_map, operation.expected_map);
        }
        if (!this.is_current_preparation(operation)) {
          throw new Error('Map check superseded.');
        }
        prepared_map = candidate_map;
      },
    };
    const expected_map = operation.expected_map;
    if (expected_map) {
      request.choose_map = (source) => matching_filename(source, expected_map);
    }
    await this.load_preparation_candidate(action, operation, request);
    if (!this.is_current_preparation(operation)) {
      return null;
    }
    if (this.player.selection.error) {
      throw this.player.selection.error;
    }
    if (!prepared_map || !this.player.view.can_play) {
      throw new Error('Map preparation did not complete.');
    }
    return prepared_map;
  }

  private async prepare_local(action: Map_Preparation_Action) {
    const room = this.state.room;
    if (!room || room.phase !== 'lobby' || !this.state.connected) {
      return;
    }
    const selects_room_map = room.host_id === room.member_id && action.type !== 'check';
    const operation: Map_Preparation_Operation = {
      generation: ++this.preparation_generation,
      selection_revision: room.selection_revision,
      member_id: room.member_id,
      selects_room_map,
      expected_map: selects_room_map ? null : room.selected_map,
      room_engine_hash: room.engine_hash,
    };
    this.host_preparation_generation = selects_room_map ? operation.generation : null;
    this.player.selection.cancel_pending();
    this.prepared_revision = -1;
    this.publish({ busy: true, error: null, prepared: false, availability: 'checking' });

    try {
      // Serialize host publications so each command uses the acknowledged revision.
      if (selects_room_map && this.selection_acknowledgement) {
        await this.selection_acknowledgement;
      }
      if (!this.is_current_preparation(operation)) {
        return;
      }
      this.set_availability('checking');
      if (!selects_room_map && !operation.expected_map) {
        this.set_availability('missing');
        return;
      }
      this.require_compatible_build(operation);
      const needs_loaded_set = action.type === 'check' || action.type === 'difficulty';
      if (needs_loaded_set && this.player.selection.loaded_sets.length === 0) {
        this.set_availability('missing');
        return;
      }
      const prepared_map = await this.prepare_matching_candidate(action, operation);
      if (!prepared_map || !this.is_current_preparation(operation)) {
        return;
      }
      if (selects_room_map) {
        await this.publish_selection(prepared_map);
        if (this.is_current_preparation(operation)) {
          void this.check_map();
        }
      } else {
        this.prepared_revision = operation.selection_revision;
        this.set_availability('available');
      }
    } catch (error) {
      if (this.is_current_preparation(operation)) {
        this.set_availability(error instanceof Incompatible_Map ? 'incompatible' : 'failed');
        this.report_error(error);
      }
    } finally {
      if (this.host_preparation_generation === operation.generation) {
        this.host_preparation_generation = null;
      }
      if (this.is_current_preparation(operation)) {
        this.publish({ busy: false });
      }
    }
  }

  private async publish_selection(selected_map: Selected_Map) {
    const room = this.state.room!;
    let unsubscribe = () => {};
    let timeout: ReturnType<typeof setTimeout>;
    const acknowledgement = new Promise<void>((resolve, reject) => {
      timeout = setTimeout(
        () =>
          reject(new Error('Map selection confirmation timed out. Reconnect and check the map.')),
        5000,
      );
      unsubscribe = this.subscribe(() => {
        if (
          !this.state.connected ||
          this.state.room?.host_id !== room.member_id ||
          this.state.error
        ) {
          reject(new Error(this.state.error ?? 'Map selection interrupted.'));
        } else if (this.state.room.selection_revision > room.selection_revision) {
          resolve();
        }
      });
    });
    this.selection_acknowledgement = acknowledgement;
    this.send_command({
      type: 'select',
      selection_revision: room.selection_revision,
      selected_map,
    });
    try {
      await acknowledgement;
    } finally {
      clearTimeout(timeout!);
      unsubscribe();
      if (this.selection_acknowledgement === acknowledgement) {
        this.selection_acknowledgement = null;
      }
    }
  }

  import_files(files: File[]) {
    if (files.length) {
      return this.prepare_local({ type: 'import', files });
    }
  }
  select_map(set_id: number, filename: string) {
    if (this.state.room?.host_id === this.state.room?.member_id) {
      return this.prepare_local({ type: 'difficulty', set_id, filename });
    }
  }
  select_demo() {
    return this.prepare_local({ type: 'demo' });
  }
  check_map() {
    return this.prepare_local({ type: 'check' });
  }

  private open_socket() {
    if (
      this.disposed ||
      this.socket?.readyState === WebSocket.OPEN ||
      this.socket?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }
    const url = new URL(`/api/multiplayer/${this.room_id}/socket`, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('connection', this.connection_id);
    if (this.local_round_id) {
      url.searchParams.set('resume', this.local_round_id);
    }
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      this.check_on_snapshot = true;
      this.disconnected_ms = null;
      this.terminal_report_sent = false;
      this.publish({
        connected: true,
        error: null,
      });
    };
    socket.onmessage = (event) => {
      if (socket !== this.socket || typeof event.data !== 'string' || event.data.length > 32_768) {
        return;
      }
      try {
        this.receive(JSON.parse(event.data));
      } catch (error) {
        this.report_error(error);
      }
    };
    socket.onclose = (event) => {
      if (this.disposed || socket !== this.socket) {
        return;
      }
      this.socket = null;
      this.preparation_generation++;
      this.host_preparation_generation = null;
      this.player.selection.cancel_pending();
      this.prepared_revision = -1;
      this.publish({
        prepared: false,
        busy: false,
        connected: false,
        error: 'Connection lost. Reconnecting for up to 30 seconds; live scores are stale.',
      });
      if ([4000, 4001, 4002, 4003, 4008].includes(event.code)) {
        this.withdraw(event.reason);
        return;
      }
      this.disconnected_ms ??= performance.now();
      if (this.state.room?.phase === 'countdown') {
        this.withdraw('Countdown cancelled after connection loss.');
      }
      if (performance.now() - this.disconnected_ms < RECONNECT_MS) {
        this.reconnect_timer = setTimeout(() => this.open_socket(), 1000);
      } else {
        this.withdraw('Reconnection timed out. You have withdrawn. Solo play remains available.');
      }
    };
    socket.onerror = () =>
      this.report_error(
        new Error('Multiplayer connection failed. Try again; solo play remains available.'),
      );
  }

  private receive(message: Server_Message) {
    if (!message || message.version !== PROTOCOL_VERSION) {
      throw new Error('Room protocol upgraded. Reload and recreate the room.');
    }
    if (message.type === 'error') {
      this.report_error(new Error(message.message));
      return;
    }
    if (message.type === 'clock') {
      const pending = this.pending_clock_requests.get(message.sequence);
      if (!pending) {
        return;
      }
      this.clock_samples.push(
        clock_sample(message.client_ms, performance.now(), message.server_ms),
      );
      clearTimeout(pending.timer);
      this.pending_clock_requests.delete(message.sequence);
      pending.resolve();
    } else if (message.type === 'score') {
      if (message.round_id !== this.state.room?.round?.round_id) {
        return;
      }
      this.publish({
        scores: {
          ...this.state.scores,
          [message.member_id]: {
            ...message.report,
            received_ms: performance.now(),
          },
        },
      });
    } else if (message.type === 'snapshot') {
      this.apply_snapshot(message);
    }
  }

  private apply_snapshot(message: Room_Snapshot) {
    if (
      message.room_id !== this.room_id ||
      (this.state.room && message.sequence < this.state.room.sequence)
    ) {
      return;
    }
    const needs_check = this.check_on_snapshot;
    this.check_on_snapshot = false;
    const previous_revision = this.state.room?.selection_revision;
    const returning_to_lobby = this.state.room?.phase !== 'lobby' && message.phase === 'lobby';
    const previous_round_id = this.state.room?.round?.round_id;
    this.publish({
      room: message,
      ...(previous_round_id !== message.round?.round_id ? { scores: {} } : {}),
    });

    if (message.phase === 'lobby' && this.local_round_id) {
      this.local_round_id = null;
      this.terminal_report = null;
      this.terminal_report_sent = false;
      this.player.back();
    }
    if (
      message.phase === 'lobby' &&
      (needs_check || previous_revision !== message.selection_revision || returning_to_lobby) &&
      !(this.host_preparation_generation !== null && message.host_id === message.member_id)
    ) {
      void this.check_map();
    }
    if (
      message.phase === 'countdown' &&
      message.round &&
      this.local_round_id !== message.round.round_id
    ) {
      this.local_round_id = message.round.round_id;
      this.terminal_report = null;
      this.terminal_report_sent = false;
      void this.arm_round(message);
    }
    if (
      message.round?.results[message.member_id]?.status === 'withdrawn' &&
      this.local_round_id &&
      !this.terminal_report
    ) {
      this.withdraw('This run was withdrawn.');
    }
    if (
      message.phase === 'playing' &&
      !this.local_round_id &&
      message.round?.participants.includes(message.member_id)
    ) {
      this.local_round_id = message.round.round_id;
      this.withdraw('This page did not arm the round before launch. You have withdrawn.');
    }
  }

  private send_command(message: Client_Command): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.socket.send(
      JSON.stringify({
        ...message,
        version: 2,
        sequence: ++this.sequence,
      }),
    );
    return true;
  }

  private async synchronize() {
    this.clock_samples = [];
    for (let sample_index = 0; sample_index < 5; sample_index++) {
      if (!this.state.connected) {
        throw new Error('Connect to the room before readying.');
      }
      await new Promise<void>((resolve, reject) => {
        const sequence = this.sequence + 1;
        const timer = setTimeout(() => {
          this.pending_clock_requests.delete(sequence);
          reject(new Error('Clock synchronization timed out.'));
        }, 1500);
        this.pending_clock_requests.set(sequence, {
          resolve,
          reject,
          timer,
        });
        this.send_command({
          type: 'clock',
          client_ms: performance.now(),
        });
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 220));
    }
    const sample = [...this.clock_samples].sort(
      (left, right) => left.round_trip_ms - right.round_trip_ms,
    )[0];
    if (!sample || sample.round_trip_ms > 200) {
      throw new Error('Clock synchronization is too uncertain. Try again on a faster connection.');
    }
    return sample;
  }

  async ready() {
    // Invoke resume synchronously in the Ready gesture, before any network await.
    const revision = this.state.room?.selection_revision;
    const generation = this.preparation_generation;
    const audio_unlock = this.player.audio_context.resume();
    this.publish({
      busy: true,
      error: null,
    });
    try {
      await audio_unlock;
      if (
        !this.state.prepared ||
        !this.player.view.can_play ||
        this.player.audio_context.state !== 'running'
      ) {
        throw new Error('Import matching files and enable audio before readying.');
      }
      await this.synchronize();
      if (
        this.disposed ||
        generation !== this.preparation_generation ||
        revision !== this.prepared_revision ||
        revision !== this.state.room?.selection_revision ||
        this.state.room?.phase !== 'lobby' ||
        !this.state.prepared
      ) {
        return;
      }
      this.send_command({
        type: 'ready',
        ready: true,
        selection_revision: this.state.room?.selection_revision ?? 0,
      });
    } catch (error) {
      this.report_error(error);
    } finally {
      this.publish({ busy: false });
    }
  }
  reconnect() {
    if (this.reconnect_timer) {
      clearTimeout(this.reconnect_timer);
    }
    this.disconnected_ms = null;
    this.open_socket();
  }
  unready() {
    this.send_command({
      type: 'ready',
      ready: false,
      selection_revision: this.state.room?.selection_revision ?? 0,
    });
  }
  start() {
    this.send_command({
      type: 'start',
      selection_revision: this.state.room?.selection_revision ?? 0,
    });
  }
  rematch() {
    this.send_command({ type: 'rematch' });
  }

  private async arm_round(snapshot: Room_Snapshot) {
    const round = snapshot.round!;
    try {
      const sample = await this.synchronize();
      if (
        this.disposed ||
        this.local_round_id !== round.round_id ||
        this.state.room?.phase !== 'countdown'
      ) {
        return;
      }
      if (!this.state.prepared || this.prepared_revision !== round.selection_revision) {
        throw new Error('The current map was not prepared for this round.');
      }
      if (this.player.audio_context.state !== 'running') {
        throw new Error('Audio is suspended.');
      }
      const audio_seconds = scheduled_audio_time(
        round.start_ms,
        sample,
        performance.now(),
        this.player.audio_context.currentTime,
      );
      await this.player.play_scheduled(audio_seconds);
      if (
        this.local_round_id === round.round_id &&
        !['running', 'terminal'].includes(this.player.view.state)
      ) {
        throw new Error(this.player.view.message);
      }
    } catch (error) {
      if (this.local_round_id === round.round_id) {
        this.withdraw(error instanceof Error ? error.message : 'Unable to arm playback.');
      }
    }
  }

  private observe_player() {
    if (!this.local_round_id || this.terminal_report) {
      return;
    }
    const view = this.player.view;
    if (view.state === 'terminal' && view.result) {
      // Continue-after-failure runs finish PASSED with a frozen F rank; the
      // rank, not the terminal state, classifies the report.
      const run_failed = view.result.summary.state === SESSION_STATE.FAILED ||
        Number(view.result.summary.rank) === RANK.F;
      this.terminal_report = {
        status: run_failed ? 'failed' : 'completed',
        score: Number(view.result.summary.score),
        accuracy: Number(view.result.summary.accuracy),
        combo: Number(view.result.summary.highest_combo),
        progress: Math.min(
          1,
          Math.max(
            0,
            Number(view.result.summary.terminal_ms) /
              (this.state.room?.round?.selected_map.end_ms ?? 1),
          ),
        ),
      };
      this.report_score();
    } else if (['paused', 'recovering', 'disposed'].includes(view.state)) {
      this.withdraw('Playback interrupted. You have withdrawn; other players continue.');
    }
  }

  private report_score() {
    if (this.disposed) {
      return;
    }
    // Also refresh stale labels without receiving network traffic.
    this.publish({});
    if (!this.local_round_id) {
      return;
    }
    if (this.terminal_report) {
      if (!this.terminal_report_sent && this.state.connected) {
        this.terminal_report_sent = this.send_command({
          type: 'terminal',
          round_id: this.local_round_id,
          report: this.terminal_report,
        });
      }
      return;
    }
    if (this.player.view.state !== 'running' || !this.state.connected) {
      return;
    }
    const score = this.player.multiplayer_score;
    if (score) {
      this.send_command({
        type: 'score',
        round_id: this.local_round_id,
        report: {
          score: score.score,
          accuracy: score.accuracy,
          combo: score.combo,
          progress: Math.min(
            1,
            Math.max(0, score.committed_ms / (this.state.room?.round?.selected_map.end_ms ?? 1)),
          ),
        },
      });
    }
  }
  withdraw(message = 'You have withdrawn from this round.') {
    if (this.local_round_id && !this.terminal_report) {
      this.terminal_report = {
        status: 'withdrawn',
        score: 0,
        accuracy: 0,
        combo: 0,
        progress: 0,
      };
      this.report_score();
      this.player.back();
    }
    this.report_error(new Error(message));
  }
  leave() {
    this.send_command({ type: 'leave' });
    this.dispose();
  }
  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.publish({ connected: false });
    this.preparation_generation++;
    this.player.set_fail_policy(FAIL_POLICY.TERMINAL);
    this.player.selection.cancel_pending();
    this.unsubscribe_player();
    window.removeEventListener('pagehide', this.pagehide);
    this.player.audio_context.removeEventListener('statechange', this.audio_changed);
    clearInterval(this.score_interval);
    if (this.reconnect_timer) {
      clearTimeout(this.reconnect_timer);
    }
    for (const pending of this.pending_clock_requests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Room closed.'));
    }
    this.pending_clock_requests.clear();
    this.socket?.close(1000, 'Left room');
    if (this.local_round_id) {
      this.player.back();
    }
    this.listeners.clear();
  }
}
