import { DurableObject } from 'cloudflare:workers';
import {
  DEMO_DURATION_MS,
  RECONNECT_MS,
  parse_client_message,
  type Client_Message,
  type Room_Member,
  type Room_Round,
  type Room_Snapshot,
  type Server_Message,
} from '../shared/multiplayer';
import build_identity from '../artifacts/multiplayer_identity.json';

const ROOM_IDLE_TIMEOUT_MS = 30 * 60_000;
const ROOM_MAX_LIFETIME_MS = 4 * 60 * 60_000;
const ROOM_PATTERN = /^[a-f0-9]{32}$/;
const WITHDRAWN_REPORT = {
  status: 'withdrawn' as const,
  score: 0,
  accuracy: 0,
  combo: 0,
  progress: 0,
};
interface Stored_Member extends Room_Member {
  token_hash: string;
  joined_ms: number;
  disconnected_ms: number | null;
  connection_id?: string;
  socket_id?: string;
  traffic?: Socket_State;
}
interface Stored_Room {
  room_id: string;
  created_ms: number;
  active_ms: number;
  sequence: number;
  host_id: string;
  phase: Room_Snapshot['phase'];
  members: Stored_Member[];
  round: Room_Round | null;
}
interface Socket_State {
  member_id: string;
  socket_id: string;
  sequence: number;
  window_ms: number;
  received_ms: number;
  count: number;
  score_ms: number;
}
const response_json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
const failure = (code: string, status: number) =>
  response_json(
    {
      error: code,
      message: 'Multiplayer is unavailable. Try again; solo play remains available.',
    },
    status,
  );
const random_id = () => crypto.randomUUID().replaceAll('-', '');
class Invalid_Request extends Error {}
async function hash_token(token: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
function same_token(left: string, right: string) {
  return crypto.subtle.timingSafeEqual(
    new TextEncoder().encode(left),
    new TextEncoder().encode(right),
  );
}
function count_event(event: string) {
  console.log(
    JSON.stringify({
      event: `multiplayer_${event}`,
      count: 1,
    }),
  );
}
async function read_member_token_hash(request: Request): Promise<string | null> {
  const cookie_prefix = 'tapweave_member=';
  const member_cookie = request.headers
    .get('Cookie')
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(cookie_prefix));
  const credential = member_cookie?.slice(cookie_prefix.length);
  if (!credential || !/^[a-f0-9]{64}$/.test(credential)) {
    return null;
  }
  return hash_token(credential);
}

async function read_nickname(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) {
    throw new Invalid_Request('Missing body');
  }
  let byte_count = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      byte_count += chunk.value.byteLength;
      if (byte_count > 4096) {
        throw new Invalid_Request('Body exceeds limit');
      }
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(byte_count);
  let write_offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, write_offset);
    write_offset += chunk.byteLength;
  }
  const nickname = JSON.parse(new TextDecoder().decode(bytes)).nickname;
  if (
    typeof nickname !== 'string' ||
    !nickname.trim() ||
    [...nickname.trim()].length > 24 ||
    /[\u0000-\u001f\u007f]/.test(nickname)
  ) {
    throw new Invalid_Request('Invalid nickname');
  }
  return nickname.trim();
}

