import { expect, type Page, test } from '@playwright/test';
import {
  addParameter,
  closeParameters,
  openParameters,
  primitive,
  viewportOf,
} from './benchmark-helpers';
import { kernelReady, openProject } from './helpers';

// P4-07 (FR-PAR-05 and FR-PAR-06): the Customizer panel. A starred parameter
// gets a slider, the model follows it, one undo takes the drag back, and named
// configurations switch a set of values at once. A template opens with its main
// parameters exposed already.

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 120_000 });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const panel = (page: Page) => page.getByRole('region', { name: 'Customizer' });
const configuration = (page: Page) => panel(page).getByRole('combobox', { name: 'Configuration' });
const row = (page: Page, name: string) => panel(page).locator(`[data-customizer-row="${name}"]`);
const value = (page: Page, name: string) =>
  panel(page).getByRole('textbox', { name: `Expression of ${name}`, exact: true });
const slider = (page: Page, name: string) =>
  panel(page).locator(`[data-customizer-slider="${name}"]`);

/** Opens the Customizer panel from the toolbar's Solid › Modify group. */
async function openCustomizer(page: Page) {
  await page.getByRole('button', { name: 'Customizer', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-customizer-state', /.+/);
}

async function closeCustomizer(page: Page) {
  await panel(page).getByRole('button', { name: 'Done' }).click();
  await expect(panel(page)).toHaveCount(0);
}

/** Stars a parameter in the Parameters dialog and gives the slider a range. */
async function expose(page: Page, name: string, min: string, max: string) {
  await openParameters(page);
  const dialog = page.getByRole('dialog', { name: 'Parameters' });
  await dialog.getByRole('button', { name: `Show ${name} in customizer` }).click();
  await expect(dialog.getByRole('textbox', { name: `Min of ${name}`, exact: true })).toBeVisible();
  for (const [field, text] of [
    ['Min', min],
    ['Max', max],
  ] as const) {
    const input = dialog.getByRole('textbox', { name: `${field} of ${name}`, exact: true });
    await input.fill(text);
    await input.press('Enter');
  }
  await closeParameters(page);
}

/** The configuration named in the panel's select. */
async function choose(page: Page, name: string) {
  await configuration(page).selectOption({ label: name });
}

/** The name of the configuration the document has: the selected option's text. */
async function currentName(page: Page) {
  return configuration(page).evaluate((select) => {
    // e2e/ has no DOM library, so the select's shape is spelled out here.
    const list = select as unknown as { options: { text: string }[]; selectedIndex: number };
    return list.options[list.selectedIndex]?.text ?? '';
  });
}

/** The sizes of the drawn bodies, as `data-bodies` lists them ("Body1:6:60,40,30"). */
async function bodySizes(page: Page) {
  const key = (await viewportOf(page).getAttribute('data-bodies')) ?? '';
  return key.split(' ').map((entry) => entry.split(':')[2]);
}

test('a slider drag changes the model, and one undo takes it back', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await openParameters(page);
  await addParameter(page, 'size', '20 mm');
  await closeParameters(page);
  // The box's length is the parameter, so the slider moves the body.
  await primitive(page, 'Box', { Length: 'size' });
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');

  await expose(page, 'size', '10 mm', '60 mm');
  await openCustomizer(page);
  await expect(panel(page)).toHaveAttribute('data-customizer-state', 'parameters');
  await expect(row(page, 'size')).toBeVisible();

  // A drag: down on the slider, along it, release. The panel's slider is a
  // native range input, so the value follows the pointer within its step.
  const box = await slider(page, 'size').boundingBox();
  if (!box) throw new Error('no slider');
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const dragged = Number((await value(page, 'size').inputValue()).split(' ')[0]);
  // About 40 mm: min 10 + 0.6 × 50.
  expect(dragged).toBeGreaterThan(34);
  expect(dragged).toBeLessThan(46);
  await expect
    .poll(async () => Number((await bodySizes(page))[0]?.split(',')[0]), { timeout: 15_000 })
    .toBeCloseTo(dragged, 1);

  // One Ctrl+Z, with the slider still focused, undoes the whole drag.
  await page.keyboard.press('Control+z');
  await expect(value(page, 'size')).toHaveValue('20 mm');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
});

test('configurations save, apply, rename and delete', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await openParameters(page);
  await addParameter(page, 'size', '20 mm');
  await closeParameters(page);
  await primitive(page, 'Box', { Length: 'size' });
  await expose(page, 'size', '10 mm', '60 mm');
  await openCustomizer(page);

  // Save the current values as "Small".
  await panel(page).getByRole('button', { name: 'Configuration actions' }).click();
  await page.getByRole('menuitem', { name: 'Save as…' }).click();
  const name = panel(page).getByRole('textbox', { name: 'Name of the configuration' });
  await name.fill('Small');
  await name.press('Enter');
  await expect(configuration(page)).toHaveValue(/./);

  // 50 mm, saved as "Large".
  await value(page, 'size').fill('50 mm');
  await value(page, 'size').press('Enter');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:50,20,20');
  await panel(page).getByRole('button', { name: 'Configuration actions' }).click();
  await page.getByRole('menuitem', { name: 'Save as…' }).click();
  await name.fill('Large');
  await name.press('Enter');

  // Choosing "Small" writes its values, and the box follows.
  await choose(page, 'Small');
  await expect(value(page, 'size')).toHaveValue('20 mm');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
  await expect(configuration(page)).toHaveValue(/.+/);
  await expect(configuration(page)).not.toHaveValue('');

  // The select names the configuration the document has.
  expect(await currentName(page)).toBe('Small');

  // Typing a value of its own leaves no configuration current.
  await value(page, 'size').fill('33 mm');
  await value(page, 'size').press('Enter');
  expect(await currentName(page)).toBe('Custom');
  await choose(page, 'Large');
  await expect(value(page, 'size')).toHaveValue('50 mm');

  // Rename it, then delete it.
  await panel(page).getByRole('button', { name: 'Configuration actions' }).click();
  await page.getByRole('menuitem', { name: /^Rename Large/ }).click();
  const rename = panel(page).getByRole('textbox', { name: 'Rename Large' });
  await rename.fill('Big');
  await rename.press('Enter');
  await expect(configuration(page)).toContainText('Big');

  await panel(page).getByRole('button', { name: 'Configuration actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete Big' }).click();
  await panel(page).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(configuration(page)).not.toContainText('Big');
  // The parameters keep their values.
  await expect(value(page, 'size')).toHaveValue('50 mm');
});

