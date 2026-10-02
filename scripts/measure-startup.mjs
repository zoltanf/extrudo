#!/usr/bin/env node
// Measures Extrudo's download size and startup against NFR-02 (ADR-0037).
//
//   pnpm build && node scripts/measure-startup.mjs [--no-browser] [--mbit 50]
//
// 1. Sizes: raw and brotli (quality 11) of every file in apps/web/dist, grouped.
// 2. Timing (needs Chromium: Playwright's, or PLAYWRIGHT_CHROMIUM_PATH): serves
//    dist over HTTP with brotli, throttles the network to --mbit (default 50,
//    plus 20 ms latency) through the DevTools protocol, and takes
//      - a first visit: page load to the home screen, then opening the Wall
//        bracket template to the kernel's first finished recompute;
//      - a repeat visit, in the same profile once the service worker has
//        precached the app: the same two times, and again with the network off.
//    The precache's own downloads happen inside the service worker, which the
//    page's network log doesn't show: read that cost from the size table.
// Numbers vary with the machine: run it a few times and take the median.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';

const DIST = join(fileURLToPath(new URL('..', import.meta.url)), 'apps/web/dist');
const args = process.argv.slice(2);
const mbit = args.includes('--mbit') ? Number(args[args.indexOf('--mbit') + 1]) : 50;
const fmt = (n) => `${(n / 1e6).toFixed(2)} MB`;

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
const brotli = (buf) =>
  brotliCompressSync(buf, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  });

// ---- sizes -----------------------------------------------------------------
const files = walk(DIST).map((path) => {
  const data = readFileSync(path);
  return {
    name: relative(DIST, path).split(sep).join('/'),
    raw: data.length,
    br: brotli(data).length,
  };
});
const group = (name) =>
  name.startsWith('demos/')
    ? 'demos (no cache)'
    : name.endsWith('.wasm')
      ? name.includes('occt')
        ? 'OCCT WASM'
        : 'planegcs WASM'
      : /woff2?$/.test(name)
        ? 'fonts'
        : name.endsWith('.js')
          ? name.includes('worker') || name.includes('extrudo_occt')
            ? 'kernel JS'
            : 'app JS'
          : name.endsWith('.css')
            ? 'CSS'
            : 'other';
const groups = new Map();
for (const f of files) {
  const g = groups.get(group(f.name)) ?? { raw: 0, br: 0 };
  g.raw += f.raw;
  g.br += f.br;
  groups.set(group(f.name), g);
}
// The tools' demo clips (P3-12) are fetched when a tooltip opens and aren't precached.
const precached = files.filter((f) => !f.name.startsWith('demos/'));
const sum = (key) => precached.reduce((n, f) => n + f[key], 0);
console.log(`Sizes of apps/web/dist (${files.length} files)\n`);
console.log('group'.padEnd(16), 'raw'.padStart(12), 'brotli'.padStart(12));
for (const [g, v] of [...groups].sort((a, b) => b[1].br - a[1].br))
  console.log(g.padEnd(16), fmt(v.raw).padStart(12), fmt(v.br).padStart(12));
console.log('precache total'.padEnd(16), fmt(sum('raw')).padStart(12), fmt(sum('br')).padStart(12));
console.log(
  `\nAt ${mbit} Mbit, the whole precache takes ${((sum('br') * 8) / (mbit * 1e6)).toFixed(1)} s`,
);
if (args.includes('--no-browser')) process.exit(0);

// ---- timing ----------------------------------------------------------------
const { chromium } = await import('@playwright/test');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webm': 'video/webm',
  '.webmanifest': 'application/manifest+json',
};
const cache = new Map();
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = join(DIST, path === '/' ? 'index.html' : path);
  if (!file.startsWith(DIST)) return res.writeHead(403).end();
  let entry = cache.get(file);
  try {
    if (!entry && statSync(file).isFile()) {
      entry = brotliCompressSync(readFileSync(file), {
        params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
      });
      cache.set(file, entry);
    }
  } catch {}
  if (!entry) return res.writeHead(404).end();
  res
    .writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-encoding': 'br',
      'cache-control': 'no-cache',
    })
    .end(entry);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
});
const context = await browser.newContext({ serviceWorkers: 'allow' });

async function visit(label, { offline = false } = {}) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline,
    latency: 20,
    downloadThroughput: (mbit * 1e6) / 8,
    uploadThroughput: (mbit * 1e6) / 8,
  });
  const t0 = performance.now();
  await page.goto(origin);
  await page.getByRole('button', { name: 'New design' }).waitFor();
  const home = performance.now() - t0;
  const t1 = performance.now();
  await page.getByRole('button', { name: 'Start from the Wall bracket template' }).click();
  await page
    .getByRole('status', { name: 'Kernel' })
    .and(page.locator('[data-model-status="ready"]'))
    .waitFor({ timeout: 60_000 });
  const kernel = performance.now() - t1;
  console.log(
    `${label.padEnd(34)} home ${(home / 1e3).toFixed(2)} s   kernel ready ${(kernel / 1e3).toFixed(2)} s after opening`,
  );
  await page.close();
}

console.log(`\nTiming at ${mbit} Mbit, 20 ms latency, brotli, Chromium\n`);
await visit('first visit');
// The service worker precaches while the first visit runs; wait until it has.
const probe = await context.newPage();
await probe.goto(origin);
await probe.evaluate('navigator.serviceWorker.ready.then(() => true)');
await probe.close();
await visit('repeat visit (service worker)');
await visit('repeat visit, offline', { offline: true });
await browser.close();
server.close();
