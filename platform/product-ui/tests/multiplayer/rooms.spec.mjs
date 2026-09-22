import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { zipSync, unzipSync, strToU8 } from 'fflate';

const demo_archive = unzipSync(
  await readFile(new URL('../../public/demo/tapweave-demo.osz', import.meta.url)),
);
const demo_map_name = Object.keys(demo_archive).find((filename) => filename.endsWith('.osu'));
const audio_name = Object.keys(demo_archive).find((filename) => filename.endsWith('.wav'));
const local_map = new TextDecoder()
  .decode(demo_archive[demo_map_name])
  .replace('Title:Tapweave Demo', 'Title:Local Room Fixture');
const fixture_files = () => [
  {
    name: 'matching.osu',
    mimeType: 'text/plain',
    buffer: Buffer.from(local_map),
  },
  {
    name: audio_name,
    mimeType: 'audio/wav',
    buffer: Buffer.from(demo_archive[audio_name]),
  },
];
const fixture_archive = () => ({
  name: 'local.osz',
  mimeType: 'application/zip',
  buffer: Buffer.from(
    zipSync(
      {
        'first.osu': strToU8(local_map.replace('Version:Beginner', 'Version:Other difficulty')),
        'matching.osu': strToU8(local_map),
        [audio_name]: demo_archive[audio_name],
        'unrelated.txt': strToU8('Different packaging'),
      },
      { level: 9 },
    ),
  ),
});

async function import_host_fixture(page) {
  await expect(page.locator('#room-map-import')).toBeVisible();
  await expect(page.locator('#room-ready')).toBeDisabled();
  await page.locator('#room-map-import').setInputFiles(fixture_files());
  await expect(page.locator('#room-ready')).toBeEnabled();
}
async function import_friend_fixture(page) {
  await expect(page.locator('#room-map-import')).toBeVisible();
  await expect(page.locator('#room-ready')).toBeDisabled();
  await page.locator('#room-map-import').setInputFiles(fixture_archive());
  await expect(page.locator('#room-ready')).toBeEnabled();
}

function capture_multiplayer_traffic(page) {
  const sent = [];
  const snapshots = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/multiplayer/') && request.postData()) {
      sent.push(JSON.parse(request.postData()));
    }
  });
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => sent.push(JSON.parse(String(payload))));
    socket.on('framereceived', ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.type === 'snapshot') {
        snapshots.push(message);
      }
    });
  });
  return { sent, snapshots };
}
function assert_metadata_only(traffic) {
  const allowed_fields = [
    'nickname',
    'type',
    'version',
    'sequence',
    'client_ms',
    'selection_revision',
    'selected_map',
    'availability',
    'ready',
    'round_id',
    'report',
  ];
  for (const message of traffic.sent) {
    expect(Object.keys(message).every((field) => allowed_fields.includes(field))).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(message))).toBeLessThanOrEqual(4096);
    if (message.selected_map) {
      expect(Object.keys(message.selected_map).sort()).toEqual([
        'artist',
        'creator',
        'difficulty',
        'end_ms',
        'engine_hash',
        'map_hash',
        'music_hash',
        'title',
      ]);
      for (const field of ['engine_hash', 'map_hash', 'music_hash']) {
        expect(message.selected_map[field]).toMatch(/^[a-f0-9]{64}$/);
      }
    }
    expect(JSON.stringify(message)).not.toContain('osu file format');
    expect(JSON.stringify(message)).not.toContain('RIFF');
  }
}

