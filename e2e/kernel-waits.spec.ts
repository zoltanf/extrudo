import { expect, type Page, test } from '@playwright/test';
import { kernelReady, parameterExpression, parametersDialog, pickTool, projector } from './helpers';

// P6-17, ADR-0105: on the bottle cap (B9, an ~8 s recompute) a parameter
// change shows the determinate "Updating the model…" notice, whose progress
// bar grows; a kernel call made while it still computes queues behind it and
// the shell shows the busy cursor; once the kernel is ready, neither the
// notice nor the cursor remains. Traps are in docs/agent/e2e-notes.md.

test.use({ viewport: { width: 1440, height: 900 } });
// The recompute alone is about 8 s; the whole run is comfortably under 2 min.
test.setTimeout(120_000);

/** The bar's `value` as a number (the notice's `<progress>`), or -1 when gone. */
const barValue = (page: Page) =>
  page.evaluate(
    `(() => {
      const el = document.querySelector('[data-model-progress="updating"] progress');
      return el ? el.value : -1;
    })()`,
  ) as Promise<number>;

test('a long recompute shows a growing bar and a queued kernel call shows the busy cursor', async ({
  page,
}) => {
  await page.goto('./#/example/bottle-cap');
  await kernelReady(page);
  const viewport = page.getByRole('region', { name: 'Viewport' });

  // Change the cap diameter: it invalidates the first sketch, so every feature
  // re-evaluates in order and the bar advances through the long recompute
  // (B9 ≈ 8 s), while a `wall` edit would only re-evaluate the later features.
  await pickTool(page, 'Parameters');
  const field = await parameterExpression(page, 'capDia');
  await field.fill('34 mm');
  await field.press('Enter');
  await page.keyboard.press('Escape');
  await expect(parametersDialog(page)).toHaveCount(0);

  // (a) The updating notice with a progress bar whose value grows, and its
  // detail line naming the feature being computed. Read the first value as
  // soon as the notice shows: the bar reaches the last feature (the heavy
  // thread) about 1.5 s in, so this must not wait for the other steps.
  const updating = page.locator('[data-model-progress="updating"]');
  await expect(updating).toBeVisible();
  await expect(updating.locator('progress')).toBeVisible();
  await expect(updating).toContainText(/\d+ of \d+/);
  const first = await barValue(page);
  await expect.poll(() => barValue(page), { timeout: 20_000 }).not.toBe(first);

  // (b) A kernel call made while it still computes queues behind it. Select a
  // face first (a plain click picks the body, not the construction planes),
  // then activate Section Analysis: with a face selected it calls
  // `Recomputer.reference` (non-quiet) at once, so the shell carries
  // `data-kernel-busy` and the view's cursor is the busy one. The updating
  // notice wins the pill, so the wait is asserted through the shell attribute
  // instead.
  const project = await projector(viewport);
  const target = ((await viewport.getAttribute('data-camera-target')) ?? '')
    .split(',')
    .map(Number) as [number, number, number];
  const centre = project(target);
  await page.mouse.click(centre.x, centre.y);
  await expect(viewport).toHaveAttribute('data-model-selection', /^face:/);
  await pickTool(page, 'Section Analysis');
  await expect(page.locator('[data-kernel-busy]')).toHaveCount(1, { timeout: 10_000 });
  // Move off the model so the view has no pick cursor of its own; the busy
  // cursor on the shell root then reaches the view.
  const box = await viewport.boundingBox();
  await page.mouse.move((box?.x ?? 0) + 20, (box?.y ?? 0) + (box?.height ?? 0) - 20);
  await expect
    .poll(
      () =>
        page.evaluate(
          `(() => {
            const el = document.querySelector('[aria-label="Viewport"]');
            return el ? getComputedStyle(el).cursor : '';
          })()`,
        ),
      { timeout: 10_000 },
    )
    .toBe('progress');

  // (c) Once the kernel is ready, no notice and no cursor.
  await expect(page.getByRole('status', { name: 'Kernel' })).toHaveAttribute(
    'data-model-status',
    'ready',
    { timeout: 60_000 },
  );
  await expect(page.locator('[data-model-progress]')).toHaveCount(0);
  await expect(page.locator('[data-kernel-busy]')).toHaveCount(0);
});
