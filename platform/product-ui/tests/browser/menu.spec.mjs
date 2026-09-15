import { expect, test } from '@playwright/test';

// Main menu (lazer MainMenu structure): centered pulsing logo with a left
// action column of live buttons only, keyboard activation (Enter/P), roving
// arrow navigation with Tab still native, and the footer disclaimer plus the
// engine baseline small print.

test('the menu shows the logo and a left column with live buttons only', async ({ page }) => {
  await page.goto('/menu');
  const menu_buttons = page.locator('.menu-buttons button');
  await expect(menu_buttons).toHaveCount(2);
  for (const button of await menu_buttons.all()) {
    await expect(button).toBeEnabled();
  }
  await expect(page.locator('.menu-logo .brand-mark')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'tapweave' })).toBeVisible();
  await page.locator('#menu-diagnostics').click();
  await expect(page).toHaveURL(/\/diagnostics$/);
});

test('Enter activates the focused Play button', async ({ page }) => {
  await page.goto('/menu');
  await expect(page.locator('#menu-play')).toBeFocused({ timeout: 20_000 });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/select$/);
});

test('P activates Play without a focused menu button', async ({ page }) => {
  await page.goto('/menu');
  await expect(page.locator('#menu-play')).toBeVisible();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press('p');
  await expect(page).toHaveURL(/\/select$/);
});

test('arrow keys rove the menu column and wrap around', async ({ page }) => {
  await page.goto('/menu');
  await expect(page.locator('#menu-play')).toBeFocused({ timeout: 20_000 });
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#menu-diagnostics')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#menu-play')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#menu-diagnostics')).toBeFocused();
});

// WebKit automation never performs native sequential focus navigation on Tab
// keydowns, so the native walk out of the menu is asserted where it is
// actually deliverable.
test('Tab walks natively out of the menu into the footer', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit automation does not move focus on Tab');
  await page.goto('/menu');
  await expect(page.locator('#menu-play')).toBeFocused({ timeout: 20_000 });
  await page.keyboard.press('Tab');
  await expect(page.locator('#menu-diagnostics')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('footer').getByRole('button', { name: 'Settings' })).toBeFocused();
});

test('the footer carries the disclaimer and the engine baseline small print', async ({ page }) => {
  await page.goto('/menu');
  await expect(page.locator('.footer-note')).toContainText('Not affiliated with osu! or ppy.');
  await expect(page.locator('[data-footer-baseline]')).toHaveText(/lazer \d+/, { timeout: 20_000 });
});

test('P stays inert while the settings dialog is open', async ({ page }) => {
  await page.goto('/menu');
  const settings_button = page.locator('footer').getByRole('button', { name: 'Settings' });
  await expect(settings_button).toBeEnabled({ timeout: 20_000 });
  await settings_button.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('p');
  await expect(page).toHaveURL(/\/menu$/);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});
