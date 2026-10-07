import { expect, test } from '@playwright/test';

// ADR-0076: a Chromium started with no GL at all (`--disable-gpu
// --disable-software-rasterizer`) must show the message, not a white page.
// A launch option forces a worker of its own, so this has its own file.
test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
    args: ['--disable-gpu', '--disable-software-rasterizer'],
    ignoreDefaultArgs: ['--enable-unsafe-swiftshader'],
  },
});

test('a browser with no GL shows the message, not a white page', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'New design' }).click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  const none = page.getByRole('region', { name: '3D view unavailable' });
  await expect(none).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('status', { name: 'Status', exact: true })).toBeVisible();
  // Headless Chrome on Linux: a Chromium command with the flag and this origin.
  const command = page.locator('[data-swiftshader-command]');
  await expect(command).toContainText('--enable-unsafe-swiftshader');
  await expect(command).toContainText(new URL(page.url()).origin);
});
