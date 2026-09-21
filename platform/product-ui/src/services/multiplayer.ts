import {
  DEMO_DURATION_MS,
  RECONNECT_MS,
  type Client_Command,
  type Room_Snapshot,
  type Score_Report,
  type Server_Message,
  type Terminal_Report,
} from '../../shared/multiplayer';
import build_identity from '../../artifacts/multiplayer_identity.json';
import { SESSION_STATE } from '@browser/abi-records.js';
import type { Player_Session_Service } from './player_session';

export interface Multiplayer_State {
  room: Room_Snapshot | null;
  connected: boolean;
  prepared: boolean;
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
  private demo_preparation: Promise<void> | null = null;
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
          identity: build_identity.identity,
        });
      }
    }
  };
  constructor(
    readonly player: Player_Session_Service,
    readonly room_id: string,
  ) {
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
      await this.prepare_demo();
    } catch (error) {
      this.report_error(error);
    } finally {
      if (!this.disposed) {
        this.publish({ busy: false });
      }
    }
  }

  private async prepare_demo() {
    if (this.demo_preparation) {
      return this.demo_preparation;
    }
    this.demo_preparation = (async () => {
      this.publish({ prepared: false });
      this.player.back();
      const response = await fetch('/demo/tapweave-demo.osz', { cache: 'reload' });
      if (!response.ok) {
        throw new Error('Demo download failed. Try joining again.');
      }
      const bytes = await response.arrayBuffer();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      if (digest !== build_identity.archive_hash) {
        throw new Error('Demo files differ from this release. Reload the page.');
      }
      if (this.disposed) {
        return;
      }
      await this.player.load_files([
        new File([bytes], 'tapweave-demo.osz', { type: 'application/zip' }),
      ]);
      if (!this.player.view.can_play) {
        throw new Error(this.player.view.message);
      }
      this.publish({ prepared: true });
    })();
    try {
      await this.demo_preparation;
    } finally {
      this.demo_preparation = null;
    }
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
      this.publish({
        connected: false,
        error: 'Connection lost. Reconnecting for up to 30 seconds; live scores are stale.',
      });
      if ([4000, 4001, 4002, 4008].includes(event.code)) {
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
    if (!message || message.version !== 1) {
      throw new Error('Incompatible room protocol. Reload the page.');
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
    const previous_round_id = this.state.room?.round?.round_id;
    this.publish({
      room: message,
      ...(previous_round_id !== message.round?.round_id ? { scores: {} } : {}),
    });
    if (message.identity !== build_identity.identity) {
      this.report_error(new Error('Incompatible engine or demo build. Reload to join.'));
    }
    if (message.phase === 'lobby' && this.local_round_id) {
      this.local_round_id = null;
      this.terminal_report = null;
      this.terminal_report_sent = false;
      this.player.back();
      this.publish({ prepared: this.player.view.can_play });
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
        version: 1,
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
        throw new Error('Prepare the demo and enable audio before readying.');
      }
      await this.synchronize();
      this.send_command({
        type: 'ready',
        ready: true,
        identity: build_identity.identity,
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
      identity: build_identity.identity,
    });
  }
  start() {
    this.send_command({ type: 'start' });
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
      this.terminal_report = {
        status: view.result.summary.state === SESSION_STATE.PASSED ? 'completed' : 'failed',
        score: Number(view.result.summary.score),
        accuracy: Number(view.result.summary.accuracy),
        combo: Number(view.result.summary.highest_combo),
        progress: Math.min(1, Number(view.result.summary.terminal_ms) / DEMO_DURATION_MS),
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
          progress: Math.min(1, Math.max(0, score.committed_ms / DEMO_DURATION_MS)),
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
