import { env, exports } from 'cloudflare:workers';
import { afterEach, expect, test } from 'vitest';
import {
  reset,
  runInDurableObject,
  runDurableObjectAlarm,
  evictDurableObject,
} from 'cloudflare:test';
import identity from '../artifacts/multiplayer_identity.json';
import {
  ranked_results,
  type Server_Message,
  type Room_Member,
  type Room_Round,
} from '../shared/multiplayer';

const origin = 'https://tapweave.test';
const sockets: WebSocket[] = [];
const sequences = new Map<string, number>();
afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.close();
  }
  await reset();
});
async function request(path: string, nickname = 'Player', cookie = '', origin_header = origin) {
  return exports.default.fetch(origin + path, {
    method: 'POST',
    headers: {
      Origin: origin_header,
      Cookie: cookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ nickname }),
  });
}
async function create(nickname = 'Host') {
  const response = await request('/api/multiplayer/rooms', nickname);
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    room_id: string;
    member_id: string;
  };
  const cookie = response.headers.get('Set-Cookie')!;
  expect(cookie).toMatch(/Secure; HttpOnly; SameSite=Strict/);
  expect(cookie).toContain(`Path=/api/multiplayer/${body.room_id}/`);
  return {
    ...body,
    cookie: cookie.split(';')[0],
  };
}
async function join(room_id: string, nickname = 'Friend') {
  const response = await request(`/api/multiplayer/${room_id}/join`, nickname);
  expect(response.status).toBe(200);
  return {
    ...((await response.json()) as {
      room_id: string;
      member_id: string;
    }),
    cookie: response.headers.get('Set-Cookie')!.split(';')[0],
  };
}
async function connect(
  member: {
    room_id: string;
    cookie: string;
    member_id: string;
  },
  resume = '',
) {
  const response = await exports.default.fetch(
    `${origin}/api/multiplayer/${member.room_id}/socket?resume=${resume}&connection=${member.member_id}`,
    {
      headers: {
        Origin: origin,
        Cookie: member.cookie,
        Upgrade: 'websocket',
      },
    },
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  const messages: Server_Message[] = [];
  socket.addEventListener('message', (event) => {
    messages.push(JSON.parse(event.data as string));
  });
  socket.accept();
  sockets.push(socket);
  let sequence = sequences.get(member.member_id) ?? 0;
  return {
    socket,
    messages,
    send(message: Record<string, unknown>) {
      sequences.set(member.member_id, sequence + 1);
      socket.send(
        JSON.stringify({
          version: 1,
          sequence: ++sequence,
          ...message,
        }),
      );
    },
    async wait<Message_Type extends Server_Message['type']>(
      type: Message_Type,
      predicate: (message: Extract<Server_Message, { type: Message_Type }>) => unknown = () => true,
    ): Promise<Extract<Server_Message, { type: Message_Type }>> {
      await expect
        .poll(() =>
          messages.find(
            (message) =>
              message.type === type &&
              predicate(message as Extract<Server_Message, { type: Message_Type }>),
          ),
        )
        .toBeTruthy();
      const message_index = messages.findIndex(
        (message) =>
          message.type === type &&
          predicate(message as Extract<Server_Message, { type: Message_Type }>),
      );
      return messages.splice(message_index, 1)[0] as Extract<
        Server_Message,
        { type: Message_Type }
      >;
    },
  };
}
const room_stub = (room_id: string) => env.MULTIPLAYER_ROOMS.getByName(room_id);
interface Stored_Test_Room {
  created_ms: number;
  active_ms: number;
  members: (Room_Member & { disconnected_ms: number | null })[];
  round: Room_Round | null;
}
async function edit_stored_room(room_id: string, mutate: (room: Stored_Test_Room) => void) {
  await runInDurableObject(room_stub(room_id), (_instance, context) => {
    const room = JSON.parse(
      context.storage.sql.exec('SELECT payload FROM room').one().payload as string,
    );
    mutate(room);
    context.storage.sql.exec('UPDATE room SET payload = ?', JSON.stringify(room));
  });
}
async function prepared_room() {
  const host = await create();
  const host_connection = await connect(host);
  const friend = await join(host.room_id);
  const friend_connection = await connect(friend);
  for (const connection of [host_connection, friend_connection]) {
    connection.send({
      type: 'ready',
      ready: true,
      identity: identity.identity,
    });
  }
  await host_connection.wait(
    'snapshot',
    (message) => message.members.length === 2 && message.members.every((member) => member.ready),
  );
  return {
    host,
    friend,
    host_connection,
    friend_connection,
  };
}
async function started_room() {
  const room = await prepared_room();
  room.host_connection.send({ type: 'start' });
  const snapshot = await room.host_connection.wait(
    'snapshot',
    (message) => message.phase === 'countdown',
  );
  await edit_stored_room(room.host.room_id, (state) => {
    state.round!.start_ms = Date.now() - 1;
  });
  await runDurableObjectAlarm(room_stub(room.host.room_id));
  await room.host_connection.wait('snapshot', (message) => message.phase === 'playing');
  return {
    ...room,
    round_id: snapshot.round!.round_id,
  };
}
const completed_report = {
  score: 12345,
  accuracy: 0.95,
  combo: 12,
  progress: 1,
  status: 'completed',
};

test('room isolation, scoped secure cookies, origin and membership authorization', async () => {
  const first_room = await create();
  const second_room = await create();
  expect(first_room.room_id).not.toBe(second_room.room_id);
  expect((await request('/api/multiplayer/rooms', 'CSRF', '', 'https://other.test')).status).toBe(
    403,
  );
  const unauthorized = await exports.default.fetch(
    `${origin}/api/multiplayer/${second_room.room_id}/socket`,
    {
      headers: {
        Origin: origin,
        Upgrade: 'websocket',
        Cookie: first_room.cookie,
      },
    },
  );
  expect(unauthorized.status).toBe(401);
  const connection = await connect(first_room);
  expect((await connection.wait('snapshot')).members).toHaveLength(1);
  expect(JSON.stringify(connection.messages)).not.toContain('token_hash');
});

test('eight member capacity holds under concurrent joins; names and bodies are bounded', async () => {
  const host = await create();
  await connect(host);
  const responses = await Promise.all(
    Array.from({ length: 12 }, (_, member_index) =>
      request(`/api/multiplayer/${host.room_id}/join`, `Player ${member_index}`),
    ),
  );
  expect(responses.filter((response) => response.status === 200)).toHaveLength(7);
  expect(responses.filter((response) => response.status === 409)).toHaveLength(5);
  expect((await request('/api/multiplayer/rooms', 'a'.repeat(25))).status).not.toBe(200);
  expect((await request('/api/multiplayer/rooms', 'a'.repeat(5000))).status).not.toBe(200);
});

test('host permissions, readiness, incompatible builds, and countdown cancellation', async () => {
  const host = await create();
  const host_connection = await connect(host);
  host_connection.send({ type: 'start' });
  expect((await host_connection.wait('error')).message).toContain('two');
  const friend = await join(host.room_id);
  const friend_connection = await connect(friend);
  friend_connection.send({ type: 'start' });
  expect((await friend_connection.wait('error')).message).toContain('host');
  friend_connection.send({
    type: 'ready',
    ready: true,
    identity: 'old-build',
  });
  expect((await friend_connection.wait('error')).message).toContain('Incompatible');
  for (const connection of [host_connection, friend_connection]) {
    connection.send({
      type: 'ready',
      ready: true,
      identity: identity.identity,
    });
  }
  await host_connection.wait('snapshot', (message) =>
    message.members.every((member) => member.ready),
  );
  host_connection.send({ type: 'start' });
  const countdown = await host_connection.wait(
    'snapshot',
    (message) => message.phase === 'countdown',
  );
  expect(countdown.round!.start_ms - Date.now()).toBeGreaterThan(4000);
  expect((await request(`/api/multiplayer/${host.room_id}/join`)).status).toBe(409);
  friend_connection.send({
    type: 'ready',
    ready: false,
    identity: identity.identity,
  });
  await host_connection.wait(
    'snapshot',
    (message) =>
      message.phase === 'lobby' && message.round === null && message.sequence > countdown.sequence,
  );
});

test('disconnect before launch cancels countdown and transfers host', async () => {
  const { host_connection, friend_connection, friend } = await prepared_room();
  host_connection.send({ type: 'start' });
  const countdown = await friend_connection.wait(
    'snapshot',
    (message) => message.phase === 'countdown',
  );
  host_connection.socket.close();
  const lobby = await friend_connection.wait(
    'snapshot',
    (message) => message.sequence > countdown.sequence && message.phase === 'lobby',
  );
  expect(lobby.host_id).toBe(friend.member_id);
  expect(lobby.members.every((member) => !member.ready)).toBe(true);
});

test('first terminal persists across eviction; duplicate and stale round reports cannot overwrite it', async () => {
  const room = await started_room();
  room.host_connection.send({
    type: 'terminal',
    round_id: room.round_id,
    report: completed_report,
  });
  await room.host_connection.wait(
    'snapshot',
    (message) => message.round?.results[room.host.member_id],
  );
  await evictDurableObject(room_stub(room.host.room_id));
  room.host_connection.send({
    type: 'terminal',
    round_id: room.round_id,
    report: {
      ...completed_report,
      score: 999999,
    },
  });
  await room.host_connection.wait('error');
  room.friend_connection.send({
    type: 'terminal',
    round_id: 'old-round',
    report: completed_report,
  });
  await room.friend_connection.wait('error');
  room.friend_connection.send({
    type: 'terminal',
    round_id: room.round_id,
    report: completed_report,
  });
  const results_snapshot = await room.friend_connection.wait(
    'snapshot',
    (message) => message.phase === 'results',
  );
  expect(results_snapshot.round!.results[room.host.member_id].score).toBe(completed_report.score);
  expect(ranked_results(results_snapshot.round!).map((result) => result.placement)).toEqual([1, 1]);
  room.host_connection.send({ type: 'rematch' });
  const lobby = await room.friend_connection.wait(
    'snapshot',
    (message) => message.phase === 'lobby' && message.sequence > results_snapshot.sequence,
  );
  expect(lobby.members.every((member) => !member.ready)).toBe(true);
});

test('live scores are transient, bounded, and rejected when duplicate or malformed', async () => {
  const room = await started_room();
  room.host_connection.send({
    type: 'score',
    round_id: room.round_id,
    report: completed_report,
  });
  expect((await room.friend_connection.wait('score')).report.score).toBe(completed_report.score);
  room.host_connection.send({
    type: 'score',
    round_id: room.round_id,
    report: completed_report,
  });
  expect((await room.host_connection.wait('error')).message).toContain('twice');
  room.host_connection.send({
    type: 'score',
    sequence: 1,
    round_id: room.round_id,
    report: completed_report,
  });
  expect((await room.host_connection.wait('error')).message).toContain('duplicate');
  room.host_connection.send({
    type: 'score',
    round_id: room.round_id,
    report: {
      ...completed_report,
      accuracy: 2,
    },
  });
  expect((await room.host_connection.wait('error')).message).toContain('Invalid');
  room.host_connection.socket.send('x'.repeat(4097));
  expect((await room.host_connection.wait('error')).message).toContain('4 KiB');
  await runInDurableObject(room_stub(room.host.room_id), (_instance, context) => {
    expect(context.storage.sql.exec('SELECT payload FROM room').one().payload).not.toContain(
      '12345',
    );
  });
});

test('brief reconnection preserves a run, refresh withdraws it, and other players continue', async () => {
  const room = await started_room();
  room.friend_connection.socket.close();
  await room.host_connection.wait(
    'snapshot',
    (message) =>
      message.phase === 'playing' &&
      message.members.some(
        (member) => member.member_id === room.friend.member_id && !member.connected,
      ),
  );
  const reconnected = await connect(room.friend, room.round_id);
  const snapshot = await reconnected.wait('snapshot');
  expect(snapshot.round!.results[room.friend.member_id]).toBeUndefined();
  reconnected.socket.close();
  await room.host_connection.wait(
    'snapshot',
    (message) =>
      message.sequence > snapshot.sequence &&
      message.members.some(
        (member) => member.member_id === room.friend.member_id && !member.connected,
      ),
  );
  const refreshed = await connect(room.friend);
  const refreshed_snapshot = await refreshed.wait('snapshot');
  expect(refreshed_snapshot.round!.results[room.friend.member_id].status).toBe('withdrawn');
  expect(refreshed_snapshot.phase).toBe('playing');
});

test('alarms enforce reconnect timeout, round deadline, inactivity and absolute expiry', async () => {
  const room = await started_room();
  room.friend_connection.socket.close();
  await room.host_connection.wait('snapshot', (message) =>
    message.members.some((member) => !member.connected),
  );
  await edit_stored_room(room.host.room_id, (state) => {
    state.members.find((member) => member.member_id === room.friend.member_id)!.disconnected_ms =
      Date.now() - 30_001;
  });
  await runDurableObjectAlarm(room_stub(room.host.room_id));
  await room.host_connection.wait(
    'snapshot',
    (message) => message.round?.results[room.friend.member_id]?.status === 'withdrawn',
  );
  await edit_stored_room(room.host.room_id, (state) => {
    state.round!.deadline_ms = Date.now() - 1;
  });
  await runDurableObjectAlarm(room_stub(room.host.room_id));
  await room.host_connection.wait('snapshot', (message) => message.phase === 'results');
  await edit_stored_room(room.host.room_id, (state) => {
    state.active_ms = Date.now() - 30 * 60_000 - 1;
  });
  await runDurableObjectAlarm(room_stub(room.host.room_id));
  expect((await request(`/api/multiplayer/${room.host.room_id}/join`)).status).toBe(404);
  const old_room = await create();
  await edit_stored_room(old_room.room_id, (state) => {
    state.created_ms = Date.now() - 4 * 60 * 60_000 - 1;
  });
  await runDurableObjectAlarm(room_stub(old_room.room_id));
  expect((await request(`/api/multiplayer/${old_room.room_id}/join`)).status).toBe(404);
});

test('member flood closes the socket and one member cannot open a second connection', async () => {
  const host = await create();
  const connection = await connect(host);
  const duplicate = await exports.default.fetch(
    `${origin}/api/multiplayer/${host.room_id}/socket?connection=${'f'.repeat(32)}`,
    {
      headers: {
        Origin: origin,
        Upgrade: 'websocket',
        Cookie: host.cookie,
      },
    },
  );
  expect(duplicate.status).toBe(409);
  const closed = new Promise<number>((resolve) =>
    connection.socket.addEventListener('close', (event) => resolve(event.code)),
  );
  for (let message_index = 0; message_index < 11; message_index++) {
    connection.send({
      type: 'clock',
      client_ms: message_index,
    });
  }
  expect(await closed).toBe(4008);
});

test('rollout flag blocks creation without affecting room status or solo assets', async () => {
  const worker = (await import('../worker/index')).default;
  const response = await worker.fetch(
    new Request(origin + '/api/multiplayer/rooms', {
      method: 'POST',
      headers: { Origin: origin },
      body: JSON.stringify({ nickname: 'Host' }),
    }),
    {
      ...env,
      MULTIPLAYER_ENABLED: 'false',
    },
  );
  expect(response.status).toBe(503);
  expect(
    (
      (await response.json()) as {
        error: string;
      }
    ).error,
  ).toBe('DISABLED');
  const status = await worker.fetch(new Request(origin + '/api/multiplayer/status'), {
    ...env,
    MULTIPLAYER_ENABLED: 'false',
  });
  expect(
    (
      (await status.json()) as {
        enabled: boolean;
      }
    ).enabled,
  ).toBe(false);
});

test('a half-open socket can be replaced by its running session and retires after silence', async () => {
  const room = await started_room();
  const reconnected = await connect(room.friend, room.round_id);
  const snapshot = await reconnected.wait('snapshot');
  expect(snapshot.round!.results[room.friend.member_id]).toBeUndefined();
  await runInDurableObject(room_stub(room.host.room_id), (_instance, context) => {
    const socket = context
      .getWebSockets(room.friend.member_id)
      .find((candidate) => candidate.readyState === WebSocket.OPEN)!;
    const attachment = socket.deserializeAttachment();
    attachment.received_ms = Date.now() - 30_001;
    socket.serializeAttachment(attachment);
  });
  await runDurableObjectAlarm(room_stub(room.host.room_id));
  await room.host_connection.wait(
    'snapshot',
    (message) => message.round?.results[room.friend.member_id]?.status === 'withdrawn',
  );
});

test('same-session half-open countdown reconnection cancels launch and keeps one socket', async () => {
  const room = await prepared_room();
  room.host_connection.send({ type: 'start' });
  await room.host_connection.wait('snapshot', (message) => message.phase === 'countdown');
  const reconnecting = await connect(room.friend);
  expect((await reconnecting.wait('snapshot')).phase).toBe('lobby');
  await runInDurableObject(room_stub(room.host.room_id), (_instance, context) => {
    expect(
      context
        .getWebSockets(room.friend.member_id)
        .filter((socket) => socket.readyState === WebSocket.OPEN),
    ).toHaveLength(1);
  });
});
