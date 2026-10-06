import { expect, type Locator, type Page, test } from '@playwright/test';
import { kernelReady, openProject, pickTool, projector } from './helpers';

// P2-10: Box, Cylinder, Sphere and Torus (ADR-0032). Each opens on the XY
// plane, can be moved to another origin plane or a body's face (picked in
// the view like Create Sketch's plane), previews live, and commits one undo
// step; editing one recomputes it; on a face they join or cut.

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

/** Opens a primitive's dialog from Solid › Create and waits for its first preview. */
async function start(page: Page, label: string) {
  await pickTool(page, label);
  const dialog = page.getByRole('region', { name: `${label} dialog` });
  await expect(dialog).toBeVisible();
  await expect(viewportOf(page)).toHaveAttribute('data-preview', /./, { timeout: 15_000 });
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok');
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

/** Half the side of an origin plane's square in mm (`PLANE_HALF` of the view size). */
async function planeHalf(viewport: Locator) {
  return Number(await viewport.getAttribute('data-camera-size')) * 0.16;
}

/** Clicks a world point in the view (a plane or a face while a Plane field takes picks). */
async function clickAt(
  page: Page,
  at: (p: [number, number, number]) => { x: number; y: number },
  p: [number, number, number],
) {
  const { x, y } = at(p);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
}

/** A dialog's number field as a plain number (mm), read blurred. */
async function numberOf(dialog: Locator, name: string) {
  const field = dialog.getByRole('textbox', { name, exact: true });
  await field.blur();
  return Number((await field.inputValue()).replace(/[^\d.-]/g, ''));
}

/** A manipulator handle's centre in page px. */
async function handle(viewport: Locator, field: string) {
  const circle = viewport.locator(`[data-manipulator-handle="${field}"]`);
  const box = await viewport.boundingBox();
  return {
    x: (box?.x ?? 0) + Number(await circle.getAttribute('cx')),
    y: (box?.y ?? 0) + Number(await circle.getAttribute('cy')),
  };
}

test('places a box, a cylinder, a sphere and a torus on the origin planes', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  // The home view looks from +X, −Y, +Z: points with x ≥ 0, y ≤ 0, z ≥ 0 of a
  // plane's square have no other plane in front of them.
  const at = await settledProjector(viewport);
  const h = await planeHalf(viewport);

  // A cylinder on XZ, picked in the view: it grows towards −Y, the XZ plane's normal.
  const cylinder = await start(page, 'Cylinder');
  const plane = cylinder.getByRole('button', { name: 'Plane', exact: true });
  await expect(plane).toHaveText('XY plane');
  await clickAt(page, at, [h * 0.6, 0, h * 0.6]);
  await expect(plane).toHaveText('XZ plane');
  await cylinder.getByRole('textbox', { name: 'X', exact: true }).fill('-40 mm');
  await cylinder.getByRole('textbox', { name: 'Diameter' }).fill('10 mm');
  await expect(cylinder).toHaveAttribute('data-preview-status', 'ok');
  await ok(page, cylinder);
  await expect(chip(page, 'Cylinder1')).toBeVisible();
  await expect(viewport).toHaveAttribute('data-bodies', /^Body1:3:10,20,10$/);

  // A sphere on YZ, off to the side along the plane's X (world Y).
  const sphere = await start(page, 'Sphere');
  await clickAt(page, at, [0, -h * 0.6, h * 0.6]);
  await expect(sphere.getByRole('button', { name: 'Plane', exact: true })).toHaveText('YZ plane');
  await sphere.getByRole('textbox', { name: 'X', exact: true }).fill('-60 mm');
  await ok(page, sphere);

  // A torus on XY, lifted.
  const torus = await start(page, 'Torus');
  await torus.getByRole('textbox', { name: 'Offset' }).fill('40 mm');
  await ok(page, torus);

  // A box on XY, centred on the origin.
  const box = await start(page, 'Box');
  await expect(box.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
  await expect(box.getByRole('textbox', { name: 'Length' })).toHaveValue('20 mm');
  await expect(box.getByRole('combobox', { name: 'Operation' })).toHaveValue('new-body');
  await expect(viewport).toHaveAttribute('data-preview', 'new');
  await expect(viewport.locator('[data-manipulators]')).toHaveAttribute(
    'data-manipulators',
    'distance:length distance:width distance:height angle:rotation distance:x distance:y distance:offset',
  );
  await box.getByRole('textbox', { name: 'Length' }).fill('40 mm');
  await page.screenshot({ path: test.info().outputPath('box-preview.png') });
  await ok(page, box);
  await expect(chip(page, 'Box1')).toBeVisible();
  const bodies = (await viewport.getAttribute('data-bodies')) ?? '';
  expect(bodies.split(' ').map((b) => b.split(':').slice(0, 2).join(':'))).toEqual([
    'Body1:3',
    'Body2:1',
    'Body3:1',
    'Body4:6',
  ]);
  expect(bodies).toMatch(/ Body4:6:40,20,20$/);
  await page.screenshot({ path: test.info().outputPath('four.png') });

  // One undo step each.
  await page.keyboard.press('Control+z');
  await expect(chip(page, 'Box1')).toHaveCount(0);
  await expect(viewport).toHaveAttribute('data-bodies', /Body3:1:\S+$/);
});

test('a torus stands on edge and rests on the plane (P4-12)', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);

  // Axis X stands the ring on edge; Seat "On the plane" rests it on XY.
  const torus = await start(page, 'Torus');
  await torus.getByRole('combobox', { name: 'Axis' }).selectOption('x');
  await torus.getByRole('combobox', { name: 'Seat' }).selectOption('plane');
  await expect(torus).toHaveAttribute('data-preview-status', 'ok');
  await ok(page, torus);
  // One face: tube across X, the ring's diameter + tube across Y and up Z.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:1:10,50,50');
});

