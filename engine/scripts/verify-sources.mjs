import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { root } from './toolchain.mjs';
const directory = resolve(root, 'reference');
const manifest = JSON.parse(readFileSync(resolve(directory, 'source-manifest.json'), 'utf8'));
if (manifest.schemaVersion !== 1) throw new Error('Unsupported source manifest');
for (const file of manifest.files) {
  const source = resolve(directory, file.local);
  const local = relative(directory, source);
  if (local.startsWith('..') || isAbsolute(local)) throw new Error(`Unsafe manifest path: ${file.local}`);
  const component = file.repository === manifest.osu.repository ? manifest.osu : manifest.framework;
  if (file.repository !== component.repository || file.commit !== component.commit || file.licence !== 'MIT') throw new Error(`Unpinned source: ${file.path}`);
  const expectedUrl = `https://raw.githubusercontent.com/${file.repository}/${file.commit}/${file.path}`;
  if (file.url !== expectedUrl) throw new Error(`Source URL mismatch: ${file.path}`);
  const actual = createHash('sha256').update(readFileSync(source)).digest('hex');
  if (actual !== file.sha256) throw new Error(`Source hash mismatch: ${file.local}`);
}
const csproj = readFileSync(resolve(directory, 'sources/osu__osu.Game__osu.Game.csproj'), 'utf8');
if (!csproj.includes(`Include="ppy.osu.Framework" Version="${manifest.framework.version}"`)) throw new Error('Framework package pin changed');

// Full checkouts are optional for local foundation tests, required by oracle runs.
for (const [key, environment] of [['osu', 'OSU_REFERENCE_CHECKOUT'], ['framework', 'OSU_FRAMEWORK_CHECKOUT']]) {
  const checkout = process.env[environment];
  if (!checkout) {
    if (process.argv.includes('--require-checkouts')) throw new Error(`Set ${environment} to the pinned checkout`);
    continue;
  }
  const git = args => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim();
  if (git(['rev-parse', 'HEAD']) !== manifest[key].commit) throw new Error(`${key} checkout revision mismatch`);
  if (git(['status', '--porcelain', '--untracked-files=normal'])) throw new Error(`${key} checkout contains modified source`);
}
console.log(`Verified ${manifest.files.length} source hashes, licences, and framework pin.`);
