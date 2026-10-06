import { expect, type Locator, type Page, test } from '@playwright/test';
import { exportModel, objectsOf3mf, solidTab } from './benchmark-helpers';
import { kernelReady, openProject, pickTool, projector } from './helpers';

// P3-01: Fillet (ADR-0038, FR-FT-04, FR-UX-06). Edges are picked in the
// view (a picked edge brings its tangent chain), each set has its own
// radius, the preview is live, and a radius that is too large says which
// edge and how large it may be. One undo step. P4-10: a set with an end
// radius tapers along its edges (ADR-0064 §2).

test.use({ viewport: { width: 1440, height: 900 } });
// Four exports (one per volume) plus the previews: a few minutes.
test.describe.configure({ timeout: 300_000 });

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

/** A 20 mm cube on XY, centred on the origin: x, y in −10…10, z in 0…20. */
async function cube(page: Page) {
  await pickTool(page, 'Box');
  const dialog = page.getByRole('region', { name: 'Box dialog' });
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(viewportOf(page)).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
}

/** Clicks an edge of the cube at its world midpoint, a couple of pixels off (as the selection tests do). */
async function clickEdge(
  page: Page,
  at: (p: [number, number, number]) => { x: number; y: number },
  midpoint: [number, number, number],
) {
  const { x, y } = at(midpoint);
  await page.mouse.move(x, y + 2);
  await expect.poll(() => viewportOf(page).getAttribute('data-model-hover')).toMatch(/^edge:/);
  await page.mouse.click(x, y + 2);
}

/**
 * The cube's top front edge after the vertical edges are rounded: the chain's
 * straight part, at its middle and a little along it. The pick finds an edge
 * at one of them but not always at the middle (the round's radius handle
 * stands there while a fillet or chamfer dialog is open, P4-12).
 */
const TOP_FRONT: readonly (readonly [number, number, number])[] = [
  [0, -10, 20],
  [-3, -10, 20],
  [3, -10, 20],
];

/** Clicks the top front edge at the first of those points the view picks an edge at. */
async function clickTopFront(
  page: Page,
  at: (p: [number, number, number]) => { x: number; y: number },
) {
  const viewport = viewportOf(page);
  for (const p of TOP_FRONT) {
    const { x, y } = at([...p]);
    await page.mouse.move(x, y + 2);
    const edge = await expect
      .poll(() => viewport.getAttribute('data-model-hover'), { timeout: 1_000 })
      .toMatch(/^edge:/)
      .then(() => true)
      .catch(() => false);
    if (!edge) continue;
    await page.mouse.click(x, y + 2);
    return;
  }
  throw new Error('the top front edge was not pickable');
}

