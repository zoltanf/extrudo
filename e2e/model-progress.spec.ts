import { readFileSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { applyCommand, renameFeature, updateFeatureInputs } from '../packages/core/src/index';
import { readArchive, writeArchive } from '../packages/storage/src/archive';
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

test('while a design opens, the notice names the running feature and counts its seconds', async ({
  page,
}, info) => {
  // ADR-0105's amendment of 2026-11-19. The PCB enclosure benchmark with its post pattern
  // raised to 12 × 12 keeps one kernel call busy: 13.9 s in Node on the Ubuntu machine,
  // longer in a browser and on a busy machine, so the count (from 3 s on) always shows. The
  // pattern gets a 60-character name, which the notice cuts short. The test never waits for
  // the model: closing the page ends the worker.
  let doc = readArchive(readFileSync('fixtures/benchmarks/b5-pcb-enclosure.extrudo')).doc;
  const pattern = doc.features.find((f) => f.name === 'Rectangular Pattern1');
  if (!pattern) throw new Error('the benchmark has no Rectangular Pattern1');
  // Only the expression changes: the input keeps its parameter name and unit.
  const expr = (key: string, value: string) => {
    const input = pattern.inputs[key];
    if (input?.kind !== 'expr') throw new Error(`the pattern has no ${key} expression`);
    return { ...input, expr: value };
  };
  doc = applyCommand(
    doc,
    updateFeatureInputs({
      id: pattern.id,
      inputs: {
        count1: expr('count1', '12'),
        distance1: expr('distance1', '2 * px / 11'),
        count2: expr('count2', '12'),
        distance2: expr('distance2', '2 * py / 11'),
      },
    }),
  ).doc;
  const name = 'Posts for the circuit board, twelve by twelve, all the same.';
  expect(name).toHaveLength(60);
  doc = applyCommand(doc, renameFeature({ id: pattern.id, name })).doc;
  const position = `${doc.features.findIndex((f) => f.id === pattern.id) + 1} of ${doc.features.length}`;
  const file = info.outputPath('many-posts.extrudo');
  writeFileSync(file, writeArchive({ ...doc, name: 'Many posts' }));

  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…', exact: true }).click(),
  ]);
  await chooser.setFiles(file);

  const notice = page.locator('[data-model-progress="preparing"]');
  await expect(notice).toBeVisible();
  const feature = notice.locator('[data-progress-feature]');
  await expect(feature).toHaveText(name, { timeout: 60_000 });
  await expect(notice.locator('[data-progress-line]')).toContainText(` · ${position}`);
  await expect(notice.getByRole('progressbar', { name: 'Features computed' })).toBeVisible();
  // The seconds come once the pattern has run 3 s, and stay out of the live region.
  const seconds = notice.locator('[data-feature-seconds]');
  await expect(seconds).toHaveText(/^ · \d+ s$/, { timeout: 60_000 });
  await expect(seconds).toHaveAttribute('aria-hidden', 'true');
  await expect(notice).toHaveAttribute('aria-live', 'polite');
  const spoken = await notice.ariaSnapshot();
  expect(spoken).toContain(position);
  expect(spoken).not.toMatch(/\d+ s\b/);
  // The long name is cut short with an ellipsis; the count and the seconds still show.
  await expect(feature).toHaveCSS('text-overflow', 'ellipsis');
  // A string, since e2e/ typechecks without the DOM library.
  expect(
    await page.evaluate(
      `(() => { const el = document.querySelector('[data-progress-feature]'); return el.scrollWidth > el.clientWidth; })()`,
    ),
  ).toBe(true);
  const line = await notice.locator('[data-progress-line]').boundingBox();
  const shown = await seconds.boundingBox();
  expect(line && shown && shown.x + shown.width <= line.x + line.width + 1).toBe(true);
  expect((await notice.boundingBox())?.width ?? 0).toBeLessThan(420);
  await expect(notice).toHaveCSS('pointer-events', 'none');
});
