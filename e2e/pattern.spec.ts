import { expect, type Locator, type Page, test } from '@playwright/test';
import { meshBounds } from '../packages/io/src/index';
import {
  exportModel,
  fill,
  objectsOf3mf,
  selectBodies,
  solidFacts,
  solidTab,
  zoomOutTo,
} from './benchmark-helpers';
import { kernelReady, openProject, pickTool, projector } from './helpers';

// P3-07: patterns (ADR-0047, FR-FT-11). A rectangular pattern of a body along
// a picked axis; a circular pattern of a feature (a hole cut) about the Z axis;
// a path pattern along a picked edge; and Mirror's features mode. Positions and
// volumes are read back from the 3MF export.

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

type At = Awaited<ReturnType<typeof settledProjector>>;

/** A Box-tool body: 20 mm cube on XY centred on the origin unless the fields say otherwise. */
async function box(page: Page, fields: Record<string, string> = {}) {
  await pickTool(page, 'Box');
  const dialog = page.getByRole('region', { name: 'Box dialog' });
  await expect(dialog).toBeVisible();
  for (const [name, value] of Object.entries(fields)) {
    await dialog.getByRole('textbox', { name, exact: true }).fill(value);
  }
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
}

/** A cylinder that cuts a hole through the cube: 4 mm across at (x, 0), 20 mm tall from the XY plane. */
async function hole(page: Page, x: number) {
  await pickTool(page, 'Cylinder');
  const dialog = page.getByRole('region', { name: 'Cylinder dialog' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Diameter', exact: true }).fill('4 mm');
  await dialog.getByRole('textbox', { name: 'X', exact: true }).fill(`${x} mm`);
  await dialog.getByRole('combobox', { name: 'Operation' }).selectOption('cut');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
}

/** Opens a pattern or mirror dialog from the Create menu or the Transform group. */
async function openDialog(page: Page, tool: string, region: string, create = true) {
  if (create) await pickTool(page, tool);
  else await page.getByRole('button', { name: tool, exact: true }).click();
  const dialog = page.getByRole('region', { name: region });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function ok(page: Page, dialog: Locator) {
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
}

/** Hovers points along an origin axis until the view reports it, then clicks. */
async function pickAxis(page: Page, at: At, axis: 'x' | 'y' | 'z', along: number[]) {
  const viewport = viewportOf(page);
  for (const t of along) {
    const p = at(axis === 'x' ? [t, 0, 0] : axis === 'y' ? [0, t, 0] : [0, 0, t]);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(150);
    if ((await viewport.getAttribute('data-model-hover')) === `axis:origin:${axis}`) {
      await page.mouse.click(p.x, p.y);
      return;
    }
  }
  throw new Error(`no point of the ${axis} axis can be picked`);
}

/** Every body's box and volume in the 3MF export, by name. */
async function measured(page: Page) {
  const file = await exportModel(page, '3MF');
  await page
    .getByRole('tablist', { name: 'Toolbar tabs' })
    .getByRole('tab', { name: 'Solid' })
    .click();
  const out: Record<string, { min: number[]; max: number[]; volume: number }> = {};
  for (const object of objectsOf3mf(file)) {
    const box = meshBounds(object.mesh);
    if (!box) throw new Error(`${object.name} is empty`);
    out[object.name] = {
      min: box.min.map((v) => Math.round(v * 100) / 100),
      max: box.max.map((v) => Math.round(v * 100) / 100),
      volume: solidFacts(object.mesh).volume,
    };
  }
  return out;
}

const CYLINDER_VOLUME = Math.PI * 2 * 2 * 20;

test('copies a body along a picked axis: a rectangular pattern', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await box(page);
  await page.keyboard.press('Shift+1');
  const at = await settledProjector(viewport);

  await selectBodies(page, ['Body1']);
  const dialog = await openDialog(page, 'Rectangular Pattern', 'Rectangular Pattern dialog');
  // The picked body is in, and the direction is the next thing to pick: the X axis.
  await expect(dialog.getByRole('button', { name: 'Bodies', exact: true })).toHaveText('Body1');
  await dialog.getByRole('button', { name: 'Direction', exact: true }).click();
  await pickAxis(page, at, 'x', [25, 30, 35, -25, -30, -35]);
  await expect(dialog.getByRole('button', { name: 'Direction', exact: true })).toHaveText('X axis');

  await dialog.getByRole('textbox', { name: 'Count', exact: true }).fill('3');
  await dialog.getByRole('textbox', { name: 'Distance', exact: true }).fill('30 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  // Two copies drawn over the model.
  await expect(viewport).toHaveAttribute('data-preview', 'new new');
  // A distance arrow for the direction, a count handle on its last instance and a
  // dot per instance (P4-12), each kind and field listed once.
  await expect(viewport.locator('[data-manipulators]')).toHaveAttribute(
    'data-manipulators',
    'distance:distance1 count:count1 toggle:skip',
  );
  await expect(viewport.locator('[data-instance-toggle]')).toHaveCount(2);
  await ok(page, dialog);

  await expect(chip(page, 'Rectangular Pattern1')).toBeVisible();
  await expect(viewport).toHaveAttribute(
    'data-bodies',
    'Body1:6:20,20,20 Body2:6:20,20,20 Body3:6:20,20,20',
  );
  const bodies = await measured(page);
  expect(Object.values(bodies).map((b) => b.min[0])).toEqual([-10, 20, 50]);
  for (const body of Object.values(bodies)) expect(body.volume).toBeCloseTo(8000, 0);

  // Editing the pattern keeps its fields and makes more instances; the earlier ones stay.
  await chip(page, 'Rectangular Pattern1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Rectangular Pattern1 dialog' });
  await expect(edit.getByRole('textbox', { name: 'Count', exact: true })).toHaveValue('3');
  await expect(edit.getByRole('button', { name: 'Direction', exact: true })).toHaveText('X axis');
  await edit.getByRole('textbox', { name: 'Count', exact: true }).fill('4');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await ok(page, edit);
  await expect(viewport).toHaveAttribute(
    'data-bodies',
    'Body1:6:20,20,20 Body2:6:20,20,20 Body3:6:20,20,20 Body4:6:20,20,20',
  );

  // One undo step for the pattern, one for the edit.
  await page.keyboard.press('Control+z');
  await kernelReady(page);
  await page.keyboard.press('Control+z');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
});

test('repeats a hole about the Z axis: a circular pattern of a feature', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await box(page);
  await hole(page, 6);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:20,20,20');
  await page.keyboard.press('Shift+1');
  const at = await settledProjector(viewport);

  const dialog = await openDialog(page, 'Circular Pattern', 'Circular Pattern dialog');
  await dialog.getByRole('combobox', { name: 'Pattern' }).selectOption('features');
  // Only features that join or cut are listed: the hole.
  await expect(dialog.getByRole('list', { name: 'Features' }).getByRole('checkbox')).toHaveCount(1);
  await dialog.getByRole('checkbox', { name: /^Cylinder1/ }).check();
  await dialog.getByRole('button', { name: 'Axis', exact: true }).click();
  // The Z axis above the cube.
  await pickAxis(page, at, 'z', [30, 35, 40, 45, 25]);
  await expect(dialog.getByRole('button', { name: 'Axis', exact: true })).toHaveText('Z axis');
  await dialog.getByRole('textbox', { name: 'Count', exact: true }).fill('4');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  // The hole's tool, repeated, drawn as a cut.
  await expect(viewport).toHaveAttribute('data-preview', 'cut');
  await expect(viewport.locator('[data-manipulators]')).toHaveAttribute(
    'data-manipulators',
    'angle:angle count:count toggle:skip',
  );
  await expect(viewport.locator('[data-instance-toggle]')).toHaveCount(3);
  await ok(page, dialog);

  await expect(chip(page, 'Circular Pattern1')).toBeVisible();
  // Four holes: the cube's six faces and four cylinders.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:10:20,20,20');
  const bodies = await measured(page);
  expect(bodies.Body1?.volume).toBeCloseTo(8000 - 4 * CYLINDER_VOLUME, -1);

  // Editing lists the same feature, ticked.
  await chip(page, 'Circular Pattern1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Circular Pattern1 dialog' });
  await expect(edit.getByRole('checkbox', { name: /^Cylinder1/ })).toBeChecked();
  await expect(edit.getByRole('button', { name: 'Axis', exact: true })).toHaveText('Z axis');
  await page.keyboard.press('Escape');
  await expect(edit).toBeHidden();
});