export default {
  async fetch(request: Request, environment: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/multiplayer/')) {
      return environment.ASSETS.fetch(request);
    }
    if (url.pathname === '/api/multiplayer/status' && request.method === 'GET') {
      return response_json({
        enabled: String(environment.MULTIPLAYER_ENABLED) === 'true',
        version: 1,
      });
    }
    if (request.headers.get('Origin') !== url.origin) {
      return failure('ORIGIN', 403);
    }
    try {
      if (url.pathname === '/api/multiplayer/rooms' && request.method === 'POST') {
        if (String(environment.MULTIPLAYER_ENABLED) !== 'true') {
          return failure('DISABLED', 503);
        }
        const nickname = await read_nickname(request);
        const room_id = random_id();
        return await environment.MULTIPLAYER_ROOMS.getByName(room_id).join(
          room_id,
          nickname,
          true,
          null,
        );
      }
      const route = /^\/api\/multiplayer\/([a-f0-9]{32})\/(join|socket)$/.exec(url.pathname);
      if (!route) {
        return failure('NOT_FOUND', 404);
      }
      const [, room_id, operation] = route;
      const token_hash = await read_member_token_hash(request);
      const room = environment.MULTIPLAYER_ROOMS.getByName(room_id);
      if (operation === 'join' && request.method === 'POST') {
        return await room.join(room_id, await read_nickname(request), false, token_hash);
      }
      if (
        operation === 'socket' &&
        request.method === 'GET' &&
        request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
      ) {
        return await room.fetch(request);
      }
      return failure('METHOD', 405);
    } catch (error) {
      count_event('request_failure');
      return error instanceof SyntaxError || error instanceof Invalid_Request
        ? failure('INVALID_REQUEST', 400)
        : failure('SERVICE_FAILURE', 503);
    }
  },
} satisfies ExportedHandler<Env>;

