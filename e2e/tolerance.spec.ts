import { expect, type Page, test } from '@playwright/test';
import { closeParameters, openParameters, solidTab } from './benchmark-helpers';
import { kernelReady, openProject, pickTool, projector } from './helpers';

// P4-08: the print tolerance (ADR-0062, FR-3DP-05). One document parameter
// named `tolerance`, set from the 3D Print tab's Tolerance panel (one undo step
// per change), which hole presets add to every diameter they write:
// "3.4 mm + 2 * tolerance". Without the parameter the presets write the
// published ISO sizes, as before (P3-04, ADR-0049).

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const viewport = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const panel = (page: Page) => page.getByRole('region', { name: 'Print tolerance' });
const field = (page: Page) => panel(page).getByRole('textbox', { name: 'Print tolerance' });
const usage = (page: Page) => panel(page).locator('[data-tolerance-usage]');
const holeDialog = (page: Page) => page.getByRole('region', { name: 'Hole dialog' });

/** The 3D Print tab's Tolerance tile, which opens the panel. */
async function openTolerance(page: Page) {
  await page
    .getByRole('tablist', { name: 'Toolbar tabs' })
    .getByRole('tab', { name: '3D Print' })
    .click();
  await page.getByRole('button', { name: 'Tolerance', exact: true }).click();
  await expect(panel(page)).toBeVisible();
}

/** The Parameters dialog: on the Solid tab's Modify group, like every parameter change. */
async function parameters(page: Page) {
  await solidTab(page);
  await openParameters(page);
}

/** A 40 mm cube from the Box tool (x, y ±20, z 0…40). */
async function cube(page: Page) {
  await pickTool(page, 'Box');
  const box = page.getByRole('region', { name: 'Box dialog' });
  for (const name of ['Length', 'Width', 'Height']) {
    await box.getByRole('textbox', { name, exact: true }).fill('40 mm');
  }
  await expect(box).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await box.getByRole('button', { name: 'OK' }).click();
  await expect(box).toBeHidden();
  await kernelReady(page);
}

/** A settled world → page mapping for the home view, as `e2e/hole.spec.ts` does it. */
async function homeView(page: Page) {
  await page.keyboard.press('Shift+1');
  let last = '';
  await expect
    .poll(async () => {
      const now = await viewport(page).getAttribute('data-camera-size');
      const still = now === last;
      last = now ?? '';
      return still;
    })
    .toBe(true);
  return projector(viewport(page));
}

/** The Hole tool on the cube's top face at world (x, y, 40). */
async function startHoleOnCube(page: Page, x: number, y: number) {
  const at = await homeView(page);
  await page.keyboard.press('h');
  const dialog = holeDialog(page);
  await expect(dialog).toBeVisible();
  // It opens on the XY plane at the origin; the click moves it onto the face.
  await expect(dialog.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
  const point = at([x, y, 40]);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(150);
  await page.mouse.click(point.x, point.y);
  await expect(dialog.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
  return dialog;
}

test('the panel creates the tolerance parameter, one undo step per change', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await openTolerance(page);
  // Nothing yet: the field says so, and no button is pressed.
  await expect(panel(page)).toHaveAttribute('data-tolerance', 'unset');
  await expect(field(page)).toHaveValue('');
  await expect(usage(page)).toHaveText('Not used yet');
  await expect(panel(page).getByRole('button', { name: 'Normal 0.2 mm' })).not.toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await panel(page).getByRole('button', { name: 'Normal 0.2 mm' }).click();
  await expect(panel(page)).toHaveAttribute('data-tolerance', 'set');
  await expect(panel(page).getByRole('button', { name: 'Normal 0.2 mm' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // It is an ordinary parameter: the Parameters dialog lists it with its value.
  await parameters(page);
  const expression = page.getByRole('textbox', { name: 'Expression of tolerance', exact: true });
  await expect(expression).toHaveValue('0.2 mm');
  // Its value shows under the field, like every parameter's.
  await expect(
    page.getByRole('dialog', { name: 'Parameters' }).getByText('= 0.20 mm'),
  ).toBeVisible();
  await closeParameters(page);

  // A typed value edits the same parameter.
  await field(page).fill('0.35 mm');
  await field(page).press('Enter');
  await expect(field(page)).toHaveValue('0.35 mm');

  // One undo step per change: the edit, then the parameter itself.
  await page.keyboard.press('Control+z');
  await expect(field(page)).toHaveValue('0.2 mm');
  await page.keyboard.press('Control+z');
  await expect(panel(page)).toHaveAttribute('data-tolerance', 'unset');
  await parameters(page);
  await expect(page.getByRole('textbox', { name: 'Expression of tolerance' })).toHaveCount(0);
  await closeParameters(page);
});

test('a hole preset adds the tolerance to every diameter it writes', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  // The box first (the Create menu is on the Solid tab), then the tolerance, then the hole.
  await cube(page);
  await openTolerance(page);
  await panel(page).getByRole('button', { name: 'Tight 0.1 mm' }).click();
  await expect(panel(page)).toHaveAttribute('data-tolerance', 'set');
  // The tile toggles its panel, so close it before the hole's dialog covers it.
  await panel(page).getByRole('button', { name: /^Done/ }).click();
  await expect(panel(page)).toHaveCount(0);

  const dialog = await startHoleOnCube(page, 10, -10);
  await dialog.getByRole('combobox', { name: 'Preset' }).selectOption({ label: 'M3 clearance' });
  await expect(dialog.getByRole('textbox', { name: 'Diameter', exact: true })).toHaveValue(
    '3.4 mm + 2 * tolerance',
  );
  await dialog.getByRole('combobox', { name: 'Type' }).selectOption('counterbore');
  // The counterbore's diameter carries it; its depth is the published one.
  await expect(dialog.getByRole('textbox', { name: 'Counterbore diameter' })).toHaveValue(
    '6 mm + 2 * tolerance',
  );
  await expect(dialog.getByRole('textbox', { name: 'Counterbore depth' })).toHaveValue('3.3 mm');
  // The sizes are the M3 clearance ones, so the dropdown still shows it.
  await expect(dialog.getByRole('combobox', { name: 'Preset' })).toHaveValue('m3-clearance');
  await expect(dialog).toHaveAttribute('data-preview-status', /^(ok|warning)$/, {
    timeout: 15_000,
  });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);

  // The panel says what its value reaches.
  await openTolerance(page);
  await expect(usage(page)).toHaveText('Used by 1 hole');
});

test('without a tolerance a preset writes the published size', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  const dialog = await startHoleOnCube(page, 10, -10);
  await dialog.getByRole('combobox', { name: 'Preset' }).selectOption({ label: 'M3 clearance' });
  await expect(dialog.getByRole('textbox', { name: 'Diameter', exact: true })).toHaveValue(
    '3.4 mm',
  );
  await expect(dialog.getByRole('combobox', { name: 'Preset' })).toHaveValue('m3-clearance');
  await expect(dialog).toHaveAttribute('data-preview-status', /^(ok|warning)$/, {
    timeout: 15_000,
  });
});
