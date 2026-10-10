import { expect, type Locator, type Page, test } from '@playwright/test';
import { chip, clickWhere, turnView } from './benchmark-helpers';
import { kernelReady } from './helpers';

// P6-05 J1 (ADR-0081 §4): joints between components. The hinge fixture
// (`fixtures/components/hinge.extrudo`, written by the kernel's
// `joints/hinge-fixture.test.ts`) has components Base (a plate, two knuckles and
// a Ø6 pin along X at y = 0, z = 2) and Leaf (a plate and a middle knuckle round
// the pin), and the revolute joint Hinge from the leaf's hole wall to the pin's.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const browserOf = (page: Page) => page.getByRole('complementary', { name: 'Browser' });
const viewportOf = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const componentLeaf = (page: Page, name: string) =>
  browserOf(page)
    .locator('[data-component]')
    .filter({ has: page.getByRole('button', { name, exact: true }) });
const menuItem = (page: Page, name: string) =>
  page.getByRole('menuitem', { name: new RegExp(`^${name}`) });
const blur = (page: Page) =>
  page.evaluate(
    'document.activeElement && document.activeElement.blur && document.activeElement.blur()',
  );

/** A point on the leaf's knuckle (Ø10, coaxial with the pin) facing the home view. */
const LEAF_KNUCKLE = [0, -3, 6] as const;
/** The same on the base's second knuckle (x 7…20). */
const BASE_KNUCKLE = [13.5, -3, 6] as const;

async function openHinge(page: Page) {
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import .extrudo' }).click(),
  ]);
  await chooser.setFiles('fixtures/components/hinge.extrudo');
  await expect(page).toHaveURL(/#\/p\/[^/]+$/);
  await kernelReady(page);
}

async function pickFrames(page: Page, dialog: Locator) {
  const at = await turnView(page, 'Shift+1');
  await clickWhere(page, at, LEAF_KNUCKLE, /^face:/);
  await expect(dialog.getByRole('button', { name: 'Moving part', exact: true })).toHaveText(
    /· Leaf$/,
  );
  await clickWhere(page, at, BASE_KNUCKLE, /^face:/);
  await expect(dialog.getByRole('button', { name: 'Fixed part', exact: true })).toHaveText(
    /· Base$/,
  );
}

test('a joint is made, renamed, undone, and its lost frame fixed', async ({ page }) => {
  test.setTimeout(120_000);
  await openHinge(page);
  const viewport = viewportOf(page);
  await expect(viewport).toHaveAttribute('data-joints', /^Hinge:revolute:ok:[^:]+:1,0,0$/);
  const leaf = componentLeaf(page, 'Leaf');
  const hinge = leaf.locator('[data-joint]');
  await expect(hinge).toHaveCount(1);
  await expect(hinge).toHaveAttribute('data-joint-status', 'ok');
  await expect(hinge).toHaveAttribute('data-joint-type', 'revolute');

  // J opens the dialog; the two knuckles' walls are one axis.
  await page.keyboard.press('j');
  const dialog = page.getByRole('region', { name: 'Joint dialog' });
  await expect(dialog).toBeVisible();
  await pickFrames(page, dialog);
  await dialog.getByRole('combobox', { name: 'Type' }).selectOption('revolute');
  await dialog.getByRole('textbox', { name: 'Maximum angle' }).fill('90 deg');
  await expect(dialog.locator('[data-info="joint"]')).toHaveText("Turns Leaf about Base's axis.");
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
  await dialog.getByRole('button', { name: /^OK/ }).click();
  await expect(dialog).toBeHidden();
  await expect(leaf.locator('[data-joint]')).toHaveCount(2);
  await expect(viewport).toHaveAttribute(
    'data-joints',
    /^Hinge:revolute:ok:[^;]+;Joint1:revolute:ok:[^:]+:-?1,0,0$/,
  );

  // F2 renames it; Ctrl+Z takes the rename and then the joint away.
  await leaf.getByRole('button', { name: 'Joint1', exact: true }).focus();
  await page.keyboard.press('F2');
  const field = browserOf(page).getByRole('textbox', { name: 'Rename Joint1' });
  await field.fill('Lid hinge');
  await field.press('Enter');
  await expect(viewport).toHaveAttribute('data-joints', /;Lid_hinge:revolute:ok:/);
  await blur(page);
  await page.keyboard.press('Control+z');
  await expect(viewport).toHaveAttribute('data-joints', /;Joint1:revolute:ok:/);
  await page.keyboard.press('Control+z');
  await expect(leaf.locator('[data-joint]')).toHaveCount(1);

  // Deleting the pin loses Hinge's fixed frame: the kernel guesses the closest
  // cylinder, which is on Leaf, so the row warns (or errs, without a match).
  await chip(page, 'Pin').click({ button: 'right' });
  await menuItem(page, 'Delete').click();
  await expect(hinge).toHaveAttribute('data-joint-status', /^(warning|error)$/);
  await hinge.click({ button: 'right' });
  await menuItem(page, 'Fix References').click();
  const fix = page.getByRole('region', { name: 'Edit Hinge dialog' });
  await expect(fix).toBeVisible();
  await expect(fix.getByRole('note', { name: 'Fix references' })).toBeVisible();
  const at = await turnView(page, 'Shift+1');
  await clickWhere(page, at, BASE_KNUCKLE, /^face:/);
  await expect(fix.locator('[data-info="joint"]')).toHaveText("Turns Leaf about Base's axis.");
  await fix.getByRole('button', { name: /^OK/ }).click();
  await expect(hinge).toHaveAttribute('data-joint-status', 'ok');

  // Two undos: the fix, then the deletion; the pin's wall is the frame again.
  await blur(page);
  await page.keyboard.press('Control+z');
  await expect(hinge).toHaveAttribute('data-joint-status', /^(warning|error)$/);
  await page.keyboard.press('Control+z');
  await expect(hinge).toHaveAttribute('data-joint-status', 'ok');
  await expect(chip(page, 'Pin')).toBeVisible();
});
