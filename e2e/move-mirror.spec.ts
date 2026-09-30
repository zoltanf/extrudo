import { expect, type Locator, type Page, test } from '@playwright/test';
import { meshBounds } from '../packages/io/src/index';
import { exportModel, objectsOf3mf, selectBodies } from './benchmark-helpers';
import { kernelReady, openProject, pickTool, projector } from './helpers';

// P3-06: Move/Copy and Mirror (ADR-0044, FR-FT-10, FR-FT-11). Move: typed
// distances and turns, an arrow per axis and a ring per axis in the view
// (dragging an arrow writes the field), a rotation about a picked axis, a
// copy that keeps the original; Mirror: about a picked origin plane, as a
// copy, in place and joined. Positions are read back from the 3MF export.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });

/** A 20 mm cube on XY centred at (x, 0): x ± 10, y ±10, z 0…20. */
async function cube(page: Page, x = 0) {
  await pickTool(page, 'Box');
  const dialog = page.getByRole('region', { name: 'Box dialog' });
  await expect(dialog).toBeVisible();
  if (x !== 0) await dialog.getByRole('textbox', { name: 'X', exact: true }).fill(`${x} mm`);
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
}

/** Selects bodies and opens a dialog from the Transform group. */
async function open(
  page: Page,
  tool: string,
  dialog: string,
  bodies: string[],
  preview = true,
): Promise<Locator> {
  await selectBodies(page, bodies);
  await page.getByRole('button', { name: tool, exact: true }).click();
  const region = page.getByRole('region', { name: dialog });
  await expect(region).toBeVisible();
  // A move that moves nothing yet is a warning ("Nothing moves"); a mirror waits for its plane.
  if (preview) {
    await expect(region).toHaveAttribute('data-preview-status', /^(ok|warning)$/, {
      timeout: 15_000,
    });
  }
  return region;
}

async function ok(page: Page, dialog: Locator) {
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
}

