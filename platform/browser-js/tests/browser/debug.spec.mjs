import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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
  await expect(page.locator('#debug-audio-events')).toContainText('No audio events');
  await expect(page.locator('#debug-stored')).toContainText('No stored reports yet');
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
  await page.evaluate(async () => {
    const { Audio_Clock } = await import('/platform/browser-js/src/clock.js');
    Audio_Clock.prototype.input_time = () => -1;
  });
  await page.locator('#start').click();
  await expect(page.locator('#pause')).toBeVisible();
  await page.keyboard.press('z');
  await expect(page.locator('#lifecycle-title')).toHaveText('Playback interrupted');
  await expect(page.locator('#recovery-report')).toBeVisible();
  await page.reload();
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

test('workspace lists searchable scenarios with run, step, reset and run-all controls', async ({ page }) => {
  await page.goto('/debug.html');
  await expect(page.locator('#scenario-status')).toContainText('scenario definitions loaded');
  const items = page.locator('#scenario-list li');
  expect(await items.count()).toBeGreaterThan(20);
  await page.locator('#scenario-search').fill('clock mismatch');
  await expect(items).toHaveCount(1);
  await page.locator('#scenario-list li').click();
  await expect(page.locator('#scenario-title')).toContainText('Clock mismatch');
  await page.locator('#scenario-run').click();
  await expect(page.locator('#scenario-results')).toContainText('PASS', { timeout: 30000 });
  await expect(page.locator('#scenario-status')).toContainText('assertion(s) passed');
  await page.locator('#scenario-report').click();
  const download_pending = page.waitForEvent('download');
  await page.locator('#scenario-report').click();
  expect((await download_pending).suggestedFilename()).toMatch(/^tapweave-scenario-clock-mismatch-rejection/);
  await page.locator('#scenario-reset').click();
  await expect(page.locator('#scenario-status')).toContainText('reset');
  await page.locator('#scenario-search').fill('');
  await page.locator('#scenario-list li').first().click();
  await page.locator('#scenario-step').click();
  await expect(page.locator('#scenario-results')).toContainText('Step');
  await page.locator('#run-all').click();
  await expect(page.locator('#scenario-status')).toContainText('Run All complete:', { timeout: 120000 });
  await expect(page.locator('#scenario-results')).toContainText('PASS clock-aligned');
});

test('graphics scenarios exercise GPU loss, dispatch failure and capacity exhaustion', async ({ page }) => {
  await page.goto('/debug.html');
  await expect(page.locator('#scenario-status')).toContainText('scenario definitions loaded');
  for (const [search, status] of [
    ['GPU context loss', 'all'],
    ['Scene dispatch failure', 'passed'],
    ['Scene capacity exhaustion', 'passed'],
  ]) {
    await page.locator('#scenario-search').fill(search);
    await page.locator('#scenario-list li').click();
    await expect(page.locator('#scenario-canvas')).toBeVisible();
    await page.locator('#scenario-run').click();
    await expect(page.locator('#scenario-status')).toContainText(status, { timeout: 30000 });
  }
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
