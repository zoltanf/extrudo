import { expect, type Page, test } from '@playwright/test';
import { kernelReady, openProject, saveStatus } from './helpers';

// P0-04: the app shell. Screenshots in both themes, and panels that resize,
// collapse and remember their state.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function open(page: Page, theme?: 'dark' | 'light') {
  if (theme) {
    await page.addInitScript(
      (t) => localStorage.setItem('extrudo.theme', JSON.stringify(t)),
      theme,
    );
  }
  await openProject(page, 'wall-bracket');
  await expect(saveStatus(page)).toHaveText('Saved');
  await kernelReady(page);
  // A string, since e2e/ typechecks without the DOM library.
  await page.evaluate('document.fonts.ready.then(() => true)');
}

for (const theme of ['dark', 'light'] as const) {
  test(`looks right in the ${theme} theme`, async ({ page }) => {
    await open(page, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page).toHaveScreenshot(`shell-${theme}.png`, {
      animations: 'disabled',
      caret: 'hide',
    });
  });
}

test('the theme follows the (dark) system by default, and the theme choice survives a reload', async ({
  page,
}) => {
  await open(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('the browser panel resizes with the keyboard and the mouse', async ({ page }) => {
  await open(page);
  const browser = page.getByRole('complementary', { name: 'Browser' });
  const splitter = page.getByRole('separator', { name: 'Resize browser' });
  const width = async () => Math.round((await browser.boundingBox())?.width ?? 0);
  expect(await width()).toBe(248);

  await splitter.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await width()).toBe(280);
  await expect(splitter).toHaveAttribute('aria-valuenow', '280');
  await page.keyboard.press('Home');
  expect(await width()).toBe(180);
  await page.keyboard.press('End');
  expect(await width()).toBe(480);

  const box = await splitter.boundingBox();
  if (!box) throw new Error('no splitter');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 150, y, { steps: 5 });
  await page.mouse.up();
  expect(await width()).toBe(330);

  // The size is kept.
  await page.reload();
  expect(await width()).toBe(330);
});

test('the browser collapses and expands, and remembers it; the timeline is always shown', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Hide browser' }).click();
  const browser = page.getByRole('complementary', { name: 'Browser' });
  // The panel slides away completely; a small tab at the view's edge brings it back.
  await expect(browser).toBeHidden();
  await expect(page.getByRole('separator', { name: 'Resize browser' })).toHaveCount(0);
  const tab = page.getByRole('button', { name: 'Show browser' });
  await expect(tab).toBeVisible();
  expect(Math.round((await tab.boundingBox())?.width ?? 0)).toBeLessThanOrEqual(32);
  await expect(page.getByRole('button', { name: 'Hide browser' })).toBeHidden();

  // The timeline has no toggle: the bottom row always shows it and the status bar.
  await expect(page.getByRole('button', { name: /^(Hide|Show) timeline$/i })).toHaveCount(0);
  await expect(page.getByRole('slider', { name: 'Timeline marker' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Show browser' })).toBeVisible();
  await page.getByRole('button', { name: 'Show browser' }).click();
  await expect.poll(async () => Math.round((await browser.boundingBox())?.width ?? 0)).toBe(248);
  await expect(page.getByRole('button', { name: 'Show browser' })).toBeHidden();
  await expect(page.getByRole('button', { name: /^(Hide|Show) timeline$/i })).toHaveCount(0);
  await expect(page.getByRole('slider', { name: 'Timeline marker' })).toBeVisible();
});

test('the timeline marker moves with playback, and Ctrl+Z undoes it', async ({ page }) => {
  await open(page);
  const rolledBack = page.getByRole('button', { name: /\(rolled back\)$/ });
  await expect(rolledBack).toHaveCount(1);

  await page.getByRole('button', { name: 'Roll forward to end' }).click();
  await expect(rolledBack).toHaveCount(0);
  await page.getByRole('button', { name: 'Roll back to start' }).click();
  await expect(rolledBack).toHaveCount(6);

  await page.keyboard.press('Control+z');
  await expect(rolledBack).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(rolledBack).toHaveCount(1);
  await page.keyboard.press('Control+y');
  await expect(rolledBack).toHaveCount(0);
});

test('tools that are not built yet say when they arrive', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: '3D Print' }).click();
  await page.getByRole('button', { name: 'Send to Slicer', exact: true }).hover();
  // The web build has no slicer to launch: the tooltip says what to do instead (ADR-0062).
  await expect(page.getByRole('tooltip')).toContainText(
    'Sending to a slicer needs the desktop app. In the browser, export a 3MF and open it in your slicer.',
  );
  await expect(page.getByRole('button', { name: 'Send to Slicer', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});
