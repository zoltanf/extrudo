import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { openProject, pickMenuItem } from './helpers';

// ADR-0133: the first start of a newer version says "Updated to Extrudo X.Y.Z." with a
// What's new button, once; a first install says nothing. The preview build is `dev`, which
// announces like stable (only edge stays quiet). The notes are the package version's
// `docs/release-highlights/` file and CHANGELOG section.

const VERSION = (
  JSON.parse(readFileSync(new URL('../apps/web/package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;
const KEY = 'extrudo.whatsNew.lastVersion';
const dialog = (page: Page) =>
  page.getByRole('dialog', { name: `What's new in Extrudo ${VERSION}` });
const toast = (page: Page) => page.getByText(`Updated to Extrudo ${VERSION}.`);

/** An older version ran before; only the first load of the test sets it. */
async function updatedFrom(page: Page, version: string) {
  await page.addInitScript(
    ([key, value]) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    },
    [KEY, JSON.stringify(version)] as const,
  );
}

test("an update says so once, and What's new shows its notes", async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (e) => errors.push(e));
  await updatedFrom(page, '0.0.1');
  await page.goto('./');
  await expect(toast(page)).toBeVisible();
  await page.getByRole('button', { name: "What's new" }).click();

  const notes = dialog(page);
  await expect(notes).toBeVisible();
  const highlights = await notes.getByRole('listitem').count();
  expect(highlights).toBeGreaterThan(0);
  const full = notes.getByRole('button', { name: /^Full changelog \(\d+ changes\)$/ });
  await expect(full).toHaveAttribute('aria-expanded', 'false');
  await full.click();
  await expect(full).toHaveAttribute('aria-expanded', 'true');
  expect(await notes.getByRole('listitem').count()).toBeGreaterThan(highlights);
  await notes.getByRole('button', { name: 'Got it' }).click();
  await expect(notes).toBeHidden();

  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(
    JSON.stringify(VERSION),
  );
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Extrudo' })).toBeVisible();
  // The home screen has settled (its designs listed) before the check that nothing came.
  await page.waitForTimeout(1000);
  await expect(toast(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a first install says nothing and records the version', async ({ page }) => {
  await page.goto('./');
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), KEY))
    .toBe(JSON.stringify(VERSION));
  await expect(toast(page)).toHaveCount(0);
});

test("About › What's new opens the notes in the app", async ({ page }) => {
  await openProject(page);
  await pickMenuItem(page, 'App', 'About Extrudo');
  await page
    .getByRole('dialog', { name: /about/ })
    .getByRole('button', { name: "What's new" })
    .click();
  await expect(page.getByRole('dialog', { name: /about/ })).toBeHidden();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('listitem').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
});