/** A manipulator handle's centre in page px. */
async function handle(viewport: Locator, field: string) {
  const circle = viewport.locator(`[data-manipulator-handle="${field}"]`);
  const box = await viewport.boundingBox();
  const cx = Number(await circle.getAttribute('cx'));
  const cy = Number(await circle.getAttribute('cy'));
  return { x: (box?.x ?? 0) + cx, y: (box?.y ?? 0) + cy };
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

/** The model's volume in mm³, from a 3MF export (a tessellation, so a little under). */
async function volume(page: Page) {
  const file = await exportModel(page, '3MF');
  await solidTab(page);
  const objects = objectsOf3mf(file);
  expect(objects).toHaveLength(1);
  const mesh = objects[0]?.mesh;
  if (!mesh) throw new Error('no mesh');
  let total = 0;
  const p = mesh.positions;
  const i = mesh.indices;
  // The signed volume of each triangle's tetrahedron with the origin.
  for (let t = 0; t + 2 < i.length; t += 3) {
    const at = (node: number, k: number) => p[3 * node + k] ?? 0;
    const a = i[t] ?? 0;
    const b = i[t + 1] ?? 0;
    const c = i[t + 2] ?? 0;
    total +=
      (at(a, 0) * (at(b, 1) * at(c, 2) - at(b, 2) * at(c, 1)) -
        at(a, 1) * (at(b, 0) * at(c, 2) - at(b, 2) * at(c, 0)) +
        at(a, 2) * (at(b, 0) * at(c, 1) - at(b, 1) * at(c, 0))) /
      6;
  }
  return total;
}

test('rounds edges in two sets; a radius that is too large says how large it may be', async ({
  page,
}) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  const at = await settledProjector(viewport);

  // The home view looks from +X, −Y, +Z: the top face's front and right edges show.
  await clickEdge(page, at, [0, -10, 20]);
  await expect(viewport).toHaveAttribute('data-model-selection', /^edge:/);
  await page.keyboard.press('f');
  const dialog = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Edges', exact: true })).toHaveText('1 edge');
  await expect(dialog.getByRole('textbox', { name: 'Radius', exact: true })).toHaveValue('1 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await expect(viewport).toHaveAttribute('data-preview', /./);

  // Too large: the message names the edge and the largest radius that works.
  await dialog.getByRole('textbox', { name: 'Radius', exact: true }).fill('50 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'error', { timeout: 15_000 });
  await expect(dialog.getByRole('status', { name: 'Feature status' })).toContainText(
    /Radius 50 mm is too large for edge \d+ \(max ≈ 1\d(\.\d)? mm\)\./,
  );
  await expect(dialog.getByRole('button', { name: 'OK' })).toBeDisabled();

  // A second set with its own radius appears once the first has edges.
  await dialog.getByRole('textbox', { name: 'Radius', exact: true }).fill('3 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Edges 2', exact: true }).click();
  await clickEdge(page, at, [10, 0, 20]);
  await expect(dialog.getByRole('button', { name: 'Edges 2', exact: true })).toHaveText('1 edge');
  await dialog.getByRole('textbox', { name: 'Radius 2', exact: true }).fill('1 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);

  // A face for each edge; one undo step takes both away.
  await expect(chip(page, 'Fillet1')).toHaveAccessibleName('Fillet1');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:8:20,20,20');
  await page.keyboard.press('Control+z');
  await expect(chip(page, 'Fillet1')).toHaveCount(0);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
});

test('a picked edge brings its tangent chain, which is rounded as one', async ({ page }) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  const at = await settledProjector(viewport);

  // Round the three vertical edges the home view shows.
  await clickEdge(page, at, [10, -10, 10]);
  await page.keyboard.press('f');
  const first = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(first).toBeVisible();
  await expect(first.getByRole('button', { name: 'Edges', exact: true })).toHaveText('1 edge');
  await clickEdge(page, at, [-10, -10, 10]);
  await clickEdge(page, at, [10, 10, 10]);
  await expect(first.getByRole('button', { name: 'Edges', exact: true })).toHaveText('3 edges');
  await first.getByRole('textbox', { name: 'Radius', exact: true }).fill('4 mm');
  await expect(first).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await first.getByRole('button', { name: 'OK' }).click();
  await expect(first).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:9:20,20,20');

  // The top front edge now runs between two arcs: it comes with them and the edges beyond,
  // seven up to the sharp corner at the back (left edge, arc, front, arc, right, arc, back).
  await clickTopFront(page, at);
  await page.keyboard.press('f');
  const second = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(second.getByRole('button', { name: 'Edges', exact: true })).toHaveText('7 edges');
  // Unpicking one edge of a chain takes the whole chain out; picking it brings it back.
  await clickTopFront(page, at);
  await expect(second.getByRole('button', { name: 'Edges', exact: true })).toHaveText('Pick edges');
  await clickTopFront(page, at);
  await expect(second.getByRole('button', { name: 'Edges', exact: true })).toHaveText('7 edges');
  await second.getByRole('textbox', { name: 'Radius', exact: true }).fill('1 mm');
  await expect(second).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await second.getByRole('button', { name: 'OK' }).click();
  await expect(second).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:16:20,20,20');
});

test('the wall bracket’s Fillet1 rounds its bend, and its dialog opens on the two stored sets', async ({
  page,
}) => {
  const viewport = viewportOf(page);
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  // The L, two holes and two fillet faces (the template's Fillet1 has two sets).
  await expect(chip(page, 'Fillet1')).toHaveAccessibleName('Fillet1');
  await expect(viewport).toHaveAttribute('data-bodies', 'Bracket:12:40,80,60');

  // Its dialog opens on the stored sets.
  await chip(page, 'Fillet1').dblclick();
  const dialog = page.getByRole('region', { name: 'Edit Fillet1 dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Radius', exact: true })).toHaveValue(
    'wall / 2',
  );
  await expect(dialog.getByRole('textbox', { name: 'Radius 2', exact: true })).toHaveValue(
    'wall * 1.5',
  );
  await expect(dialog.getByRole('button', { name: 'Edges', exact: true })).toHaveText('1 edge');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Cancel Esc' }).click();
  await expect(dialog).toBeHidden();
});

