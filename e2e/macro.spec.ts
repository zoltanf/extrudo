import { expect, type Page, test } from '@playwright/test';
import {
  addParameter,
  chip,
  clickEdge,
  closeParameters,
  openParameters,
  primitive,
  turnView,
  viewportOf,
} from './benchmark-helpers';
import { clicker, kernelReady, mapping, openProject, pickTool } from './helpers';

// P5-05 slice 2 (ADR-0073 §4): Record and Stop, the Macro dialog, Replace and Keep both, and
// Export Design as Script. The recorded code runs in a Script feature and gives the same body.

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(180_000);

let errors: string[] = [];

test.beforeEach(async ({ page, context }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openProject(page);
  await kernelReady(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const recording = (page: Page) => page.locator('[data-macro-recording]');
const dialog = (page: Page) => page.getByRole('region', { name: 'Macro', exact: true });
const bodies = async (page: Page) => (await viewportOf(page).getAttribute('data-bodies')) ?? '';
/** `data-bodies` without the names (a script's body is a new body): "6:20,20,20 6:…". */
const shapes = async (page: Page) =>
  (await bodies(page))
    .split(' ')
    .filter(Boolean)
    .map((entry) => entry.split(':').slice(1).join(':'))
    .join(' ');

/** A 40 × 20 rectangle on XY with its bottom side dimensioned (so the sketch has d1), finished. */
async function rectangle(page: Page) {
  await page.getByRole('button', { name: 'Create Sketch' }).click();
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XY' })
    .click();
  const viewport = viewportOf(page);
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  const click = clicker(page, await mapping(viewport));
  await page.getByRole('button', { name: /^Rectangle/ }).click();
  await click(-20, -10);
  await click(20, 10);
  await page.keyboard.press('Escape');
}

async function finishSketch(page: Page) {
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();
}

async function extrudeProfile(page: Page, distance: string) {
  const world = await turnView(page, 'Shift+1');
  const centre = world([0, 0, 0]);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.click(centre.x, centre.y);
  await expect
    .poll(() => viewportOf(page).getAttribute('data-model-selection'))
    .toMatch(/^profile:/);
  await page.getByRole('button', { name: /^Extrude/ }).click();
  const extrude = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(extrude).toBeVisible();
  await extrude.getByRole('textbox', { name: 'Distance' }).fill(distance);
  await expect(extrude).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await extrude.getByRole('button', { name: 'OK' }).click();
  await expect(chip(page, 'Extrude1')).toBeVisible();
  await kernelReady(page);
}

test('records a sketch, an extrude and a fillet, and Replace makes one Script with the same body', async ({
  page,
}) => {
  await pickTool(page, 'Record Macro');
  await expect(recording(page)).toHaveAttribute('data-macro-recording', '0');
  // Record is gone from the menu and Stop is there.
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Record Macro', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Stop Macro', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await rectangle(page);
  await finishSketch(page);
  await extrudeProfile(page, '15');
  const home = await turnView(page, 'Shift+1');
  await clickEdge(page, home, [0, -10, 15]);
  await page.getByRole('button', { name: /^Fillet/ }).click();
  const fillet = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(fillet).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await fillet.getByRole('button', { name: 'OK' }).click();
  await expect(chip(page, 'Fillet1')).toBeVisible();
  await kernelReady(page);
  await expect(recording(page)).toContainText('Recording macro · 3 features');
  const before = await shapes(page);
  expect(before).toMatch(/^\d+:40,20,15$/);

  // Stop: the Macro dialog shows the code, and Copy puts all of it on the clipboard.
  await pickTool(page, 'Stop Macro');
  await expect(recording(page)).toHaveCount(0);
  await expect(dialog(page)).toHaveAttribute('data-macro-dialog', 'ready');
  await expect(page.getByRole('textbox', { name: 'Macro code' })).toContainText('design.sketch(');
  await dialog(page).getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Copied', { exact: true })).toBeVisible();
  const code = await page.evaluate('navigator.clipboard.readText()');
  expect(code).toContain('design.sketch(');
  expect(code).toContain('design.extrude(');
  expect(code).toContain('design.fillet(');

  // Replace: one Script, the same body.
  await dialog(page).getByRole('button', { name: 'Replace with a Script' }).click();
  await expect(dialog(page)).toHaveAttribute('data-macro-dialog', 'done');
  await expect(dialog(page).locator('[data-macro-outcome]')).toContainText('Replaced 3 features');
  await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(chip(page, 'Script1')).toBeVisible();
  for (const name of ['Sketch1', 'Extrude1', 'Fillet1']) {
    await expect(chip(page, name)).toHaveCount(0);
  }
  await kernelReady(page);
  await expect.poll(() => shapes(page), { timeout: 60_000 }).toBe(before);

  // One undo brings the three features back and takes the script away.
  await page.keyboard.press('Control+z');
  for (const name of ['Sketch1', 'Extrude1', 'Fillet1']) {
    await expect(chip(page, name)).toBeVisible();
  }
  await expect(chip(page, 'Script1')).toHaveCount(0);
  await kernelReady(page);
  await expect.poll(() => shapes(page), { timeout: 60_000 }).toBe(before);

  // Redo, then a second recording: a box, kept beside its script, suppressed.
  await page.keyboard.press('Control+Shift+z');
  await expect(chip(page, 'Script1')).toBeVisible();
  await kernelReady(page);
  await pickTool(page, 'Record Macro');
  await primitive(page, 'Box', {}, 'new-body');
  await expect(recording(page)).toContainText('Recording macro · 1 feature');
  // (The modal dialog hides the view from the accessibility tree: read the bodies first.)
  await kernelReady(page);
  const two = await shapes(page);
  expect(two.split(' ')).toHaveLength(2);
  await pickTool(page, 'Stop Macro');
  await dialog(page).getByRole('button', { name: 'Keep both' }).click();
  await expect(dialog(page).locator('[data-macro-outcome]')).toHaveText(
    'Added Script2, suppressed: unsuppress it to run the macro.',
  );
  await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(chip(page, 'Script2')).toBeVisible();
  await expect(chip(page, 'Script2')).toHaveAccessibleName(/suppressed/);
  await kernelReady(page);
  expect(await shapes(page)).toBe(two);
  // Unsuppressed, it makes one more body.
  await chip(page, 'Script2').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unsuppress' }).click();
  await expect
    .poll(async () => (await shapes(page)).split(' ').length, { timeout: 60_000 })
    .toBe(3);
});

test('Replace is refused, with nothing changed, while something outside the run uses it', async ({
  page,
}) => {
  await pickTool(page, 'Record Macro');
  await rectangle(page);
  // A dimension makes a parameter of the sketch (d1); a user parameter that reads it holds the sketch.
  const click = clicker(page, await mapping(viewportOf(page)));
  await page.getByRole('button', { name: /^Dimension/ }).click();
  await click(0, -10);
  await click(0, -16);
  await page.keyboard.type('40');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await finishSketch(page);
  await openParameters(page);
  await addParameter(page, 'twice', 'd1 * 2');
  await closeParameters(page);
  await expect(recording(page)).toContainText('Recording macro · 1 feature');

  await pickTool(page, 'Stop Macro');
  await dialog(page).getByRole('button', { name: 'Replace with a Script' }).click();
  const outcome = dialog(page).locator('[data-macro-outcome]');
  await expect(outcome).toHaveAttribute('data-macro-outcome', 'refused');
  await expect(outcome).toContainText("Can't delete Sketch1");
  // Still offered: keep both instead.
  await expect(dialog(page).getByRole('button', { name: 'Keep both' })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(chip(page, 'Sketch1')).toBeVisible();
  await expect(chip(page, 'Script1')).toHaveCount(0);
});

test('Stop with nothing recorded says so, and an undo past the start ends the recording', async ({
  page,
}) => {
  await pickTool(page, 'Record Macro');
  await pickTool(page, 'Stop Macro');
  await expect(dialog(page)).toHaveAttribute('data-macro-dialog', 'empty');
  await expect(dialog(page)).toContainText('Nothing was recorded.');
  await expect(dialog(page).getByRole('button', { name: 'Replace with a Script' })).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();

  await primitive(page, 'Box', {}, 'new-body');
  await pickTool(page, 'Record Macro');
  await primitive(page, 'Cylinder', {}, 'new-body');
  await expect(recording(page)).toContainText('1 feature');
  await page.keyboard.press('Control+z');
  await expect(recording(page)).toContainText('0 features');
  await page.keyboard.press('Control+z');
  await expect(recording(page)).toHaveCount(0);
  await expect(
    page.getByText('Macro recording ended: you undid past where it started.'),
  ).toBeVisible();
});

test('Export Design as Script downloads the design with its parameters', async ({ page }) => {
  await openParameters(page);
  await addParameter(page, 'width', '40 mm');
  await closeParameters(page);
  await primitive(page, 'Box', { Length: 'width' }, 'new-body');
  await page.getByRole('button', { name: 'File menu' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Export design as script…' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.ts$/);
  const text = await (await import('node:fs/promises')).readFile(await download.path(), 'utf8');
  expect(text).toContain('design.parameter(');
  expect(text).toContain('design.box(');
  await expect(page.getByText(`Exported ${download.suggestedFilename()}.`)).toBeVisible();
});
