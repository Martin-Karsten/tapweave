import { mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync, renameSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { root, toolchain, verifyCompiler } from './toolchain.mjs';

if (process.env.ODIN_BIN || existsSync(resolve(root, '.toolchain/odin/odin'))) {
  console.log(verifyCompiler());
} else {
  const asset = toolchain.assets[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error('No pinned installer for this platform. Install the pinned Odin release and set ODIN_BIN.');
  const cache = resolve(root, '.toolchain');
  mkdirSync(cache, { recursive: true });
  const staging = mkdtempSync(join(cache, 'install-'));
  try {
    const archive = join(staging, 'odin.tar.gz');
    execFileSync('curl', ['--fail', '--location', '--retry', '3', asset.url, '--output', archive], { stdio: 'inherit' });
    if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== asset.sha256) throw new Error('Odin archive checksum mismatch');
    const extracted = join(staging, 'extracted');
    mkdirSync(extracted);
    execFileSync('tar', ['-xzf', archive, '-C', extracted]);
    const candidates = [extracted, ...readdirSync(extracted, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(extracted, entry.name))];
    const installation = candidates.find(path => existsSync(join(path, 'odin')));
    if (!installation) throw new Error('Unexpected Odin archive layout');
    const version = execFileSync(join(installation, 'odin'), ['version'], { encoding: 'utf8' }).trim();
    if (!version.includes(toolchain.version) || !version.includes(toolchain.commit)) throw new Error(`Unexpected compiler: ${version}`);
    renameSync(installation, join(cache, 'odin'));
    console.log(verifyCompiler());
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
console.log('Odin is ready. Install a native linker and wasm-ld separately; see README.md.');