test('a value outside the range is kept, and the row warns about it', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await openParameters(page);
  await addParameter(page, 'size', '20 mm');
  await closeParameters(page);
  await primitive(page, 'Box', { Length: 'size' });
  await expose(page, 'size', '10 mm', '60 mm');
  await openCustomizer(page);

  await value(page, 'size').fill('80 mm');
  await value(page, 'size').press('Enter');
  await expect(row(page, 'size')).toHaveAttribute('data-out-of-range', 'true');
  await expect(row(page, 'size')).toContainText('Outside 10.00 mm to 60.00 mm');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:80,20,20');
});

test('a template opens with its parameters exposed and its configurations', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start from the Storage box template' }).click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  const viewport = viewportOf(page);
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:11:80,60,40');

  await openCustomizer(page);
  for (const name of ['width', 'depth', 'height', 'wall']) {
    await expect(row(page, name)).toBeVisible();
    await expect(slider(page, name)).toBeVisible();
  }
  await expect(panel(page).getByRole('region', { name: 'Size' })).toBeVisible();
  await expect(panel(page).getByRole('region', { name: 'Walls' })).toBeVisible();
  // A row's field shows the stored expression, not the formatted value.
  await expect(value(page, 'width')).toHaveValue('80 mm');

  // The second configuration is a bigger box, and the model follows it.
  const options = await configuration(page).evaluate(
    (select) => (select as unknown as { options: unknown[] }).options.length,
  );
  expect(options).toBe(3);
  await choose(page, 'Large');
  await expect(value(page, 'width')).toHaveValue('140 mm');
  await expect
    .poll(async () => (await viewport.getAttribute('data-bodies')) ?? '', { timeout: 15_000 })
    .toContain('140,100,70');
  await closeCustomizer(page);
});

test('an empty design says so, and has a way to the Parameters dialog', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await openCustomizer(page);
  await expect(panel(page)).toHaveAttribute('data-customizer-state', 'empty');
  await expect(panel(page)).toContainText('Star a parameter in the Parameters dialog');
  await panel(page).getByRole('button', { name: 'Open Parameters' }).click();
  await expect(page.getByRole('dialog', { name: 'Parameters' })).toBeVisible();
});