async function create_two_player_room(browser, base_url) {
  const host_context = await browser.newContext({ ignoreHTTPSErrors: true });
  const friend_context = await browser.newContext({ ignoreHTTPSErrors: true });
  const host = await host_context.newPage();
  const friend = await friend_context.newPage();
  const host_traffic = capture_multiplayer_traffic(host);
  const friend_traffic = capture_multiplayer_traffic(friend);
  await host.goto(base_url + '/multiplayer');
  await host.getByLabel('Your nickname').fill('Host');
  await host.getByRole('button', { name: 'Create private room' }).click();
  await import_host_fixture(host);
  const invite = await host.locator('#room-invite').inputValue();
  await friend.goto(invite);
  await friend.getByLabel('Your nickname').fill('Friend');
  await friend.getByRole('button', { name: 'Join room' }).click();
  await import_friend_fixture(friend);
  return {
    host,
    friend,
    host_context,
    friend_context,
    host_traffic,
    friend_traffic,
  };
}
async function ready_and_start(host, friend) {
  await host.locator('#room-ready').click();
  await friend.locator('#room-ready').click();
  await expect(host.locator('#room-start')).toBeEnabled();
  await host.locator('#room-start').click();
  await expect(host.getByRole('status')).toContainText('Starting together');
  await expect(friend.getByRole('status')).toContainText('Starting together');
  await expect
    .poll(() => host.evaluate(() => window.__tapweave_player_probe.session.view.state), {
      timeout: 12_000,
    })
    .toBe('running');
  await expect
    .poll(() => friend.evaluate(() => window.__tapweave_player_probe.session.view.state), {
      timeout: 12_000,
    })
    .toBe('running');
}
test('independent contexts share membership, synchronized playback, live scores, results and rematch', async ({
  browser,
  baseURL: base_url,
}) => {
  const { host, friend, host_context, friend_context, host_traffic, friend_traffic } =
    await create_two_player_room(browser, base_url);
  try {
    await ready_and_start(host, friend);
    await expect(host.locator('#room-map-import')).not.toBeVisible();
    await expect(friend.locator('#room-difficulty')).not.toBeVisible();
    // Compare the audio-anchored start against each process's wall-clock epoch.
    // This is a controlled browser estimate, not a physical output measurement.
    const start_epoch = (page) =>
      page.evaluate(() => {
        const session = window.__tapweave_player_probe.session;
        return (
          performance.timeOrigin +
          performance.now() -
          (session.audio_context.currentTime - session.playback_clock.anchor.audio_seconds) * 1000
        );
      });
    const start_epochs_ms = await Promise.all([start_epoch(host), start_epoch(friend)]);
    const start_skew_ms = Math.abs(start_epochs_ms[0] - start_epochs_ms[1]);
    await test.info().attach('start-skew', {
      body: JSON.stringify({ start_skew_ms }),
      contentType: 'application/json',
    });
    expect(start_skew_ms).toBeLessThan(100);
    if (test.info().project.name === 'chromium') {
      await host.screenshot({
        path: test.info().outputPath('multiplayer-playing.png'),
      });
    }
    await expect(host.getByRole('region', { name: 'Client-reported scoreboard' })).toContainText(
      '%',
    );
    await expect(friend.getByRole('region', { name: 'Client-reported scoreboard' })).toContainText(
      '%',
    );
    // Unplayed runs naturally fail through Odin; the server does not fabricate
    // judgements or scores to expedite the test.
    await expect(host.getByRole('heading', { name: 'Shared results' })).toBeVisible({
      timeout: 100_000,
    });
    await expect(friend.getByRole('heading', { name: 'Shared results' })).toBeVisible({
      timeout: 10_000,
    });
    const scoreboard = (page) =>
      page.getByRole('region', { name: 'Client-reported scoreboard' }).innerText();
    expect((await scoreboard(host)).replace('Return to lobby', '').trim()).toBe(
      (await scoreboard(friend)).trim(),
    );
    await host.locator('#room-rematch').click();
    await expect(host.locator('#room-ready')).toHaveText('Ready');
    await expect(friend.locator('#room-ready')).toHaveText('Ready');
    await expect(host.getByRole('region', { name: 'Selected map' })).toContainText(
      'Local Room Fixture',
    );
    assert_metadata_only(host_traffic);
    assert_metadata_only(friend_traffic);
  } finally {
    await host_context.close();
    await friend_context.close();
  }
});

test('audio suspension withdraws one player and a refresh cannot resume its old run', async ({
  browser,
  baseURL: base_url,
}) => {
  const { host, friend, host_context, friend_context } = await create_two_player_room(
    browser,
    base_url,
  );
  try {
    await ready_and_start(host, friend);
    await friend.evaluate(() => window.__tapweave_player_probe.session.audio_context.suspend());
    await expect(host.getByRole('region', { name: 'Client-reported scoreboard' })).toContainText(
      'withdrawn',
    );
    expect(await host.evaluate(() => window.__tapweave_player_probe.session.view.state), {
      timeout: 12_000,
    }).toBe('running');
    await friend.reload();
    await friend.getByLabel('Your nickname').fill('Friend');
    await friend.getByRole('button', { name: 'Join room' }).click();
    await expect(friend.getByRole('region', { name: 'Client-reported scoreboard' })).toContainText(
      'withdrawn',
    );
  } finally {
    await host_context.close();
    await friend_context.close();
  }
});

