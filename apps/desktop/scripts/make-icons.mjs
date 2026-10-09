#!/usr/bin/env node
/**
 * Renders the desktop app's icons from the brand's own mark
 * (docs/brand/extrudo-favicon.svg), through a headless Chromium page with a
 * transparent background (ADR-0075's 2026-10-10 amendment).
 *
 *   build/icon.png      1024 x 1024, the rounded square full-bleed (Windows, Linux)
 *   build/icon-mac.png  1024 x 1024, Apple's grid: the square 824 x 824 centred,
 *                       corner radius 185 px, transparent margin, no shadow
 *
 * Usage: node apps/desktop/scripts/make-icons.mjs
 * Set PLAYWRIGHT_CHROMIUM_PATH for a system Chromium.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const source = readFileSync(join(root, 'docs/brand/extrudo-favicon.svg'), 'utf8');
const inner = source
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<title>[\s\S]*?<\/title>/, '');
const SIZE = 1024;
const SQUARE = 824;
const RADIUS = 185;
const scale = SQUARE / 64;
// The mark's first element is the 64-unit rounded square; give it the radius in its own units.
const macInner = inner.replace(/rx="15"/, `rx="${RADIUS / scale}"`);

const svgs = {
  'icon.png': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${SIZE}" height="${SIZE}">${inner}</svg>`,
  'icon-mac.png': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}"><g transform="translate(${(SIZE - SQUARE) / 2} ${(SIZE - SQUARE) / 2}) scale(${scale})">${macInner}</g></svg>`,
};

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
});
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  for (const [name, svg] of Object.entries(svgs)) {
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`,
    );
    const png = await page.screenshot({
      omitBackground: true,
      clip: { x: 0, y: 0, width: SIZE, height: SIZE },
    });
    writeFileSync(join(root, 'apps/desktop/build', name), png);
    console.log(`wrote apps/desktop/build/${name}`);
  }
} finally {
  await browser.close();
}
