#!/usr/bin/env node
// Regenerates the onboarding assets (P3-12, ADR-0052):
//
//   - the tools' demo clips, `apps/web/public/demos/<tool>.webm`
//     (FR-UX-04: shown in the toolbar's tooltips);
//   - the template gallery's thumbnails, `apps/web/src/home/templates/*.png`.
//
//   pnpm demos                  # build the app, then record everything
//   pnpm demos --skip-build     # the build in apps/web/dist is current
//   pnpm demos -g "demo: fillet"  # only what matches (a Playwright --grep)
//   pnpm demos -g tutorials     # the tutorials' pictures, docs/guide/tutorials/images/
//
// How it works: `e2e/record-assets.spec.ts` drives the real app in headless
// Chromium (flows copied from the e2e specs) while `e2e/demo-recorder.ts`
// takes screenshots of the view as fast as the page allows, lays them on a
// 15 fps timeline and encodes a 480 × 300 WebM with Playwright's own ffmpeg
// (VP8 only; `playwright install ffmpeg` fetches it, 2 MB). The pointer is
// drawn into the page, since screenshots don't show the OS cursor. Nothing
// here needs a system ffmpeg.
//
// Set PLAYWRIGHT_CHROMIUM_PATH for a system Chromium (on the Ubuntu machine
// /usr/bin/google-chrome-stable), E2E_PORT if 4173 is taken, and FFMPEG to use
// another ffmpeg with libvpx and an mjpeg decoder. Run it where the OCCT WASM
// is available (`pnpm wasm`): every project starts the kernel. The clips depend
// on how the app looks and behaves, so record again after changing a tool's UI,
// look at the result in the Browser pane, and check the sizes
// (`apps/web/src/onboarding/demos.test.ts` fails above 150 kB a clip).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');
let passThrough = args.filter((a) => a !== '--skip-build');
// `pnpm demos -g tutorials` records the tutorials' pictures (e2e/tutorials/step.ts,
// ADR-0080 §4) instead of the onboarding assets; further arguments go to Playwright.
const grep = passThrough.findIndex((a) => a === '-g' || a === '--grep');
const tutorials = grep >= 0 && passThrough[grep + 1] === 'tutorials';
if (tutorials) passThrough = passThrough.filter((_, i) => i !== grep && i !== grep + 1);
const target = tutorials ? 'e2e/tutorials' : 'e2e/record-assets.spec.ts';

function run(command, commandArgs, env = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const playwright = ['node_modules/@playwright/test/cli.js'];
if (!process.env.FFMPEG) run(process.execPath, [...playwright, 'install', 'ffmpeg']);
if (!skipBuild) run('pnpm', ['build']);
if (!existsSync(`${root}apps/web/dist/index.html`)) {
  console.error('apps/web/dist is missing: run without --skip-build.');
  process.exit(1);
}
run(process.execPath, [...playwright, 'test', target, '--workers=1', ...passThrough], {
  RECORD_ASSETS: '1',
});
console.log(
  tutorials
    ? '\nDone. Look at every picture in docs/guide/tutorials/images/ before committing.'
    : '\nDone. Review apps/web/public/demos/ and apps/web/src/home/templates/ before committing.',
);
