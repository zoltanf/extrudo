import { expect, type Page, test } from '@playwright/test';
import { primitive } from './benchmark-helpers';
import { kernelReady, openProject, pickTool, saveStatus } from './helpers';

// P6-26 (ADR-0140, issue #75): Insert Design, Copied. Solid › Assemble › Insert
// Design picks an .extrudo file; its bodies come in as one component named after
// the file, from one timeline feature. One undo step; it survives a reload.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const FILE = 'fixtures/benchmarks/b4-box-with-lid.extrudo';
const viewportOf = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });

/** Runs Insert Design and gives the file chooser `file`. */
async function insert(page: Page, file: string) {
  const chooser = page.waitForEvent('filechooser');
  await pickTool(page, 'Insert Design');
  await (await chooser).setFiles(file);
}

test('Insert Design brings a design in as one component, undoable and saved', async ({ page }) => {
  test.setTimeout(120_000);
  await openProject(page);
  await primitive(page, 'Box', {});
  await kernelReady(page);
  const viewport = viewportOf(page);
  await expect(viewport).not.toHaveAttribute('data-components');

  await insert(page, FILE);
  await expect(page.getByText(/is in the design as the component b4-box-with-lid/)).toBeVisible();
  await kernelReady(page);
  // The copy's bodies keep their names, in the component named after the file.
  await expect(viewport).toHaveAttribute('data-components', 'b4-box-with-lid:Box,Lid');
  await expect(chip(page, 'b4-box-with-lid')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Kernel' })).not.toHaveAttribute(
    'data-model-status',
    'error',
  );

  // One undo step takes the feature, the component and its bodies away; redo brings them back.
  await page.keyboard.press('Control+z');
  await expect(viewport).not.toHaveAttribute('data-components');
  await expect(chip(page, 'b4-box-with-lid')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(viewport).toHaveAttribute('data-components', 'b4-box-with-lid:Box,Lid');

  // A second insert of the same file is a second component, "(2)".
  await insert(page, FILE);
  await kernelReady(page);
  await expect(viewport).toHaveAttribute(
    'data-components',
    'b4-box-with-lid:Box,Lid;b4-box-with-lid_(2):Box,Lid',
  );

  // Saved and reopened, the design still has both.
  await expect(saveStatus(page)).toHaveText('Saved');
  await page.reload();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute(
    'data-components',
    'b4-box-with-lid:Box,Lid;b4-box-with-lid_(2):Box,Lid',
  );
});

test('Insert Design refuses a file that is not an Extrudo design', async ({ page }) => {
  await openProject(page);
  await insert(page, 'fixtures/imports/b3.step');
  await expect(page.getByText(/Insert Design takes an Extrudo design/)).toBeVisible();
  await expect(viewportOf(page)).not.toHaveAttribute('data-components');
});
