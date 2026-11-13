import { expect, type Page, test } from '@playwright/test';
import { kernelReady, pickTool, selectTab } from './helpers';

const naturalWidth = (locator: ReturnType<Page['locator']>) =>
  locator.evaluate((el) => (el as unknown as { naturalWidth: number }).naturalWidth);

// P6-06 S3: the example library — `#/example/<id>` opens a copy of one of the
// thirteen example designs, listed under the home screen's More examples…
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
  await expect(list.getByRole('button', { name: /^Open the / })).toHaveCount(13);
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
  await expect(pictures).toHaveCount(13);
  await expect(list.getByRole('img', { name: 'Name tag' })).toBeVisible();
  for (let i = 0; i < 13; i++) {
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

// P6-24 S6: the spool holder comes with a sheet. Its copy keeps it (the bodies' new IDs reach
// the sheet's anchors and parts list), so Make › Drawing opens the sheet with every item drawn
// from the model: no anchor lost, the parts list's two rows filled in.
test('the spool holder example opens its sheet, every item found', async ({ page }) => {
  await page.goto('./#/example/spool-holder');
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await kernelReady(page);
  await selectTab(page, 'Make');
  await pickTool(page, 'Drawing');
  const sheet = page.getByRole('region', { name: 'Sheet', exact: true });
  await expect(sheet).toBeVisible();
  await expect(page.locator('output[aria-label="Status"]')).toHaveText(
    'Editing drawing · sheet 1 of 1 · A4 landscape · 1:1 · mm',
  );
  const browser = page.getByRole('complementary', { name: 'Browser' });
  await expect(browser.locator('[data-sheet-view-row]')).toHaveCount(4);
  const texts = sheet.locator('[data-sheet-text] text');
  await expect
    .poll(() => texts.allTextContents(), { timeout: 60_000 })
    .toEqual(expect.arrayContaining(['80.0', '60.0', '40.0', 'Ø12.4', 'Bracket', 'Axle', 'PETG']));
  await expect(sheet.locator('[data-sheet-paper] > svg path[data-state="detached"]')).toHaveCount(
    0,
  );
});
