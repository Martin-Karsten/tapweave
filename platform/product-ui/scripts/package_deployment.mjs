import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const package_root = new URL('../', import.meta.url);
const output_root = new URL('../artifacts/deployment/', import.meta.url);
const deployment_config = JSON.parse(
  (await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')).replace(
    /^\s*\/\/.*$/gm,
    '',
  ),
);
await new Promise((resolve, reject) => {
  const child = spawn('npm', ['run', 'build:worker'], {
    cwd: package_root,
    stdio: 'inherit',
  });
  child.on('error', reject);
  child.on('exit', (exit_code) =>
    exit_code === 0 ? resolve() : reject(new Error(`Worker bundle failed: ${exit_code}`)),
  );
});
await rm(output_root, {
  recursive: true,
  force: true,
});
await mkdir(output_root, { recursive: true });
await cp(new URL('../dist/', import.meta.url), new URL('assets/', output_root), {
  recursive: true,
});
await cp(
  new URL('../artifacts/worker/index.js', import.meta.url),
  new URL('worker.js', output_root),
);
delete deployment_config.$schema;
deployment_config.main = './worker.js';
deployment_config.assets.directory = './assets';
deployment_config.no_bundle = true;
deployment_config.find_additional_modules = false;
await writeFile(
  new URL('wrangler.json', output_root),
  JSON.stringify(deployment_config, null, 2) + '\n',
);
const artifact_hashes = {};
async function hash_directory(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative_path = prefix + entry.name;
    if (entry.isDirectory()) {
      await hash_directory(new URL(entry.name + '/', directory), relative_path + '/');
    } else {
      artifact_hashes[relative_path] = createHash('sha256')
        .update(await readFile(new URL(entry.name, directory)))
        .digest('hex');
    }
  }
}
await hash_directory(output_root);
await writeFile(
  new URL('sha256.json', output_root),
  JSON.stringify(artifact_hashes, null, 2) + '\n',
);
console.log(
  'Packaged static assets, Worker bundle, bindings and SQLite migration for deployment without rebuilding.',
);
