import { expect, type Locator, type Page, test } from '@playwright/test';
import { clicker, kernelReady, mapping, newSketchOnXY, openProject, projector } from './helpers';

// P3-05: construction geometry (ADR-0040, FR-FT-13). An offset plane is
// picked in the view, previews and commits; a sketch lies on it and its
// extrude starts there; two construction points make an axis that a revolve
// turns about; the browser's Construction folder lists them with an eye.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const attr = async (el: Locator, name: string) => (await el.getAttribute(name)) ?? '';
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });
const prompt = (page: Page) => page.getByRole('status', { name: 'Tool prompt' });

/** Runs a Construct-group tool from its tile or the group's menu, and waits for its dialog. */
async function startConstruction(page: Page, label: string, tileName = label) {
  const group = page.getByRole('group', { name: 'Construct', exact: true });
  const tile = group.getByRole('button', { name: new RegExp(`^${tileName}`) });
  if (await tile.count()) {
    await tile.click();
  } else {
    await group.getByRole('button', { name: 'Construct', exact: true }).click();
    await page.getByRole('menuitem', { name: new RegExp(`^${label}`) }).click();
  }
  const dialog = page.getByRole('region', { name: `${label} dialog` });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function ok(page: Page, dialog: Locator) {
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
}

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

async function clickAt(
  page: Page,
  at: (p: [number, number, number]) => { x: number; y: number },
  p: [number, number, number],
) {
  const { x, y } = at(p);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
}

type At = Awaited<ReturnType<typeof newSketchOnXY>>;

/** Draws a rectangle from (x0, y0) to (x1, y1) in the open sketch. */
async function rectangle(page: Page, at: At, x0: number, y0: number, x1: number, y1: number) {
  const click = clicker(page, at);
  await page.keyboard.press('r');
  await click(x0, y0);
  await click(x1, y1);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveCount(0);
}

test('an offset plane: picked in the view, previewed, a sketch on it, its extrude, the browser', async ({
  page,
}) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  const at = await settledProjector(viewport);
  const half = Number(await viewport.getAttribute('data-camera-size')) * 0.16;

  // The dialog picks planes like Create Sketch: a click on the XY plane's square.
  const dialog = await startConstruction(page, 'Offset Plane');
  const plane = dialog.getByRole('button', { name: 'Plane', exact: true });
  await expect(plane).toHaveAttribute('aria-pressed', 'true');
  await clickAt(page, at, [half * 0.5, -half * 0.5, 0]);
  await expect(plane).toHaveText('XY plane');
  await dialog.getByRole('textbox', { name: 'Distance' }).fill('30 mm');
  await expect(viewport).toHaveAttribute(
    'data-construction',
    'preview:Offset_Plane1:plane:0,0,30:0,0,1',
    { timeout: 15_000 },
  );
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok');
  await ok(page, dialog);
  await expect(chip(page, 'Offset Plane1')).toBeVisible();
  await expect(viewport).toHaveAttribute('data-construction', 'Offset_Plane1:plane:0,0,30:0,0,1');

  // The browser's Construction folder lists it, with an eye.
  const row = page.locator(`[data-construction="${await constructionId(page)}"]`);
  await expect(row).toContainText('Offset Plane1');
  await page.getByRole('button', { name: 'Hide Offset Plane1' }).click();
  await expect(viewport).not.toHaveAttribute('data-construction', /./);
  await page.getByRole('button', { name: 'Show Offset Plane1' }).click();
  await expect(viewport).toHaveAttribute('data-construction', /Offset_Plane1/);

  // A sketch on it: Create Sketch lists the construction plane beside the origin planes.
  await page.getByRole('button', { name: 'Create Sketch' }).click();
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('group', { name: 'Construction planes' })
    .getByRole('button', { name: 'Offset Plane1' })
    .click();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  await expect(viewport).toHaveAttribute('data-sketch-frames', /:0,0,30:0,0,1$/, {
    timeout: 15_000,
  });
  const map = await mapping(viewport);
  await rectangle(page, map, 0, 0, 20, 10);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();
  await kernelReady(page);
  await expect(chip(page, 'Sketch1')).toHaveAccessibleName('Sketch1');

  // It builds on the plane: the plane can't be deleted while the sketch uses it.
  await page.getByRole('button', { name: 'Offset Plane1', exact: true }).first().focus();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('alert')).toContainText(/Sketch1 uses it/);
  await page.getByRole('button', { name: 'Dismiss' }).click();

  // Its extrude starts at the plane, 30 mm up: 20 × 10 × 8.
  const inside = map(10, 5);
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.click(inside.x, inside.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  const extrude = page.getByRole('region', { name: 'Extrude dialog' });
  await extrude.getByRole('textbox', { name: 'Distance' }).fill('8 mm');
  await expect(extrude).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await ok(page, extrude);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,10,8');

  // Editing the plane moves what is built on it: 30 → 50 mm.
  await chip(page, 'Offset Plane1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Offset Plane1 dialog' });
  await edit.getByRole('textbox', { name: 'Distance' }).fill('50 mm');
  await expect(viewport).toHaveAttribute(
    'data-construction',
    'preview:Offset_Plane1:plane:0,0,50:0,0,1',
    { timeout: 15_000 },
  );
  await ok(page, edit);
  await expect(viewport).toHaveAttribute('data-construction', 'Offset_Plane1:plane:0,0,50:0,0,1');

  // One undo step.
  await page.keyboard.press('Control+z');
  await expect(viewport).toHaveAttribute('data-construction', 'Offset_Plane1:plane:0,0,30:0,0,1');
  await page.keyboard.press('Control+y');
  await expect(viewport).toHaveAttribute('data-construction', 'Offset_Plane1:plane:0,0,50:0,0,1');

  // The extrude hid Sketch1; showing it again draws it on the moved plane.
  await page.getByRole('button', { name: 'Show Sketch1' }).click();
  await expect(viewport).toHaveAttribute('data-sketch-frames', /:0,0,50:0,0,1$/);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,10,8');
});

