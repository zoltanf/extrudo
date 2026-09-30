import { expect, type Locator, type Page, test } from '@playwright/test';
import { meshBounds } from '../packages/io/src/index';
import { exportModel, objectsOf3mf, solidFacts } from './benchmark-helpers';
import { clicker, kernelReady, newSketchOnXY, openProject, pickTool, projector } from './helpers';

// P3-04: the hole feature (ADR-0049, FR-FT-07). Holes on a cube from the Box
// tool (x, y ±20, z 0…40, a 40 mm cube): where you click on its top face, a
// counterbore from a preset, a blind hole with its drill point, a heat-set
// insert hole, sketch points on another plane, and a circular pattern of the
// hole. Faces and sizes are read from `data-bodies`, volumes from the 3MF export.

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

/** Waits until the camera has stopped moving; returns a world → page mapping. */
async function settledProjector(viewport: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const values = await Promise.all(
        ['size', 'target', 'direction'].map((k) => viewport.getAttribute(`data-camera-${k}`)),
      );
      const key = values.join(' ');
      const still = key === last;
      last = key;
      return still;
    })
    .toBe(true);
  return projector(viewport);
}

/** A 40 mm cube from the Box tool, centred on the origin, on the XY plane. */
async function cube(page: Page) {
  await pickTool(page, 'Box');
  const dialog = page.getByRole('region', { name: 'Box dialog' });
  await expect(dialog).toBeVisible();
  for (const name of ['Length', 'Width', 'Height']) {
    await dialog.getByRole('textbox', { name, exact: true }).fill('40 mm');
  }
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
}

const holeDialog = (page: Page) => page.getByRole('region', { name: 'Hole dialog' });

/** Opens the Hole tool with H and clicks the cube's top face at world (x, y, 40). */
async function startHole(page: Page, x = 5, y = -6) {
  const viewport = viewportOf(page);
  await page.keyboard.press('Shift+1');
  const at = await settledProjector(viewport);
  await page.keyboard.press('h');
  const dialog = holeDialog(page);
  await expect(dialog).toBeVisible();
  // It opens on the XY plane, at the origin.
  await expect(dialog.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
  const p = at([x, y, 40]);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(150);
  await page.mouse.click(p.x, p.y);
  await expect(dialog.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
  return { dialog, at };
}

async function ok(page: Page, dialog: Locator) {
  await expect(dialog).toHaveAttribute('data-preview-status', /^(ok|warning)$/, {
    timeout: 15_000,
  });
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
}

/** The cube's box and volume in the 3MF export. */
async function measured(page: Page) {
  const file = await exportModel(page, '3MF');
  await page
    .getByRole('tablist', { name: 'Toolbar tabs' })
    .getByRole('tab', { name: 'Solid' })
    .click();
  const [object] = objectsOf3mf(file);
  if (!object) throw new Error('no body exported');
  const box = meshBounds(object.mesh);
  return {
    volume: solidFacts(object.mesh).volume,
    size: box?.max.map((v, k) => v - (box.min[k] as number)),
  };
}

const CUBE = 40 * 40 * 40;
const PI = Math.PI;

test('a simple through hole where you click on a face', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await cube(page);
  const { dialog } = await startHole(page);

  // The click put the hole at about (5, −6) in the face's frame (X along world X, Y along world Y).
  const x = await dialog.getByRole('textbox', { name: 'X', exact: true }).inputValue();
  const y = await dialog.getByRole('textbox', { name: 'Y', exact: true }).inputValue();
  expect(Number.parseFloat(x)).toBeCloseTo(5, -0.5);
  expect(Number.parseFloat(y)).toBeCloseTo(-6, -0.5);
  await dialog.getByRole('textbox', { name: 'X', exact: true }).fill('5 mm');
  await dialog.getByRole('textbox', { name: 'Y', exact: true }).fill('-6 mm');
  await dialog.getByRole('textbox', { name: 'Diameter', exact: true }).fill('6 mm');
  await expect(dialog.getByRole('combobox', { name: 'Extent' })).toHaveValue('through');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  // The cut is drawn over the model, with arrows for the diameter.
  await expect(viewport).toHaveAttribute('data-preview', 'cut');
  await expect(viewport.locator('[data-manipulators]')).toHaveAttribute(
    'data-manipulators',
    'distance:diameter',
  );
  await ok(page, dialog);

  await expect(chip(page, 'Hole1')).toBeVisible();
  // The cube's 6 faces and the hole's wall.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:40,40,40');
  const body = await measured(page);
  expect(body.volume).toBeCloseTo(CUBE - PI * 9 * 40, -1);

  // Editing the hole keeps its fields; a counterbore adds two faces.
  await chip(page, 'Hole1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Hole1 dialog' });
  await expect(edit.getByRole('textbox', { name: 'Diameter', exact: true })).toHaveValue('6 mm');
  await expect(edit.getByRole('textbox', { name: 'X', exact: true })).toHaveValue('5 mm');
  await edit.getByRole('combobox', { name: 'Type' }).selectOption('counterbore');
  await edit.getByRole('textbox', { name: 'Counterbore diameter' }).fill('12 mm');
  await edit.getByRole('textbox', { name: 'Counterbore depth' }).fill('5 mm');
  await ok(page, edit);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:9:40,40,40');

  // One undo step for the hole, one for the edit.
  await page.keyboard.press('Control+z');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:40,40,40');
  await page.keyboard.press('Control+z');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:40,40,40');
});