test('a variable radius tapers along the edge between its two ends', async ({ page }) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  const at = await settledProjector(viewport);

  // The top front edge: 20 mm long, between the top face and the front one.
  await clickEdge(page, at, [0, -10, 20]);
  await page.keyboard.press('f');
  const dialog = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(dialog).toBeVisible();
  // Variable is off, so there is no end radius yet.
  await expect(dialog.getByRole('checkbox', { name: 'Variable' })).not.toBeChecked();
  await expect(dialog.getByRole('textbox', { name: 'End radius' })).toHaveCount(0);
  await dialog.getByRole('textbox', { name: 'Radius', exact: true }).fill('2 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  const flat2 = await volume(page);

  // The same fillet at 5 mm, for the volume the taper has to stay above.
  await chip(page, 'Fillet1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Fillet1 dialog' });
  await expect(edit).toBeVisible();
  await edit.getByRole('textbox', { name: 'Radius', exact: true }).fill('5 mm');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(edit).toBeHidden();
  await kernelReady(page);
  const flat5 = await volume(page);
  expect(flat2).toBeGreaterThan(flat5 + 50);

  // Now the taper: 2 mm at one end of the edge, 5 mm at the other.
  await chip(page, 'Fillet1').dblclick();
  await expect(edit).toBeVisible();
  await edit.getByRole('textbox', { name: 'Radius', exact: true }).fill('2 mm');
  await edit.getByRole('checkbox', { name: 'Variable' }).check();
  await edit.getByRole('textbox', { name: 'End radius' }).fill('5 mm');
  await edit.getByRole('checkbox', { name: 'Swap ends' }).waitFor();
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 20_000 });
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(edit).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:20,20,20');
  const tapered = await volume(page);
  // Between the two constant fillets: more gone than at 2 mm, less than at 5 mm.
  expect(tapered).toBeLessThan(flat2);
  expect(tapered).toBeGreaterThan(flat5);

  // Swapping the ends moves the round along the edge, not the material.
  await chip(page, 'Fillet1').dblclick();
  await expect(edit).toBeVisible();
  await edit.getByRole('checkbox', { name: 'Variable' }).check();
  await edit.getByRole('textbox', { name: 'End radius' }).fill('5 mm');
  await edit.getByRole('checkbox', { name: 'Swap ends' }).check();
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 20_000 });
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(edit).toBeHidden();
  await kernelReady(page);
  expect(await volume(page)).toBeCloseTo(tapered, -1);

  // The chip's dialog opens on the stored taper: Variable is on with its ends.
  await chip(page, 'Fillet1').dblclick();
  await expect(edit).toBeVisible();
  await expect(edit.getByRole('checkbox', { name: 'Variable' })).toBeChecked();
  await expect(edit.getByRole('textbox', { name: 'End radius' })).toHaveValue('5 mm');
  await edit.getByRole('checkbox', { name: 'Variable' }).uncheck();
  await expect(edit.getByRole('textbox', { name: 'End radius' })).toHaveCount(0);
});

