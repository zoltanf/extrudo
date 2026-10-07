import { expect, type Locator, type Page, test } from '@playwright/test';
import { clickAt, primitive, settled, zoomOutTo } from './benchmark-helpers';
import {
  counts,
  kernelReady,
  mapping,
  newSketchOnXY,
  openProject,
  openSketch,
  projector,
} from './helpers';

// P4-12 (ADR-0031's amendment): Project takes a sphere's outline (a silhouette,
// not just its edges), Intersect (Shift+P) brings in the curves where a body
// meets the sketch plane, and with "Keep linked" off the curves come in as
// plain sketch geometry that no longer follows the model.

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 90_000 });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const attr = async (el: Locator, name: string) => (await el.getAttribute(name)) ?? '';
const browserRow = (page: Page, name: string) =>
  page.getByRole('complementary', { name: 'Browser' }).getByRole('button', { name, exact: true });

/** Hovers sketch point (x, y) of the Top view until the view offers a face, then clicks it. */
async function clickFace(page: Page, viewport: Locator, x: number, y: number) {
  const at = await mapping(viewport);
  const p = at(x, y);
  await page.mouse.move(p.x, p.y);
  await expect.poll(() => attr(viewport, 'data-model-hover')).toMatch(/^face:/);
  await page.mouse.click(p.x, p.y);
}

test('projects a sphere below the sketch as its outline: one circle', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Sphere', { Diameter: '20 mm', Offset: '-40 mm' });
  await newSketchOnXY(page);
  await settled(viewport);
  const sketch = await openSketch(page);

  await page.keyboard.press('p');
  const panel = page.getByRole('region', { name: 'Project', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('checkbox', { name: 'Keep linked' })).toBeChecked();
  await clickFace(page, viewport, 3, 2);
  // (The summary's bounds are the curves' points: a circle's centre.)
  await expect
    .poll(() => attr(viewport, 'data-sketch-projected'))
    .toBe(`${sketch}:curves=1:x=0..0:y=0..0`);
  await expect.poll(async () => (await counts(page)).circles).toBe(1);
  // The circle and its centre follow the model: the solver holds them.
  await expect(viewport).toHaveAttribute('data-sketch-status', 'free=0 fixed=2 conflict=0');
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(panel).toBeHidden();
});

test('Intersect (Shift+P) cuts a cylinder with an angled plane into an ellipse', async ({
  page,
}) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  // A box whose front and top faces give a plane at 45° (z = y + 30), then a tall cylinder
  // beside it that the plane cuts.
  await primitive(page, 'Box', { Length: '40 mm', Width: '20 mm', Height: '20 mm' });
  await page.keyboard.press('Shift+1');
  await settled(viewport);
  const at = await projector(viewport);
  const group = page.getByRole('group', { name: 'Construct', exact: true });
  await group.getByRole('button', { name: 'Construct', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Angled Midplane/ }).click();
  const dialog = page.getByRole('region', { name: 'Angled Midplane dialog' });
  await expect(dialog).toBeVisible();
  await clickAt(page, at, [0, -10, 10]); // the box's front, normal −Y
  await clickAt(page, at, [0, 0, 20]); // its top, normal +Z
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await primitive(page, 'Cylinder', { Diameter: '20 mm', Height: '60 mm', X: '60 mm' });

  await page.getByRole('button', { name: 'Create Sketch' }).click();
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('group', { name: 'Construction planes' })
    .getByRole('button', { name: 'Angled Midplane1' })
    .click();
  await expect(viewport).toHaveAttribute('data-sketch-frames', /:0,-0\.707,0\.707$/, {
    timeout: 15_000,
  });
  const sketch = await openSketch(page);

  await page.keyboard.press('Shift+P');
  const panel = page.getByRole('region', { name: 'Intersect', exact: true });
  await expect(panel).toBeVisible();
  // A body is picked through its browser row.
  await browserRow(page, 'Body2').click();
  await expect
    .poll(() => attr(viewport, 'data-sketch-projected'))
    .toMatch(new RegExp(`^${sketch}:curves=1:`));
  await expect.poll(async () => (await counts(page)).ellipses).toBe(1);
  // The same body again is refused.
  await browserRow(page, 'Body2').click();
  await expect(page.getByRole('alert')).toContainText('already intersected');
});

test('with "Keep linked" off, the curves are plain and can be moved', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Box', {
    Length: '40 mm',
    Width: '20 mm',
    Height: '10 mm',
    Offset: '-30 mm',
  });
  await newSketchOnXY(page);
  await settled(viewport);

  await page.keyboard.press('p');
  const panel = page.getByRole('region', { name: 'Project', exact: true });
  await panel.getByRole('checkbox', { name: 'Keep linked' }).uncheck();
  await clickFace(page, viewport, 5, 3);
  // Four lines with their own ends, held by nothing, and no projection left.
  await expect.poll(async () => (await counts(page)).lines).toBe(4);
  await expect(viewport).toHaveAttribute('data-sketch-status', 'free=12 fixed=0 conflict=0');
  await expect(viewport).not.toHaveAttribute('data-sketch-projected', /./);
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
  await panel.getByRole('button', { name: 'Done' }).click();

  // Drag the top side 10 mm up: it moves on its own, and the outline opens. (The sketch
  // opened fitted to the box below it, in perspective: zoom out, and map through the camera.)
  const box = await viewport.boundingBox();
  if (!box) throw new Error('no viewport');
  await zoomOutTo(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 150);
  await settled(viewport);
  const at = await projector(viewport);
  const from = at([0, 10, 0]);
  const to = at([0, 20, 0]);
  await page.mouse.move(from.x, from.y);
  const overlay = page.locator('[data-hover-entity]');
  await expect
    .poll(
      async () =>
        (await overlay.count()) > 0 && (await overlay.first().getAttribute('data-hover-entity')),
    )
    .toBeTruthy();
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  }
  await page.mouse.up();
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=0 holes=0');
  await expect(viewport).not.toHaveAttribute('data-sketch-projected', /./);
});
