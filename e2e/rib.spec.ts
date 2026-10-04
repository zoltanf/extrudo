import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  attr,
  chip,
  exportModel,
  fill,
  objectsOf3mf,
  ok,
  settled,
  solidTab,
  toolPrompt,
} from './benchmark-helpers';
import { clicker, kernelReady, openProject, pickTool, projector } from './helpers';

// P4-10: the rib (FR-FT-17, ADR-0064 §1). A sketch line on the Wall bracket's
// middle plane becomes a thin wall that fills the space between the line and
// the legs: the volume grows by the triangle the line's extension cuts from the
// legs, times the thickness. Flipped, the wall grows away from the corner into
// open air and the kernel says so.

test.use({ viewport: { width: 1440, height: 900 } });
// Two exports, a sketch, a rib and its preview per test: about a minute.
test.describe.configure({ timeout: 240_000 });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const viewportOf = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const dialogOf = (page: Page, name: string) => page.getByRole('region', { name: `${name} dialog` });

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

/**
 * The Wall bracket: an L in XZ (a 40 mm base, a 2.4 mm wall 60 mm tall, its
 * inside corner filleted with `wall / 2` = 1.2 mm) extruded ±40 mm along Y.
 */
const WALL = 2.4;
const OUTER: [number, number] = [0, 60];
const INNER: [number, number] = [40, 0];

/**
 * The triangle the line's extension cuts from the legs' inner faces, mm²: the
 * corner's two legs up to the line. The fillet's 0.31 mm² at the corner are
 * left out (0.07 % of the triangle, well inside a 1 % check).
 */
function triangle(a: readonly [number, number], b: readonly [number, number]) {
  const [x0, y0] = a;
  const [x1, y1] = b;
  // Where the line meets x = WALL and z = WALL.
  const up: [number, number] = [WALL, y0 + ((y1 - y0) * (WALL - x0)) / (x1 - x0)];
  const along: [number, number] = [x0 + ((x1 - x0) * (WALL - y0)) / (y1 - y0), WALL];
  const corner: [number, number] = [WALL, WALL];
  const area = Math.abs(
    (up[0] - corner[0]) * (along[1] - corner[1]) - (along[0] - corner[0]) * (up[1] - corner[1]),
  );
  return area / 2;
}

/** The bracket's volume in mm³, from a 3MF export of the model (a tessellation). */
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

/** Draws the rib's line on a new sketch (Sketch3) on the XZ plane, through the bracket. */
async function ribLine(page: Page, viewport: Locator) {
  await page.getByRole('button', { name: 'Create Sketch' }).click();
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XZ' })
    .click();
  await settled(viewport);
  const xz = await projector(viewport);
  const click = clicker(page, (x, y) => xz([x, 0, y]));
  // The Line tool (`l`): two points, an open curve — the rib's open edge.
  await page.keyboard.press('l');
  await click(OUTER[0], OUTER[1]);
  await click(INNER[0], INNER[1]);
  // The Line tool keeps drawing chains: the first Escape ends this one, the
  // second the tool.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  // The template brings Sketch1 and Sketch2; this is the third.
  await expect(chip(page, 'Sketch3')).toBeVisible();
  await kernelReady(page);
  return xz;
}

/**
 * Selects the sketch's line in the view, a little along it from its middle (a
 * stroke can be thin): the hover names it before the click takes it.
 */
async function selectLine(
  page: Page,
  viewport: Locator,
  xz: (p: readonly [number, number, number]) => { x: number; y: number },
  at: readonly [number, number, number],
) {
  for (const nudge of [0, 0.5, -0.5, 1, -1, 2, -2]) {
    const point = xz([at[0] + nudge, at[1], at[2]]);
    await page.mouse.move(point.x, point.y);
    if (!/^sketchEntity:/.test(await attr(viewport, 'data-model-hover'))) continue;
    await page.mouse.click(point.x, point.y);
    await expect
      .poll(() => attr(viewport, 'data-model-selection'))
      .toMatch(/^sketchEntity:[^/]+\/[^/]+$/);
    return;
  }
  throw new Error(
    `the line at ${at.join(',')} is not pickable (hover "${await attr(viewport, 'data-model-hover')}")`,
  );
}

