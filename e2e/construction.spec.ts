import { expect, type Locator, type Page, test } from '@playwright/test';
import { clickEdge, clickWhere, primitive } from './benchmark-helpers';
import {
  clicker,
  kernelReady,
  mapping,
  newSketchOnXY,
  openProject,
  pickTool,
  projector,
} from './helpers';

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

/** Runs a Construct tab tool from its tile or its group's menu, and waits for its dialog. */
async function startConstruction(page: Page, label: string) {
  await pickTool(page, label);
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
  await pickTool(page, 'Create Sketch');
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
  await pickTool(page, 'Extrude');
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
  const axis = await startConstruction(page, 'Axis Through 2 Points');
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
  await pickTool(page, 'Revolve');
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

/** A manipulator handle's centre in page px. */
async function handleAt(viewport: Locator, field: string) {
  const circle = viewport.locator(`[data-manipulator-handle="${field}"]`);
  const box = await viewport.boundingBox();
  const cx = Number(await circle.getAttribute('cx'));
  const cy = Number(await circle.getAttribute('cy'));
  return { x: (box?.x ?? 0) + cx, y: (box?.y ?? 0) + cy };
}

/** Presses on a handle and drags it by a page-pixel offset. */
async function dragHandle(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

// P4-12: the construction backlog. A point on a box edge with its handle, a
// plane along a sketch line, an angled midplane from two faces, and a box
// selection that takes a construction plane.

test('a point on a box edge, dragged along the edge with its handle', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Box', { Length: '40 mm', Width: '20 mm', Height: '10 mm' });
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:40,20,10');
  await page.keyboard.press('Shift+1');
  const at = await settledProjector(viewport);

  const dialog = await startConstruction(page, 'Point on Path');
  // The bottom front edge runs along X at y = −10, z = 0: its midpoint is the origin.
  await clickEdge(page, at, [0, -10, 0]);
  await expect(viewport).toHaveAttribute('data-construction', /Point_on_Path1:point:0,-10,0$/, {
    timeout: 15_000,
  });

  // The handle sits on the edge; dragging it along the edge changes Position.
  const field = dialog.getByRole('textbox', { name: 'Position', exact: true });
  await expect(field).toHaveValue('0.5');
  const from = await handleAt(viewport, 'position');
  const a0 = at([-15, -10, 0]);
  const a1 = at([15, -10, 0]);
  await dragHandle(page, from, (a1.x - a0.x) * 0.5, (a1.y - a0.y) * 0.5);
  await field.blur();
  const moved = Number(await field.inputValue());
  expect(moved).not.toBe(0.5);
  expect(moved).toBeGreaterThanOrEqual(0);
  expect(moved).toBeLessThanOrEqual(1);
  await expect(viewport).toHaveAttribute('data-construction', /Point_on_Path1:point:/);
  await ok(page, dialog);
  await expect(viewport).toHaveAttribute('data-construction', /Point_on_Path1:point:/);
});

test('a plane along a sketch arc is square to its tangent', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  const map = await newSketchOnXY(page);
  const click = clicker(page, map);
  // A 3-point arc from (0, 0) over (20, 20) to (40, 0): a half circle of radius 20
  // centred at (20, 0), its middle at (20, 20).
  await page.keyboard.press('a');
  await click(0, 0);
  await click(40, 0);
  await click(20, 20);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);

  await page.keyboard.press('Shift+1');
  const at = await settledProjector(viewport);
  const dialog = await startConstruction(page, 'Plane Along Path');
  // The arc's middle is its top, (20, 20): the plane is x = 20 and its normal is
  // the tangent there (±X).
  await clickWhere(page, at, [20, 20, 0], /^sketchEntity:/);
  await expect(viewport).toHaveAttribute(
    'data-construction',
    /preview:Plane_Along_Path1:plane:20,0,0:(-?1,0,0)$/,
    { timeout: 15_000 },
  );
  await ok(page, dialog);
  await expect(viewport).toHaveAttribute(
    'data-construction',
    /Plane_Along_Path1:plane:20,0,0:(-?1,0,0)$/,
  );
});