test('a counterbore for an M4 screw from the preset', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await cube(page);
  const { dialog } = await startHole(page);

  await dialog.getByRole('combobox', { name: 'Preset' }).selectOption({ label: 'M4 clearance' });
  await expect(dialog.getByRole('textbox', { name: 'Diameter', exact: true })).toHaveValue(
    '4.5 mm',
  );
  await dialog.getByRole('combobox', { name: 'Type' }).selectOption('counterbore');
  await expect(dialog.getByRole('textbox', { name: 'Counterbore diameter' })).toHaveValue('7.5 mm');
  await expect(dialog.getByRole('textbox', { name: 'Counterbore depth' })).toHaveValue('4.3 mm');
  // Still the M4 preset: the sizes match it.
  await expect(dialog.getByRole('combobox', { name: 'Preset' })).toHaveValue('m4-clearance');
  await ok(page, dialog);

  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:9:40,40,40');
  const body = await measured(page);
  expect(body.volume).toBeCloseTo(
    CUBE - PI * 2.25 * 2.25 * (40 - 4.3) - PI * 3.75 * 3.75 * 4.3,
    -1,
  );

  // Changing a size leaves the preset.
  await chip(page, 'Hole1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Hole1 dialog' });
  await expect(edit.getByRole('combobox', { name: 'Preset' })).toHaveValue('m4-clearance');
  await edit.getByRole('textbox', { name: 'Diameter', exact: true }).fill('4.6 mm');
  await expect(edit.getByRole('combobox', { name: 'Preset' })).toHaveValue('custom');
  await page.keyboard.press('Escape');
});

test('a blind hole has a drill point; a heat-set insert hole is flat', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await cube(page);
  const { dialog } = await startHole(page);

  await dialog.getByRole('combobox', { name: 'Extent' }).selectOption('blind');
  await dialog.getByRole('textbox', { name: 'Diameter', exact: true }).fill('6 mm');
  await dialog.getByRole('textbox', { name: 'Depth', exact: true }).fill('10 mm');
  await expect(dialog.getByRole('textbox', { name: 'Drill point' })).toHaveValue('118 deg');
  // A depth arrow joins the diameter's.
  await expect(viewport.locator('[data-manipulators]')).toHaveAttribute(
    'data-manipulators',
    'distance:diameter distance:depth',
  );
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await ok(page, dialog);
  // 6 faces + the wall + the drill point's cone.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:8:40,40,40');
  const cone = (PI * 9 * (3 / Math.tan((59 * PI) / 180))) / 3;
  expect((await measured(page)).volume).toBeCloseTo(CUBE - PI * 9 * 10 - cone, -1);

  // Another hole from a heat-set insert preset: blind, simple, flat.
  await page.keyboard.press('Shift+1');
  const at = await settledProjector(viewport);
  await page.keyboard.press('h');
  const insert = holeDialog(page);
  await expect(insert).toBeVisible();
  const p = at([-8, 8, 40]);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(150);
  await page.mouse.click(p.x, p.y);
  await insert
    .getByRole('combobox', { name: 'Preset' })
    .selectOption({ label: 'M3 heat-set insert' });
  await expect(insert.getByRole('combobox', { name: 'Extent' })).toHaveValue('blind');
  await expect(insert.getByRole('textbox', { name: 'Diameter', exact: true })).toHaveValue('4 mm');
  await expect(insert.getByRole('textbox', { name: 'Depth', exact: true })).toHaveValue('6.5 mm');
  await expect(insert.getByRole('textbox', { name: 'Drill point' })).toHaveValue('0 deg');
  await ok(page, insert);
  // A floor instead of a cone: 8 + 2 faces.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:10:40,40,40');
  expect((await measured(page)).volume).toBeCloseTo(CUBE - PI * 9 * 10 - cone - PI * 4 * 6.5, -1);
});

