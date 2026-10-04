import { expect, type Page, test } from '@playwright/test';
import { counts, kernelReady, pickTool, sketchOnXY } from './helpers';

// P4-06, slice 1: drawings into a sketch (ADR-0066 §1). The tool picks an SVG
// or DXF file, its panel asks for the unit, the scale, where the drawing goes
// and whether its curves are fixed, and OK brings the file in as one undo step
// of ordinary fixed curves. The imported plate then extrudes like any other
// sketch's profile.

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

const viewport = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const panel = (page: Page) => page.getByRole('region', { name: 'Import drawing' });
const summary = (page: Page) => panel(page).locator('[data-import-summary]');
/** The fixtures `@extrudo/io`'s own tests read. */
const FIXTURES = 'packages/io/src/fixtures/';

/** "Body1:7:40,20,5" per drawn body: its name, face count and size in mm. */
async function bodies(page: Page) {
  const drawn = (await viewport(page).getAttribute('data-bodies')) ?? '';
  return drawn
    .split(' ')
    .filter(Boolean)
    .map((entry) => {
      const [name, faces, size] = entry.split(':');
      return { name: name ?? '', faces: Number(faces), size: (size ?? '').split(',').map(Number) };
    });
}

/**
 * The tool from the Create menu, then a file through the platform's picker: the
 * command runs the tool, and the tool opens the dialog at once, so the chooser
 * is waited for beside the click that starts it.
 */
async function pickFile(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await pickTool(page, 'Import Drawing…');
  await (await chooser).setFiles(file);
}

/** Finishes the sketch, extrudes the profile under `at` 5 mm, and reads the body. */
async function extrudeProfileAt(
  page: Page,
  at: (x: number, y: number) => { x: number; y: number },
  point: [number, number],
): Promise<{ faces: number; size: number[] }[]> {
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);
  const p = at(point[0], point[1]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await expect
    .poll(async () => viewport(page).getAttribute('data-model-selection'))
    .toMatch(/^profile:/);
  await page.keyboard.press('e');
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Distance' }).fill('5 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 30_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  return bodies(page);
}

test('an SVG of a rectangle and a circle comes in as fixed curves', async ({ page }) => {
  const at = await sketchOnXY(page);
  await pickFile(page, `${FIXTURES}rect-circle.svg`);

  // The panel says what the file brings in, and which unit it was in.
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText('rect-circle.svg');
  await expect(summary(page)).toHaveAttribute('data-import-summary', 'ok');
  await expect(summary(page)).toHaveText('5 curves');
  await expect(panel(page).getByRole('combobox', { name: 'Units' })).toHaveValue('mm');
  await expect(panel(page).getByRole('checkbox', { name: 'Fixed' })).toBeChecked();
  await expect(panel(page).getByRole('textbox', { name: 'Scale' })).toHaveValue('1');
  await expect(panel(page).getByRole('combobox', { name: 'Position' })).toHaveValue('origin');

  await panel(page).getByRole('button', { name: 'OK' }).click();
  await expect(panel(page)).toHaveCount(0);

  // Four lines and a circle, nine points, and one `fix` per curve.
  await expect
    .poll(() => counts(page))
    .toMatchObject({
      lines: 4,
      circles: 1,
      points: 9,
      constraints: 5,
    });
  // The plate with its Ø10 hole: two regions, one of them a hole (ADR-0020).
  await expect(viewport(page)).toHaveAttribute('data-sketch-profiles', 'profiles=2 holes=1');

  // One undo step: Ctrl+Z takes the whole import out, and redo brings it back.
  await page.keyboard.press('Control+z');
  await expect.poll(() => counts(page)).toMatchObject({ points: 0, constraints: 0 });
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => counts(page)).toMatchObject({ lines: 4, circles: 1 });

  // The plate extrudes like any other profile: 40 × 20 mm by 5 mm.
  const drawn = await extrudeProfileAt(page, at, [-10, 0]);
  expect(drawn).toHaveLength(1);
  expect(drawn[0]?.size).toEqual([40, 20, 5]);
});

test('the panel Scale moves the drawing', async ({ page }) => {
  const at = await sketchOnXY(page);
  await pickFile(page, `${FIXTURES}rect-circle.svg`);
  await panel(page).getByRole('textbox', { name: 'Scale' }).fill('2');
  await panel(page).getByRole('button', { name: 'OK' }).click();
  await expect(panel(page)).toHaveCount(0);

  const drawn = await extrudeProfileAt(page, at, [-20, 0]);
  expect(drawn).toHaveLength(1);
  expect(drawn[0]?.size).toEqual([80, 40, 5]);
});

test('Centred on sketch origin puts the drawing around the origin', async ({ page }) => {
  const at = await sketchOnXY(page);
  await pickFile(page, `${FIXTURES}rect-circle.svg`);
  await panel(page).getByRole('combobox', { name: 'Position' }).selectOption('centre');
  await panel(page).getByRole('button', { name: 'OK' }).click();
  await expect(panel(page)).toHaveCount(0);

  const drawn = await extrudeProfileAt(page, at, [0, 8]);
  expect(drawn).toHaveLength(1);
  expect(drawn[0]?.size).toEqual([40, 20, 5]);
});

test('a DXF in inches comes in at its real size', async ({ page }) => {
  const at = await sketchOnXY(page);
  await pickFile(page, `${FIXTURES}square-inches.dxf`);
  // The file says $INSUNITS 1, which the panel preselects: a 1 × 1 in square.
  await expect(panel(page).getByRole('combobox', { name: 'Units' })).toHaveValue('in');
  await panel(page).getByRole('button', { name: 'OK' }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(viewport(page)).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');

  const drawn = await extrudeProfileAt(page, at, [12, 12]);
  expect(drawn).toHaveLength(1);
  expect(drawn[0]?.size[0]).toBeCloseTo(25.4, 3);
  expect(drawn[0]?.size[1]).toBeCloseTo(25.4, 3);
  expect(drawn[0]?.size[2]).toBe(5);
});

test('a file that is not a drawing says so and refuses OK', async ({ page }) => {
  await sketchOnXY(page);
  await pickFile(page, {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Not a drawing, just a note.'),
  });
  await expect(panel(page)).toBeVisible();
  await expect(summary(page)).toHaveAttribute('data-import-summary', 'error');
  await expect(summary(page)).toHaveText('Extrudo imports SVG and DXF drawings.');
  await expect(panel(page).getByRole('button', { name: 'OK' })).toBeDisabled();
  // Nothing was drawn and nothing went into the sketch.
  await expect.poll(() => counts(page)).toMatchObject({ points: 0 });
});

test('Cancel leaves the sketch as it was', async ({ page }) => {
  await sketchOnXY(page);
  await pickFile(page, `${FIXTURES}rect-circle.svg`);
  await panel(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect.poll(() => counts(page)).toMatchObject({ points: 0 });
});
