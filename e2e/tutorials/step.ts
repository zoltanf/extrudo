import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Page, test } from '@playwright/test';
import { settled } from '../benchmark-helpers';
import { indexed } from '../indexed-png';

// Tutorials are tests (ADR-0080 §4). A tutorial page in `docs/guide/tutorials/<name>.md`
// has one `<!-- step: <slug> -->` marker per step; its spec `e2e/tutorials/<name>.spec.ts`
// walks the same steps with `step('<slug>', actions, check)`, in the same order
// (`apps/site/src/tutorials.test.ts` fails when the two differ, or a picture is missing).
//
//   const { step } = tutorial(page, 'first-part');
//   await step('rectangle', async () => { …do what the page says… }, async () => { …assert… });
//
// A step runs its actions, then its check, inside Playwright's `test.step`, so a failure
// names the step. The check reads the app's data attributes, as the benchmarks do.
//
// Pictures: with `RECORD_ASSETS=1` the step then saves a PNG to
// `docs/guide/tutorials/images/<name>/<slug>.png`. One rule for every tutorial: the
// **whole page at 1440 × 900** (the specs set that viewport), after the camera has
// stopped moving, with the render-rate readout hidden by `e2e/screenshot.css`, and
// after the pointer has been moved to the corner so no tooltip or hover covers the
// step. The page-wide shot keeps toolbar, browser, timeline and dialog together, which
// is what a reader needs to find the control on their own screen. The shot is then
// **reduced to a 256-colour PNG** (median cut, no dither, `indexed` below): a full-colour
// 1440 × 900 shot of the app's gradient view is about 570 kB, the indexed one under
// 150 kB, and the UI's flat colours and text lose nothing a reader can see. Without
// `RECORD_ASSETS` a step only checks, so the tutorials run in the normal e2e suite.
//
// Record with `pnpm demos -g tutorials` (scripts/record-demos.mjs builds the app, then
// runs this folder with RECORD_ASSETS=1); look at every picture before committing.

const IMAGES = join(process.cwd(), 'docs', 'guide', 'tutorials', 'images');
const STYLE = join(process.cwd(), 'e2e', 'screenshot.css');

export function tutorial(page: Page, name: string) {
  async function step(
    slug: string,
    actions: () => Promise<void>,
    check: () => Promise<void>,
  ): Promise<void> {
    await test.step(`${name}: ${slug}`, async () => {
      await actions();
      await check();
      if (!process.env.RECORD_ASSETS) return;
      // The Viewport region leaves the accessibility tree while a modal dialog is open.
      await settled(page.locator('[data-camera-size]'));
      // Toasts (and the Sketch1-is-hidden notice) would cover the step.
      for (const toast of await page.getByRole('button', { name: 'Dismiss' }).all()) {
        await toast.click();
      }
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      await mkdir(join(IMAGES, name), { recursive: true });
      const shot = await page.screenshot({
        style: await readFile(STYLE, 'utf8'),
        animations: 'disabled',
      });
      await writeFile(join(IMAGES, name, `${slug}.png`), await indexed(page, shot));
    });
  }
  return { step };
}
