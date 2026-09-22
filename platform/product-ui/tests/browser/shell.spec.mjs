import { expect, test } from '@playwright/test';

test('shell serves and the a2 counter is interactive', async ({ page }) => {
  await page.goto('/diagnostics');
  await expect(page.getByRole('heading', { name: 'HMR counter fixture' })).toBeVisible();
  const counter_button = page.getByRole('button', { name: /count is 0/ });
  await counter_button.click();
  await expect(page.getByRole('button', { name: /count is 1/ })).toBeVisible();
});

test('b1 engine bridge boots the production wasm', async ({ page }) => {
  await page.goto('/diagnostics');
  await expect(page.locator('[data-b1-state="ready"]')).toContainText(/build \d+ · behavior \d+ · ABI 2\.2/, {
    timeout: 20_000,
  });
  await expect(page.locator('[data-capability-field="preparation_version"] dd')).toHaveText('2');
});

test('b2 virtual list renders bounded rows and navigates by keyboard', async ({ page }) => {
  await page.goto('/diagnostics');
  const rows = page.locator('[data-virtual-list="songs"] [data-index]');
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  expect(await rows.count()).toBeLessThan(100);
  await page.locator('[data-virtual-list="songs"]').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-virtual-list="songs"] [data-selected="true"]')).toHaveAttribute('data-index', '3');
});

test('b3 frame probe boxes exist and update under the reactive binding', async ({ page }) => {
  await page.goto('/diagnostics');
  const reactive_box = page.locator('[data-probe-box="reactive"]');
  await expect(reactive_box).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-probe-action="start"]').click();
  await page.waitForTimeout(500);
  const frame_count = await page.getAttribute('[data-frame-count]', 'data-frame-count');
  expect(Number(frame_count)).toBeGreaterThan(10);
  await page.locator('[data-probe-action="stop"]').click();
});