test('places copies along a picked edge: a path pattern', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await box(page);
  // A 4 mm cube in front of the big one, away from its edge.
  await box(page, { Length: '4 mm', Width: '4 mm', Height: '4 mm', Y: '-40 mm' });
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20 Body2:6:4,4,4');
  await page.keyboard.press('Shift+1');
  let at = await settledProjector(viewport);

  await selectBodies(page, ['Body2']);
  const dialog = await openDialog(page, 'Path Pattern', 'Path Pattern dialog');
  await dialog.getByRole('button', { name: 'Path', exact: true }).click();
  // The cube's top front edge, running along X.
  const { x, y } = at([0, -10, 20]);
  await page.mouse.move(x, y + 2);
  await expect.poll(() => viewport.getAttribute('data-model-hover')).toMatch(/^edge:/);
  await page.mouse.click(x, y + 2);
  await expect(dialog.getByRole('button', { name: 'Path', exact: true })).toHaveText('1 edge');
  await dialog.getByRole('textbox', { name: 'Count', exact: true }).fill('3');
  await dialog.getByRole('textbox', { name: 'Distance', exact: true }).fill('5 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  // P4-12: a distance handle at the last instance, along the path's tangent there.
  await expect(viewport.locator('[data-manipulators]')).toHaveAttribute(
    'data-manipulators',
    'distance:distance toggle:skip',
  );
  await ok(page, dialog);

  await expect(chip(page, 'Path Pattern1')).toBeVisible();
  const bodies = await measured(page);
  expect(Object.keys(bodies)).toHaveLength(4);
  // Body2 was centred on x = 0; the copies step 5 and 10 mm along the edge, whichever way it runs.
  const mins = [bodies.Body2, bodies.Body3, bodies.Body4]
    .map((b) => b?.min[0] as number)
    .sort((a, b) => a - b);
  const forward = [-2, 3, 8];
  const backward = [-12, -7, -2];
  expect([forward, backward]).toContainEqual(mins);
  // The copies are all still 4 mm cubes on the same line in y.
  for (const b of [bodies.Body2, bodies.Body3, bodies.Body4]) expect(b?.min[1]).toBeCloseTo(-42, 1);

  // Editing the pattern, the distance handle closes the run up: 2 mm between the copies.
  await solidTab(page);
  await chip(page, 'Path Pattern1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Path Pattern1 dialog' });
  const handle = viewport.locator('[data-manipulator-handle="distance"]');
  await expect(handle).toBeVisible();
  // Zoom out so the whole run is inside the view, then read where the path is.
  const frame = await viewBox(page);
  await zoomOutTo(page, { x: frame.width / 2, y: frame.height / 2 }, 90);
  at = await settledProjector(viewport);
  const distance = edit.getByRole('textbox', { name: 'Distance', exact: true });
  // The handle spans the whole run (two steps of the 5 mm distance), so a drag to 4 mm
  // along the path from the body's centre is 2 mm between the copies. The shaft runs
  // through that centre, at z = 2 on a 4 mm cube, and the path runs one way or the
  // other along X: try both and keep the one that took.
  for (const along of [1, -1]) {
    await dragHandle(page, handle, at([along * 4, -40, 2]));
    if ((await distance.inputValue()) === '2 mm') break;
  }
  await expect(distance).toHaveValue('2 mm');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await ok(page, edit);
  const closed = await measured(page);
  const steps = [closed.Body2, closed.Body3, closed.Body4]
    .map((b) => b?.min[0] as number)
    .sort((a, b) => a - b);
  const gaps = [
    (steps[1] as number) - (steps[0] as number),
    (steps[2] as number) - (steps[1] as number),
  ];
  expect(Math.max(...gaps)).toBeLessThan(4);
});