test('an axis through two construction points is the axis of a revolve', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);

  // Two points on a line parallel to the Y axis, 10 mm to its left: (-10, 0, 0) and (-10, 45, 0).
  const first = await startConstruction(page, 'Point');
  await first.getByRole('textbox', { name: 'X', exact: true }).fill('-10 mm');
  await ok(page, first);
  const second = await startConstruction(page, 'Point');
  await second.getByRole('textbox', { name: 'X', exact: true }).fill('-10 mm');
  await second.getByRole('textbox', { name: 'Y', exact: true }).fill('45 mm');
  await ok(page, second);
  await expect(viewport).toHaveAttribute(
    'data-construction',
    'Point1:point:-10,0,0 Point2:point:-10,45,0',
  );

  // The axis picks the points in the view (Top view, so they are apart).
  await page.keyboard.press('Shift+2');
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  const at = await settledProjector(viewport);
  const axis = await startConstruction(page, 'Axis Through 2 Points', '2-Point Axis');
  await clickAt(page, at, [-10, 0, 0]);
  await clickAt(page, at, [-10, 45, 0]);
  await expect(axis.getByRole('button', { name: 'Points', exact: true })).toHaveText('2 points');
  await expect(viewport).toHaveAttribute(
    'data-construction',
    /Axis_Through_2_Points1:axis:-10,22\.5,0:0,1,0$/,
    {
      timeout: 15_000,
    },
  );
  await ok(page, axis);
  await expect(chip(page, 'Axis Through 2 Points1')).toBeVisible();

  // A ring profile beside it, revolved about the construction axis.
  const map = await newSketchOnXY(page);
  await rectangle(page, map, 10, 0, 30, 20);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);
  const inside = map(20, 10);
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.click(inside.x, inside.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.getByRole('button', { name: 'Revolve', exact: true }).click();
  const revolve = page.getByRole('region', { name: 'Revolve dialog' });
  await expect(revolve.getByRole('button', { name: 'Axis', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // The axis line runs through the view: pick it beside the profile.
  const onAxis = map(-10, 35);
  await page.mouse.move(onAxis.x, onAxis.y);
  await expect.poll(() => attr(viewport, 'data-model-hover')).toMatch(/^axis:/);
  await page.mouse.click(onAxis.x, onAxis.y);
  await expect(revolve.getByRole('button', { name: 'Axis', exact: true })).toHaveText(
    'Axis Through 2 Points1',
  );
  await expect(viewport).toHaveAttribute('data-preview', 'new', { timeout: 15_000 });
  await ok(page, revolve);
  // A ring of radii 20 and 40 about that line: 80 wide, 20 tall (along Y), 80 deep.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:4:80,20,80');
});

/** The feature ID of the first construction row in the browser (its `data-construction`). */
async function constructionId(page: Page): Promise<string> {
  const id = await page
    .locator('aside[aria-label="Browser"] [data-construction]')
    .first()
    .getAttribute('data-construction');
  if (!id) throw new Error('no construction row');
  return id;
}