test('a hole that misses the body says so and stays out', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  const { dialog } = await startHole(page);
  // Flipped, the hole goes up into the air above the face.
  await dialog.getByRole('checkbox', { name: 'Flip' }).check();
  await expect(dialog).toHaveAttribute('data-preview-status', 'error', { timeout: 15_000 });
  await expect(dialog.getByRole('status', { name: 'Feature status' })).toContainText(
    /doesn't remove anything/,
  );
  await expect(dialog.getByRole('button', { name: 'OK' })).toHaveAttribute('aria-disabled', 'true');
  await dialog.getByRole('checkbox', { name: 'Flip' }).uncheck();
  await ok(page, dialog);
});

test('holes at sketch points, dropped onto the face', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await cube(page);

  // Two points in a sketch on the XY plane, which is the cube's bottom.
  const onXY = await newSketchOnXY(page);
  const clickXY = clicker(page, onXY);
  await pickTool(page, 'Point');
  await clickXY(-10, 0);
  await clickXY(10, 10);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);

  const { dialog } = await startHole(page, 0, 0);
  await dialog.getByRole('textbox', { name: 'Diameter', exact: true }).fill('4 mm');
  await dialog.getByRole('button', { name: 'Points', exact: true }).click();
  // The sketch's points are at the cube's bottom: look from below to pick them.
  await page.keyboard.press('Shift+3');
  const below = await settledProjector(viewport);
  for (const [x, y] of [
    [-10, 0],
    [10, 10],
  ] as const) {
    const p = below([x, y, 0]);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(150);
    await page.mouse.click(p.x, p.y);
  }
  await expect(dialog.getByRole('button', { name: 'Points', exact: true })).toHaveText('2 points');
  // X and Y are the points' now.
  await expect(dialog.getByRole('textbox', { name: 'X', exact: true })).toHaveCount(0);
  await ok(page, dialog);

  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:8:40,40,40');
  expect((await measured(page)).volume).toBeCloseTo(CUBE - 2 * PI * 4 * 40, -1);
  // Editing the hole shows its points again.
  await chip(page, 'Hole1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Hole1 dialog' });
  await expect(edit.getByRole('button', { name: 'Points', exact: true })).toHaveText('2 points');
  await page.keyboard.press('Escape');
});

test('a circular pattern repeats a hole, faces and all', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await cube(page);
  const { dialog } = await startHole(page, 10, 0);
  await dialog.getByRole('textbox', { name: 'X', exact: true }).fill('10 mm');
  await dialog.getByRole('textbox', { name: 'Y', exact: true }).fill('0 mm');
  await dialog.getByRole('textbox', { name: 'Diameter', exact: true }).fill('4 mm');
  await ok(page, dialog);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:40,40,40');

  await pickTool(page, 'Circular Pattern');
  const pattern = page.getByRole('region', { name: 'Circular Pattern dialog' });
  await expect(pattern).toBeVisible();
  await pattern.getByRole('combobox', { name: 'Pattern' }).selectOption('features');
  // The hole is listed: a hole always cuts.
  await pattern.getByRole('checkbox', { name: /^Hole1/ }).check();
  await pattern.getByRole('button', { name: 'Axis', exact: true }).click();
  await page.keyboard.press('Shift+1');
  const at = await settledProjector(viewport);
  let picked = false;
  for (const t of [45, 50, 55, 60, 70]) {
    const p = at([0, 0, t]);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(150);
    if ((await viewport.getAttribute('data-model-hover')) === 'axis:origin:z') {
      await page.mouse.click(p.x, p.y);
      picked = true;
      break;
    }
  }
  expect(picked).toBe(true);
  await pattern.getByRole('textbox', { name: 'Count', exact: true }).fill('4');
  await ok(page, pattern);
  // Four holes: 6 + 4 walls.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:10:40,40,40');
  // Volumes read from a 3MF are a tessellation short of exact.
  expect((await measured(page)).volume).toBeCloseTo(CUBE - 4 * PI * 4 * 40, -2);
});