test('mirrors a hole to the other side of a plane: Mirror in features mode', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await box(page);
  await hole(page, 5);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:20,20,20');
  const at = await settledProjector(viewport);
  const half = Number(await viewport.getAttribute('data-camera-size')) * 0.16;

  const dialog = await openDialog(page, 'Mirror', 'Mirror dialog', false);
  await dialog.getByRole('combobox', { name: 'Mirror' }).selectOption('features');
  await dialog.getByRole('checkbox', { name: /^Cylinder1/ }).check();
  // Copy and Join are about bodies.
  await expect(dialog.getByRole('checkbox', { name: 'Copy' })).toHaveCount(0);
  const plane = dialog.getByRole('button', { name: 'Plane', exact: true });
  await plane.click();
  // The YZ plane's square: the first point on it that no body is in front of.
  for (const [y, z] of [
    [-0.9, 0.9],
    [-0.9, 0.5],
    [-0.5, 0.9],
    [-0.7, 0.7],
    [-0.95, 0.2],
  ] as const) {
    const p = at([0, y * half, z * half]);
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
    if ((await plane.textContent()) === 'YZ plane') break;
    if ((await plane.textContent()) !== 'Pick a plane or flat face') {
      await dialog.getByRole('button', { name: 'Clear Plane' }).click();
    }
  }
  await expect(plane).toHaveText('YZ plane');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await ok(page, dialog);

  await expect(chip(page, 'Mirror1')).toBeVisible();
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:8:20,20,20');
  const bodies = await measured(page);
  expect(bodies.Body1?.volume).toBeCloseTo(8000 - 2 * CYLINDER_VOLUME, -1);
});

