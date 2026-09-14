import { test, expect } from '@playwright/test';

// In-player debug flows (panel/HUD/export from the player screens) targeted the
// retired vanilla player page; they return with the panel re-homed in
// platform/product-ui. The developer workspace tests below remain.

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

