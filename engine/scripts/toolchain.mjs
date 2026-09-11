import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const toolchain = JSON.parse(readFileSync(resolve(root, 'toolchain.json'), 'utf8'));
export const odin = process.env.ODIN_BIN || resolve(root, '.toolchain/odin/odin');
export const env = { ...process.env, PATH: [process.env.ODIN_WASM_LD_DIR, process.env.PATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':') };
export function compile(args) {
  execFileSync(odin, args, { cwd: root, env, stdio: 'inherit' });
}
export function verifyCompiler() {
  const version = execFileSync(odin, ['version'], { env, encoding: 'utf8' }).trim();
  if (!version.includes(toolchain.version) || !version.includes(toolchain.commit)) throw new Error(`Expected pinned Odin ${toolchain.commit}, got ${version}`);
  return version;
}