test('service exhaustion is recoverable and solo navigation remains available', async ({
  page,
  baseURL: base_url,
}) => {
  await page.route('**/api/multiplayer/rooms', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'SERVICE_FAILURE',
        message: 'Try again; solo play remains available.',
      }),
    }),
  );
  await page.goto(base_url + '/multiplayer');
  await page.getByLabel('Your nickname').fill('Host');
  await page.getByRole('button', { name: 'Create private room' }).click();
  await expect(page.getByRole('alert')).toContainText('solo play remains available');
  await page.getByRole('link', { name: 'Back to solo play' }).click();
  await expect(page.locator('#menu-play')).toBeVisible();
});

test('brief socket loss keeps local playback; delayed countdown delivery withdraws visibly', async ({
  browser,
  baseURL: base_url,
}) => {
  const host_context = await browser.newContext({ ignoreHTTPSErrors: true });
  const friend_context = await browser.newContext({ ignoreHTTPSErrors: true });
  const host = await host_context.newPage();
  const friend = await friend_context.newPage();
  let friend_socket;
  let delay_countdown = false;
  const delayed_countdown_timers = new Set();
  await friend.routeWebSocket('**/api/multiplayer/*/socket*', (socket) => {
    const server = socket.connectToServer();
    friend_socket = {
      socket,
      server,
    };
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (delay_countdown && message.type === 'snapshot' && message.phase === 'countdown') {
        const timer = setTimeout(() => {
          delayed_countdown_timers.delete(timer);
          socket.send(raw);
        }, 6000);
        delayed_countdown_timers.add(timer);
      } else {
        socket.send(raw);
      }
    });
  });
  try {
    await host.goto(base_url + '/multiplayer');
    await host.getByLabel('Your nickname').fill('Host');
    await host.getByRole('button', { name: 'Create private room' }).click();
    await import_host_fixture(host);
    await friend.goto(await host.locator('#room-invite').inputValue());
    await friend.getByLabel('Your nickname').fill('Friend');
    await friend.getByRole('button', { name: 'Join room' }).click();
    await import_friend_fixture(friend);
    await ready_and_start(host, friend);
    const audio_start_seconds = await friend.evaluate(
      () => window.__tapweave_player_probe.session.playback_clock.anchor.audio_seconds,
    );
    await friend_socket.server.close({
      code: 1011,
      reason: 'Test brief loss',
    });
    await friend_socket.socket.close({
      code: 1011,
      reason: 'Test brief loss',
    });
    await expect(friend.getByRole('status')).toContainText('Round in progress', {
      timeout: 10_000,
    });
    expect(
      await friend.evaluate(
        () => window.__tapweave_player_probe.session.playback_clock.anchor.audio_seconds,
      ),
    ).toBe(audio_start_seconds);
    await friend
      .getByRole('button', {
        name: 'Withdraw',
        exact: true,
      })
      .click();
    await host
      .getByRole('button', {
        name: 'Withdraw',
        exact: true,
      })
      .click();
    await expect(host.locator('#room-rematch')).toBeVisible();
    await host.locator('#room-rematch').click();
    delay_countdown = true;
    await host.locator('#room-ready').click();
    await friend.locator('#room-ready').click();
    await expect(host.locator('#room-start')).toBeEnabled();
    await host.locator('#room-start').click();
    await expect(friend.getByRole('alert')).toContainText(/withdraw|deadline/i, {
      timeout: 12_000,
    });
    expect(await friend.evaluate(() => window.__tapweave_player_probe.session.view.state)).not.toBe(
      'running',
    );
  } finally {
    for (const timer of delayed_countdown_timers) {
      clearTimeout(timer);
    }
    await host_context.close();
    await friend_context.close();
  }
});

