import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const browser_root = new URL('../../platform/browser-js/', import.meta.url);
const compiled_entry = new URL('build/engine-bridge.js', browser_root);

function compiled_is_stale() {
  let entry_time;
  try {
    entry_time = statSync(fileURLToPath(compiled_entry)).mtimeMs;
  } catch {
    return true;
  }
  const source_directory = fileURLToPath(new URL('src/', browser_root));
  for (const source_name of readdirSync(source_directory)) {
    if (source_name.endsWith('.ts') &&
      statSync(source_directory + source_name).mtimeMs > entry_time) {
      return true;
    }
  }
  return false;
}

// The engine harnesses reuse the browser player's compiled Engine_Bridge as
// their ABI client. Compile the browser runtime on demand so the engine
// suites stay runnable without a manual browser build step.
export async function load_browser_runtime() {
  if (compiled_is_stale()) {
    const compilation = spawnSync('npm', ['--prefix', fileURLToPath(browser_root), 'run', 'compile'],
      { stdio: 'inherit' });
    if (compilation.status !== 0) {
      throw new Error('Browser runtime compilation failed; run npm --prefix platform/browser-js run compile.');
    }
  }
  return import(compiled_entry);
}
