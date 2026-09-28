// P2-01: the kernel worker recomputes the open document and the timeline
// shows each feature's status. The engine's caching and cancellation are
// unit-tested in packages/kernel (engine.test.ts, recomputer.test.ts); this
// covers the real worker, Comlink and the status display.
import { expect, type Page, test } from '@playwright/test';
import { kernelReady, openProject } from './helpers';

const kernel = (page: Page) => page.getByRole('status', { name: 'Kernel' });
const status = (page: Page) => page.getByRole('status', { name: 'Status', exact: true });
const chips = (page: Page) =>
  page.getByRole('list', { name: 'Features' }).getByRole('button', { name: /^[A-Z]/ });
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}( |$)`) });

test('the kernel computes a new design, and a sketch in it', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await expect(kernel(page)).toContainText(/computed in [\d.]+ ms/);

  await page.getByRole('button', { name: 'Create Sketch' }).click();
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XY' })
    .click();
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toHaveAccessibleName('Sketch1');
  await expect(kernel(page)).toHaveAttribute('data-model-status', 'ready');
  await expect(status(page)).toHaveText('1 feature · mm');
});

test('features the kernel cannot compute show an error, with the reason', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  // The template's extrudes have no profiles yet and the fillet no geometry;
  // Plane1 is rolled back.
  expect(
    await chips(page).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))),
  ).toEqual([
    'Sketch1',
    'Extrude1 (error)',
    'Sketch2',
    'Extrude2 (error)',
    'Fillet1 (error)',
    'Plane1 (rolled back)',
  ]);
  await expect(status(page)).toHaveText('6 features · mm · 3 errors');

  await chip(page, 'Extrude1').hover();
  await expect(page.getByRole('tooltip')).toContainText(
    'Extrude · error: Pick at least one profile or face to extrude.',
  );

  // Rolled back and suppressed features aren't computed, so they have no status.
  await page.getByRole('button', { name: 'Roll back to start' }).click();
  await expect(status(page)).toHaveText('6 features · mm');
  await expect(chip(page, 'Extrude1')).toHaveAccessibleName('Extrude1 (rolled back)');
  // Rolling forward to the end brings Plane1 in, which can't be computed either.
  await page.getByRole('button', { name: 'Roll forward to end' }).click();
  await expect(status(page)).toHaveText('6 features · mm · 4 errors');
  await expect(chip(page, 'Plane1')).toHaveAccessibleName('Plane1 (error)');

  await chip(page, 'Fillet1').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Suppress/ }).click();
  await expect(chip(page, 'Fillet1')).toHaveAccessibleName('Fillet1 (suppressed)');
  await expect(status(page)).toHaveText('6 features · mm · 3 errors');
});