// P4-12: skipping instances, count handles and the path's distance handle.
// The dots and the handles read the layout the kernel reports, so these are
// about the whole path: a preview with a ghost in it, a drag that changes a
// count, and the volumes an instance list leaves out.

/** The viewport's box, with the width and height the checks below want. */
async function viewBox(page: Page) {
  return (await viewportOf(page).boundingBox()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Drags a handle of the dialog overlay (its `cx`/`cy` are px in the viewport) to
 * the page point `to`, in four steps, the way the app's own gizmo drags read.
 */
async function dragHandle(page: Page, handle: Locator, to: { x: number; y: number }) {
  const { cx, cy } = (await handle.evaluate((el) => ({
    cx: Number(el.getAttribute('cx')),
    cy: Number(el.getAttribute('cy')),
  }))) as { cx: number; cy: number };
  const box = await viewBox(page);
  const from = { x: box.x + cx, y: box.y + cy };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let k = 1; k <= 4; k++) {
    await page.mouse.move(from.x + ((to.x - from.x) * k) / 4, from.y + ((to.y - from.y) * k) / 4);
  }
  await page.mouse.up();
}

test('leaves instances out: a rectangular pattern of a cut, 3 × 2 (P4-12)', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await box(page, { Length: '40 mm', Width: '40 mm', Height: '20 mm' });
  await hole(page, -12);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:40,40,20');
  await page.keyboard.press('Shift+1');
  const at = await settledProjector(viewport);

  const dialog = await openDialog(page, 'Rectangular Pattern', 'Rectangular Pattern dialog');
  await dialog.getByRole('combobox', { name: 'Pattern' }).selectOption('features');
  await dialog.getByRole('checkbox', { name: /^Cylinder1/ }).check();
  await dialog.getByRole('button', { name: 'Direction', exact: true }).click();
  await pickAxis(page, at, 'x', [35, 40, 45, -35, -40, -45]);
  await dialog.getByRole('button', { name: 'Direction 2', exact: true }).click();
  await pickAxis(page, at, 'y', [35, 40, 45, -35, -40, -45]);
  await fill(dialog, { Count: '3', Distance: '12 mm', 'Count 2': '2', 'Distance 2': '12 mm' });
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  // Six instances, one dot each, and nothing skipped yet.
  await expect(viewport).toHaveAttribute('data-preview', 'cut');
  await expect(viewport.locator('[data-instance-toggle]')).toHaveCount(5);
  await expect(dialog.locator('[data-labels="skip"]')).toHaveText('None');

  // Instance 1x1 is the hole 12 mm along X and 12 mm along Y: its centre.
  const dot = viewport.locator('[data-instance-toggle="1x1"]');
  const { x, y } = at([0, 12, 10]);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  // The instance is left out, so its ghost joins the cut in the preview.
  await expect(viewport).toHaveAttribute('data-preview', 'cut skip');
  await expect(dialog.locator('[data-labels="skip"]')).toHaveText('1x1');
  await expect(dot).toHaveAttribute('data-skipped', 'true');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });

  await ok(page, dialog);
  // Five holes in the plate: its six faces and five cylinders.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:11:40,40,20');
  const bodies = await measured(page);
  expect(bodies.Body1?.volume).toBeCloseTo(40 * 40 * 20 - 5 * CYLINDER_VOLUME, -1);

  // One undo step takes the pattern and its skip away together.
  await page.keyboard.press('Control+z');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:40,40,20');
  await expect(viewport.locator('[data-instance-toggle]')).toHaveCount(0);
});

