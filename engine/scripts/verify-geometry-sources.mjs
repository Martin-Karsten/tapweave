import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(readFileSync(resolve(root, 'reference/source-manifest.json')));
const directory = resolve(root, 'reference/geometry');
const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json')));
if (manifest.schemaVersion !== 1 || manifest.files.length !== 6) throw new Error('Unexpected geometry manifest');
for (const file of manifest.files) {
  const component = [baseline.osu, baseline.framework].find(c => c.repository === file.repository);
  if (!component || component.commit !== file.commit || file.licence !== 'MIT') throw new Error(`Unpinned source ${file.path}`);
  if (file.local.includes('/') || file.local.includes('\\') || file.local === '..') throw new Error('Unsafe source path');
  if (file.url !== `https://raw.githubusercontent.com/${file.repository}/${file.commit}/${file.path}`) throw new Error('Source URL mismatch');
  const hash = createHash('sha256').update(readFileSync(resolve(directory, file.local))).digest('hex');
  if (hash !== file.sha256) throw new Error(`Geometry source hash mismatch: ${file.path}`);
}
const project = readFileSync(resolve(root, 'geometry-reference-host/GeometryReference.csproj'), 'utf8');
if (!project.includes(`Include="ppy.osu.Framework" Version="${baseline.framework.version}"`)) throw new Error('Geometry framework pin mismatch');
console.log(`Verified ${manifest.files.length} pinned geometry source files.`);