test('failed imports preserve selection; map changes invalidate ready and select matching local difficulty', async ({
  browser,
  baseURL: base_url,
}) => {
  const room = await create_two_player_room(browser, base_url);
  const { host, friend } = room;
  try {
    await friend.locator('#room-ready').click();
    await expect(friend.locator('#room-ready')).toHaveText('Unready');
    await host.locator('#room-map-import').setInputFiles({
      name: 'broken.osz',
      mimeType: 'application/zip',
      buffer: Buffer.from('invalid zip'),
    });
    await expect(host.getByRole('alert')).toBeVisible();
    await expect(host.getByRole('region', { name: 'Selected map' })).toContainText(
      'Local Room Fixture',
    );
    expect(
      await host.evaluate(() => window.__tapweave_player_probe.session.selection.active.filename),
    ).toBe('matching.osu');
    await host.getByRole('button', { name: 'Check loaded map' }).click();
    await expect(host.locator('#room-ready')).toBeEnabled();
    // The friend's repacked set already contains this other difficulty.
    await host.locator('#room-map-import').setInputFiles(fixture_archive());
    await expect(host.getByRole('region', { name: 'Selected map' })).toContainText(
      'Other difficulty',
    );
    await expect(friend.locator('#room-ready')).toHaveText('Ready');
    await expect(friend.locator('#room-ready')).toBeEnabled();
    expect(
      await friend.evaluate(() => window.__tapweave_player_probe.session.selection.active.filename),
    ).toBe('first.osu');
    const revision = room.host_traffic.snapshots.at(-1).selection_revision;
    // The repacked archive and the earlier loose import both carry
    // matching.osu; either row publishes the same map bytes.
    await host.locator('#room-difficulty [data-map-filename="matching.osu"]').first().click();
    await host.locator('#room-difficulty [data-map-filename="first.osu"]').click();
    await expect(host.locator('#room-ready')).toBeEnabled();
    await expect(friend.locator('#room-ready')).toBeEnabled();
    expect(room.host_traffic.snapshots.at(-1).selection_revision).toBeGreaterThan(revision);
    assert_metadata_only(room.host_traffic);
    assert_metadata_only(room.friend_traffic);
  } finally {
    await room.host_context.close();
    await room.friend_context.close();
  }
});

