import { expect, type Locator, type Page, test } from '@playwright/test';
import { primitive } from './benchmark-helpers';
import { clicker, kernelReady, mapping, openProject, pickTool, projector } from './helpers';

// P4-04: Emboss and deboss (FR-FT-16, ADR-0060). A whole text from a sketch
// in any plane parallel to a face is put **onto** that face in one step: on a
// flat face it is moved onto it, on a round face it is wrapped round it so the
// letters keep their width. One feature, with a Mode: Emboss stands the letters
// out, Deboss presses them in.
//
// Both cases sketch on a construction plane clear of the body, so the letters
// can be picked in the view, and emboss a face a click away from where they
// were drawn. A thread's wall-picking helpers are reused for the round case.

test.use({ viewport: { width: 1440, height: 900 } });
// A box, a plane, a sketch, a text and two previews per test: about a minute.
test.describe.configure({ timeout: 180_000 });

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
const dialogOf = (page: Page, name: string) => page.getByRole('region', { name: `${name} dialog` });
const textPanel = (page: Page) => page.getByRole('region', { name: 'Text' });

/** "Body1:14:20,21,20" as {name, faces, size: [x, y, z]}. */
async function bodies(page: Page): Promise<{ name: string; faces: number; size: number[] }[]> {
  return (await attr(viewportOf(page), 'data-bodies'))
    .split(' ')
    .filter(Boolean)
    .map((entry) => {
      const [name, faces, size] = entry.split(':');
      return { name: name ?? '', faces: Number(faces), size: (size ?? '').split(',').map(Number) };
    });
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

type At = Awaited<ReturnType<typeof settledProjector>>;

/** Clicks a world point with the mouse (no hover wait). */
async function clickAt(page: Page, at: At, p: [number, number, number]) {
  const { x, y } = at(p);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
}

/** Clicks a world point once the view hovers a face, then takes it. */
async function clickFace(page: Page, at: At, p: [number, number, number]) {
  const { x, y } = at(p);
  await page.mouse.move(x, y);
  await expect.poll(() => attr(viewportOf(page), 'data-model-hover')).toMatch(/^face:/);
  await page.mouse.click(x, y);
}

/** Commits a dialog: its preview came out, then OK and the recompute. */
async function ok(page: Page, dialog: Locator) {
  await expect(dialog).toHaveAttribute('data-preview-status', /^(ok|warning)$/, {
    timeout: 30_000,
  });
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
}

/**
 * A construction plane `distance` from an origin plane, made through its
 * dialog: the plane's square is clicked in the view (`plane` names which).
 */
async function offsetPlane(page: Page, plane: 'XY' | 'XZ', distance: string, viewport: Locator) {
  await pickTool(page, 'Offset Plane');
  const dialog = dialogOf(page, 'Offset Plane');
  await expect(dialog).toBeVisible();
  const at = await settledProjector(viewport);
  const half = Number(await viewport.getAttribute('data-camera-size')) * 0.16;
  // A corner of the origin plane's square that no other plane is in front of.
  await clickAt(
    page,
    at,
    plane === 'XY' ? [half * 0.5, -half * 0.5, 0] : [half * 0.5, 0, half * 0.5],
  );
  await expect(dialog.getByRole('button', { name: 'Plane', exact: true })).toHaveText(
    `${plane} plane`,
  );
  await dialog.getByRole('textbox', { name: 'Distance' }).fill(distance);
  await ok(page, dialog);
}

/** A sketch on a construction plane, with the text placed and finished. */
async function sketchText(
  page: Page,
  viewport: Locator,
  plane: RegExp,
  text: string,
  at: [number, number],
  height: string,
) {
  await pickTool(page, 'Create Sketch');
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('group', { name: 'Construction planes' })
    .getByRole('button', { name: 'Offset Plane1' })
    .click();
  await expect(viewport).toHaveAttribute('data-sketch-frames', plane, { timeout: 15_000 });
  const map = await mapping(viewport);
  const click = clicker(page, map);
  await page.keyboard.press('Shift+T');
  await expect(page.getByRole('status', { name: 'Tool prompt' })).toBeVisible();
  await click(at[0], at[1]);
  await expect(textPanel(page)).toBeVisible();
  await textPanel(page).getByRole('textbox', { name: 'Text' }).fill(text);
  await textPanel(page).getByRole('textbox', { name: 'Height' }).fill(height);
  await textPanel(page).getByRole('button', { name: 'OK' }).click();
  await expect(textPanel(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();
  await kernelReady(page);
}

/**
 * The drawn text's ink in sketch mm, once its font has arrived (P4-03).
 */
async function ink(page: Page): Promise<{ x: [number, number]; y: [number, number] }> {
  const viewport = viewportOf(page);
  await expect.poll(() => attr(viewport, 'data-text-bounds')).toContain('x=');
  const entry = (await attr(viewport, 'data-text-bounds')).split(' ').find(Boolean) ?? '';
  const [, xs, ys] = entry.split(':');
  const range = (v: string | undefined) =>
    (v?.slice(2) ?? '').split('..').map(Number) as [number, number];
  return { x: range(xs), y: range(ys) };
}

/** Sketch-mm points inside an ink box, a coarse grid from the middle out. */
function inkPoints(ink: { x: [number, number]; y: [number, number] }): [number, number][] {
  const [x0, x1] = ink.x;
  const [y0, y1] = ink.y;
  const out: [number, number][] = [];
  for (let y = (y0 + y1) / 2; y < y1; y += 0.5) {
    for (let x = (x0 + x1) / 2; x < x1; x += 0.5) out.push([x, y]);
  }
  for (let y = y0; y < (y0 + y1) / 2; y += 0.5) {
    for (let x = x0; x < (x0 + x1) / 2; x += 0.5) out.push([x, y]);
  }
  return out;
}

/** Clicks a letter of the drawn text in the model, which takes the whole text. */
async function pickText(
  page: Page,
  viewport: Locator,
  at: At,
  world: (sketch: [number, number]) => [number, number, number],
) {
  for (const [u, v] of inkPoints(await ink(page))) {
    const { x, y } = at(world([u, v]));
    await page.mouse.move(x, y);
    if (!/^sketchEntity:/.test(await attr(viewport, 'data-model-hover'))) continue;
    await page.mouse.click(x, y);
    await expect
      .poll(() => attr(viewport, 'data-model-selection'))
      .toMatch(/^sketchEntity:[^/]+\/[^/]+$/);
    return;
  }
  throw new Error('no letter under the pointer');
}

test('embosses a text on a flat face and presses it back in as a deboss', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Box', {});
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');

  // The text 40 mm above the box, over its middle: in the clear, so a click can
  // take it, and the letters land on the top face under it.
  await offsetPlane(page, 'XY', '40 mm', viewport);
  await sketchText(page, viewport, /:0,0,40:0,0,1$/, 'ABC', [0, 0], '5 mm');
  const at = await settledProjector(viewport);
  await pickText(page, viewport, at, ([u, v]) => [u, v, 40]);

  await pickTool(page, 'Emboss');
  const dialog = dialogOf(page, 'Emboss');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Profiles', exact: true })).toHaveText('1 text');
  // The box's top face, 40 mm below the letters.
  await clickFace(page, at, [0, 0, 10]);
  await expect(dialog.getByRole('button', { name: 'Face', exact: true })).toHaveText('1 face');
  await dialog.getByRole('textbox', { name: 'Depth' }).fill('1 mm');
  await ok(page, dialog);

  // One body, the letters 1 mm proud of its top face.
  await expect(chip(page, 'Emboss1')).toHaveAccessibleName('Emboss1');
  const raised = await bodies(page);
  expect(raised).toHaveLength(1);
  expect(raised[0]?.size[2]).toBeCloseTo(21, 1);
  expect(raised[0]?.faces).toBeGreaterThan(6);

  // The same feature as a deboss: the letters go into the top face instead, so
  // the body is its old size again with the letters' faces in it.
  await chip(page, 'Emboss1').dblclick();
  const edit = dialogOf(page, 'Edit Emboss1');
  await expect(edit).toBeVisible();
  await expect(edit.getByRole('button', { name: 'Profiles', exact: true })).toHaveText('1 text');
  await expect(edit.getByRole('button', { name: 'Face', exact: true })).toHaveText('1 face');
  await edit.getByRole('combobox', { name: 'Mode' }).selectOption('deboss');
  await ok(page, edit);
  const pressed = await bodies(page);
  expect(pressed).toHaveLength(1);
  expect(pressed[0]?.size[2]).toBeCloseTo(20, 1);
  expect(pressed[0]?.faces).toBeGreaterThan(6);
});

test('wraps a text round a cylinder wall, and presses it back in as a deboss', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Cylinder', {});
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:3:20,20,20');

  // A sketch on a plane 30 mm in front of the cylinder (its XZ plane, whose
  // normal looks at the home view's camera), so the letters are drawn clear of
  // the wall and can be clicked. The wrap ignores how far the plane is.
  await offsetPlane(page, 'XZ', '30 mm', viewport);
  await expect(viewport).toHaveAttribute('data-construction', 'Offset_Plane1:plane:0,-30,0:0,-1,0');
  await sketchText(page, viewport, /:0,-30,0:0,-1,0$/, 'AB', [0, 10], '5 mm');

  const at = await settledProjector(viewport);
  // A letter of `AB` on the plane, which the wrap puts on the wall behind it.
  await pickText(page, viewport, at, ([u, v]) => [u, -30, v]);

  await pickTool(page, 'Emboss');
  const dialog = dialogOf(page, 'Emboss');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Profiles', exact: true })).toHaveText('1 text');
  // The wall the letters stand on: its own face, clear of them, and the one the
  // sketch plane looks at.
  await clickFace(page, at, [0, -10, 17]);
  await expect(dialog.getByRole('button', { name: 'Face', exact: true })).toHaveText('1 face');
  await dialog.getByRole('textbox', { name: 'Depth' }).fill('1 mm');
  // The depth arrow stands on the wall among the letters, radially out of it.
  await expect(viewport.locator('[data-manipulators]')).toHaveAttribute(
    'data-manipulators',
    'distance:depth',
  );
  await ok(page, dialog);

  // One body: the letters stand 1 mm off the wall, so it is 1 mm wider across.
  await expect(chip(page, 'Emboss1')).toHaveAccessibleName('Emboss1');
  const raised = await bodies(page);
  expect(raised).toHaveLength(1);
  expect(raised[0]?.name).toBe('Body1');
  expect(raised[0]?.size[0]).toBeCloseTo(20, 1);
  expect(raised[0]?.size[1]).toBeCloseTo(21, 1);
  expect(raised[0]?.size[2]).toBeCloseTo(20, 1);
  expect(raised[0]?.faces).toBeGreaterThan(3);

  // A deboss cuts the same letters into the wall: the body is its old size
  // again, with their walls in it.
  await chip(page, 'Emboss1').dblclick();
  const edit = dialogOf(page, 'Edit Emboss1');
  await expect(edit).toBeVisible();
  await edit.getByRole('combobox', { name: 'Mode' }).selectOption('deboss');
  await ok(page, edit);
  const pressed = await bodies(page);
  expect(pressed).toHaveLength(1);
  expect(pressed[0]?.size[0]).toBeCloseTo(20, 1);
  expect(pressed[0]?.size[1]).toBeCloseTo(20, 1);
  expect(pressed[0]?.size[2]).toBeCloseTo(20, 1);
  expect(pressed[0]?.faces).toBeGreaterThan(3);
});

// P4-12 (ADR-0060's amendment): a cone wraps like a cylinder, and any other
// curved face takes the profiles projected along the sketch's normal; the
// dialog's read-only Method line says which the kernel did.
const method = (dialog: Locator) => dialog.locator('[data-info="method"]');

test('wraps a text round a cone (a drafted cylinder), out and in', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Cylinder', {});
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:3:20,20,20');
  const at = await settledProjector(viewport);
  const half = Number(await viewport.getAttribute('data-camera-size')) * 0.16;

  // Draft the wall 10° about the XY plane: it narrows towards the top, a cone.
  await pickTool(page, 'Draft');
  const draft = dialogOf(page, 'Draft');
  await expect(draft).toBeVisible();
  await clickFace(page, at, [0, -10, 10]);
  await expect(draft.getByRole('button', { name: 'Faces', exact: true })).toHaveText('1 face');
  await draft.getByRole('button', { name: 'Plane', exact: true }).click();
  await clickAt(page, at, [half * 0.75, -half * 0.75, 0]);
  await expect(draft.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
  await draft.getByRole('textbox', { name: 'Angle', exact: true }).fill('10 deg');
  await ok(page, draft);
  await expect(chip(page, 'Draft1')).toBeVisible();

  // The text on a plane 30 mm in front, as on the cylinder.
  await offsetPlane(page, 'XZ', '30 mm', viewport);
  await sketchText(page, viewport, /:0,-30,0:0,-1,0$/, 'AB', [0, 10], '5 mm');
  const view = await settledProjector(viewport);
  await pickText(page, viewport, view, ([u, v]) => [u, -30, v]);
  const plain = (await bodies(page))[0]?.faces ?? 0;

  await pickTool(page, 'Emboss');
  const dialog = dialogOf(page, 'Emboss');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Profiles', exact: true })).toHaveText('1 text');
  // The cone's wall high up, clear of the letters: its radius there is 10 - 17 tan 10°.
  const r = 10 - 17 * Math.tan((10 * Math.PI) / 180);
  await clickFace(page, view, [0, -r * 0.99, 17]);
  await expect(dialog.getByRole('button', { name: 'Face', exact: true })).toHaveText('1 face');
  await expect(method(dialog)).toHaveText('Wrapped round the cone', { timeout: 30_000 });
  await ok(page, dialog);
  const raised = await bodies(page);
  expect(raised).toHaveLength(1);
  expect(raised[0]?.faces).toBeGreaterThan(plain);

  await chip(page, 'Emboss1').dblclick();
  const edit = dialogOf(page, 'Edit Emboss1');
  await expect(edit).toBeVisible();
  await edit.getByRole('combobox', { name: 'Mode' }).selectOption('deboss');
  await expect(method(edit)).toHaveText('Wrapped round the cone', { timeout: 30_000 });
  await ok(page, edit);
  const pressed = await bodies(page);
  expect(pressed).toHaveLength(1);
  expect(pressed[0]?.faces).toBeGreaterThan(plain);
  expect(pressed[0]?.size[2]).toBeCloseTo(20, 1);
});

test('projects a circle onto a sphere, out and in', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Sphere', {});
  // The display mesh's box is a tessellation short across the equator (19.9).
  await expect(viewport).toHaveAttribute('data-bodies', /^Body1:1:/);
  const plain = (await bodies(page))[0]?.size ?? [];

  // A Ø6 circle on a plane 40 mm above the sphere's centre, over its top.
  await offsetPlane(page, 'XY', '40 mm', viewport);
  await pickTool(page, 'Create Sketch');
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('group', { name: 'Construction planes' })
    .getByRole('button', { name: 'Offset Plane1' })
    .click();
  await expect(viewport).toHaveAttribute('data-sketch-frames', /:0,0,40:0,0,1$/, {
    timeout: 15_000,
  });
  const click = clicker(page, await mapping(viewport));
  await page.keyboard.press('c');
  await click(0, 0);
  // Typed, so the grid can't snap the diameter.
  const headsUp = page.getByRole('group', { name: 'Heads-up input' });
  await expect(headsUp).toBeVisible();
  const diameter = headsUp.getByRole('textbox', { name: 'Diameter' });
  await diameter.fill('6 mm');
  await diameter.press('Enter');
  await page.keyboard.press('Escape');
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();
  await kernelReady(page);

  // The disc picked in the model, where it lies above the sphere.
  const at = await settledProjector(viewport);
  let picked = false;
  for (const [u, v] of [
    [0, 0],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1.5, -1.5],
  ] as const) {
    const { x, y } = at([u, v, 40]);
    await page.mouse.move(x, y);
    if (!/^profile:/.test(await attr(viewport, 'data-model-hover'))) continue;
    await page.mouse.click(x, y);
    picked = true;
    break;
  }
  expect(picked).toBe(true);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);

  await pickTool(page, 'Emboss');
  const dialog = dialogOf(page, 'Emboss');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Profiles', exact: true })).toHaveText(
    'Profile · Sketch1',
  );
  // The sphere where it looks at the home view's camera, clear of the disc.
  const s = 10 / Math.sqrt(3);
  await clickFace(page, at, [s, -s, s]);
  await expect(dialog.getByRole('button', { name: 'Face', exact: true })).toHaveText('1 face');
  await expect(method(dialog)).toHaveText('Projected onto the face', { timeout: 30_000 });
  await ok(page, dialog);
  // The disc stands 1 mm off the top of the sphere.
  const raised = await bodies(page);
  expect(raised).toHaveLength(1);
  expect(Math.abs((raised[0]?.size[2] ?? 0) - ((plain[2] ?? 0) + 1))).toBeLessThan(0.15);
  expect(raised[0]?.faces).toBeGreaterThan(1);

  await chip(page, 'Emboss1').dblclick();
  const edit = dialogOf(page, 'Edit Emboss1');
  await expect(edit).toBeVisible();
  await edit.getByRole('combobox', { name: 'Mode' }).selectOption('deboss');
  await expect(method(edit)).toHaveText('Projected onto the face', { timeout: 30_000 });
  await ok(page, edit);
  const pressed = await bodies(page);
  expect(pressed).toHaveLength(1);
  // The cut takes the sphere's top away: its highest point is now the rim of the
  // Ø6 hole, √(10² − 3²) above the centre.
  expect(Math.abs((pressed[0]?.size[2] ?? 0) - (10 + Math.sqrt(91)))).toBeLessThan(0.15);
  expect(pressed[0]?.faces).toBeGreaterThan(1);
});
