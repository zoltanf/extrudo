import { expect, type Page, test } from '@playwright/test';
import { kernelReady, parameterExpression, parametersDialog, pickTool, projector } from './helpers';

// P6-17, ADR-0105: on the bottle cap (B9, an ~8 s recompute) a parameter
// change shows the determinate "Updating the model…" notice, whose progress
// bar never goes back; a kernel call made while it still computes queues behind it and
// the shell shows the busy cursor; once the kernel is ready, neither the
// notice nor the cursor remains. Traps are in docs/agent/e2e-notes.md.

test.use({ viewport: { width: 1440, height: 900 } });
// The recompute alone is about 8 s; the whole run is comfortably under 2 min.
test.setTimeout(120_000);

interface Sampled {
  /** The notice's bar values, each new one as it changed. */
  bar: number[];
  /** Whether the shell ever carried `data-kernel-busy`… */
  busy: boolean;
  /** …and the view's cursors while it did. */
  cursors: string[];
}

/**
 * Samples the notice's bar, the shell's busy flag and the view's cursor every
 * frame from now on: Playwright's polls are too coarse for a queued call that
 * may wait only a moment.
 */
const startSampling = (page: Page) =>
  page.evaluate(
    `(() => {
      const seen = { bar: [], busy: false, cursors: [] };
      window.__kernelWaits = seen;
      const tick = () => {
        const bar = document.querySelector('[data-model-progress="updating"] progress');
        if (bar && seen.bar[seen.bar.length - 1] !== bar.value) seen.bar.push(bar.value);
        if (document.querySelector('[data-kernel-busy]')) {
          seen.busy = true;
          const view = document.querySelector('[aria-label="Viewport"]');
          const cursor = view ? getComputedStyle(view).cursor : '';
          if (!seen.cursors.includes(cursor)) seen.cursors.push(cursor);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })()`,
  );

const sampled = (page: Page) => page.evaluate('window.__kernelWaits') as Promise<Sampled>;

test('a long recompute shows a progress bar and a queued kernel call shows the busy cursor', async ({
  page,
}) => {
  await page.goto('./#/example/bottle-cap');
  await kernelReady(page);
  const viewport = page.getByRole('region', { name: 'Viewport' });

  // Select a face before the edit (a plain click picks the body, not the
  // construction planes), so Section Analysis can call the kernel the moment
  // the update starts, with most of the recompute still ahead. Then move off
  // the model so the view has no pick cursor of its own.
  const project = await projector(viewport);
  const target = ((await viewport.getAttribute('data-camera-target')) ?? '')
    .split(',')
    .map(Number) as [number, number, number];
  const centre = project(target);
  await page.mouse.click(centre.x, centre.y);
  await expect(viewport).toHaveAttribute('data-model-selection', /^face:/);
  const box = await viewport.boundingBox();
  await page.mouse.move((box?.x ?? 0) + 20, (box?.y ?? 0) + (box?.height ?? 0) - 20);
  await startSampling(page);

  // Change the cap diameter: it invalidates the first sketch, so every feature
  // re-evaluates in order and the bar advances through the long recompute
  // (B9 ≈ 8 s), while a `wall` edit would only re-evaluate the later features.
  await pickTool(page, 'Parameters');
  const field = await parameterExpression(page, 'capDia');
  await field.fill('34 mm');
  await field.press('Enter');
  await page.keyboard.press('Escape');
  await expect(parametersDialog(page)).toHaveCount(0);

  // (a) The updating notice with a progress bar and its detail line naming
  // the feature being computed.
  const updating = page.locator('[data-model-progress="updating"]');
  await expect(updating).toBeVisible();
  await expect(updating.locator('progress')).toBeVisible();
  await expect(updating).toContainText(/\d+ of \d+/);

  // (b) Section Analysis with a face selected calls `Recomputer.reference`
  // (non-quiet) at once, which queues behind the recompute: the shell carries
  // `data-kernel-busy` and the view's cursor is the busy one. The updating
  // notice wins the pill, so the wait shows through the shell attribute.
  await expect(viewport).toHaveAttribute('data-model-selection', /^face:/);
  await pickTool(page, 'Section Analysis');
  await expect.poll(async () => (await sampled(page)).busy, { timeout: 10_000 }).toBe(true);

  // (c) Once the kernel is ready, no notice and no cursor; meanwhile the bar
  // only moved forward and the busy cursor showed. Whether the bar is seen to
  // move depends on the machine: the features before the heavy thread often
  // finish inside the notice's 800 ms delay, so it may show the last step only
  // (the per-feature progress is unit-tested in recomputer.test.ts).
  await expect(page.getByRole('status', { name: 'Kernel' })).toHaveAttribute(
    'data-model-status',
    'ready',
    { timeout: 60_000 },
  );
  await expect(page.locator('[data-model-progress]')).toHaveCount(0);
  await expect(page.locator('[data-kernel-busy]')).toHaveCount(0);
  const { bar, cursors } = await sampled(page);
  expect(bar.length).toBeGreaterThan(0);
  expect(bar).toEqual([...bar].sort((a, b) => a - b));
  expect(cursors).toContain('progress');
});
