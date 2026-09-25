// Download size per candidate from the Vite production build (dist/assets):
// raw, gzip -9 and brotli q11 (what a host would serve precompressed).
// `npx vite build && node src/node/sizes.ts [candidate]` (one candidate keeps the others' previous numbers)

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const assets = readdirSync('dist/assets');
const groups: Record<string, { wasm: RegExp; js: RegExp[] }> = {
  libcascade: { wasm: /^opencascade_single-.*\.wasm$/, js: [/^opencascade_single-.*\.js$/, /^libcascade-.*\.js$/, /^raw-occt-.*\.js$/] },
  replicad: { wasm: /^replicad_single-.*\.wasm$/, js: [/^replicad-.*\.js$/, /^raw-occt-.*\.js$/] },
  brepjs: { wasm: /^occt-wasm-.*\.wasm$/, js: [/^occt-wasm-.*\.js$/, /^brepjs-.*\.js$/] },
  custom: { wasm: /^extrudo_occt_single-.*\.wasm$/, js: [/^extrudo_occt_single-.*\.js$/, /^custom-.*\.js$/, /^raw-occt-.*\.js$/] },
};
const size = (f: string) => {
  const b = readFileSync(`dist/assets/${f}`);
  return {
    raw: b.length,
    gzip: gzipSync(b, { level: 9 }).length,
    brotli: brotliCompressSync(b, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: b.length },
    }).length,
  };
};
const out: Record<string, unknown> = {};
const only = process.argv[2];
const prev: Record<string, unknown> = (() => {
  try {
    return JSON.parse(readFileSync('results/sizes.json', 'utf8'));
  } catch {
    return {};
  }
})();
for (const [c, g] of Object.entries(groups)) {
  if (only && c !== only) {
    if (prev[c]) out[c] = prev[c];
    continue;
  }
  const wasmFile = assets.find((a) => g.wasm.test(a));
  if (!wasmFile) throw new Error(`no wasm for ${c}`);
  const jsFiles = assets.filter((a) => a.endsWith('.js') && g.js.some((r) => r.test(a)));
  const wasm = size(wasmFile);
  const js = jsFiles.map(size).reduce((a, b) => ({ raw: a.raw + b.raw, gzip: a.gzip + b.gzip, brotli: a.brotli + b.brotli }));
  out[c] = { wasmFile, wasm, jsFiles, js };
  const mb = (n: number) => (n / 1e6).toFixed(2);
  console.log(`${c.padEnd(11)} wasm ${mb(wasm.raw)} MB raw / ${mb(wasm.gzip)} gz / ${mb(wasm.brotli)} br   js ${(js.raw / 1e3).toFixed(0)} kB raw / ${(js.brotli / 1e3).toFixed(0)} kB br`);
}
writeFileSync('results/sizes.json', `${JSON.stringify(out, null, 2)}\n`);
