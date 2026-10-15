import { expect, type Page, test } from '@playwright/test';
import { openProject } from './helpers';

// ADR-0085: Help › About Extrudo shows the build's version, where the app
// runs and the engines; its links open through `Platform.openLink`. The
// external host is answered locally (nothing leaves the machine).

test.use({ viewport: { width: 1440, height: 900 } });

const dialog = (page: Page) => page.getByRole('dialog', { name: /about/ });

async function routeGithub(page: Page) {
  await page
    .context()
    .route('https://github.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '' }),
    );
}

test('Help › About Extrudo shows the build, links and closes with Esc', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (e) => errors.push(e));
  await openProject(page);
  await routeGithub(page);
  await page.getByRole('button', { name: 'Help' }).click();
  await page.getByRole('menuitem', { name: 'About Extrudo' }).click();
  const about = dialog(page);
  await expect(about).toBeVisible();
  await expect(about.getByText(/^\d+\.\d+\.\d+/).first()).toBeVisible();
  await expect(about.getByText('Running on')).toBeVisible();
  await expect(about.getByText('App', { exact: true })).toBeVisible();
  await expect(about.getByText('Browser', { exact: true })).toBeVisible();
  await expect(
    about.getByText(/^WebGL \d.*(hardware accelerated|software rendering)/),
  ).toBeVisible();
  await expect(about.getByText('Engines')).toBeVisible();
  await expect(about.getByRole('button', { name: /Copy details/ })).toBeEnabled();

  await about.getByRole('button', { name: 'Extrudo logo' }).click();
  await expect(about).toBeVisible();

  const popupPromise = page.context().waitForEvent('page');
  await about.getByRole('link', { name: 'GitHub' }).click();
  expect((await popupPromise).url()).toBe('https://github.com/zoltanf/extrudo');

  await page.keyboard.press('Escape');
  await expect(about).toBeHidden();
  expect(errors).toEqual([]);
});

test('the home bar has About Extrudo too', async ({ page }) => {
  await page.goto('./');
  await page
    .getByRole('navigation', { name: 'Extrudo' })
    .getByRole('button', { name: 'About' })
    .click();
  await expect(dialog(page)).toBeVisible();
});