test('the radius handle on the edge sets the radius', async ({ page }) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  const at = await settledProjector(viewport);

  // The top front edge, between the top face and the front one.
  await clickEdge(page, at, [0, -10, 20]);
  await page.keyboard.press('f');
  const dialog = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(dialog).toBeVisible();
  // One handle: set 1's Radius, out along the edge's two faces.
  await expect(viewport.locator('[data-manipulators]')).toHaveAttribute(
    'data-manipulators',
    'distance:radius',
  );
  const radiusField = dialog.getByRole('textbox', { name: 'Radius', exact: true });
  await radiusField.fill('2 mm');
  // The field keeps what it is given while it has the focus (it is the user's
  // own text until they leave it), so it shows the drag's value only blurred.
  await radiusField.blur();
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  // The handle stands at the edge's middle and away from the body.
  const middle = at([0, -10, 20]);
  const head = await handle(viewport, 'radius');
  const out = { x: head.x - middle.x, y: head.y - middle.y };
  expect(Math.hypot(out.x, out.y)).toBeGreaterThan(4);

  // Drag it further out along the arrow: the radius follows, and the round grows.
  await drag(page, head, out.x, out.y);
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  const text = await radiusField.inputValue();
  const radius = Number.parseFloat(text);
  expect(radius, `radius after the drag: ${text}`).toBeGreaterThan(3);
  expect(radius).toBeLessThan(8);
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:20,20,20');
  const dragged = await volume(page);

  // The same edge at 2 mm for the volume the dragged round has to be under.
  await chip(page, 'Fillet1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Fillet1 dialog' });
  await expect(edit).toBeVisible();
  // The stored radius is the one the drag wrote (snapped to a step).
  const stored = Number.parseFloat(
    await edit.getByRole('textbox', { name: 'Radius', exact: true }).inputValue(),
  );
  expect(stored).toBeCloseTo(radius, 1);
  await edit.getByRole('textbox', { name: 'Radius', exact: true }).fill('2 mm');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(edit).toBeHidden();
  await kernelReady(page);
  expect(dragged).toBeLessThan(await volume(page));
});

test('a shortcut with a digit is the app’s, not the heads-up box’s', async ({ page }) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  const at = await settledProjector(viewport);
  await clickEdge(page, at, [0, -10, 20]);
  await page.keyboard.press('f');
  const dialog = page.getByRole('region', { name: 'Fillet dialog' });
  const radiusField = dialog.getByRole('textbox', { name: 'Radius', exact: true });
  await radiusField.fill('2 mm');
  await radiusField.blur();
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  const home = await viewport.getAttribute('data-camera-direction');

  // The front view turns the camera; the 5 belongs to the command, not to the
  // Radius field, which keeps its own value (P4-12: the handle makes Shift+1…7
  // worth pressing while a fillet dialog is open).
  await page.keyboard.press('Shift+4');
  await expect.poll(() => viewport.getAttribute('data-camera-direction')).not.toBe(home);
  await expect(radiusField).toHaveValue('2 mm');
});

/** The state ("active" or "quiet") of the arrow that writes `field`, as the overlay draws it. */
async function arrowState(viewport: Locator, field: string) {
  return viewport
    .locator(`[data-manipulator-state]:has([data-manipulator-handle="${field}"])`)
    .getAttribute('data-manipulator-state');
}