test('a point at an intersection picks two edges in the view (M1)', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  // A 20 mm cube, x and y ±10, z 0…20.
  await primitive(page, 'Box', { Length: '20 mm', Width: '20 mm', Height: '20 mm' });
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
  await page.keyboard.press('Shift+1');
  const at = await settledProjector(viewport);

  const dialog = await startConstruction(page, 'Point at Intersection');
  // The top-front edge (along X at y = −10, z = 20) and the front-right vertical
  // edge (x = 10, y = −10) meet at (10, −10, 20). The field takes edges, so the
  // model picker picks them (before M1 the plane picker made an edge unpickable).
  await clickEdge(page, at, [0, -10, 20]);
  await clickEdge(page, at, [10, -10, 10]);
  await expect(dialog.getByRole('button', { name: 'Entities', exact: true })).toHaveText('2 edges');
  await expect(viewport).toHaveAttribute(
    'data-construction',
    /preview:Point_at_Intersection1:point:10,-10,20$/,
    { timeout: 15_000 },
  );
  await ok(page, dialog);
  await expect(viewport).toHaveAttribute(
    'data-construction',
    'Point_at_Intersection1:point:10,-10,20',
  );
});

test('a point where a box edge meets a cylinder wall (an edge and a curved face)', async ({
  page,
}) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Cylinder', { Diameter: '20 mm', Height: '20 mm' });
  await primitive(page, 'Box', { Length: '40 mm', Width: '4 mm', Height: '10 mm', X: '15 mm' });
  await page.keyboard.press('Shift+1');
  const at = await settledProjector(viewport);

  const dialog = await startConstruction(page, 'Point at Intersection');
  // The box's front top edge runs along X at y = −2, z = 10 and crosses the cylinder's
  // wall at x = √96 ≈ 9.8.
  await clickEdge(page, at, [15, -2, 10]);
  await clickWhere(page, at, [10 * 0.707, -10 * 0.707, 15], /^face:/);
  await expect(dialog.getByRole('button', { name: 'Entities', exact: true })).toHaveText(/edge/);
  await expect(viewport).toHaveAttribute(
    'data-construction',
    /preview:Point_at_Intersection1:point:9\.798,-2,10$/,
    { timeout: 15_000 },
  );
  await ok(page, dialog);
  await expect(viewport).toHaveAttribute(
    'data-construction',
    'Point_at_Intersection1:point:9.798,-2,10',
  );
});

test('an angled midplane bisects two faces at 45°', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Box', { Length: '40 mm', Width: '20 mm', Height: '20 mm' });
  await page.keyboard.press('Shift+1');
  const at = await settledProjector(viewport);

  const dialog = await startConstruction(page, 'Angled Midplane');
  // A Plane field picks like Create Sketch (no `data-model-hover`): click the faces.
  await clickAt(page, at, [0, -10, 10]); // front, normal −Y
  await clickAt(page, at, [0, 0, 20]); // top, normal +Z
  await expect(viewport).toHaveAttribute(
    'data-construction',
    /preview:Angled_Midplane1:plane:[^:]*:0,-0\.707,0\.707$/,
    { timeout: 15_000 },
  );
  await ok(page, dialog);
  await expect(viewport).toHaveAttribute(
    'data-construction',
    /Angled_Midplane1:plane:[^:]*:0,-0\.707,0\.707/,
  );
});

test('a box selection takes a construction plane', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  const at0 = await settledProjector(viewport);
  const halfPlane = Number(await viewport.getAttribute('data-camera-size')) * 0.16;

  const plane = await startConstruction(page, 'Offset Plane');
  await clickAt(page, at0, [halfPlane * 0.5, -halfPlane * 0.5, 0]);
  await expect(plane.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
  await plane.getByRole('textbox', { name: 'Distance' }).fill('30 mm');
  await ok(page, plane);
  const id = await constructionId(page);

  // The top view: the plane's square lies face-on around the origin.
  await page.keyboard.press('Shift+2');
  const at = await settledProjector(viewport);
  const span = halfPlane * 1.2;
  const from = at([-span, -span, 30]);
  const to = at([span, span, 30]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect(viewport).toHaveAttribute('data-model-selection', new RegExp(`plane:${id}`));
});