export class Multiplayer_Room extends DurableObject<Env> {
  private expired = false;
  constructor(context: DurableObjectState, environment: Env) {
    super(context, environment);
    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS room (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), payload TEXT NOT NULL)',
    );
    // Socket attachments survive hibernation. Live scores deliberately do not;
    // connected clients send fresh reports every 500 ms.
  }

  private read_room(): Stored_Room | null {
    if (this.expired) {
      return null;
    }
    const rows = this.ctx.storage.sql
      .exec<{
        payload: string;
      }>('SELECT payload FROM room WHERE singleton = 1')
      .toArray();
    return rows.length ? JSON.parse(rows[0].payload) : null;
  }

  private open_sockets(member_id?: string) {
    return this.ctx
      .getWebSockets(member_id)
      .filter((socket) => socket.readyState === WebSocket.OPEN);
  }

  private save_room(room: Stored_Room) {
    room.sequence++;
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO room VALUES (1, ?)', JSON.stringify(room));
  }

  private expiration_time(room: Stored_Room) {
    return Math.min(room.created_ms + ROOM_MAX_LIFETIME_MS, room.active_ms + ROOM_IDLE_TIMEOUT_MS);
  }

  private async schedule_next_alarm(room: Stored_Room) {
    const deadlines = [this.expiration_time(room)];
    if (room.round && (room.phase === 'countdown' || room.phase === 'playing')) {
      deadlines.push(room.phase === 'countdown' ? room.round.start_ms : room.round.deadline_ms);
    }
    for (const member of room.members) {
      if (member.disconnected_ms !== null) {
        deadlines.push(member.disconnected_ms + RECONNECT_MS);
      }
      if (room.phase === 'playing' && member.connected && !room.round?.results[member.member_id]) {
        const attachment: Socket_State | undefined = this.open_sockets(
          member.member_id,
        )[0]?.deserializeAttachment();
        if (attachment) {
          deadlines.push(attachment.received_ms + RECONNECT_MS);
        }
      }
    }
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.min(...deadlines)));
  }

  private send_message(socket: WebSocket, message: Server_Message) {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      /* Close/error callback owns membership transitions. */
    }
  }

  private broadcast_snapshot(room: Stored_Room) {
    for (const socket of this.open_sockets()) {
      const attachment: Socket_State = socket.deserializeAttachment();
      this.send_message(socket, {
        version: 1,
        type: 'snapshot',
        sequence: room.sequence,
        room_id: room.room_id,
        member_id: attachment.member_id,
        host_id: room.host_id,
        phase: room.phase,
        members: room.members.map(({ member_id, nickname, ready, connected }) => ({
          member_id,
          nickname,
          ready,
          connected,
        })),
        round: room.round,
        identity: build_identity.identity,
        expires_ms: this.expiration_time(room),
      });
    }
  }

  private transfer_host_if_disconnected(room: Stored_Room) {
    if (!room.members.some((member) => member.member_id === room.host_id && member.connected)) {
      room.host_id =
        room.members
          .filter((member) => member.connected)
          .sort((left, right) => left.joined_ms - right.joined_ms)[0]?.member_id ?? '';
    }
  }

  private cancel_countdown(room: Stored_Room) {
    if (room.phase !== 'countdown') {
      return;
    }
    room.phase = 'lobby';
    room.round = null;
    for (const member of room.members) {
      member.ready = false;
    }
    count_event('countdown_cancelled');
  }

  private finish_round_if_complete(room: Stored_Room) {
    if (
      room.phase === 'playing' &&
      room.round?.participants.every((member_id) => room.round!.results[member_id])
    ) {
      room.phase = 'results';
      for (const member of room.members) {
        member.ready = false;
      }
      count_event('round_closed');
    }
  }

  private withdraw_member(room: Stored_Room, member_id: string) {
    if (room.phase === 'countdown') {
      this.cancel_countdown(room);
      return;
    }
    if (room.phase === 'playing' && room.round?.participants.includes(member_id)) {
      room.round.results[member_id] ??= { ...WITHDRAWN_REPORT };
      this.finish_round_if_complete(room);
    }
  }

  private async expire_room() {
    for (const socket of this.open_sockets()) {
      socket.close(4000, 'Room expired');
    }
    this.expired = true;
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    count_event('expired');
  }
  // Apply elapsed deadlines before every command, not just when alarms arrive.
  private apply_elapsed_deadlines(room: Stored_Room) {
    const now_ms = Date.now();
    if (room.phase === 'countdown' && room.round && now_ms >= room.round.start_ms) {
      room.phase = 'playing';
      count_event('round_started');
    }
    for (const member of room.members) {
      if (room.phase === 'playing' && member.connected && !room.round?.results[member.member_id]) {
        const socket = this.open_sockets(member.member_id)[0];
        const attachment: Socket_State | undefined = socket?.deserializeAttachment();
        if (attachment && now_ms >= attachment.received_ms + RECONNECT_MS) {
          this.withdraw_member(room, member.member_id);
          member.connected = false;
          member.ready = false;
          member.disconnected_ms = null;
          socket.close(4002, 'Reconnection deadline expired');
          count_event('reconnect_expired');
        }
      }
      if (member.disconnected_ms !== null && now_ms >= member.disconnected_ms + RECONNECT_MS) {
        this.withdraw_member(room, member.member_id);
        member.disconnected_ms = null;
      }
    }
    if (room.phase === 'playing' && room.round && now_ms >= room.round.deadline_ms) {
      for (const member_id of room.round.participants) {
        room.round.results[member_id] ??= { ...WITHDRAWN_REPORT };
      }
      this.finish_round_if_complete(room);
    }
    // Retain names for results; free abandoned lobby seats after the grace period.
    if (room.phase === 'lobby') {
      room.members = room.members.filter(
        (member) => member.connected || member.disconnected_ms !== null,
      );
    }
    this.transfer_host_if_disconnected(room);
  }

  async join(
    room_id: string,
    nickname: string,
    creating: boolean,
    token_hash: string | null,
  ): Promise<Response> {
    if (!ROOM_PATTERN.test(room_id)) {
      return failure('NOT_FOUND', 404);
    }
    let room = this.read_room();
    if (room && Date.now() >= this.expiration_time(room)) {
      await this.expire_room();
      return failure('EXPIRED', 410);
    }
    if (!room && !creating) {
      return failure('NOT_FOUND', 404);
    }
    if (room && creating) {
      return failure('CONFLICT', 409);
    }
    if (!room) {
      room = {
        room_id,
        created_ms: Date.now(),
        active_ms: Date.now(),
        sequence: 0,
        host_id: '',
        phase: 'lobby',
        members: [],
        round: null,
      };
    }
    this.apply_elapsed_deadlines(room);
    const existing =
      token_hash && room.members.find((member) => same_token(member.token_hash, token_hash));
    if (existing) {
      return response_json({
        room_id,
        member_id: existing.member_id,
      });
    }
    if (room.phase !== 'lobby') {
      return failure('ROUND_ACTIVE', 409);
    }
    if (room.members.length >= 8) {
      return failure('ROOM_FULL', 409);
    }
    const credential = random_id() + random_id();
    // Hash before reading authoritative state again: concurrent joins must not
    // overwrite membership while Web Crypto yields.
    const credential_hash = await hash_token(credential);
    room = this.read_room() ?? room;
    if (room.phase !== 'lobby' || room.members.length >= 8) {
      return failure('ROOM_FULL', 409);
    }
    const member_id = random_id();
    room.members.push({
      member_id,
      nickname,
      token_hash: credential_hash,
      joined_ms: Date.now(),
      ready: false,
      connected: false,
      disconnected_ms: Date.now(),
    });
    if (!room.host_id) {
      room.host_id = member_id;
    }
    room.active_ms = Date.now();
    this.save_room(room);
    await this.schedule_next_alarm(room);
    this.broadcast_snapshot(this.read_room()!);
    count_event(creating ? 'created' : 'joined');
    return response_json(
      {
        room_id,
        member_id,
      },
      200,
      {
        'Set-Cookie': `tapweave_member=${credential}; Path=/api/multiplayer/${room_id}/; Secure; HttpOnly; SameSite=Strict; Max-Age=14400`,
      },
    );
  }
  // WebSocket upgrades use the fetch transport: RPC cannot serialize sockets.
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.headers.get('Origin') !== url.origin ||
      request.headers.get('Upgrade')?.toLowerCase() !== 'websocket'
    ) {
      return failure('ORIGIN', 403);
    }
    const token_hash = await read_member_token_hash(request);
    return this.open_socket(
      token_hash,
      url.searchParams.get('resume'),
      url.searchParams.get('connection'),
    );
  }

  private async open_socket(
    token_hash: string | null,
    resume_round: string | null,
    connection_id: string | null,
  ): Promise<Response> {
    const room = this.read_room();
    if (!room) {
      return failure('NOT_FOUND', 404);
    }
    if (Date.now() >= this.expiration_time(room)) {
      await this.expire_room();
      return failure('EXPIRED', 410);
    }
    this.apply_elapsed_deadlines(room);
    const member = room.members.find(
      (candidate) => token_hash && same_token(candidate.token_hash, token_hash),
    );
    if (!member) {
      return failure('MEMBERSHIP', 401);
    }
    if (!connection_id || !ROOM_PATTERN.test(connection_id)) {
      return failure('CONNECTION_ID', 400);
    }
    const previous_sockets = this.open_sockets(member.member_id);
    const same_connection = connection_id === member.connection_id;
    const resuming =
      same_connection && resume_round === room.round?.round_id && room.phase === 'playing';
    // Replace a half-open connection only for the same in-memory running
    // session. Refresh has a new connection identity and withdraws the old run.
    if (previous_sockets.length && !same_connection && room.phase !== 'playing') {
      return failure('ALREADY_CONNECTED', 409);
    }
    const previous_traffic: Socket_State | undefined =
      previous_sockets[0]?.deserializeAttachment() ?? member.traffic;
    if (room.phase === 'playing' && !resuming) {
      this.withdraw_member(room, member.member_id);
    }
    for (const previous_socket of previous_sockets) {
      previous_socket.close(4001, 'Connection replaced');
    }
    member.connection_id = connection_id;
    member.socket_id = random_id();
    if (room.phase === 'countdown') {
      this.cancel_countdown(room);
    }
    member.connected = true;
    member.disconnected_ms = null;
    member.ready = false;
    this.transfer_host_if_disconnected(room);
    room.active_ms = Date.now();
    this.save_room(room);
    const socket_pair = new WebSocketPair();
    const [client_socket, server_socket] = Object.values(socket_pair);
    this.ctx.acceptWebSocket(server_socket, [member.member_id]);
    server_socket.serializeAttachment({
      member_id: member.member_id,
      socket_id: member.socket_id,
      sequence: same_connection ? (previous_traffic?.sequence ?? 0) : 0,
      window_ms: previous_traffic?.window_ms ?? Date.now(),
      received_ms: Date.now(),
      count: previous_traffic?.count ?? 0,
      score_ms: previous_traffic?.score_ms ?? 0,
    } satisfies Socket_State);
    await this.schedule_next_alarm(room);
    this.broadcast_snapshot(this.read_room()!);
    count_event('connected');
    return new Response(null, {
      status: 101,
      webSocket: client_socket,
    });
  }

  private set_member_ready(
    room: Stored_Room,
    member: Stored_Member,
    message: Extract<Client_Message, { type: 'ready' }>,
  ) {
    if (room.phase !== 'lobby' && room.phase !== 'countdown') {
      throw new Error('Return to the lobby first.');
    }
    if (message.ready && message.identity !== build_identity.identity) {
      throw new Error('Incompatible demo or engine build. Reload this page.');
    }
    if (!message.ready) {
      this.cancel_countdown(room);
    }
    member.ready = message.ready;
  }

  private start_countdown(room: Stored_Room, member: Stored_Member) {
    if (member.member_id !== room.host_id) {
      throw new Error('Only the host can start.');
    }
    if (
      room.phase !== 'lobby' ||
      room.members.length < 2 ||
      !room.members.every((candidate) => candidate.ready && candidate.connected)
    ) {
      throw new Error('At least two connected, ready players are required.');
    }
    const start_ms = Date.now() + 5000;
    room.round = {
      round_id: random_id(),
      start_ms,
      deadline_ms: start_ms + DEMO_DURATION_MS + RECONNECT_MS,
      participants: room.members.map((candidate) => candidate.member_id),
      results: {},
    };
    room.phase = 'countdown';
    count_event('countdown');
  }

  private open_rematch(room: Stored_Room, member: Stored_Member) {
    if (member.member_id !== room.host_id || room.phase !== 'results') {
      throw new Error('Only the host can open a rematch after results.');
    }
    room.phase = 'lobby';
    room.round = null;
    room.members = room.members.filter((candidate) => candidate.connected);
    for (const candidate of room.members) {
      candidate.ready = false;
    }
  }

  private leave_room(room: Stored_Room, member: Stored_Member, socket: WebSocket) {
    this.withdraw_member(room, member.member_id);
    member.connected = false;
    member.ready = false;
    member.disconnected_ms = null;
    if (room.phase === 'lobby') {
      room.members = room.members.filter((candidate) => candidate !== member);
    }
    this.transfer_host_if_disconnected(room);
    socket.close(1000, 'Left room');
  }

  private accept_score_report(
    room: Stored_Room,
    member: Stored_Member,
    socket: WebSocket,
    attachment: Socket_State,
    message: Extract<Client_Message, { type: 'score' | 'terminal' }>,
  ) {
    const round = room.round;
    if (
      !round ||
      round.round_id !== message.round_id ||
      !round.participants.includes(member.member_id)
    ) {
      throw new Error('Stale round.');
    }
    const withdrawing_before_start =
      message.type === 'terminal' &&
      message.report.status === 'withdrawn' &&
      room.phase === 'countdown';
    if (withdrawing_before_start) {
      this.cancel_countdown(room);
      return;
    }
    if (room.phase !== 'playing' || round.results[member.member_id]) {
      throw new Error('Round is not accepting reports.');
    }
    if (message.type === 'score') {
      if (Date.now() - attachment.score_ms < 500) {
        throw new Error('Score reports are limited to twice a second.');
      }
      attachment.score_ms = Date.now();
      socket.serializeAttachment(attachment);
      for (const recipient of this.open_sockets()) {
        this.send_message(recipient, {
          version: 1,
          type: 'score',
          round_id: message.round_id,
          member_id: member.member_id,
          sequence: message.sequence,
          report: message.report,
        });
      }
      return;
    }
    round.results[member.member_id] = message.report;
    this.finish_round_if_complete(room);
    count_event('terminal');
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    try {
      const room = this.read_room();
      if (!room) {
        socket.close(4000, 'Room expired');
        return;
      }
      if (Date.now() >= this.expiration_time(room)) {
        await this.expire_room();
        return;
      }
      const attachment: Socket_State = socket.deserializeAttachment();
      if (Date.now() - attachment.window_ms >= 1000) {
        attachment.window_ms = Date.now();
        attachment.count = 0;
      }
      attachment.count++;
      attachment.received_ms = Date.now();
      socket.serializeAttachment(attachment);
      if (attachment.count > 10) {
        socket.close(4008, 'Rate limit');
        count_event('rate_limited');
        return;
      }
      if (typeof raw !== 'string') {
        throw new Error('Text messages required.');
      }
      const message = parse_client_message(raw);
      if (message.sequence <= attachment.sequence) {
        throw new Error('Stale or duplicate sequence.');
      }
      attachment.sequence = message.sequence;
      socket.serializeAttachment(attachment);
      this.apply_elapsed_deadlines(room);
      const member = room.members.find((candidate) => candidate.member_id === attachment.member_id);
      if (!member?.connected || member.socket_id !== attachment.socket_id) {
        throw new Error('Membership required.');
      }
      if (message.type === 'clock') {
        this.send_message(socket, {
          version: 1,
          type: 'clock',
          sequence: message.sequence,
          client_ms: message.client_ms,
          server_ms: Date.now(),
        });
        return;
      }
      if (message.type === 'score' || message.type === 'terminal') {
        this.accept_score_report(room, member, socket, attachment, message);
        if (message.type === 'score') {
          return;
        }
      } else if (message.type === 'ready') {
        this.set_member_ready(room, member, message);
      } else if (message.type === 'start') {
        this.start_countdown(room, member);
      } else if (message.type === 'rematch') {
        this.open_rematch(room, member);
      } else if (message.type === 'leave') {
        this.leave_room(room, member, socket);
      }
      // Clock replies and live scores return above without persisting. Commands
      // that change membership or round state are saved before broadcasting.
      room.active_ms = Date.now();
      this.save_room(room);
      await this.schedule_next_alarm(room);
      this.broadcast_snapshot(this.read_room()!);
    } catch (error) {
      count_event('message_rejected');
      this.send_message(socket, {
        version: 1,
        type: 'error',
        code: 'REJECTED',
        message: error instanceof Error ? error.message : 'Recoverable multiplayer failure.',
      });
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string, was_clean: boolean) {
    // Complete the close handshake so the retired connection cannot block a reconnect.
    socket.close(code === 1005 || code === 1006 ? 1000 : code, 'Connection closed');
    const room = this.read_room();
    if (!room) {
      return;
    }
    const attachment: Socket_State = socket.deserializeAttachment();
    const member = room.members.find((candidate) => candidate.member_id === attachment.member_id);
    if (!member?.connected || member.socket_id !== attachment.socket_id) {
      return;
    }
    member.traffic = attachment;
    this.apply_elapsed_deadlines(room);
    this.cancel_countdown(room);
    member.connected = false;
    member.ready = false;
    member.disconnected_ms = Date.now();
    this.transfer_host_if_disconnected(room);
    this.save_room(room);
    await this.schedule_next_alarm(room);
    this.broadcast_snapshot(this.read_room()!);
    count_event('disconnected');
  }

  async webSocketError(socket: WebSocket) {
    socket.close(1011, 'Connection failure');
    await this.webSocketClose(socket, 1011, '', false);
  }

  async alarm() {
    const room = this.read_room();
    if (!room) {
      return;
    }
    if (Date.now() >= this.expiration_time(room)) {
      await this.expire_room();
      return;
    }
    this.apply_elapsed_deadlines(room);
    this.save_room(room);
    await this.schedule_next_alarm(room);
    this.broadcast_snapshot(this.read_room()!);
  }
}
