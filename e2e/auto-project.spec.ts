import { expect, type Locator, type Page, test } from '@playwright/test';
import { primitive, settled, zoomOutTo } from './benchmark-helpers';
import {
  counts,
  kernelReady,
  mapping,
  openProject,
  openSketch,
  pickTool,
  projector,
} from './helpers';

// P6-07 (ADR-0074): a body edge or vertex a sketch tool snaps to is projected
// into the sketch on the fly. A Line end that snaps to a Box vertex brings the
// vertex into the sketch and holds the point on it, all in one undo step; the
// preference turns it off; and with the face-outline preference on a sketch
// started on a face comes in with the face's outline already projected.

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

const attr = async (el: Locator, name: string) => (await el.getAttribute(name)) ?? '';
const viewportOf = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });

/** A 40 × 40 × 20 box around the origin, its top face at z = 20. */
async function box(page: Page) {
  await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Box', { Length: '40 mm', Width: '40 mm', Height: '20 mm' });
  await expect(viewportOf(page)).toHaveAttribute('data-bodies', 'Body1:6:40,40,20');
}

/** Create Sketch on the Box's top face (world (0,0,20)): the sketch opens on it. */
async function sketchOnTopFace(page: Page): Promise<string> {
  const viewport = viewportOf(page);
  await page.keyboard.press('Shift+1');
  await settled(viewport);
  const world = await projector(viewport);
  await pickTool(page, 'Create Sketch');
  const create = page.getByRole('region', { name: 'Create Sketch' });
  await expect(create).toContainText('flat face');
  const top = world([10, 10, 20]);
  await page.mouse.move(top.x, top.y);
  await page.mouse.click(top.x, top.y);
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  const id = await openSketch(page);
  await expect.poll(() => attr(viewport, 'data-sketch-frames')).toContain(`${id}:0,0,20:0,0,1`);
  // A face sketch opens fitted tight; clear the palette before clicking a far corner.
  const at = await mapping(viewport);
  await zoomOutTo(page, at(0, 0), 150);
  return id;
}

/** Draws a Line from the top-right corner (a body vertex) to (5,0) and ends the tool. */
async function lineFromCorner(page: Page) {
  const viewport = viewportOf(page);
  const at = await mapping(viewport);
  await page.keyboard.press('l');
  const corner = at(20, 20);
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.click(corner.x, corner.y);
  const end = at(5, 0);
  await page.mouse.move(end.x, end.y);
  await page.mouse.click(end.x, end.y);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status', { name: 'Tool prompt' })).toHaveCount(0);
  return viewport;
}

test('a Line end snapping to a Box vertex projects it and holds the point on it', async ({
  page,
}) => {
  await box(page);
  const sketch = await sketchOnTopFace(page);
  const viewport = await lineFromCorner(page);

  // The kernel reports the vertex on the next recompute; the coincidence follows.
  await expect.poll(async () => (await counts(page)).constraints, { timeout: 60_000 }).toBe(1);

  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);
  await expect
    .poll(() => attr(viewport, 'data-sketch-projected'))
    .toBe(`${sketch}:curves=0:x=20..20:y=20..20`);

  // One undo takes the line, the projection and the constraint away.
  await page.keyboard.press('Control+z');
  await expect.poll(() => attr(viewport, 'data-sketch-projected')).toBe('');
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => attr(viewport, 'data-sketch-projected')).toContain(`${sketch}:curves=0`);

  // Reopening the sketch shows the coincidence the projection brought.
  await chip(page, 'Sketch1').dblclick();
  await expect.poll(async () => (await counts(page)).constraints).toBe(1);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
});

test('the Auto-project preference off leaves the snap and the projection out', async ({ page }) => {
  await box(page);
  const sketch = await sketchOnTopFace(page);
  await page.getByRole('checkbox', { name: 'Auto-project', exact: true }).uncheck();
  const viewport = await lineFromCorner(page);
  // The corner is a grid point: no model snap, no projection, no constraint.
  await expect.poll(async () => (await counts(page)).constraints).toBe(0);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);
  await expect.poll(() => attr(viewport, 'data-sketch-projected')).not.toContain(sketch);
});

test('the face-outline preference projects a face a sketch starts on', async ({ page }) => {
  await box(page);
  await sketchOnTopFace(page);
  await page.getByRole('checkbox', { name: 'Auto-project face outline' }).check();
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);

  const viewport = viewportOf(page);
  await page.keyboard.press('Shift+1');
  await settled(viewport);
  const world = await projector(viewport);
  await pickTool(page, 'Create Sketch');
  const top = world([10, 10, 20]);
  await page.mouse.move(top.x, top.y);
  await page.mouse.click(top.x, top.y);
  const second = await openSketch(page);
  // The face's four edges come in as fixed curves, in the same undo step.
  await expect
    .poll(() => attr(viewport, 'data-sketch-projected'), { timeout: 60_000 })
    .toContain(`${second}:curves=4`);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
});

