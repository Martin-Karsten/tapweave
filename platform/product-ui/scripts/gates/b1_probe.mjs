import { chromium } from '@playwright/test';
import { start_dev_server } from './dev_server.mjs';

const dev_server = start_dev_server();

try {
  await dev_server.wait_for_port();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const console_errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') console_errors.push(message.text());
  });
  await page.goto('http://127.0.0.1:5180/');

  await page.locator('[data-b1-state="ready"]').waitFor({ timeout: 20_000 });
  const ready_text = await page.locator('[data-b1-state="ready"]').innerText();
  const preparation_value = await page.getAttribute('[data-capability-field="preparation_version"] dd', 'data-capability-value');
  const wasm_pages_text = await page.locator('[data-b1-panel="engine"] [data-b1-wasm-pages]').innerText();

  await page.getByRole('button', { name: 're-read live wasm memory' }).click();
  await page.waitForTimeout(200);
  const wasm_pages_after = await page.getAttribute('[data-b1-panel="engine"] p[data-b1-wasm-pages]', 'data-b1-wasm-pages');

  console.log(JSON.stringify({
    engine_ready: true,
    ready_text: ready_text,
    preparation_version: preparation_value,
    wasm_pages_before: wasm_pages_text,
    wasm_pages_live_read: wasm_pages_after,
    wasm_pages_positive: Number(wasm_pages_after ?? '0') > 0,
    console_errors: console_errors,
  }, null, 2));

  await browser.close();
} finally {
  dev_server.stop_dev_server();
}
