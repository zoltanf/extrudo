import { expect, type Page, test } from '@playwright/test';
import { kernelReady, openProject, saveStatus } from './helpers';

// ADR-0078: the "Preparing your design…" notice in the view, and the bodies
// the last session made listed in the browser before the kernel has computed
// them (the model cache, `projects/<id>/model-cache.json`).

test.use({ viewport: { width: 1440, height: 900 } });

const browserOf = (page: Page) => page.getByRole('complementary', { name: 'Browser' });
const progress = (page: Page) => page.locator('[data-model-progress]');

/** Waits until the project's model cache file is in OPFS (the write is fire and forget). */
async function cacheWritten(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(`(async () => {
          const root = await navigator.storage.getDirectory();
          const projects = await root.getDirectoryHandle('projects');
          for await (const [, dir] of projects.entries()) {
            try {
              await dir.getFileHandle('model-cache.json');
              return true;
            } catch {}
          }
          return false;
        })()`),
      { timeout: 15_000 },
    )
    .toBe(true);
}

test('a reopened design says it is being prepared and lists its bodies before they are drawn', async ({
  page,
}) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', /^Bracket:12:/);
  await expect(progress(page)).toHaveCount(0);
  await expect(saveStatus(page)).toContainText('Saved');
  await cacheWritten(page);

  // Slow the worker's start so the window before the kernel is ready is long enough to look at.
  await page.route('**/extrudo_occt*.wasm', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.continue();
  });
  await page.reload();

  const notice = page.locator('[data-model-progress="preparing"]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Preparing your design…');
  await expect(notice).toContainText(/Computing \d+ features/);
  await expect(notice).toHaveCSS('pointer-events', 'none');
  const pending = browserOf(page).locator('[data-body-pending]');
  await expect(pending).toHaveCount(1);
  await expect(pending).toContainText('Bracket');
  await expect(pending).toHaveAttribute('aria-busy', 'true');
  await expect(browserOf(page).locator('[data-folder-count]')).toHaveText('1');

  await kernelReady(page);
  await expect(progress(page)).toHaveCount(0);
  await expect(browserOf(page).locator('[data-body-pending]')).toHaveCount(0);
  await expect(browserOf(page).getByRole('button', { name: 'Bracket', exact: true })).toBeVisible();
});

test('with no model cache the folder says the bodies are being computed, not that there are none', async ({
  page,
}) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await cacheWritten(page);
  const id = page.url().split('#/p/')[1]?.split(/[/?]/)[0] ?? '';
  await page.evaluate(`(async () => {
    const root = await navigator.storage.getDirectory();
    const projects = await root.getDirectoryHandle('projects');
    const dir = await projects.getDirectoryHandle(${JSON.stringify(id)});
    await dir.removeEntry('model-cache.json');
  })()`);
  await page.route('**/extrudo_occt*.wasm', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.continue();
  });
  await page.reload();

  const computing = browserOf(page).locator('[data-bodies-computing]');
  await expect(computing).toBeVisible();
  await expect(computing).toContainText('Computing bodies…');
  await expect(computing).toHaveAttribute('aria-busy', 'true');
  await expect(browserOf(page).getByText('No bodies yet')).toHaveCount(0);

  await kernelReady(page);
  await expect(computing).toHaveCount(0);
  await expect(browserOf(page).getByRole('button', { name: 'Bracket', exact: true })).toBeVisible();
});

test('a new design has no bodies to list', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await expect(browserOf(page).getByText('No bodies yet')).toBeVisible();
  await expect(browserOf(page).locator('[data-body-pending]')).toHaveCount(0);
  await expect(progress(page)).toHaveCount(0);
});

test('the icon stands still under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await page.route('**/extrudo_occt*.wasm', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.continue();
  });
  await page.reload();
  await expect(page.locator('[data-model-progress="preparing"]')).toBeVisible();
  const running = await page.evaluate(
    `document.querySelector('[data-model-progress] [data-progress-icon]').getAnimations({ subtree: true }).length`,
  );
  expect(running).toBe(0);

  // With motion allowed the same icon animates.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect
    .poll(() =>
      page.evaluate(
        `document.querySelector('[data-model-progress] [data-progress-icon]')?.getAnimations({ subtree: true }).length ?? 0`,
      ),
    )
    .toBeGreaterThan(0);
});
