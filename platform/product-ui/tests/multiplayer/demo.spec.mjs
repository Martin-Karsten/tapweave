import { test, expect } from '@playwright/test';

test('the demo is an explicit optional selection with matching imports and readiness', async ({
  browser,
  baseURL: base_url,
}) => {
  const host_context = await browser.newContext({ ignoreHTTPSErrors: true });
  const friend_context = await browser.newContext({ ignoreHTTPSErrors: true });
  const host = await host_context.newPage();
  const friend = await friend_context.newPage();
  let demo_requests = 0;
  for (const page of [host, friend]) {
    page.on('request', (request) => {
      if (request.url().endsWith('/demo/tapweave-demo.osz')) {
        demo_requests++;
      }
    });
  }
  try {
    await host.goto(base_url + '/multiplayer');
    await host.getByLabel('Your nickname').fill('Host');
    await host.getByRole('button', { name: 'Create private room' }).click();
    await expect(host.locator('#room-ready')).toBeVisible();
    await expect(host.locator('#room-ready')).toBeDisabled();
    await friend.goto(await host.locator('#room-invite').inputValue());
    await friend.getByLabel('Your nickname').fill('Friend');
    await friend.getByRole('button', { name: 'Join room' }).click();
    await expect(friend.locator('#room-ready')).toBeDisabled();
    expect(demo_requests).toBe(0);
    await host.getByRole('button', { name: 'Use Tapweave demo' }).click();
    await expect(host.locator('#room-ready')).toBeEnabled();
    await expect(friend.getByRole('region', { name: 'Selected map' })).toContainText(
      'Tapweave Demo',
    );
    await expect(friend.locator('#room-ready')).toBeDisabled();
    await friend.getByRole('button', { name: 'Use Tapweave demo' }).click();
    await expect(friend.locator('#room-ready')).toBeEnabled();
    expect(demo_requests).toBe(2);
    await host.locator('#room-ready').click();
    await friend.locator('#room-ready').click();
    await expect(host.locator('#room-start')).toBeEnabled();
  } finally {
    await host_context.close();
    await friend_context.close();
  }
});
