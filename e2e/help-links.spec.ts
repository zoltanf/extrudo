import { expect, type Page, test } from '@playwright/test';
import { openProject, pickTool } from './helpers';

// P6-06 S9: the Help menu's docs items and a tool tile's F1 open the landing
// site's /docs/ pages through `Platform.openDocs`. The external host is
// answered locally (nothing leaves the machine); the popup's URL is the
// assertion.

test.use({ viewport: { width: 1440, height: 900 } });

const DOCS = 'https://extrudo.org';

/**
 * Opens a project with the docs host answered locally, and returns the popup
 * taker. The route fulfils with an empty page — `route.abort()` would make
 * Chrome replace the popup's URL with `chrome-error://chromewebdata/` — so
 * still no request leaves the machine, and `popup.url()` is the real address.
 */
async function open(page: Page) {
  const viewport = await openProject(page);
  await page
    .context()
    .route(`${DOCS}/**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '' }),
    );
  return viewport;
}

/** Runs `step` and returns the URL of the docs page it opened in a popup. */
async function popupUrl(page: Page, step: () => Promise<void>): Promise<string> {
  const popupPromise = page.context().waitForEvent('page');
  await step();
  const popup = await popupPromise;
  return popup.url();
}

test('Help lists User Guide without a key and Help for This Tool with F1 (P6-06 S10)', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Help' }).click();
  await expect(page.getByRole('menuitem', { name: 'User Guide', exact: true })).toBeVisible();
  const help = page.getByRole('menuitem', { name: /^Help for This Tool/ });
  await expect(help).toContainText('F1');
  const url = await popupUrl(page, () => help.click());
  // The pointer is on the menu, so no tile is hovered: the guide.
  expect(url).toBe(`${DOCS}/docs/`);
});

test('Help › User Guide opens the docs guide in a popup (P6-06 S9)', async ({ page }) => {
  await open(page);
  const url = await popupUrl(page, async () => {
    await page.getByRole('button', { name: 'Help' }).click();
    await page.getByRole('menuitem', { name: 'User Guide' }).click();
  });
  expect(url).toBe(`${DOCS}/docs/`);
});

test('F1 on a hovered tool opens its docs page (P6-06 S9)', async ({ page }) => {
  await open(page);
  const url = await popupUrl(page, async () => {
    await page.getByRole('button', { name: 'Extrude' }).hover();
    await page.keyboard.press('F1');
  });
  expect(url).toBe(`${DOCS}/docs/tools/extrude/`);
});

test('F1 works while a dialog field has focus (P6-06 S10)', async ({ page }) => {
  await open(page);
  await pickTool(page, 'Extrude');
  const field = page.getByRole('region', { name: 'Extrude dialog' }).getByRole('textbox', {
    name: 'Distance',
    exact: true,
  });
  await field.focus();
  await page.getByRole('button', { name: 'Revolve' }).hover();
  await expect(field).toBeFocused();
  const url = await popupUrl(page, () => page.keyboard.press('F1'));
  expect(url).toBe(`${DOCS}/docs/tools/revolve/`);
});

test('F1 with nothing hovered opens the user guide (P6-06 S9)', async ({ page }) => {
  await open(page);
  const url = await popupUrl(page, () => page.keyboard.press('F1'));
  expect(url).toBe(`${DOCS}/docs/`);
});

test('Ctrl+K Tool Reference opens the tool index (P6-06 S9)', async ({ page }) => {
  await open(page);
  const url = await popupUrl(page, async () => {
    await page.keyboard.press('Control+k');
    const search = page
      .getByRole('dialog', { name: 'Command palette' })
      .getByRole('combobox', { name: 'Search commands' });
    await search.fill('tool ref');
    await page.keyboard.press('Enter');
  });
  expect(url).toBe(`${DOCS}/docs/tools/`);
});

test("the Extrude tile's tooltip shows F1 for more (P6-06 S9)", async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Extrude' }).hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('F1 for more');
  // The footer is plain text: no link or button inside the tooltip.
  await expect(tooltip.locator('a, button')).toHaveCount(0);
});
