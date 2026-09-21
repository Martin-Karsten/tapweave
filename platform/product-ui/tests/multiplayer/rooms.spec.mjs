import { test, expect } from '@playwright/test';

async function create_two_player_room(browser, base_url) {
  const host_context = await browser.newContext({ ignoreHTTPSErrors: true });
  const friend_context = await browser.newContext({ ignoreHTTPSErrors: true });
  const host = await host_context.newPage();
  const friend = await friend_context.newPage();
  await host.goto(base_url + '/multiplayer');
  await host.getByLabel('Your nickname').fill('Host');
  await host.getByRole('button', { name: 'Create private room' }).click();
  await expect(host.locator('#room-ready')).toBeEnabled();
  const invite = await host.locator('#room-invite').inputValue();
  await friend.goto(invite);
  await friend.getByLabel('Your nickname').fill('Friend');
  await friend.getByRole('button', { name: 'Join room' }).click();
  await expect(friend.locator('#room-ready')).toBeEnabled();
  return {
    host,
    friend,
    host_context,
    friend_context,
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
  const { host, friend, host_context, friend_context } = await create_two_player_room(
    browser,
    base_url,
  );
  try {
    await ready_and_start(host, friend);
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
      await host.screenshot({ path: test.info().outputPath('multiplayer-playing.png') });
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
    expect((await scoreboard(host)).replace('Rematch', '').trim()).toBe(
      (await scoreboard(friend)).trim(),
    );
    await host.locator('#room-rematch').click();
    await expect(host.locator('#room-ready')).toHaveText('Ready');
    await expect(friend.locator('#room-ready')).toHaveText('Ready');
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
    await expect(host.locator('#room-ready')).toBeEnabled();
    await friend.goto(await host.locator('#room-invite').inputValue());
    await friend.getByLabel('Your nickname').fill('Friend');
    await friend.getByRole('button', { name: 'Join room' }).click();
    await expect(friend.locator('#room-ready')).toBeEnabled();
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
    await expect(friend.getByRole('status')).toContainText('Room: playing', { timeout: 10_000 });
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
