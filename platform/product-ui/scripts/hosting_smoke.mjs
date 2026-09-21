import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { PROTOCOL_VERSION } from '../shared/multiplayer.ts';

// With no URL, exercise the actual Cloudflare asset router locally. A URL
// exercises the same public contract after deployment without rebuilding.
const supplied_url = process.argv[2];
const base_url = supplied_url ?? 'http://127.0.0.1:8787';
const server = supplied_url
  ? null
  : spawn('npm', ['run', 'preview:hosting'], {
      cwd: new URL('../', import.meta.url),
      stdio: 'inherit',
      detached: true,
    });
let browser;
try {
  let ready = false;
  for (let attempt_index = 0; attempt_index < 60; attempt_index++) {
    if (server && server.exitCode !== null) {
      throw new Error('Wrangler exited before becoming ready');
    }
    try {
      const response = await fetch(base_url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for the local server or the published deployment. */
    }
    await delay(1000);
  }
  assert.ok(ready, 'hosting endpoint did not become ready');
  for (const route of [
    '/',
    '/menu',
    '/select',
    '/play',
    '/results',
    '/diagnostics',
    '/multiplayer',
    '/room/0123456789abcdef0123456789abcdef',
  ]) {
    const response = await fetch(new URL(route, base_url), {
      headers: { 'Sec-Fetch-Mode': 'navigate' },
      redirect: 'error',
    });
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(response.headers.get('cache-control') ?? '', /no-cache/);
    assert.match(await response.text(), /id="root"/);
  }
  for (const asset_path of ['/assets/missing.js', '/assets/missing.wasm']) {
    const response = await fetch(new URL(asset_path, base_url), {
      headers: { 'Sec-Fetch-Mode': 'cors' },
    });
    assert.equal(response.status, 404, `${asset_path} must not become SPA HTML`);
  }
  const status_response = await fetch(new URL('/api/multiplayer/status', base_url));
  assert.equal(status_response.status, 200);
  assert.equal((await status_response.json()).version, PROTOCOL_VERSION);
  const rejected_creation = await fetch(new URL('/api/multiplayer/rooms', base_url), {
    method: 'POST',
    headers: { Origin: 'https://invalid.example' },
  });
  assert.equal(rejected_creation.status, 403);
  const demo_response = await fetch(new URL('/demo/tapweave-demo.osz', base_url));
  assert.equal(demo_response.status, 200);
  assert.match(demo_response.headers.get('cache-control') ?? '', /no-cache/);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const browser_errors = [];
  page.on('pageerror', (error) => browser_errors.push(error.message));
  const wasm_response_pending = page.waitForResponse((response) =>
    /\/assets\/tapweave-[\w-]+\.wasm$/.test(response.url()),
  );
  await page.goto(new URL('/select', base_url).href);
  const wasm_response = await wasm_response_pending;
  assert.equal(wasm_response.status(), 200);
  assert.match(wasm_response.headers()['content-type'], /application\/wasm/);
  assert.match(wasm_response.headers()['cache-control'], /immutable/);
  assert.deepEqual([...(await wasm_response.body()).subarray(0, 4)], [0, 97, 115, 109]);
  await page.locator('#status').filter({ hasText: 'Engine ready' }).waitFor();
  await page.reload();
  await page.locator('#status').filter({ hasText: 'Engine ready' }).waitFor();
  await page.locator('#try-demo-empty').click();
  await page.locator('#map-name').filter({ hasText: 'Tapweave Demo' }).waitFor();
  await page.locator('#start').click();
  await page.locator('#pause').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#lifecycle-title').filter({ hasText: 'Paused' }).waitFor();
  assert.deepEqual(browser_errors, []);
  console.log(`Hosting smoke passed: ${base_url}`);
} finally {
  await browser?.close();
  if (server?.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      /* Already exited. */
    }
  }
}
