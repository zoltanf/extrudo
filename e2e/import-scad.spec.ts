import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  addParameter,
  closeParameters,
  exportModel,
  meshOfStl,
  objectsOf3mf,
  openParameters,
  solidFacts,
  solidTab,
} from './benchmark-helpers';
import { kernelReady, openProject, pickTool, selectTab } from './helpers';

// P5-04, slice 2: OpenSCAD import in the app (ADR-0071). A `.scad` file picked
// through Insert › Import is compiled by OpenSCAD's own WASM in a worker of its
// own and becomes a mesh body; the dialog lists the file's customizer variables
// as rows whose empty state is the file's value, a row's expression (a number,
// or a document parameter) overrides the variable, and the Customizer's slider
// on that parameter recompiles the part.

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 240_000 });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** A 40 × 30 × 4 mm plate with two Ø4 holes, its customizer in groups Size and Holes. */
const PLATE = 'fixtures/imports/customizer-plate.scad';
/** A syntax error on line 4. */
const BROKEN = 'fixtures/imports/syntax-error.scad';

const viewport = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const dialog = (page: Page, name = 'Import dialog') => page.getByRole('region', { name });
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });
const variable = (panel: Locator, name: string) =>
  panel.locator(`[data-scad-row="${name}"]`).getByRole('textbox', { name, exact: true });

/** The drawn bodies' sizes in mm (`data-bodies`: "Body1:1:40,30,4"). */
async function sizes(page: Page) {
  const drawn = (await viewport(page).getAttribute('data-bodies')) ?? '';
  return drawn
    .split(' ')
    .filter(Boolean)
    .map((entry) => (entry.split(':')[2] ?? '').split(',').map(Number));
}

/** The Insert tab's Import tile, then a file through the platform's picker. */
async function importFile(page: Page, file: string): Promise<Locator> {
  const chooser = page.waitForEvent('filechooser');
  await selectTab(page, 'Home');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await (await chooser).setFiles(file);
  const panel = dialog(page);
  await expect(panel).toBeVisible();
  return panel;
}

/** Waits for a preview of the current values (OpenSCAD compiles, then the mesh). */
async function previewed(panel: Locator, status = 'ok') {
  await expect(panel).toHaveAttribute('data-preview-status', status, { timeout: 90_000 });
}

test("a .scad file's variables are rows, and an override resizes the part", async ({ page }) => {
  await openProject(page);
  await kernelReady(page);

  const panel = await importFile(page, PLATE);
  await expect(panel.locator('[data-info="file"]')).toHaveText(
    /^customizer-plate\.scad · \d+ (B|kB) · OpenSCAD$/,
  );
  // The file's customizer, read by OpenSCAD in the worker: numbers are rows
  // with the file's value as placeholder, the rest read only, under the
  // file's groups.
  const rows = panel.locator('[data-scad-overrides]');
  await expect(rows).toHaveAttribute('data-scad-overrides', 'ready', { timeout: 90_000 });
  await expect(rows.locator('[data-scad-group]')).toHaveText(['Size', 'Holes']);
  await expect(rows.locator('[data-scad-row]')).toHaveCount(6);
  await expect(variable(panel, 'width')).toHaveAttribute('placeholder', '40');
  await expect(variable(panel, 'width')).toHaveValue('');
  await expect(panel.locator('[data-scad-row="width"]')).toContainText('Plate width');
  await expect(panel.locator('[data-scad-row="hole"]')).toContainText("The holes' diameter");
  await expect(panel.locator('[data-scad-row="label"]')).toContainText('(not editable yet)');
  await expect(panel.locator('[data-scad-row="rounded"]')).toHaveAttribute('data-scad-readonly');
  await previewed(panel);

  await panel.getByRole('button', { name: /^OK/ }).click();
  await expect(chip(page, 'Import1')).toBeVisible();
  await expect.poll(() => sizes(page), { timeout: 60_000 }).toEqual([[40, 30, 4]]);
  await expect(page.locator('[data-body]').first()).toHaveAttribute('data-body-mesh', 'true');

  // Edit from the chip: width 60 recompiles the part 60 mm wide.
  await chip(page, 'Import1').dblclick();
  const edit = dialog(page, 'Edit Import1 dialog');
  await expect(edit.locator('[data-scad-overrides]')).toHaveAttribute(
    'data-scad-overrides',
    'ready',
  );
  await variable(edit, 'width').fill('60');
  await expect(edit.locator('[data-scad-row="width"]')).toContainText('= 60');
  await previewed(edit);
  await edit.getByRole('button', { name: /^OK/ }).click();
  await expect.poll(() => sizes(page), { timeout: 60_000 }).toEqual([[60, 30, 4]]);

  // One undo step each way.
  await page.keyboard.press('Control+z');
  await expect.poll(() => sizes(page), { timeout: 60_000 }).toEqual([[40, 30, 4]]);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => sizes(page), { timeout: 60_000 }).toEqual([[60, 30, 4]]);

  // Emptying the row takes the override out: the file's own 40 again.
  await chip(page, 'Import1').dblclick();
  await variable(edit, 'width').fill('');
  await previewed(edit);
  await edit.getByRole('button', { name: /^OK/ }).click();
  await expect.poll(() => sizes(page), { timeout: 60_000 }).toEqual([[40, 30, 4]]);

  // STL and 3MF of the compiled body read back closed, the two holes cut.
  const hole = 0.5 * 32 * 4 * Math.sin((2 * Math.PI) / 32) * 4;
  const stl = solidFacts(meshOfStl(await exportModel(page, 'STL')));
  expect(stl.size.map((v) => Number(v.toFixed(3)))).toEqual([40, 30, 4]);
  expect(stl.volume).toBeCloseTo(4800 - 2 * hole, 1);
  const [object] = objectsOf3mf(await exportModel(page, '3MF'));
  if (!object) throw new Error('no object');
  expect(solidFacts(object.mesh).volume).toBeCloseTo(4800 - 2 * hole, 1);
});

