import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const site_root = fileURLToPath(new URL('../artifacts/site/', import.meta.url));
const content_types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8' };
const port = Number(process.env.TAPWEAVE_PORT || 4173);
const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const asset_path = resolve(site_root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!asset_path.startsWith(resolve(site_root) + sep)) {
      response.writeHead(403).end();
      return;
    }
    const bytes = await readFile(asset_path);
    response.writeHead(200, { 'Content-Type': content_types[extname(asset_path)] || 'application/octet-stream',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch {
    response.writeHead(404).end('Not found');
  }
});
server.listen(port, '127.0.0.1', () => console.log('Tapweave: http://127.0.0.1:' + port));