test('drags a count handle: two spacings make two more instances (P4-12)', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await box(page);
  await page.keyboard.press('Shift+1');
  let at = await settledProjector(viewport);

  await selectBodies(page, ['Body1']);
  const dialog = await openDialog(page, 'Rectangular Pattern', 'Rectangular Pattern dialog');
  await dialog.getByRole('button', { name: 'Direction', exact: true }).click();
  await pickAxis(page, at, 'x', [25, 30, 35, -25, -30, -35]);
  await fill(dialog, { Count: '3', Distance: '10 mm' });
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await expect(viewport.locator('[data-manipulator-handle="count1"]')).toBeVisible();

  // The handle is on the last instance's centre, (20, 0, 10); two spacings is (40, 0, 10).
  // Zoom out until two spacings further along X is on screen.
  const frame = await viewBox(page);
  if (at([40, 0, 10]).x > frame.x + frame.width - 40) {
    await zoomOutTo(page, { x: frame.width / 2, y: frame.height / 2 }, 90);
    at = await settledProjector(viewport);
  }
  await dragHandle(page, viewport.locator('[data-manipulator-handle="count1"]'), at([40, 0, 10]));
  await expect(dialog.getByRole('textbox', { name: 'Count', exact: true })).toHaveValue('5');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  // Four copies drawn over the model, and a dot on each.
  await expect(viewport).toHaveAttribute('data-preview', 'new new new new');
  await expect(viewport.locator('[data-instance-toggle]')).toHaveCount(4);

  await ok(page, dialog);
  await expect(viewport).toHaveAttribute(
    'data-bodies',
    'Body1:6:20,20,20 Body2:6:20,20,20 Body3:6:20,20,20 Body4:6:20,20,20 Body5:6:20,20,20',
  );
  const bodies = await measured(page);
  expect(Object.values(bodies).map((b) => b.min[0])).toEqual([-10, 0, 10, 20, 30]);
});

test('drags a circular pattern’s count handle round the arc (P4-12)', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await box(page, { Length: '50 mm', Width: '50 mm', Height: '20 mm' });
  await hole(page, -18);
  await page.keyboard.press('Shift+1');
  const at = await settledProjector(viewport);

  const dialog = await openDialog(page, 'Circular Pattern', 'Circular Pattern dialog');
  await dialog.getByRole('combobox', { name: 'Pattern' }).selectOption('features');
  await dialog.getByRole('checkbox', { name: /^Cylinder1/ }).check();
  await dialog.getByRole('button', { name: 'Axis', exact: true }).click();
  await pickAxis(page, at, 'z', [30, 35, 40, 45, 25]);
  await fill(dialog, { Count: '4', Angle: '90 deg' });
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  // Four instances over a quarter turn are 30° apart; the handle sits on the last.
  await expect(viewport.locator('[data-instance-toggle]')).toHaveCount(3);

  // The whole angle is kept and the count follows the share of it the drag reached:
  // 112.5° is one and a quarter times the 90° angle, so five instances of it (the angle
  // then divides among them, 22.5° apart, which keeps the 4 mm holes 4.7 mm apart at
  // the 18 mm radius). A right-handed turn about +Z runs clockwise seen from +Z.
  const angle = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return at([-18 * Math.cos(rad), -18 * Math.sin(rad), 10]);
  };
  await dragHandle(page, viewport.locator('[data-manipulator-handle="count"]'), angle(112.5));
  await expect(dialog.getByRole('textbox', { name: 'Count', exact: true })).toHaveValue('5');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  // Five instances, so a dot on each but the original.
  await expect(viewport.locator('[data-instance-toggle]')).toHaveCount(4);

  await ok(page, dialog);
  // Five holes in the plate: its six faces and five cylinders.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:11:50,50,20');
  const bodies = await measured(page);
  expect(bodies.Body1?.volume).toBeCloseTo(50 * 50 * 20 - 5 * CYLINDER_VOLUME, -1);
});
