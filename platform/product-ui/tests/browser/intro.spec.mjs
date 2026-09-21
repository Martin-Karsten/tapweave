import { expect, test } from '@playwright/test';

// Intro screen (lazer-style boot gate): engine status while booting, a
// minimum-display auto-advance onto the focused menu primary action, input
// skipping, boot-failure recovery through retry_boot, and deep links that
// stay directly addressable while the engine boots.

// Mirrors --duration-enter: the intro never advances sooner than this after
// the wordmark first renders, so the shell never flashes.
const ENTER_HOLD_MS = 600;

function delay_engine_boot(page, delay_ms) {
  page.route(/\/tapweave(?:-[\w-]+)?\.wasm(?:\?.*)?$/, route => setTimeout(() => route.continue(), delay_ms));
}

test('intro shows the boot status and auto-advances to the menu with Play focused', async ({ page }) => {
  delay_engine_boot(page, 400);
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Starting engine…');
  await expect(page.locator('.intro-spinner')).toBeVisible();
  await expect(page.getByText('Press Enter or click to continue')).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/menu$/, { timeout: ENTER_HOLD_MS + 5_000 });
  await expect(page.locator('#menu-play')).toBeFocused();
});

test('Enter and clicks during booting are ignored; Enter once ready skips the hold', async ({ page }) => {
  delay_engine_boot(page, 1200);
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Starting engine…');
  await page.keyboard.press('Enter');
  await page.locator('.intro-screen').click();
  await expect(page.getByRole('status')).toHaveText('Starting engine…');
  await expect(page.getByText('Press Enter or click to continue')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/menu$/);
});

test('clicking the ready intro skips the hold', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Press Enter or click to continue')).toBeVisible({ timeout: 20_000 });
  await page.locator('.intro-screen').click();
  await expect(page).toHaveURL(/\/menu$/);
});

test('a blocked engine boot shows an alert and Retry recovers into the menu', async ({ page }) => {
  let block_engine = true;
  await page.route(/\/tapweave(?:-[\w-]+)?\.wasm(?:\?.*)?$/, route => (block_engine ? route.abort() : route.continue()));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Engine failed to start.');
  await expect(page.getByRole('link', { name: 'Diagnostics' })).toBeVisible();
  block_engine = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('status')).toHaveText('Starting engine…');
  await expect(page).toHaveURL(/\/menu$/, { timeout: 20_000 });
  await expect(page.locator('#menu-play')).toBeFocused();
});

test('the select route stays directly addressable while the engine boots', async ({ page }) => {
  delay_engine_boot(page, 400);
  await page.goto('/select');
  await expect(page.locator('#status')).toHaveText('Starting engine…');
  await expect(page.locator('#status')).toContainText('Engine ready', { timeout: 20_000 });
});
