import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { zipSync, unzipSync, strToU8 } from 'fflate';

const archive = unzipSync(
  await readFile(new URL('../../public/demo/tapweave-demo.osz', import.meta.url)),
);
const map_filename = Object.keys(archive).find((filename) => filename.endsWith('.osu'));
const map_text = new TextDecoder().decode(archive[map_filename]);
delete archive[map_filename];
const files = {
  ...archive,
  'first.osu': strToU8(map_text.replace('Version:Beginner', 'Version:First')),
  'second.osu': strToU8(map_text.replace('Version:Beginner', 'Version:Second')),
};

test('a delayed selection acknowledgement cannot replace a newer host choice', async ({ page }) => {
  let release_acknowledgement = () => {};
  let held_acknowledgement = false;
  let latest_snapshot;
  await page.routeWebSocket('**/api/multiplayer/*/socket*', (socket) => {
    const server = socket.connectToServer();
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === 'snapshot' && message.selection_revision === 2) {
        held_acknowledgement = true;
        release_acknowledgement = () => socket.send(raw);
      } else {
        if (message.type === 'snapshot') {
          latest_snapshot = message;
        }
        socket.send(raw);
      }
    });
  });
  await page.goto('/multiplayer');
  await page.getByLabel('Your nickname').fill('Host');
  await page.getByRole('button', { name: 'Create private room' }).click();
  await expect(page.locator('#room-map-import')).toBeVisible();
  await page
    .locator('#room-map-import')
    .setInputFiles({
      name: 'set.osz',
      mimeType: 'application/zip',
      buffer: Buffer.from(zipSync(files)),
    });
  await expect(page.locator('#room-ready')).toBeEnabled();
  await page.locator('#room-difficulty').selectOption('second.osu');
  await expect.poll(() => held_acknowledgement).toBe(true);
  await page.locator('#room-difficulty').selectOption('first.osu');
  release_acknowledgement();
  await expect(page.locator('#room-ready')).toBeEnabled();
  await expect.poll(() => latest_snapshot?.selection_revision).toBe(3);
  expect(latest_snapshot.selected_map.difficulty).toBe('First');
  expect(
    await page.evaluate(() => window.__tapweave_player_probe.session.selection.active.filename),
  ).toBe('first.osu');
});