test('a second set has its own radius handle, the prominent one follows the focus', async ({
  page,
}) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  const at = await settledProjector(viewport);

  await clickEdge(page, at, [0, -10, 20]);
  await page.keyboard.press('f');
  const dialog = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(dialog).toBeVisible();
  const markers = viewport.locator('[data-manipulators]');
  await expect(markers).toHaveAttribute('data-manipulators', 'distance:radius');

  // The right top edge goes to set 2, which brings its own handle.
  await dialog.getByRole('button', { name: 'Edges 2', exact: true }).click();
  await clickEdge(page, at, [10, 0, 20]);
  await expect(dialog.getByRole('button', { name: 'Edges 2', exact: true })).toHaveText('1 edge');
  await expect(markers).toHaveAttribute('data-manipulators', 'distance:radius distance:radius2');
  // The set whose pick field was last used is the prominent one.
  await expect.poll(() => arrowState(viewport, 'radius2')).toBe('active');
  expect(await arrowState(viewport, 'radius')).toBe('quiet');
  const radiusField = dialog.getByRole('textbox', { name: 'Radius', exact: true });
  await radiusField.focus();
  await expect.poll(() => arrowState(viewport, 'radius')).toBe('active');
  expect(await arrowState(viewport, 'radius2')).toBe('quiet');

  const radius2 = dialog.getByRole('textbox', { name: 'Radius 2', exact: true });
  await radius2.fill('2 mm');
  await radius2.blur();
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  // Grabbing the quiet arrow makes it the prominent one and drags Radius 2.
  const middle = at([10, 0, 20]);
  const head = await handle(viewport, 'radius2');
  const out = { x: head.x - middle.x, y: head.y - middle.y };
  expect(Math.hypot(out.x, out.y)).toBeGreaterThan(4);
  await drag(page, head, out.x, out.y);
  await expect.poll(() => arrowState(viewport, 'radius2')).toBe('active');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await radius2.blur();
  const radius = Number.parseFloat(await radius2.inputValue());
  expect(radius, `Radius 2 after the drag`).toBeGreaterThan(3);
  expect(radius).toBeLessThan(8);
  // Set 1 kept its own value.
  await expect(radiusField).toHaveValue('1 mm');
});

test('a variable set has a handle at each end of its chain; Swap ends changes their places', async ({
  page,
}) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  const at = await settledProjector(viewport);

  await clickEdge(page, at, [0, -10, 20]);
  await page.keyboard.press('f');
  const dialog = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Variable', exact: true }).check();
  const radiusField = dialog.getByRole('textbox', { name: 'Radius', exact: true });
  const endField = dialog.getByRole('textbox', { name: 'End radius', exact: true });
  await radiusField.fill('2 mm');
  await radiusField.blur();
  await endField.fill('5 mm');
  await endField.blur();
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  // Two handles, one per end, and no handle in the middle of the edge.
  await expect(viewport.locator('[data-manipulators]')).toHaveAttribute(
    'data-manipulators',
    'distance:radius distance:radiusEnd',
  );
  const left = at([-10, -10, 20]);
  const right = at([10, -10, 20]);
  const nearer = (head: { x: number; y: number }) =>
    Math.hypot(head.x - left.x, head.y - left.y) < Math.hypot(head.x - right.x, head.y - right.y)
      ? 'left'
      : 'right';
  const first = nearer(await handle(viewport, 'radius'));
  const second = nearer(await handle(viewport, 'radiusEnd'));
  expect(first).not.toBe(second);

  // Swapped, the two change ends.
  await dialog.getByRole('checkbox', { name: 'Swap ends', exact: true }).check();
  await expect.poll(async () => nearer(await handle(viewport, 'radius'))).toBe(second);
  expect(nearer(await handle(viewport, 'radiusEnd'))).toBe(first);
  await dialog.getByRole('checkbox', { name: 'Swap ends', exact: true }).uncheck();
  await expect.poll(async () => nearer(await handle(viewport, 'radius'))).toBe(first);

  // The End radius handle drags End radius.
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  const head = await handle(viewport, 'radiusEnd');
  const end = second === 'left' ? left : right;
  const out = { x: head.x - end.x, y: head.y - end.y };
  expect(Math.hypot(out.x, out.y)).toBeGreaterThan(4);
  await drag(page, head, out.x * 0.4, out.y * 0.4);
  await expect(dialog).toHaveAttribute('data-preview-status', /^(ok|error)$/, { timeout: 15_000 });
  await endField.blur();
  const changed = Number.parseFloat(await endField.inputValue());
  expect(changed, 'End radius after the drag').toBeGreaterThan(5.5);
  await expect(radiusField).toHaveValue('2 mm');
});
