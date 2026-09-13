import { chromium } from '@playwright/test';
import { start_dev_server } from './dev_server.mjs';

const dev_server = start_dev_server();

try {
  await dev_server.wait_for_port();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5180/');

  const list = page.locator('[data-virtual-list="songs"]');
  await list.waitFor({ timeout: 20_000 });

  const rendered_rows_initial = await page.locator('[data-virtual-list="songs"] [data-index]').count();
  const selected_initial = await page.getAttribute('[data-virtual-list="songs"] [data-selected="true"]', 'data-index');

  for (let key_press = 0; key_press < 5; key_press += 1) {
    await page.keyboard.press('ArrowDown');
  }
  await page.waitForTimeout(150);
  const selected_after_arrows = await page.getAttribute('[data-virtual-list="songs"] [data-selected="true"]', 'data-index');

  await page.keyboard.press('End');
  await page.waitForTimeout(300);
  const selected_after_end = await page.getAttribute('[data-virtual-list="songs"] [data-selected="true"]', 'data-index');
  const rendered_rows_at_end = await page.locator('[data-virtual-list="songs"] [data-index]').count();
  const last_row_text = await page.locator('[data-virtual-list="songs"] [data-index="9999"]').innerText();
  const scroll_top = await page.evaluate(
    () => document.querySelector('[data-virtual-list="songs"]').scrollTop,
  );

  await page.keyboard.press('Home');
  await page.waitForTimeout(300);
  const selected_after_home = await page.getAttribute('[data-virtual-list="songs"] [data-selected="true"]', 'data-index');
  const scroll_top_after_home = await page.evaluate(
    () => document.querySelector('[data-virtual-list="songs"]').scrollTop,
  );

  console.log(JSON.stringify({
    rendered_rows_initial: rendered_rows_initial,
    selected_initial: selected_initial,
    selected_after_arrows: selected_after_arrows,
    selected_after_end: selected_after_end,
    rendered_rows_at_end: rendered_rows_at_end,
    last_row_visible_text: last_row_text,
    scroll_top_after_end: scroll_top,
    selected_after_home: selected_after_home,
    scroll_top_after_home: scroll_top_after_home,
    dom_stays_bounded: rendered_rows_initial < 100 && rendered_rows_at_end < 100,
    keyboard_navigation_works: selected_initial === '0' && selected_after_arrows === '5',
    jump_navigation_works: selected_after_end === '9999' && selected_after_home === '0',
  }, null, 2));

  await browser.close();
} finally {
  dev_server.stop_dev_server();
}
