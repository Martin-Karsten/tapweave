import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

const archive = unzipSync(await readFile(new URL('../../public/demo/tapweave-demo.osz', import.meta.url)));
const music_name = Object.keys(archive).find(name => name.endsWith('.wav'));
const map_text = `osu file format v14
[General]
AudioFilename: ${music_name}
Mode:0
[Metadata]
Title:Chat boundaries
Artist:Tapweave
Creator:Test
Version:Chat
[Difficulty]
HPDrainRate:0
CircleSize:4
OverallDifficulty:5
ApproachRate:5
[Events]
2,11000,16000
[TimingPoints]
0,500,4,1,0,100,1,0
[HitObjects]
256,192,5000,1,0
256,192,9000,1,0
256,192,20000,1,0
`;
const files = [
  { name: 'chat.osu', mimeType: 'text/plain', buffer: Buffer.from(map_text) },
  { name: music_name, mimeType: 'audio/wav', buffer: Buffer.from(archive[music_name]) },
];

test('room chat survives gameplay, effective breaks, results, rematch and new membership', async ({ browser, baseURL }) => {
  const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext({ ignoreHTTPSErrors: true })));
  const [host, friend, newcomer] = await Promise.all(contexts.map(context => context.newPage()));
  let host_socket;
  await host.routeWebSocket('**/api/multiplayer/*/socket*', socket => {
    socket.connectToServer();
    host_socket = socket;
  });
  try {
    await host.goto(baseURL + '/multiplayer');
    await host.getByLabel('Your nickname').fill('Host');
    await host.getByRole('button', { name: 'Create private room' }).click();
    await expect(host.locator('#room-invite')).toBeVisible();
    const invite = await host.locator('#room-invite').inputValue();
    await friend.goto(invite);
    await friend.getByLabel('Your nickname').fill('Friend');
    await friend.getByRole('button', { name: 'Join room' }).click();
    const composer = page => page.getByLabel('Message', { exact: true });
    await expect(composer(host)).toBeEnabled();
    await composer(host).fill('hello 👩‍💻 <b>plain text</b>');
    await composer(host).press('Enter');
    await expect(friend.locator('.room-chat-log')).toContainText('hello 👩‍💻 <b>plain text</b>');
    await expect(host.locator('.room-chat-log').locator('b')).toHaveCount(0);
    await host.locator('#room-map-import').setInputFiles(files);
    await expect(host.locator('#room-ready')).toBeEnabled();
    await friend.locator('#room-map-import').setInputFiles(files);
    await expect(friend.locator('#room-ready')).toBeEnabled();
    await host.locator('#room-ready').click();
    await friend.locator('#room-ready').click();
    await expect(host.locator('#room-start')).toBeEnabled();
    await host.locator('#room-start').click();
    await composer(host).fill('countdown message');
    await composer(host).press('Enter');
    await expect(friend.locator('.room-chat-log')).toContainText('countdown message');
    await expect.poll(() => host.evaluate(() => window.__tapweave_player_probe.session.view.local_playing_state), { timeout: 15000 }).toBe('playing');
    await host.evaluate(() => {
      const metrics = window.__chat_performance = { started_ms: performance.now(), frames: 0, publications: 0, long_tasks: [] };
      const session = window.__tapweave_player_probe.session;
      const unsubscribe = session.subscribe(() => metrics.publications++);
      const observer = PerformanceObserver.supportedEntryTypes.includes('longtask')
        ? new PerformanceObserver(entries => metrics.long_tasks.push(...entries.getEntries().map(entry => entry.duration))) : null;
      observer?.observe({ type: 'longtask' });
      const frame = () => {
        if (session.view.state !== 'running') {
          metrics.elapsed_ms = performance.now() - metrics.started_ms;
          unsubscribe(); observer?.disconnect(); return;
        }
        metrics.frames++;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await friend.evaluate(() => {
      let message_number = 0;
      const interval = setInterval(() => {
        if (window.__tapweave_player_probe.session.view.state !== 'running') { clearInterval(interval); return; }
        const input = document.querySelector('#room-chat-composer');
        if (!input || input.disabled) return;
        if (document.activeElement !== input) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
        input.value = `Traffic ${++message_number}`;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
      }, 2100);
    });
    const canvas_bounds = await host.locator('canvas').boundingBox();
    // A transient server notice must not shift the running playfield either.
    host_socket.send(JSON.stringify({ version: 2, type: 'error', message: 'Transient room notice' }));
    await expect(host.locator('.multiplayer-alert')).toContainText('Transient room notice');
    expect(await host.locator('canvas').boundingBox()).toEqual(canvas_bounds);
    await expect(host.locator('.room-chat-collapsed')).toBeVisible();
    await host.keyboard.press('Enter');
    await expect(composer(host)).toBeFocused();
    await host.evaluate(() => {
      const input = window.__tapweave_player_probe.session.gameplay.frame.input;
      window.__chat_hit_presses = [];
      const receive = input.receive.bind(input);
      input.receive = event => { if (event.held) window.__chat_hit_presses.push(event); return receive(event); };
    });
    await host.keyboard.type('zx typing while playing');
    await host.keyboard.press('Enter');
    await expect(composer(host)).not.toBeFocused();
    expect(await host.evaluate(() => window.__chat_hit_presses.length)).toBe(0);
    expect(await host.evaluate(() => window.__tapweave_player_probe.session.view.state)).toBe('running');
    await expect(friend.locator('.room-chat-log')).toContainText('zx typing while playing');
    expect(await host.locator('canvas').boundingBox()).toEqual(canvas_bounds);
    await host.keyboard.press('Enter');
    await host.keyboard.press('Escape');
    await expect(composer(host)).not.toBeFocused();
    const input_bounds = await composer(host).boundingBox();
    expect(input_bounds).not.toBeNull();
    await host.mouse.click(input_bounds.x + input_bounds.width / 2, input_bounds.y + input_bounds.height / 2);
    await expect(composer(host)).not.toBeFocused();
    expect(await host.evaluate(() => window.__tapweave_player_probe.session.view.state)).toBe('running');
    await expect.poll(() => host.evaluate(() => window.__tapweave_player_probe.session.view.local_playing_state), { timeout: 12000 }).toBe('break');
    await expect(composer(host)).toBeVisible();
    await expect(composer(host)).not.toBeFocused();
    await composer(host).click();
    await composer(host).fill('break message');
    await composer(host).press('Enter');
    await expect(composer(host)).toBeFocused();
    await expect.poll(() => host.evaluate(() => window.__tapweave_player_probe.session.view.local_playing_state), { timeout: 10000 }).toBe('playing');
    await expect(composer(host)).not.toBeFocused();
    await expect(host.getByRole('heading', { name: 'Shared results', exact: true })).toBeVisible({ timeout: 15000 });
    await expect(friend.locator('.room-chat-log')).toContainText('break message');
    await expect(host.locator('.room-chat-log')).toContainText('Traffic');
    await expect.poll(() => host.evaluate(() => window.__chat_performance.elapsed_ms ?? 0)).toBeGreaterThan(0);
    const metrics = await host.evaluate(() => window.__chat_performance);
    await test.info().attach('chat-performance', { body: JSON.stringify(metrics), contentType: 'application/json' });
    expect(metrics.frames * 1000 / metrics.elapsed_ms).toBeGreaterThan(30);
    expect(metrics.publications).toBeLessThan(30);
    expect(await host.locator('.room-chat-message').count()).toBeLessThanOrEqual(100);
    await composer(host).fill('results message');
    await composer(host).press('Enter');
    await expect(friend.locator('.room-chat-log')).toContainText('results message');
    await host.locator('#room-rematch').click();
    await newcomer.goto(invite);
    await newcomer.getByLabel('Your nickname').fill('Newcomer');
    await newcomer.getByRole('button', { name: 'Join room' }).click();
    await expect(newcomer.locator('.room-chat-log')).toContainText('results message');
    await expect(newcomer.locator('.room-chat-log')).toContainText('hello 👩‍💻');
    await newcomer.setViewportSize({ width: 390, height: 844 });
    expect(await newcomer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await host.locator('.room-chat').scrollIntoViewIfNeeded();
    await host.screenshot({ path: test.info().outputPath('chat-lobby.png') });
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