test('a document parameter drives a variable, and the Customizer follows it', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await openParameters(page);
  await addParameter(page, 'plateWidth', '50 mm');
  const parameters = page.getByRole('dialog', { name: 'Parameters' });
  await parameters.getByRole('button', { name: 'Show plateWidth in customizer' }).click();
  for (const [field, text] of [
    ['Min', '20 mm'],
    ['Max', '80 mm'],
  ] as const) {
    const input = parameters.getByRole('textbox', { name: `${field} of plateWidth`, exact: true });
    await input.fill(text);
    await input.press('Enter');
  }
  await closeParameters(page);

  const panel = await importFile(page, PLATE);
  await expect(panel.locator('[data-scad-overrides]')).toHaveAttribute(
    'data-scad-overrides',
    'ready',
    { timeout: 90_000 },
  );
  await variable(panel, 'width').fill('plateWidth');
  await expect(panel.locator('[data-scad-row="width"]')).toContainText('= 50');
  await previewed(panel);
  await panel.getByRole('button', { name: /^OK/ }).click();
  await expect.poll(() => sizes(page), { timeout: 60_000 }).toEqual([[50, 30, 4]]);

  // The slider: every step recompiles, and the part follows the parameter.
  await solidTab(page);
  await pickTool(page, 'Customizer');
  const customizer = page.getByRole('region', { name: 'Customizer' });
  const slider = customizer.locator('[data-customizer-slider="plateWidth"]');
  const box = await slider.boundingBox();
  if (!box) throw new Error('no slider');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 6 });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const value = customizer.getByRole('textbox', { name: 'Expression of plateWidth', exact: true });
  const dragged = Number((await value.inputValue()).split(' ')[0]);
  expect(dragged).toBeGreaterThan(60);
  await expect
    .poll(async () => (await sizes(page))[0]?.[0], { timeout: 60_000 })
    .toBeCloseTo(dragged, 1);

  // One undo takes the whole drag back, and the part with it.
  await page.keyboard.press('Control+z');
  await expect(value).toHaveValue('50 mm');
  await expect.poll(() => sizes(page), { timeout: 60_000 }).toEqual([[50, 30, 4]]);
});

test("a file OpenSCAD can't compile says where, and OK stays off", async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  const panel = await importFile(page, BROKEN);
  await previewed(panel, 'error');
  await expect(panel.getByRole('status', { name: 'Feature status' })).toHaveText(
    'syntax-error.scad, line 4: syntax error.',
  );
  await expect(panel).not.toHaveAttribute('data-dialog-valid');
  await expect(panel.locator('[data-scad-overrides]')).toHaveAttribute(
    'data-scad-overrides',
    'error',
  );
  await expect(panel.getByRole('button', { name: /^OK/ })).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Enter');
  await expect(chip(page, 'Import1')).toHaveCount(0);
});
