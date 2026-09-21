import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { write_demo_assets } from './generate_demo.mjs';

const package_root = new URL('../', import.meta.url);
const engine_wasm = new URL('../../engine/artifacts/tapweave.wasm', package_root);

try {
  await access(engine_wasm);
} catch {
  throw new Error('engine/artifacts/tapweave.wasm is missing; run `npm --prefix engine run build` first');
}

await mkdir(new URL('../public/', import.meta.url), { recursive: true });
// Remove the obsolete fixed-name copy left by earlier builds.
await rm(new URL('../public/tapweave.wasm', import.meta.url), { force: true });
for (const filename of ['_headers', '_redirects']) {
  await copyFile(new URL('../hosting/' + filename, import.meta.url), new URL('../public/' + filename, import.meta.url));
}

// Ship attribution with the browser distribution, not just in the repository.
await copyFile(new URL('../../LICENSE', package_root), new URL('../public/LICENSE.txt', import.meta.url));
const notice_sections = [await readFile(new URL('../../THIRD_PARTY_NOTICES.md', package_root), 'utf8')];
for (const [label, license_path] of [
  ['osu!', '../../engine/reference/sources/osu__LICENCE'],
  ['osu!framework', '../../engine/reference/sources/osu-framework__LICENCE'],
  ['Solid', 'node_modules/solid-js/LICENSE'],
  ['Solid Router', 'node_modules/@solidjs/router/LICENSE'],
  ['Solid Virtual', 'node_modules/@tanstack/solid-virtual/LICENSE'],
  ['Virtual Core', 'node_modules/@tanstack/virtual-core/LICENSE'],
  ['fflate', 'node_modules/fflate/LICENSE'],
]) {
  notice_sections.push(label + '\n\n' + await readFile(new URL(license_path, package_root), 'utf8'));
}
await writeFile(new URL('../public/THIRD_PARTY_NOTICES.txt', import.meta.url), notice_sections.join('\n\n'));

// The demo beatmap is generated (and verified against the tracked manifest)
// on every asset preparation pass; see scripts/demo/README.md.
const demo_path = await write_demo_assets(new URL('../public/demo/', import.meta.url));
console.log('Product assets: ' + demo_path);
