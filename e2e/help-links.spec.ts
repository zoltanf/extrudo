import { expect, type Page, test } from '@playwright/test';
import { openProject } from './helpers';

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
