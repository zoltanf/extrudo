// Drives the built page in headless Chromium: the rectangle drag (the task's
// scenario), the conflict readout and drag tests on generated sketches (split
// into components), for each build. `npx vite build && node src/browser/measure.ts`
// Uses the repo root's Playwright. Writes results/browser.json.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview'], { stdio: 'pipe' });
await new Promise<void>((resolve) => server.stdout.on('data', (b) => String(b).includes('5175') && resolve()));

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const results: Record<string, unknown> = { browser: browser.version() };
const FRAMES = 180;
try {
  for (const build of ['npm', 'fast']) {
    const out: Record<string, unknown> = {};
    const fresh = async () => {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 680 } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.log(`[${build}] pageerror: ${e.message.slice(0, 100)}`));
      await page.goto(`http://127.0.0.1:5175/?build=${build}`);
      await page.waitForFunction(() => 'spike' in window, null, { timeout: 60_000 });
      return { ctx, page };
    };

    // The task's rectangle: drag at 60 fps, then add a conflicting dimension.
    {
      const { ctx, page } = await fresh();
      out.rectangle = await page.evaluate((f) => window.spike.dragTest('rect', 'anchored', f), FRAMES);
      out.rectangleState = await page.evaluate(() => window.spike.state());
      if (build === 'npm') await page.screenshot({ path: 'results/browser-rectangle.png' });
      await page.evaluate(() => window.spike.toggleConflict());
      out.conflictState = await page.evaluate(() => window.spike.state());
      if (build === 'npm') await page.screenshot({ path: 'results/browser-conflict.png' });
      await ctx.close();
    }

    const drags: unknown[] = [];
    for (const layout of ['anchored', 'chained'] as const) {
      // Chained 500 is one 2400-unknown system: seconds per frame (see node results).
      for (const size of layout === 'chained' ? ['50', '100', '200'] : ['50', '200', '500']) {
        const { ctx, page } = await fresh();
        try {
          const r = await page.evaluate(([s, l, f]) => window.spike.dragTest(s, l, f), [size, layout, FRAMES] as const);
          drags.push(r);
          if (build === 'fast' && size === '500' && layout === 'anchored') {
            await page.screenshot({ path: 'results/browser-500.png' });
          }
        } catch (error) {
          drags.push({ sketch: size, layout, error: String(error).split('\n')[0]?.slice(0, 120) });
        }
        await ctx.close();
      }
    }
    out.drags = drags;

    results[build] = out;
    console.log(build, JSON.stringify({ rectangle: out.rectangle, conflictState: out.conflictState }));
    for (const d of drags) console.log(build, JSON.stringify(d));
  }
} finally {
  await browser.close();
  server.kill();
}
writeFileSync('results/browser.json', `${JSON.stringify(results, null, 2)}\n`);