test('a rib fills the corner from a sketch line, and flip says it cannot', async ({ page }) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  expect(await bodies(page)).toEqual([{ name: 'Bracket', faces: 12, size: [40, 80, 60] }]);
  const before = await volume(page);

  // The line along the bracket's outer diagonal, on its middle plane: from the
  // wall's top corner to the base's end corner.
  const xz = await ribLine(page, viewport);

  // The line selected in the view is what the dialog asks for first. The
  // bracket's own face is in front of the middle plane in this view, so it is
  // hidden for the pick (the rib needs the body: only the eye goes).
  // The line selected in the view is what the dialog asks for first. The
  // template's own sketch lies in the same plane, and its profile face takes the
  // pick in front of the line, so it is hidden for the pick (eyes only: the rib
  // needs the body, and hiding either changes nothing in the document).
  await page.getByRole('button', { name: 'Hide Sketch1' }).click();
  await page.getByRole('button', { name: 'Hide Sketch2' }).click();
  await selectLine(page, viewport, xz, [20, 0, 30]);
  await page.getByRole('button', { name: 'Show Sketch1' }).click();
  await page.getByRole('button', { name: 'Show Sketch2' }).click();
  await pickTool(page, 'Rib');
  const dialog = dialogOf(page, 'Rib');
  await expect(dialog).toBeVisible();
  // A sketch line's label is the sketch it is in (the pick names the sketch).
  const line = dialog.getByRole('button', { name: 'Line', exact: true });
  await expect(line).toHaveText('Line · Sketch3');
  await expect(line).toHaveAttribute('data-count', '1');
  await fill(dialog, { Thickness: '3 mm' });
  await expect(dialog.getByRole('combobox', { name: 'Thickness side' })).toHaveValue('both');
  await expect(dialog.getByRole('checkbox', { name: 'Flip' })).not.toBeChecked();
  // Two arrows at the line's middle: the thickness across the plane and the way
  // the wall grows.
  await expect(page.locator('[data-manipulators]')).toHaveAttribute(
    'data-manipulators',
    'distance:thickness arrow:flip',
  );
  await ok(page, dialog);

  const after = await bodies(page);
  expect(after).toHaveLength(1);
  // One body, the bracket's own size, with the wall's faces in it: the two it
  // stands on and its sides across the plane, and the filleted corner's, where
  // the wall's ends meet the legs.
  expect(after[0]?.faces).toBeGreaterThan(12);
  expect(after[0]?.size).toEqual([40, 80, 60]);
  expect(await volume(page)).toBeGreaterThan(before);

  // The exact volume: the triangle the line's extension cuts from the legs,
  // times the thickness. The export is a tessellation, so a little under.
  const grown = (await volume(page)) - before;
  expect(grown).toBeGreaterThan(0);
  const wall = triangle(OUTER, INNER) * 3;
  expect(wall).toBeGreaterThan(2500);
  expect(grown / wall).toBeCloseTo(1, 2);

  // Flipped, the wall grows away from the corner into open air: the kernel says
  // so and OK stays off.
  await chip(page, 'Rib1').dblclick();
  const edit = dialogOf(page, 'Edit Rib1');
  await expect(edit).toBeVisible();
  await expect(edit.getByRole('button', { name: 'Line', exact: true })).toHaveText(
    'Line · Sketch3',
  );
  await edit.getByRole('checkbox', { name: 'Flip' }).check();
  await expect(edit.getByRole('status', { name: 'Feature status' })).toContainText(
    "The rib doesn't close against the body",
  );
  // OK is off: the attribute is there only while the dialog can commit.
  await expect(edit).not.toHaveAttribute('data-dialog-valid', 'true');
  await expect(edit.getByRole('button', { name: 'OK' })).toBeDisabled();
  // The preview that fails draws the bodies from before it: the bracket, whole.
  await expect(viewport).toHaveAttribute('data-bodies', 'Bracket:12:40,80,60');
  await edit.getByRole('button', { name: 'Cancel Esc' }).click();
  await expect(edit).toBeHidden();
  await kernelReady(page);
  // The rib is as it was, on the side of the line the corner is.
  await expect(viewport).toHaveAttribute('data-bodies', `Bracket:${after[0]?.faces}:40,80,60`);
});
