import { expect, type Page, test } from '@playwright/test';
import { openAppMenu, openProject, pickMenuItem, pickTool } from './helpers';

// P6-06 S9, ADR-0090: the app menu's Learn items and a tool tile's F1 open the landing
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

test('Learn: Help for <tool> with F1 after a tile was hovered, absent before (ADR-0090)', async ({
  page,
}) => {
  await open(page);
  let learn = (await openAppMenu(page)).getByRole('menu', { name: 'Learn' });
  // A fresh page: no tile hovered yet, so the column starts with User Guide.
  await expect(learn.getByRole('menuitem')).toHaveText([
    'User Guide',
    'Tutorial',
    'Online Tutorials',
    'Examples',
    'Tool Reference',
  ]);
  await expect(learn.getByRole('menuitem', { name: /^Help for/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Extrude' }).hover();
  learn = (await openAppMenu(page)).getByRole('menu', { name: 'Learn' });
  const help = learn.getByRole('menuitem').first();
  await expect(help).toHaveText(/^Help for ExtrudeF1$/);
  const url = await popupUrl(page, () => help.click());
  expect(url).toBe(`${DOCS}/docs/tools/extrude/`);
});

test('Menu › User Guide opens the docs guide in a popup (P6-06 S9)', async ({ page }) => {
  await open(page);
  const url = await popupUrl(page, async () => {
    await pickMenuItem(page, 'Learn', 'User Guide');
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

test('F1 before any tile was hovered opens the user guide (P6-06 S9, ADR-0090)', async ({
  page,
}) => {
  await open(page);
  const url = await popupUrl(page, () => page.keyboard.press('F1'));
  expect(url).toBe(`${DOCS}/docs/`);
});

test('Ctrl+K Tool Reference opens the tool index (P6-06 S9)', async ({ page }) => {
  await open(page);
  const url = await popupUrl(page, async () => {
    await page.keyboard.press('Control+k');
    const search = page
      .getByRole('dialog', { name: 'Search', exact: true })
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

test("the Menu strip's GitHub opens the repository in a popup", async ({ page }) => {
  await open(page);
  await page
    .context()
    .route('https://github.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '' }),
    );
  const url = await popupUrl(page, async () => {
    const panel = await openAppMenu(page);
    await panel.locator('[data-update-strip]').getByRole('button', { name: 'GitHub' }).click();
  });
  expect(url).toBe('https://github.com/zoltanf/extrudo');
});

test("the home bar's Docs and GitHub open in popups", async ({ page }) => {
  for (const host of [`${DOCS}/**`, 'https://github.com/**']) {
    await page
      .context()
      .route(host, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '' }));
  }
  await page.goto('./');
  const nav = page.getByRole('navigation', { name: 'Extrudo' });
  for (const [name, expected] of [
    ['Docs', `${DOCS}/docs/`],
    ['GitHub', 'https://github.com/zoltanf/extrudo'],
  ] as const) {
    const url = await popupUrl(page, () => nav.getByRole('link', { name }).click());
    expect(url).toBe(expected);
  }
  // The home screen stays where it was.
  await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
});

test('the App column holds About Extrudo; the strip shows the version and GitHub', async ({
  page,
}) => {
  await open(page);
  const panel = await openAppMenu(page);
  const app = panel.getByRole('menu', { name: 'App' }).getByRole('menuitem');
  await expect(app).toHaveText([
    /^Search…/,
    /^Settings…/,
    'Report a bug',
    'About Extrudo',
    'Close design',
  ]);
  const strip = panel.locator('[data-update-strip]');
  await expect(strip).toContainText(/\d+\.\d+\.\d+/);
  // The web build has no Check now: its worker checks by itself.
  await expect(strip.getByRole('button')).toHaveText(['GitHub']);
});
