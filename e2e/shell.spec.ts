import { expect, type Page, test } from '@playwright/test';

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
  await page.goto('./');
  // The viewport is lazy: wait until its first frame is drawn.
  await expect(page.getByRole('region', { name: 'Viewport' })).toHaveAttribute(
    'data-ready',
    'true',
  );
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

test('dark is the default, and the theme choice survives a reload', async ({ page }) => {
  await open(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Theme' }).click();
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

test('the browser and the timeline collapse and expand, and remember it', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Hide browser' }).click();
  const browser = page.getByRole('complementary', { name: 'Browser' });
  expect(Math.round((await browser.boundingBox())?.width ?? 0)).toBe(40);
  await expect(page.getByRole('separator', { name: 'Resize browser' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Hide timeline' }).click();
  await expect(page.getByRole('list', { name: 'Features' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Show browser' })).toBeVisible();
  await page.getByRole('button', { name: 'Show browser' }).click();
  expect(Math.round((await browser.boundingBox())?.width ?? 0)).toBe(248);
  await page.getByRole('button', { name: 'Show timeline' }).click();
  await expect(page.getByRole('list', { name: 'Features' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Extrude', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toContainText('Arrives with P2-06.');
  await expect(page.getByRole('button', { name: 'Extrude', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});