/** Draws a Line between two sketch points with inference off, then ends the tool. */
async function rawLine(page: Page, viewport: Locator, a: [number, number], b: [number, number]) {
  const at = await mapping(viewport);
  const p = at(...a);
  const q = at(...b);
  await page.keyboard.press('l');
  await page.keyboard.down('Control');
  await page.mouse.click(p.x, p.y);
  await page.mouse.click(q.x, q.y);
  await page.keyboard.up('Control');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

/** Clicks the constraint tool's tile in the Constraints group. */
function constraintTool(page: Page, name: string) {
  return page
    .getByRole('group', { name: 'Constraints' })
    .getByRole('button', { name, exact: true });
}

// P6-07 slice 2 (ADR-0074's amendment): the constraint and dimension tools
// pick a body edge or vertex directly, and the host projects it and writes the
// constraint or dimension in the same undo step.

test('Coincident between a sketch point and a Box vertex projects it', async ({ page }) => {
  await box(page);
  const sketch = await sketchOnTopFace(page);
  const viewport = viewportOf(page);
  await rawLine(page, viewport, [5, 0], [5, 10]);
  await constraintTool(page, 'Coincident').click();
  const at = await mapping(viewport);
  const point = at(5, 0);
  await page.mouse.click(point.x, point.y); // the line's end (a sketch point)
  const corner = at(20, 20); // the Box's top vertex
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.click(corner.x, corner.y);

  // The kernel reports the vertex; the coincidence follows.
  await expect.poll(async () => (await counts(page)).constraints, { timeout: 60_000 }).toBe(1);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);
  await expect
    .poll(() => attr(viewport, 'data-sketch-projected'))
    .toBe(`${sketch}:curves=0:x=20..20:y=20..20`);

  // One undo takes the coincidence and the projection away together.
  await page.keyboard.press('Control+z');
  await expect.poll(() => attr(viewport, 'data-sketch-projected')).toBe('');
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => attr(viewport, 'data-sketch-projected')).toContain(`${sketch}:curves=0`);
});

test('Parallel to a Box edge projects the edge', async ({ page }) => {
  await box(page);
  const sketch = await sketchOnTopFace(page);
  const viewport = viewportOf(page);
  await rawLine(page, viewport, [0, 0], [10, 0]);
  await constraintTool(page, 'Parallel').click();
  const at = await mapping(viewport);
  const line = at(5, 0);
  await page.mouse.click(line.x, line.y);
  const edge = at(0, 20); // the top face's far edge
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.click(edge.x, edge.y);

  await expect.poll(async () => (await counts(page)).constraints, { timeout: 60_000 }).toBe(1);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);
  await expect
    .poll(() => attr(viewport, 'data-sketch-projected'), { timeout: 60_000 })
    .toContain(`${sketch}:curves=1`);

  await page.keyboard.press('Control+z');
  await expect.poll(() => attr(viewport, 'data-sketch-projected')).toBe('');
});

test('a Dimension from a sketch point to a Box vertex projects it', async ({ page }) => {
  await box(page);
  const sketch = await sketchOnTopFace(page);
  const viewport = viewportOf(page);
  await rawLine(page, viewport, [5, 0], [5, 10]);
  await page.keyboard.press('d');
  const at = await mapping(viewport);
  const point = at(5, 0);
  await page.mouse.click(point.x, point.y); // the line's end
  const corner = at(20, 20);
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.click(corner.x, corner.y);
  const label = at(12, 12);
  await page.mouse.click(label.x, label.y); // place the dimension

  await expect.poll(async () => (await counts(page)).dimensions, { timeout: 60_000 }).toBe(1);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);
  await expect
    .poll(() => attr(viewport, 'data-sketch-projected'), { timeout: 60_000 })
    .toBe(`${sketch}:curves=0:x=20..20:y=20..20`);

  await page.keyboard.press('Control+z');
  await expect.poll(() => attr(viewport, 'data-sketch-projected')).toBe('');
});

// The review's gap 7: a curved body edge is still snappable for placing a
// point (the exact curve supports it), unlike a picking tool's straight-edge
// rule. A Line end on a cylinder's rim projects the circle.
test('a Line end snapping to a cylinder rim projects the curved edge', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Cylinder', { Diameter: '40 mm', Height: '20 mm' });
  const viewport = viewportOf(page);
  await page.keyboard.press('Shift+1');
  await settled(viewport);
  const world = await projector(viewport);
  await pickTool(page, 'Create Sketch');
  const top = world([0, 0, 20]); // the cylinder's top face
  await page.mouse.move(top.x, top.y);
  await page.mouse.click(top.x, top.y);
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  const sketch = await openSketch(page);
  const fitted = await mapping(viewport);
  await zoomOutTo(page, fitted(0, 0), 150);
  const at = await mapping(viewport);
  await page.keyboard.press('l');
  // A point on the rim, away from the seam vertex at (20,0): the curved edge wins.
  const angle = (17 * Math.PI) / 180;
  const rim = at(20 * Math.cos(angle), 20 * Math.sin(angle));
  await page.mouse.move(rim.x, rim.y);
  await page.mouse.click(rim.x, rim.y);
  const end = at(5, 5);
  await page.mouse.move(end.x, end.y);
  await page.mouse.click(end.x, end.y);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // The curved edge is projected and the point is held on it.
  await expect
    .poll(async () => (await counts(page)).constraints, { timeout: 60_000 })
    .toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);
  await expect
    .poll(() => attr(viewport, 'data-sketch-projected'), { timeout: 60_000 })
    .toContain(`${sketch}:curves=1`);
});
