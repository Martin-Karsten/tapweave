import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { start_dev_server } from './dev_server.mjs';

const counter_path = new URL('../../src/components/hmr_counter.tsx', import.meta.url);
const original_source = await readFile(counter_path, 'utf8');
const edited_source = original_source.replace('gate-counter', 'gate-counter-hmr-applied');

const dev_server = start_dev_server();

try {
  await dev_server.wait_for_port();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5180/');

  const counter_button = page.getByRole('button', { name: /count is/ });
  await counter_button.click();
  await page.getByText('count is 1').waitFor();
  await counter_button.click();
  await page.getByText('count is 2').waitFor();

  const mounted_at_before = await page.getAttribute('[data-gate="mount-time"] p', 'data-mounted-at');
  const navigations_before = await page.evaluate(() => performance.getEntriesByType('navigation').length);

  await writeFile(counter_path, edited_source, 'utf8');
  await page.locator('[data-hmr-label="gate-counter-hmr-applied"]').waitFor({ timeout: 10_000 });

  const mounted_at_after = await page.getAttribute('[data-gate="mount-time"] p', 'data-mounted-at');
  const navigations_after = await page.evaluate(() => performance.getEntriesByType('navigation').length);
  const button_text_after_hmr = await counter_button.innerText();
  // Solid HMR may reset component-local state (recorded ADR-006 caveat); the
  // gate requires the update without a reload and live reactivity afterwards.
  const counter_state_preserved = button_text_after_hmr.includes('count is 2');

  await counter_button.click();
  const button_text_after_click = await counter_button.innerText();

  console.log(JSON.stringify({
    hmr_label_updated: true,
    page_reload_avoided: navigations_before === navigations_after,
    mounted_marker_stable: mounted_at_before === mounted_at_after,
    state_preserved_across_hmr: counter_state_preserved,
    button_text_after_hmr: button_text_after_hmr,
    button_text_after_click: button_text_after_click,
    reactivity_alive_after_hmr: counter_state_preserved
      ? button_text_after_click.includes('count is 3')
      : button_text_after_click.includes('count is 1'),
  }, null, 2));

  await browser.close();
} finally {
  await writeFile(counter_path, original_source, 'utf8');
  dev_server.stop_dev_server();
}
