import { appendFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const account_id = process.env.CLOUDFLARE_ACCOUNT_ID;
const api_token = process.env.CLOUDFLARE_API_TOKEN;
if (!account_id || !api_token) {
  throw new Error(
    'Deployment requires the CLOUDFLARE_ACCOUNT_ID repository variable and CLOUDFLARE_API_TOKEN secret. See docs/hosting.md.',
  );
}
const deployment_config = JSON.parse(
  await readFile(new URL('../artifacts/deployment/wrangler.json', import.meta.url), 'utf8'),
);
if (account_id !== '1da4d2cf87f5713195cb6bc88895e0ad' || deployment_config.account_id !== account_id) {
  throw new Error('Deployment must target the dedicated Tapweave Free account. See docs/hosting.md.');
}
const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account_id)}/workers/subdomain`,
  {
    headers: { Authorization: `Bearer ${api_token}` },
    signal: AbortSignal.timeout(30_000),
  },
);
if (!response.ok) {
  throw new Error(
    `Cannot read workers.dev subdomain (HTTP ${response.status}); check account and token permissions.`,
  );
}
const account_subdomain = await response.json();
const subdomain = account_subdomain.result?.subdomain;
if (
  !account_subdomain.success ||
  typeof subdomain !== 'string' ||
  !/^[a-z0-9-]+$/.test(subdomain)
) {
  throw new Error('Create a workers.dev subdomain in the Cloudflare dashboard before deploying.');
}
const site_url = `https://tapweave.${subdomain}.workers.dev`;
const run = (arguments_, environment = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn('npm', arguments_, {
      stdio: 'inherit',
      cwd: new URL('../', import.meta.url),
      env: {
        ...process.env,
        ...environment,
      },
    });
    child.on('error', reject);
    child.on('exit', (exit_code) =>
      exit_code === 0 ? resolve() : reject(new Error(`Deployment command failed (${exit_code})`)),
    );
  });
await run(['run', 'verify:deployment']);
await run(['run', 'deploy:artifact']);
const summary = `Tapweave deployed: ${site_url}\nCommit: ${process.env.GITHUB_SHA ?? 'local'}\n`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
}
try {
  await run(['run', 'test:hosting', '--', site_url]);
  const multiplayer_status = await fetch(new URL('/api/multiplayer/status', site_url));
  if (!multiplayer_status.ok) {
    throw new Error('Multiplayer status smoke failed');
  }
  if ((await multiplayer_status.json()).enabled) {
    await run(
      ['run', 'test:multiplayer', '--', '--project=chromium', '--grep', 'independent contexts'],
      { MULTIPLAYER_TEST_URL: site_url },
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, 'Public hosting smoke: passed.\n');
  }
} catch (error) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      'Public hosting smoke: FAILED. Deployment was published; inspect and roll back if necessary.\n',
    );
  }
  throw error;
}
