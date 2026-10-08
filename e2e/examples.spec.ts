import { expect, type Page, test } from '@playwright/test';
import { kernelReady } from './helpers';

const naturalWidth = (locator: ReturnType<Page['locator']>) =>
  locator.evaluate((el) => (el as unknown as { naturalWidth: number }).naturalWidth);

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

// P6-06 S4: each example has its picture, in the dialog and on the home-screen
// card of the copy it opens.
test('the More examples… dialog shows a picture for every example', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'More examples…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Examples' });
  const list = dialog.getByRole('list', { name: 'Examples' });
  const pictures = list.getByRole('img');
  await expect(pictures).toHaveCount(11);
  await expect(list.getByRole('img', { name: 'Name tag' })).toBeVisible();
  for (let i = 0; i < 11; i++) {
    await expect.poll(() => naturalWidth(pictures.nth(i))).toBeGreaterThan(0);
  }
});

test('an opened example has its picture on its home-screen card', async ({ page }) => {
  await page.goto('./#/example/name-tag');
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await kernelReady(page);
  await page.goto('./');
  const card = page
    .getByRole('list', { name: 'Designs' })
    .getByRole('listitem')
    .filter({ hasText: 'Name tag' });
  await expect(card).toBeVisible();
  await expect.poll(() => naturalWidth(card.locator('img'))).toBeGreaterThan(0);
});
