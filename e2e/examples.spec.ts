import { expect, type Page, test } from '@playwright/test';
import { kernelReady } from './helpers';

// P6-06 S3: the example library — `#/example/<id>` opens a copy of one of the
// eleven example designs, listed under the home screen's More examples…
// dialog. The examples are not precached (they fetch over the network).

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

const viewportOf = (page: Page) => page.getByRole('region', { name: 'Viewport' });

test('an example link opens the design as a project, and Back stays out', async ({ page }) => {
  await page.goto('./#/example/name-tag');
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await kernelReady(page);
  const viewport = viewportOf(page);
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await expect(viewport).toHaveAttribute('data-bodies', /\S/);
  // The opener replaced the route, so Back doesn't return to #/example/….
  await page.goBack();
  await expect(page).not.toHaveURL(/#\/example\//);
});

test('an unknown example lands on the home screen with a toast', async ({ page }) => {
  await page.goto('./#/example/nope');
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('alert')).toHaveText(/There's no example named "nope"\./);
});

test('the home screen lists the examples under More examples…', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'More examples…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Examples' });
  const list = dialog.getByRole('list', { name: 'Examples' });
  await expect(list.getByRole('button', { name: /^Open the / })).toHaveCount(11);
  await dialog.getByRole('button', { name: 'Open the Plate with corner holes example' }).click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await kernelReady(page);
  // The B1 fixture is the sketch stage of the plate (no extrude yet), so the
  // design opens on its sketch rather than on a body.
  await expect(
    page.getByRole('button', { name: 'Project name: Plate with corner holes. Rename' }),
  ).toBeVisible();
  await expect(viewportOf(page)).toHaveAttribute('data-sketches', /\S/);
});
