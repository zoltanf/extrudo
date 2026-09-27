import { expect, type Page, test } from '@playwright/test';
import { clicker, sketchOnXY } from './helpers';

// P1-08: constraint status colours, the DOF counter, and the dialog for a
// dimension that would over-constrain the sketch.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const dof = (page: Page) =>
  page.getByRole('region', { name: 'Sketch palette' }).locator('[data-constraint-state]');
const viewport = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const labels = (page: Page) => page.locator('[data-dimension]');
const editor = (page: Page) => page.locator('[data-dimension-editor]');

test('geometry turns from blue to fully constrained as constraints and dimensions go in', async ({
  page,
}) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);
  await expect(dof(page)).toHaveText('Nothing to constrain yet');

  // A rectangle: 4 corners joined, 2 horizontal and 2 vertical sides leave 4 DOF.
  await page.keyboard.press('r');
  await click(-30, -20);
  await click(30, 20);
  await page.keyboard.press('Escape');
  await expect(dof(page)).toHaveText('4 DOF left');
  await expect(viewport(page)).toHaveAttribute('data-sketch-status', 'free=12 fixed=0 conflict=0');

  // Fixing a corner fixes the two points there; the rest can still move.
  await page
    .getByRole('group', { name: 'Constraints' })
    .getByRole('button', { name: 'Fix/Unfix', exact: true })
    .click();
  await click(-30, -20);
  await page.keyboard.press('Escape');
  await expect(dof(page)).toHaveText('2 DOF left');
  await expect(viewport(page)).toHaveAttribute('data-sketch-status', 'free=10 fixed=2 conflict=0');

  // Width, then height: fully constrained.
  await page.keyboard.press('d');
  await click(0, -20);
  await click(0, -28);
  await expect(editor(page)).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(dof(page)).toHaveText('1 DOF left');
  await click(30, 0);
  await click(38, 0);
  await page.keyboard.press('Enter');
  await expect(dof(page)).toHaveText('Fully constrained ✓');
  await expect(viewport(page)).toHaveAttribute('data-sketch-status', 'free=0 fixed=12 conflict=0');

  // Undo takes the height back off.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Z');
  await expect(dof(page)).toHaveText('1 DOF left');
});

test('a dimension that would over-constrain the sketch asks first', async ({ page }) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);
  await page.keyboard.press('l');
  await click(-20, 0);
  await click(20, 0);
  await page.keyboard.press('Escape');
  await page
    .getByRole('group', { name: 'Constraints' })
    .getByRole('button', { name: 'Fix/Unfix', exact: true })
    .click();
  await click(0, 0);
  await page.keyboard.press('Escape');
  await expect(dof(page)).toHaveText('Fully constrained ✓');

  // Cancel: nothing is added.
  await page.keyboard.press('d');
  await click(0, 0);
  await click(0, 8);
  const dialog = page.getByRole('alertdialog', { name: 'Over-constrained' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(labels(page)).toHaveCount(0);

  // Add as driven: it measures.
  await click(0, 0);
  await click(0, 8);
  await dialog.getByRole('button', { name: 'Add as driven' }).click();
  // The new dimension opens in its editor, as any new one does.
  await expect(editor(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(labels(page)).toHaveText(['(40.00)']);
  await expect(dof(page)).toHaveText('Fully constrained ✓');

  // It can't start driving either.
  await page.keyboard.press('Escape');
  await labels(page).first().dblclick();
  // A refused change leaves the box checked, and says why.
  const driven = editor(page).getByRole('checkbox', { name: 'Driven (measures only)' });
  await driven.click();
  await expect(
    page.getByText('Distance would over-constrain the sketch, so it stays driven.'),
  ).toBeVisible();
  await expect(driven).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(labels(page).first()).toHaveAttribute('data-driven', 'true');
});
