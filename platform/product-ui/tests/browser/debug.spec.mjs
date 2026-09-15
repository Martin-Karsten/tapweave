import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Parity port of the retired platform/browser-js/tests/browser/debug.spec.mjs
// player-page tests (revision 5916496): panel tabs/filtering/search/freeze,
// non-interactive HUD, pause path during play, manual export/import, failure
// report persistence and the Ctrl+F10 shortcut. The workspace scenario tests
// remain in platform/browser-js/tests/browser/debug.spec.mjs.

function music_wav(seconds = 8) {
  const samples = 8000 * seconds;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let sample_index = 0; sample_index < samples; sample_index++) bytes.writeInt16LE(Math.round(300 * Math.sin(sample_index * Math.PI / 20)), 44 + sample_index * 2);
  return bytes;
}
const mixed = `osu file format v14
[General]
AudioFilename: music.wav
[Difficulty]
HPDrainRate:0
[TimingPoints]
0,500,4,1,1,100,1,0
[HitObjects]
256,192,1500,1,0
256,192,2500,2,0,L|356:192,1,100
256,192,3500,8,0,4500`;

async function load(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Engine ready');
  await page.locator('#files').setInputFiles([
    { name: 'mixed.osu', mimeType: 'text/plain', buffer: Buffer.from(mixed) },
    { name: 'music.wav', mimeType: 'audio/wav', buffer: music_wav() },
  ]);
  await expect(page.locator('#start')).toBeEnabled();
}

// Deterministic clock fault through the browser-spec player probe; the vanilla
// page patched Audio_Clock.prototype from served sources, the bundled shell
// exposes the active playback clock read-only instead.
async function fault_input_time(page) {
  await page.evaluate(() => {
    const clock = window.__tapweave_player_probe.session.playback_clock;
    clock.input_time = () => -1;
  });
}

test('debug panel opens from selection with tabs, filtering, search and freeze', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Engine ready');
  await page.locator('#debug-open').click();
  const dialog = page.locator('#debug-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#debug-close')).toBeFocused();
  await expect(page.locator('#debug-log-count')).toContainText(/event\(s\)/);
  const rows = page.locator('#debug-log .debug-event');
  const initial_count = await rows.count();
  expect(initial_count).toBeGreaterThan(0);
  await page.locator('#category-clock').check();
  await page.locator('#category-lifecycle').uncheck();
  await page.locator('#category-engine').uncheck();
  // Creating the page mixer can expose WebKit's initial interrupted state.
  // Exclude real audio events when checking that the category filter is empty.
  await page.locator('#category-audio').uncheck();
  await expect(page.locator('#debug-log-count')).toContainText('0 event(s)');
  await page.locator('#category-lifecycle').check();
  await page.locator('#debug-search').fill('nomatch-text');
  await expect(page.locator('#debug-log-count')).toContainText('0 event(s)');
  await page.locator('#debug-search').fill('');
  await page.locator('#debug-freeze').check();
  const frozen_count = await rows.count();
  await expect(page.locator('#debug-log-count')).toContainText('frozen');
  expect(await rows.count()).toBe(frozen_count);
  await page.locator('#debug-freeze').uncheck();
  await expect(page.locator('#debug-log-count')).not.toContainText('frozen');
  for (const tab of ['timing', 'audio', 'resources']) {
    await page.locator(`#tab-${tab}`).click();
    await expect(page.locator(`#panel-${tab}`)).toBeVisible();
  }
  await expect(page.locator('#debug-frames')).toContainText('No frame samples');
  const audio_messages = await page.evaluate(() => window.__tapweave_player_probe.session.debug.diagnostics
    .ordered_events().filter(event => event.category === 'audio').map(event => event.message).filter(Boolean));
  if (audio_messages.length === 0) await expect(page.locator('#debug-audio-events')).toContainText('No audio events');
  for (const message of audio_messages) await expect(page.locator('#debug-audio-events')).toContainText(message);
  await expect(page.locator('#debug-stored')).toContainText('No stored reports yet');
  // WebKit mouse clicks on tabs do not necessarily move keyboard focus.
  await page.locator('#debug-close').focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('HUD is non-interactive, marks unavailable measurements and refreshes during play', async ({ page }) => {
  await load(page);
  await page.locator('#start').click();
  await expect(page.locator('#pause')).toBeVisible();
  await page.locator('#hud-toggle').click();
  const hud = page.locator('#debug-hud');
  await expect(hud).toBeVisible();
  await expect(page.locator('#hud-metrics')).toContainText('Frame interval');
  await expect(page.locator('#hud-metrics')).toContainText('unavailable');
  expect(await hud.evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none');
  await page.locator('#pause').click();
  await expect(page.locator('#lifecycle-title')).toHaveText('Paused');
});

test('opening the panel during play requests the normal pause path', async ({ page }) => {
  await load(page);
  await page.locator('#start').click();
  await expect(page.locator('#debug-open-running')).toBeVisible();
  await page.locator('#debug-open-running').click();
  await expect(page.locator('#lifecycle-title')).toHaveText('Paused');
  await expect(page.locator('#lifecycle-message')).toContainText('Debug panel opened');
  await expect(page.locator('#debug-dialog')).toBeVisible();
  await expect(page.locator('#tab-timing')).toBeVisible();
  await page.locator('#debug-close').click();
  await expect(page.locator('#resume')).toBeEnabled();
});

test('manual export downloads a bounded report and persists it locally', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Engine ready');
  await page.locator('#debug-open').click();
  const download_pending = page.waitForEvent('download');
  await page.locator('#debug-export').click();
  const download = await download_pending;
  expect(download.suggestedFilename()).toMatch(/^tapweave-report-/);
  const report_path = await download.path();
  const report_text = await readFile(report_path, 'utf8');
  const parsed = JSON.parse(report_text);
  expect(parsed.format).toBe('tapweave-debug-report');
  expect(parsed.reason).toBe('manual');
  expect(parsed.truncation.bounded_to_bytes).toBe(2 * 1024 * 1024);
  expect(parsed.truncation.serialized_bytes).toBe(report_text.length);
  await page.reload();
  await expect(page.locator('#status')).toContainText('Engine ready');
  await page.locator('#debug-open').click();
  await page.locator('#tab-resources').click();
  await expect(page.locator('#debug-stored')).toContainText('manual');
  // Imported reports render as text only and malformed files are rejected.
  await page.locator('#tab-logs').click();
  await page.locator('#debug-import').click();
  await page.locator('#debug-import-file').setInputFiles({ name: 'report.json', mimeType: 'application/json',
    buffer: Buffer.from(report_text, 'utf8') });
  await expect(page.locator('#debug-import-status')).toContainText('Imported report');
  await expect(page.locator('#debug-imported')).toContainText('tapweave-debug-report');
  await page.locator('#debug-import').click();
  await page.locator('#debug-import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json',
    buffer: Buffer.from('{not valid json') });
  await expect(page.locator('#debug-import-status')).toContainText('not valid JSON');
});

