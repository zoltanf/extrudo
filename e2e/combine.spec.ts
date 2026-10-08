import { expect, type Locator, type Page, test } from '@playwright/test';
import { selectBodies } from './benchmark-helpers';
import { kernelReady, openProject, pickTool } from './helpers';

// P3-06: Combine (ADR-0044, FR-FT-09). A target body and tool bodies, join,
// cut or intersect, with "keep tools"; bodies selected in the browser before
// the tool fill the target (the first) and the tools (the rest); the preview
// draws the tools in the operation's style; a combine that does nothing says
// why; one undo step.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const viewportOf = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });

/** A 20 mm cube on XY centred at (x, 0): x ± 10, y ±10, z 0…20. */
async function cube(page: Page, x: number) {
  await pickTool(page, 'Box');
  const dialog = page.getByRole('region', { name: 'Box dialog' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'X', exact: true }).fill(`${x} mm`);
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
}

async function openCombine(page: Page, bodies: string[]): Promise<Locator> {
  await selectBodies(page, bodies);
  await pickTool(page, 'Combine');
  const dialog = page.getByRole('region', { name: 'Combine dialog' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('cuts one cube with another, keeping the tool; one undo step', async ({ page }) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page, 0);
  await cube(page, 15);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20 Body2:6:20,20,20');

  const dialog = await openCombine(page, ['Body1', 'Body2']);
  // The first selected body is the target, the rest are the tools.
  await expect(dialog.getByRole('button', { name: 'Target', exact: true })).toHaveText('Body1');
  await expect(dialog.getByRole('button', { name: 'Tools', exact: true })).toHaveText('Body2');
  await expect(dialog.getByRole('combobox', { name: 'Operation' })).toHaveValue('join');
  await dialog.getByRole('combobox', { name: 'Operation' }).selectOption('cut');
  await dialog.getByRole('checkbox', { name: 'Keep tools' }).check();
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  // The tool is drawn as a cut.
  await expect(viewport).toHaveAttribute('data-preview', 'cut');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);

  // Body1 lost the 5 mm the tool overlaps (x 5…10); Body2 is kept.
  await expect(chip(page, 'Combine1')).toHaveAccessibleName('Combine1');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:15,20,20 Body2:6:20,20,20');

  await page.keyboard.press('Control+z');
  await kernelReady(page);
  await expect(chip(page, 'Combine1')).toHaveCount(0);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20 Body2:6:20,20,20');
});

test('joins two cubes into one body, and intersects them', async ({ page }) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page, 0);
  await cube(page, 15);

  // Join: the tool is used up, the flush sides merge, six faces again.
  let dialog = await openCombine(page, ['Body1', 'Body2']);
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:35,20,20');
  await expect(
    page.getByRole('complementary', { name: 'Browser' }).locator('[data-folder-count]'),
  ).toHaveText('1');

  // Undo, then intersect: only the 5 mm both cubes share is left.
  await page.keyboard.press('Control+z');
  await kernelReady(page);
  dialog = await openCombine(page, ['Body1', 'Body2']);
  await dialog.getByRole('combobox', { name: 'Operation' }).selectOption('intersect');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:5,20,20');
});

test('a combine that cannot work says why and keeps OK off', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await cube(page, 0);
  await cube(page, 100);

  const dialog = await openCombine(page, ['Body1', 'Body2']);
  // The cubes are 80 mm apart: nothing to join.
  await expect(dialog).toHaveAttribute('data-preview-status', 'error', { timeout: 15_000 });
  await expect(dialog.getByRole('status', { name: 'Feature status' })).toContainText(
    /doesn't touch the target/,
  );
  await expect(dialog.getByRole('button', { name: 'OK' })).toBeDisabled();
  // Cutting them says the same in other words.
  await dialog.getByRole('combobox', { name: 'Operation' }).selectOption('cut');
  await expect(dialog.getByRole('status', { name: 'Feature status' })).toContainText(
    /removes nothing/,
    { timeout: 15_000 },
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(chip(page, 'Combine1')).toHaveCount(0);
});
