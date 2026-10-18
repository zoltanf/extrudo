import { expect, test } from '@playwright/test';
import { primitive } from './benchmark-helpers';
import { saveStatus } from './helpers';

test.use({ viewport: { width: 1440, height: 900 } });

// Issue #57: served over plain HTTP on a LAN address the page has no secure context, so no
// `crypto.randomUUID` and no `navigator.storage` (OPFS). Playwright can't make a non-secure
// origin on localhost, so the spec removes what such an origin lacks.
test('a design is made and kept without the secure-context APIs (#57)', async ({ page }) => {
  await page.addInitScript(() => {
    // What a plain-HTTP LAN origin lacks: no crypto.randomUUID, no navigator.storage (so no OPFS).
    delete (Crypto.prototype as { randomUUID?: unknown }).randomUUID;
    Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('./');
  expect(await page.evaluate('typeof crypto.randomUUID')).toBe('undefined');
  expect(await page.evaluate('typeof navigator.storage')).toBe('undefined');

  await page.getByRole('button', { name: 'New design' }).click();
  const viewport = page.getByRole('region', { name: 'Viewport' });
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await primitive(page, 'Box', { Length: '20 mm', Width: '20 mm', Height: '20 mm' });
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20', { timeout: 30_000 });
  await expect(saveStatus(page)).toContainText('Saved', { timeout: 20_000 });

  // The design went to the IndexedDB file store: the home screen lists it after a reload.
  await page.goto('./');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Designs' }).getByRole('listitem')).toHaveCount(1);
  expect(errors).toEqual([]);
});
