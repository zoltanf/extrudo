import { expect, type Page, test } from '@playwright/test';
import { openAppMenu, openProject, pickMenuItem, pickTool, selectTab } from './helpers';

// ADR-0092: Report a bug drafts a GitHub issue. The external host is answered
// locally (nothing leaves the machine). Reading the PNG back from the
// clipboard is not asserted (headless Chromium is unreliable there).

test.use({ viewport: { width: 1440, height: 900 } });

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Report a bug' });
const preview = (page: Page) => dialog(page).getByTestId('bug-report-preview');
/** The recent-actions log's read-only handle (ADR-0127). The e2e config has no DOM types. */
const recentActions = (page: Page) =>
  page.evaluate('window.__extrudoRecentActions?.() ?? []') as Promise<string[]>;

async function routeGithub(page: Page) {
  await page
    .context()
    .route('https://github.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '' }),
    );
}

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await routeGithub(page);
});

test('Menu › Report a bug drafts the issue', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (e) => errors.push(e));
  await openProject(page);
  await pickMenuItem(page, 'App', 'Report a bug');
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(d.getByRole('img', { name: 'Screenshot' })).toBeVisible();
  await expect(preview(page)).toContainText('### Extrudo version');
  await expect(preview(page)).toContainText(/\d+\.\d+\.\d+/);
  await expect(preview(page)).toContainText('Browser and version');

  await d.getByLabel('Title').fill('Crash on extrude');
  await d.getByLabel('What happened?').fill('It broke');
  await d.getByLabel('Steps to reproduce').fill('1. Extrude');
  await expect(preview(page)).toContainText('It broke');
  await expect(preview(page)).not.toContainText('Timeline:');
  await d.getByLabel('Include the timeline').check();
  await expect(preview(page)).toContainText('Timeline:');

  await d.getByRole('button', { name: 'Copy report' }).click();
  await expect(d.getByRole('button', { name: 'Copied' })).toBeVisible();
  const text = await page.evaluate('navigator.clipboard.readText()');
  expect(text).toContain('### What happened?');
  expect(text).toContain('It broke');

  const popupPromise = page.context().waitForEvent('page');
  await d.getByRole('button', { name: 'Open GitHub draft' }).click();
  const url = (await popupPromise).url();
  expect(
    url.startsWith('https://github.com/zoltanf/extrudo/issues/new?template=bug_report.yml'),
  ).toBe(true);
  expect(new URL(url).searchParams.get('what')).toBe('It broke');
  expect(new URL(url).searchParams.get('title')).toBe('Crash on extrude');

  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
  expect(errors).toEqual([]);
});

test('Include recent actions adds the log, kept across a reload on a dev build', async ({
  page,
}) => {
  // ADR-0127: off by default; the read-only handle gives the same lines.
  await openProject(page);
  await pickMenuItem(page, 'App', 'Report a bug');
  const d = dialog(page);
  const box = d.getByLabel('Include recent actions');
  await expect(box).not.toBeChecked();
  await expect(preview(page)).not.toContainText('Recent actions');
  await box.check();
  await expect(preview(page)).toContainText('Recent actions (oldest first');
  await expect(preview(page)).toContainText('app: App started');
  await expect(preview(page)).toContainText('app: Design opened');
  const lines = await recentActions(page);
  expect(lines.some((line) => line.includes('app: Design opened'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();

  // A dev (and edge) build keeps the log in browser storage: the reload adds a second start.
  await page.evaluate("window.dispatchEvent(new Event('pagehide'))");
  await page.reload();
  await expect
    .poll(async () =>
      (await recentActions(page)).filter((line) => line.includes('app: App started')),
    )
    .toHaveLength(2);
});

test('Remove drops the screenshot and Take screenshot brings it back', async ({ page }) => {
  await openProject(page);
  await pickMenuItem(page, 'App', 'Report a bug');
  const d = dialog(page);
  await expect(d.getByRole('img', { name: 'Screenshot' })).toBeVisible();
  await d.getByRole('button', { name: 'Remove' }).click();
  await expect(d.getByText('No screenshot')).toBeVisible();
  await expect(d.getByRole('img', { name: 'Screenshot' })).toHaveCount(0);
  await d.getByRole('button', { name: 'Take screenshot' }).click();
  await expect(d.getByRole('img', { name: 'Screenshot' })).toBeVisible();
});

test('in the drawing the screenshot is the sheet, not the hidden 3D view (P6-24)', async ({
  page,
}) => {
  await openProject(page);
  await selectTab(page, 'Make');
  await pickTool(page, 'Drawing');
  await page
    .getByRole('dialog', { name: 'New drawing' })
    .getByRole('button', { name: 'Create Drawing' })
    .click();
  await expect(page.getByRole('region', { name: 'Sheet', exact: true })).toBeVisible();
  await pickMenuItem(page, 'App', 'Report a bug');
  const shot = dialog(page).getByRole('img', { name: 'Screenshot' });
  await expect(shot).toBeVisible();
  // A3 landscape's shape, its longer side 1600 px.
  await expect
    .poll(() =>
      shot.evaluate((img: unknown) => {
        const { naturalWidth, naturalHeight } = img as {
          naturalWidth: number;
          naturalHeight: number;
        };
        return `${naturalWidth}x${naturalHeight}`;
      }),
    )
    .toBe('1600x1131');
});

test("About's footer opens the dialog", async ({ page }) => {
  await openProject(page);
  await pickMenuItem(page, 'App', 'About Extrudo');
  const about = page.getByRole('dialog', { name: /about/ });
  await about.getByRole('button', { name: 'Report a bug' }).click();
  await expect(about).toBeHidden();
  await expect(dialog(page)).toBeVisible();
});

test('the home screen has it, without a screenshot or a timeline', async ({ page }) => {
  await page.goto('./');
  await openAppMenu(page);
  await pickMenuItem(page, 'App', 'Report a bug');
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(d.getByText('No screenshot')).toBeVisible();
  await expect(d.getByLabel('Include the timeline')).toHaveCount(0);
  await expect(d.getByLabel('Include recent actions')).not.toBeChecked();
});