test('failure reports persist across reload and remain listed with controls', async ({ page }) => {
  await load(page);
  await fault_input_time(page);
  await page.locator('#start').click();
  await expect(page.locator('#pause')).toBeVisible();
  await page.keyboard.press('z');
  await expect(page.locator('#lifecycle-title')).toHaveText('Playback interrupted');
  await expect(page.locator('#recovery-report')).toBeVisible();
  // The vanilla single page reloaded in place; the shell returns to the
  // selection route, whose status element gates the fresh boot.
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Engine ready');
  await page.locator('#files').setInputFiles([
    { name: 'mixed.osu', mimeType: 'text/plain', buffer: Buffer.from(mixed) },
    { name: 'music.wav', mimeType: 'audio/wav', buffer: music_wav() },
  ]);
  await expect(page.locator('#start')).toBeEnabled();
  await page.locator('#debug-open').click();
  await page.locator('#tab-resources').click();
  await expect(page.locator('#debug-stored li')).toHaveCount(1);
  await expect(page.locator('#debug-stored')).toContainText('failure');
  await page.locator('#debug-stored button', { hasText: 'View' }).click();
  await expect(page.locator('#debug-imported')).toContainText('oe_session_inputs_from_reserved');
  await page.locator('#debug-stored button', { hasText: 'Delete' }).click();
  await expect(page.locator('#debug-stored')).toContainText('No stored reports yet');
});

test('Ctrl+F10 opens the log panel when the browser delivers the shortcut', async ({ browserName, page }) => {
  test.skip(browserName === 'webkit', 'WebKit reserves or drops function-key chords; visible controls remain the required path.');
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Engine ready');
  await page.keyboard.press('Control+F10');
  await expect(page.locator('#debug-dialog')).toBeVisible();
  await page.keyboard.press('Control+F10');
  await expect(page.locator('#debug-dialog')).toBeHidden();
});
