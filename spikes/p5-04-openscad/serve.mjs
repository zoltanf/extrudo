// Serves web/ with the app's `/*` headers from apps/web/public/_headers.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
const text = readFileSync(new URL('../../apps/web/public/_headers', import.meta.url), 'utf8');
const block = text.split(/\n(?=\/)/).find((b) => b.startsWith('/*\n'));
const headers = Object.fromEntries(block.split('\n').slice(1).filter((l) => l.startsWith('  ')).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
export function serve(port = 0) {
  const server = createServer((req, res) => {
    const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    try {
      const body = readFileSync(join(new URL('./web', import.meta.url).pathname, path));
      res.writeHead(200, { ...headers, 'Content-Type': types[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404, headers); res.end(); }
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}