test('short imported map completes with identical final results and its own round deadline', async ({
  browser,
  baseURL: base_url,
}) => {
  const room = await create_two_player_room(browser, base_url);
  const { host, friend } = room;
  try {
    const short_map =
      local_map
        .slice(0, local_map.indexOf('[HitObjects]'))
        .replace('HPDrainRate:2', 'HPDrainRate:0') + '[HitObjects]\n256,192,1500,1,0\n';
    const short_files = () => [
      {
        name: 'short.osu',
        mimeType: 'text/plain',
        buffer: Buffer.from(short_map),
      },
      fixture_files()[1],
    ];
    await host.locator('#room-map-import').setInputFiles(short_files());
    await expect(host.locator('#room-ready')).toBeEnabled();
    await expect(friend.getByRole('region', { name: 'Selected map' })).toContainText(
      'Incompatible files',
    );
    await friend.locator('#room-map-import').setInputFiles(short_files());
    await expect(friend.locator('#room-ready')).toBeEnabled();
    await ready_and_start(host, friend);
    const round = room.host_traffic.snapshots.findLast((snapshot) => snapshot.round)?.round;
    expect(round.selected_map.end_ms).toBe(1500);
    expect(round.deadline_ms - round.start_ms).toBe(31_500);
    await expect(host.getByRole('heading', { name: 'Shared results' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(friend.getByRole('heading', { name: 'Shared results' })).toBeVisible();
    const final_round = room.host_traffic.snapshots.at(-1).round;
    expect(
      Object.values(final_round.results).every(
        (report) => report.status === 'completed' && report.progress === 1,
      ),
    ).toBe(true);
    expect(final_round.results).toEqual(room.friend_traffic.snapshots.at(-1).round.results);
    const local_score = await host.evaluate(() =>
      Number(window.__tapweave_player_probe.session.view.result.summary.score),
    );
    expect(final_round.results[room.host_traffic.snapshots.at(-1).member_id].score).toBe(
      local_score,
    );
  } finally {
    await room.host_context.close();
    await room.friend_context.close();
  }
});

test('superseded local checks and Ready sampling cannot ready a newer selection', async ({
  browser,
  baseURL: base_url,
}) => {
  const room = await create_two_player_room(browser, base_url);
  const { host, friend } = room;
  try {
    await host.locator('#room-map-import').setInputFiles(fixture_archive());
    await expect(host.locator('#room-ready')).toBeEnabled();
    await expect(friend.locator('#room-ready')).toBeEnabled();
    // Ready samples clocks for over a second; select a new revision meanwhile.
    await friend.locator('#room-ready').click();
    await host.locator('#room-difficulty [data-map-filename="matching.osu"]').first().click();
    await expect(friend.locator('#room-ready')).toBeEnabled();
    await expect(friend.locator('#room-ready')).toHaveText('Ready');
    // Hold a real local source read across a host revision change, then release
    // both checks. Only the new revision may become available, never ready.
    await friend.evaluate(() => {
      const source = window.__tapweave_player_probe.session.selection.active.source;
      const original_read = source.read.bind(source);
      let release;
      const pending = new Promise((resolve) => {
        release = resolve;
      });
      source.read = async (filename) => {
        await pending;
        return original_read(filename);
      };
      window.release_map_check = () => {
        source.read = original_read;
        release();
      };
    });
    await friend.getByRole('button', { name: 'Check loaded map' }).click();
    await expect(friend.getByRole('region', { name: 'Selected map' })).toContainText('Checking');
    await host.locator('#room-difficulty [data-map-filename="first.osu"]').click();
    await expect(friend.getByRole('region', { name: 'Selected map' })).toContainText(
      'Other difficulty',
    );
    await friend.evaluate(() => window.release_map_check());
    await expect(friend.locator('#room-ready')).toBeEnabled();
    await expect(friend.locator('#room-ready')).toHaveText('Ready');
    expect(room.friend_traffic.snapshots.at(-1).members.every((member) => !member.ready)).toBe(
      true,
    );
    expect(
      await friend.evaluate(() => window.__tapweave_player_probe.session.selection.active.filename),
    ).toBe('first.osu');
  } finally {
    await room.host_context.close();
    await room.friend_context.close();
  }
});

test('long delayed map stays active beyond 75 seconds and completes on the prepared timeline', async ({
  browser,
  baseURL: base_url,
}) => {
  const room = await create_two_player_room(browser, base_url);
  const { host, friend } = room;
  try {
    const delayed_map =
      local_map
        .slice(0, local_map.indexOf('[HitObjects]'))
        .replace('HPDrainRate:2', 'HPDrainRate:0') + '[HitObjects]\n256,192,80000,1,0\n';
    const delayed_files = () => [
      { name: 'delayed.osu', mimeType: 'text/plain', buffer: Buffer.from(delayed_map) },
      fixture_files()[1],
    ];
    await host.locator('#room-map-import').setInputFiles(delayed_files());
    await expect(host.locator('#room-ready')).toBeEnabled();
    await expect(friend.getByRole('region', { name: 'Selected map' })).toContainText(
      'Incompatible files',
    );
    await friend.locator('#room-map-import').setInputFiles(delayed_files());
    await expect(friend.locator('#room-ready')).toBeEnabled();
    await ready_and_start(host, friend);
    const round = room.host_traffic.snapshots.findLast((snapshot) => snapshot.round).round;
    expect(round.selected_map.end_ms).toBe(80_000);
    expect(round.deadline_ms - round.start_ms).toBe(110_000);
    await expect
      .poll(
        () =>
          host.evaluate(
            () => window.__tapweave_player_probe.session.multiplayer_score?.committed_ms,
          ),
        {
          timeout: 79_000,
          intervals: [500],
        },
      )
      .toBeGreaterThan(76_000);
    await expect(host.getByRole('status')).toContainText('Round in progress');
    const latest_score = room.host_traffic.sent.findLast((message) => message.type === 'score');
    expect(latest_score.report.progress).toBeGreaterThan(0.93);
    expect(latest_score.report.progress).toBeLessThan(1);
    await expect(host.getByRole('heading', { name: 'Shared results' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(friend.getByRole('heading', { name: 'Shared results' })).toBeVisible();
    const results = room.host_traffic.snapshots.at(-1).round.results;
    expect(
      Object.values(results).every(
        (report) => report.status === 'completed' && report.progress === 1,
      ),
    ).toBe(true);
    expect(results).toEqual(room.friend_traffic.snapshots.at(-1).round.results);
  } finally {
    await room.host_context.close();
    await room.friend_context.close();
  }
});
