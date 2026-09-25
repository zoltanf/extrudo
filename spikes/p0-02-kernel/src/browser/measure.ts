// Drive the built page in headless Chromium: for each candidate, 3 cold loads
// in fresh contexts (no HTTP cache), read window.__spike, save a screenshot.
// `npx vite build && node src/browser/measure.ts`. Uses the repo root's Playwright.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const COLD_LOADS = 3;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview'], { stdio: 'pipe' });
await new Promise<void>((resolve) => server.stdout.on('data', (b) => String(b).includes('5175') && resolve()));

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const results: Record<string, unknown> = {};
try {
  for (const c of ['libcascade', 'replicad', 'brepjs', 'custom']) {
    const loads = [];
    for (let i = 0; i < COLD_LOADS; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 700 } });
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:5175/?c=${c}`);
      await page.waitForFunction(() => (window as unknown as { __spike?: unknown }).__spike, null, { timeout: 120_000 });
      const d = await page.evaluate(() => (window as unknown as { __spike: unknown }).__spike);
      if (i === 0) await page.screenshot({ path: `results/browser-${c}.png` });
      loads.push(d);
      await ctx.close();
    }
    results[c] = { browser: browser.version(), loads };
    // biome-ignore lint/suspicious/noExplicitAny: loose result JSON
    const ready = loads.map((l: any) => l.workerReadyMs?.toFixed(0));
    console.log(`${c}: worker ready ${ready.join(' / ')} ms`);
  }
} finally {
  await browser.close();
  server.kill();
}
writeFileSync('results/browser.json', `${JSON.stringify(results, null, 2)}\n`);