/** Every body's box in the 3MF export, by name (the Solid tab is shown again afterwards). */
async function boxes(page: Page) {
  const file = await exportModel(page, '3MF');
  await page
    .getByRole('tablist', { name: 'Toolbar tabs' })
    .getByRole('tab', { name: 'Solid' })
    .click();
  const out: Record<string, { min: number[]; max: number[] }> = {};
  for (const object of objectsOf3mf(file)) {
    const box = meshBounds(object.mesh);
    if (!box) throw new Error(`${object.name} is empty`);
    out[object.name] = {
      min: box.min.map((v) => Math.round(v * 100) / 100),
      max: box.max.map((v) => Math.round(v * 100) / 100),
    };
  }
  return out;
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

test('moves a body by typed distances and turns; a copy keeps the original', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await cube(page);

  const dialog = await open(page, 'Move', 'Move dialog', ['Body1']);
  // The gizmo: an arrow and a ring for each axis.
  await expect(viewport.locator('[data-manipulators]')).toHaveAttribute(
    'data-manipulators',
    'distance:dx angle:rx distance:dy angle:ry distance:dz angle:rz',
  );
  await expect(dialog.getByRole('combobox', { name: 'Move type' })).toHaveValue('free');
  await dialog.getByRole('textbox', { name: 'X distance' }).fill('30 mm');
  await dialog.getByRole('textbox', { name: 'Z distance' }).fill('5 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await expect(viewport).toHaveAttribute('data-preview', 'new');
  await ok(page, dialog);
  await expect(chip(page, 'Move1')).toHaveAccessibleName('Move1');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
  expect(await boxes(page)).toEqual({
    Body1: { min: [20, -10, 5], max: [40, 10, 25] },
  });

  // A copy, turned 45° about Z through its own middle: the original stays.
  const copy = await open(page, 'Move', 'Move dialog', ['Body1']);
  await copy.getByRole('checkbox', { name: 'Create copy' }).check();
  await copy.getByRole('textbox', { name: 'Y distance' }).fill('50 mm');
  await copy.getByRole('textbox', { name: 'Z angle' }).fill('45 deg');
  await expect(copy).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await ok(page, copy);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20 Body2:6:28.3,28.3,20');
  const both = await boxes(page);
  expect(both.Body1).toEqual({ min: [20, -10, 5], max: [40, 10, 25] });
  // 45°: 28.28 across, centred on (30, 50).
  expect(both.Body2?.min[0]).toBeCloseTo(30 - 14.14, 1);
  expect(both.Body2?.max[1]).toBeCloseTo(50 + 14.14, 1);

  // One undo step for each.
  await page.keyboard.press('Control+z');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
});

test('dragging a gizmo arrow writes its distance field', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await cube(page);
  await page.keyboard.press('Shift+1');
  const at = await settledProjector(viewport);

  const dialog = await open(page, 'Move', 'Move dialog', ['Body1']);
  const field = dialog.getByRole('textbox', { name: 'X distance' });
  await expect(field).toHaveValue('0 mm');
  // The arrow starts on the +X face of the cube; drag it along the X axis on screen.
  const circle = viewport.locator('[data-manipulator-handle="dx"]');
  const box = await viewport.boundingBox();
  const from = {
    x: (box?.x ?? 0) + Number(await circle.getAttribute('cx')),
    y: (box?.y ?? 0) + Number(await circle.getAttribute('cy')),
  };
  const a = at([10, 0, 10]);
  const b = at([40, 0, 10]);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const step = { x: ((b.x - a.x) / length) * 80, y: ((b.y - a.y) / length) * 80 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + step.x / 2, from.y + step.y / 2, { steps: 4 });
  await page.mouse.move(from.x + step.x, from.y + step.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number.parseFloat(await field.inputValue())).toBeGreaterThan(1);
  await expect(field).toHaveValue(/ mm$/);
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('turns a body about a picked axis', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await cube(page);
  await page.keyboard.press('Shift+1');
  const at = await settledProjector(viewport);

  const dialog = await open(page, 'Move', 'Move dialog', ['Body1']);
  await dialog.getByRole('combobox', { name: 'Move type' }).selectOption('rotate');
  await expect(dialog.getByRole('textbox', { name: 'X distance' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Axis', exact: true }).click();
  // The X axis, off to the side of the cube: the first point along it that no panel covers.
  let hit: { x: number; y: number } | undefined;
  for (const along of [20, 25, 30, -25, -30, 35, 15]) {
    const p = at([along, 0, 0]);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(150);
    if ((await viewport.getAttribute('data-model-hover')) === 'axis:origin:x') {
      hit = p;
      break;
    }
  }
  if (!hit) throw new Error('no point of the X axis can be picked');
  await page.mouse.click(hit.x, hit.y);
  await expect(dialog.getByRole('button', { name: 'Axis', exact: true })).toHaveText('X axis');
  await dialog.getByRole('textbox', { name: 'Angle', exact: true }).fill('90 deg');
  await expect(viewport.locator('[data-manipulators]')).toHaveAttribute(
    'data-manipulators',
    'angle:angle',
  );
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await ok(page, dialog);
  // Right-handed about +X: (y, z) becomes (−z, y).
  expect(await boxes(page)).toEqual({ Body1: { min: [-10, -20, -10], max: [10, 0, 10] } });
});

test('mirrors a body about a picked plane: a copy, and joined to its original', async ({
  page,
}) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  // A cube touching the YZ plane: x from 0 to 20.
  await cube(page, 10);
  const at = await settledProjector(viewport);
  const half = Number(await viewport.getAttribute('data-camera-size')) * 0.16;

  const dialog = await open(page, 'Mirror', 'Mirror dialog', ['Body1'], false);
  await expect(dialog.getByRole('checkbox', { name: 'Copy' })).toBeChecked();
  // The plane is the next thing to pick: the YZ plane's square, in front of no other plane.
  await clickAt(page, at, [0, -half * 0.6, half * 0.6]);
  await expect(dialog.getByRole('button', { name: 'Plane', exact: true })).toHaveText('YZ plane');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await ok(page, dialog);
  await expect(chip(page, 'Mirror1')).toHaveAccessibleName('Mirror1');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20 Body2:6:20,20,20');
  const two = await boxes(page);
  expect(two.Body1).toEqual({ min: [0, -10, 0], max: [20, 10, 20] });
  expect(two.Body2).toEqual({ min: [-20, -10, 0], max: [0, 10, 20] });

  // Undo, then join the copy to the original: one body, 40 long.
  await page.keyboard.press('Control+z');
  await kernelReady(page);
  const join = await open(page, 'Mirror', 'Mirror dialog', ['Body1'], false);
  await clickAt(page, at, [0, -half * 0.6, half * 0.6]);
  await join.getByRole('checkbox', { name: 'Join' }).check();
  await expect(join).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await ok(page, join);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:40,20,20');
  expect(await boxes(page)).toEqual({ Body1: { min: [-20, -10, 0], max: [20, 10, 20] } });

  // Undo, then mirror the body itself, without a copy: it moves across the plane.
  await page.keyboard.press('Control+z');
  await kernelReady(page);
  const inPlace = await open(page, 'Mirror', 'Mirror dialog', ['Body1'], false);
  await clickAt(page, at, [0, -half * 0.6, half * 0.6]);
  await inPlace.getByRole('checkbox', { name: 'Copy' }).uncheck();
  await expect(inPlace.getByRole('checkbox', { name: 'Join' })).toHaveCount(0);
  await expect(inPlace).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await ok(page, inPlace);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
  expect(await boxes(page)).toEqual({ Body1: { min: [-20, -10, 0], max: [0, 10, 20] } });
});