test('sits on a body’s face, joins and cuts, and follows the face when the body is edited', async ({
  page,
}) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  const at = await settledProjector(viewport);

  // A 20 mm cube on XY: x and y −10…10, z 0…20.
  await ok(page, await start(page, 'Box'));
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');

  // A cylinder on its top face: the dialog takes the face, centres on it and proposes Join.
  const cylinder = await start(page, 'Cylinder');
  await clickAt(page, at, [5, -5, 20]);
  const plane = cylinder.getByRole('button', { name: 'Plane', exact: true });
  await expect(plane).toHaveText('1 face');
  await expect(cylinder.getByRole('combobox', { name: 'Operation' })).toHaveValue('join');
  // The click places the cylinder where it was made (P4-12), not at the face's centre.
  // (A face click lands within a millimetre of the projected point in this view.)
  await expect.poll(async () => Math.abs((await numberOf(cylinder, 'X')) - 5)).toBeLessThan(1.5);
  await cylinder.getByRole('textbox', { name: 'X', exact: true }).fill('0 mm');
  await cylinder.getByRole('textbox', { name: 'Y', exact: true }).fill('0 mm');
  await cylinder.getByRole('textbox', { name: 'Diameter' }).fill('10 mm');
  await cylinder.getByRole('textbox', { name: 'Height' }).fill('10 mm');
  await expect(viewport).toHaveAttribute('data-preview', 'join', { timeout: 15_000 });
  await expect(cylinder).toHaveAttribute('data-preview-status', 'ok');
  await page.screenshot({ path: test.info().outputPath('join-preview.png') });
  await ok(page, cylinder);
  // One body: the cube and the peg on it.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:8:20,20,30');

  // A box pushed into the front wall (a negative height) proposes Cut.
  const pocket = await start(page, 'Box');
  await clickAt(page, at, [5, -10, 10]);
  await expect(pocket.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
  await expect(pocket.getByRole('combobox', { name: 'Operation' })).toHaveValue('join');
  for (const [field, value] of [
    ['Length', '6 mm'],
    ['Width', '6 mm'],
    ['Height', '-4 mm'],
  ] as const) {
    await pocket.getByRole('textbox', { name: field, exact: true }).fill(value);
  }
  await expect(pocket.getByRole('combobox', { name: 'Operation' })).toHaveValue('cut');
  await expect(viewport).toHaveAttribute('data-preview', 'cut', { timeout: 15_000 });
  await expect(pocket).toHaveAttribute('data-preview-status', 'ok');
  await ok(page, pocket);
  // The pocket adds a floor and four walls; the body keeps its size.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:13:20,20,30');
  await expect(chip(page, 'Box2')).toBeVisible();

  // Taller cube: the cylinder rides up with the top face, the pocket stays in the wall.
  await chip(page, 'Box1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Box1 dialog' });
  await expect(edit).toHaveAttribute('data-dialog-mode', 'edit');
  await expect(edit.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
  const height = edit.getByRole('textbox', { name: 'Height' });
  await height.fill('35 mm');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await height.press('Enter');
  await expect(edit).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:13:20,20,45');
  await expect(page.getByRole('status', { name: 'Kernel' })).not.toContainText('error');
  await page.screenshot({ path: test.info().outputPath('edited.png') });

  // Editing the cylinder keeps its face and its choices.
  await chip(page, 'Cylinder1').dblclick();
  const again = page.getByRole('region', { name: 'Edit Cylinder1 dialog' });
  await expect(again.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
  await expect(again.getByRole('combobox', { name: 'Operation' })).toHaveValue('join');
  await again.getByRole('textbox', { name: 'Height' }).fill('5 mm');
  await expect(again).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await ok(page, again);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:13:20,20,40');

  // Undo goes back one edit at a time.
  await page.keyboard.press('Control+z');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:13:20,20,45');
  await page.keyboard.press('Control+z');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:13:20,20,30');
});

test('a click on the picked plane places the primitive, and the X handle drags it', async ({
  page,
}) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  const at = await settledProjector(viewport);
  const h = await planeHalf(viewport);

  const box = await start(page, 'Box');
  // The plane field is picking: a click on the XY plane's square sets X and Y to that point.
  await clickAt(page, at, [h * 0.5, -h * 0.5, 0]);
  await expect(box.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
  await expect.poll(() => numberOf(box, 'X')).toBeCloseTo(h * 0.5, 0);
  expect(await numberOf(box, 'Y')).toBeCloseTo(-h * 0.5, 0);
  await expect(box).toHaveAttribute('data-preview-status', 'ok');

  // The position handles are listed with the size handles.
  await expect(viewport.locator('[data-manipulators]')).toHaveAttribute(
    'data-manipulators',
    /distance:x distance:y distance:offset/,
  );
  // Drag the X handle 20 mm along the plane's X: the field follows (it snaps, so a little off).
  const head = await handle(viewport, 'x');
  const from = at([h * 0.5, 0, 0]);
  const to = at([h * 0.5 + 20, 0, 0]);
  // A head that lands on another is lifted off it, 14 px up (the overlay does that).
  expect(Math.hypot(head.x - from.x, head.y - from.y)).toBeLessThan(20);
  await page.mouse.move(head.x, head.y);
  await page.mouse.down();
  await page.mouse.move((head.x + to.x) / 2, (head.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => numberOf(box, 'X')).toBeCloseTo(h * 0.5 + 20, 0);
  await expect(box).toHaveAttribute('data-preview-status', 'ok');
  await ok(page, box);
  const body = ((await viewport.getAttribute('data-bodies')) ?? '').split(' ').pop();
  expect(body).toMatch(/:20,20,20$/);
  // Clicking the view while the dialog is closed does nothing new.
  await page.keyboard.press('Control+z');
  await expect(chip(page, 'Box1')).toHaveCount(0);
});

test('a box from two corners: the next two clicks on its plane, Esc disarms', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  const at = await settledProjector(viewport);
  const h = await planeHalf(viewport);

  const box = await start(page, 'Box');
  const button = box.getByRole('button', { name: /^(Two corners|Picking corners)/ });
  const state = box.locator('[data-corners]');
  await expect(state).toHaveAttribute('data-corners', 'off');

  // Esc disarms it and leaves the dialog open.
  await button.click();
  await expect(state).toHaveAttribute('data-corners', '0');
  await clickAt(page, at, [h * 0.2, -h * 0.2, 0]);
  await expect(state).toHaveAttribute('data-corners', '1');
  await button.focus();
  await page.keyboard.press('Escape');
  await expect(state).toHaveAttribute('data-corners', 'off');
  await expect(box).toBeVisible();

  // Armed again: two corners, opposite, in the order that is not lower-left first.
  const a = [h * 0.5, -h * 0.5] as const;
  const b = [h * 0.2, -h * 0.2] as const;
  await box.getByRole('textbox', { name: 'Height', exact: true }).fill('7 mm');
  await button.click();
  await clickAt(page, at, [a[0], a[1], 0]);
  await expect(state).toHaveAttribute('data-corners', '1');
  await clickAt(page, at, [b[0], b[1], 0]);
  await expect(state).toHaveAttribute('data-corners', 'off');
  const tol = 0;
  await expect.poll(() => numberOf(box, 'Length')).toBeCloseTo(Math.abs(a[0] - b[0]), tol);
  expect(await numberOf(box, 'Width')).toBeCloseTo(Math.abs(a[1] - b[1]), tol);
  expect(await numberOf(box, 'X')).toBeCloseTo((a[0] + b[0]) / 2, tol);
  expect(await numberOf(box, 'Y')).toBeCloseTo((a[1] + b[1]) / 2, tol);
  // The height stays what it was; the plane stays XY.
  expect(await numberOf(box, 'Height')).toBe(7);
  await expect(box.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
  await expect(box).toHaveAttribute('data-preview-status', 'ok');
  const length = await numberOf(box, 'Length');
  const width = await numberOf(box, 'Width');
  await ok(page, box);
  const size = ((await viewport.getAttribute('data-bodies')) ?? '').split(' ').pop() ?? '';
  const [sx, sy, sz] = size.split(':')[2]?.split(',').map(Number) ?? [];
  expect(sx).toBeCloseTo(length, 1);
  expect(sy).toBeCloseTo(width, 1);
  expect(sz).toBe(7);
});
