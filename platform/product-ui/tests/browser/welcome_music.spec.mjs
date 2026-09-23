import { expect, test } from '@playwright/test';

test('welcome music survives menu navigation and failed imports, then yields to the selected song', async ({ page }) => {
  await page.goto('/menu');
  await page.waitForFunction(() => window.__tapweave_player_probe?.session);
  const welcome_active = () => page.evaluate(() =>
    Boolean(window.__tapweave_player_probe.session.welcome_music.source));
  expect(await welcome_active()).toBe(true);
  await page.locator('#menu-play').click();
  await expect(page.locator('#status')).toContainText('Engine ready');
  expect(await welcome_active()).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    window.__tapweave_player_probe.session.audio_context.state)).toBe('running');
  await page.locator('#files').setInputFiles({ name: 'broken.osu', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
  await expect(page.locator('#error')).not.toHaveText('');
  expect(await welcome_active()).toBe(true);
  await page.locator('#try-demo-empty').click();
  await expect(page.locator('#map-name')).toHaveText('Tapweave Demo', { timeout: 30000 });
  expect(await welcome_active()).toBe(false);
  await expect.poll(() => page.evaluate(() =>
    Boolean(window.__tapweave_player_probe.session.preview.source))).toBe(true);
});
