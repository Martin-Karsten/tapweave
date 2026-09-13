import { test, expect } from '@playwright/test';

// Parity port of platform/browser-js/tests/browser/input.spec.mjs intent for
// the product shell: real DOM mouse and keyboard events aggregate with Odin
// playfield coordinates and Escape releases held actions.

test('DOM mouse and keyboard aggregate with Odin coordinates and Escape releases actions', async ({ page }) => {
  await page.goto('/diagnostics');
  await page.getByRole('button', { name: 'Start input binding fixture' }).click();
  await expect(page.locator('[data-input-fixture-state="active"]')).toBeVisible({ timeout: 20_000 });

  await page.mouse.move(276, 232);
  await page.mouse.down();
  await page.keyboard.down('z');
  await page.mouse.up();
  const held = await page.evaluate(() => {
    const record = window.__tapweave_input_fixture.frame.input.records.at(-1);
    return { bits: record.action_bits, x: record.x, y: record.y };
  });
  expect(held.bits).toBe(1);
  expect(held.x).toBeCloseTo(256, 6);
  expect(held.y).toBeCloseTo(192, 6);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__tapweave_input_fixture.frame.input.records.at(-1).action_bits)).toBe(0);
  await page.getByRole('button', { name: 'Stop input binding fixture' }).click();
  await expect(page.locator('[data-input-fixture-state="idle"]')).toBeVisible();
});
