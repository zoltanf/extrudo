import { expect, type Locator, type Page, test } from '@playwright/test';
import { exportModel, objectsOf3mf, solidTab } from './benchmark-helpers';
import { kernelReady, openProject, pickTool, projector } from './helpers';

// P3-02: Chamfer (ADR-0043, FR-FT-05, FR-UX-06). Edges are picked in the
// view (a picked edge brings its tangent chain), each set has its own type
// (equal distance, two distances, distance and angle) and values, the
// preview is live, and a distance that is too large says which edge and how
// large it may be. One undo step.

test.use({ viewport: { width: 1440, height: 900 } });
// The reference-face test exports the model twice for its measurements.
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

/** Clicks an edge at its world midpoint, a couple of pixels off (as the selection tests do). */
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

/** Starts the Chamfer tool from the toolbar (it has no key). */
const startChamfer = (page: Page) => page.getByRole('button', { name: /^Chamfer/ }).click();

/** Clicks a point of the model in the view; a dialog's pick field takes the click. */
async function clickWorld(
  page: Page,
  at: (p: [number, number, number]) => { x: number; y: number },
  p: [number, number, number],
) {
  const { x, y } = at(p);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
}

/**
 * The top face of the cube from a 3MF export: its area (its triangles are the
 * ones in the plane z = 20, where the chamfer's footprint shows) and the model's
 * volume (a tessellation, so a little under).
 */
async function measureTop(page: Page) {
  const objects = objectsOf3mf(await exportModel(page, '3MF'));
  await solidTab(page);
  expect(objects).toHaveLength(1);
  const mesh = objects[0]?.mesh;
  if (!mesh) throw new Error('no mesh');
  const { positions: p, indices: i } = mesh;
  const at = (node: number, k: number) => p[3 * node + k] ?? 0;
  const top = (z: number) => Math.abs(at(z, 2) - 20) < 1e-6;
  let area = 0;
  let volume = 0;
  for (let t = 0; t + 2 < i.length; t += 3) {
    const a = i[t] as number;
    const b = i[t + 1] as number;
    const c = i[t + 2] as number;
    if (top(a) && top(b) && top(c)) {
      const u = [0, 1, 2].map((k) => at(b, k) - at(a, k));
      const v = [0, 1, 2].map((k) => at(c, k) - at(a, k));
      const cross = [
        (u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number),
        (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number),
        (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number),
      ];
      area += 0.5 * Math.hypot(cross[0] as number, cross[1] as number, cross[2] as number);
    }
    volume +=
      (at(a, 0) * (at(b, 1) * at(c, 2) - at(b, 2) * at(c, 1)) -
        at(a, 1) * (at(b, 0) * at(c, 2) - at(b, 2) * at(c, 0)) +
        at(a, 2) * (at(b, 0) * at(c, 1) - at(b, 1) * at(c, 0))) /
      6;
  }
  return { area, volume };
}

test('bevels edges in sets of their own type; a distance that is too large says how large it may be', async ({
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
  await startChamfer(page);
  const dialog = page.getByRole('region', { name: 'Chamfer dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Edges', exact: true })).toHaveText('1 edge');
  await expect(dialog.getByRole('combobox', { name: 'Type', exact: true })).toHaveValue('equal');
  await expect(dialog.getByRole('textbox', { name: 'Distance', exact: true })).toHaveValue('1 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await expect(viewport).toHaveAttribute('data-preview', /./);

  // Too large: the message names the edge and the largest distance that works.
  await dialog.getByRole('textbox', { name: 'Distance', exact: true }).fill('50 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'error', { timeout: 15_000 });
  await expect(dialog.getByRole('status', { name: 'Feature status' })).toContainText(
    /Distance 50 mm is too large for edge \d+ \(max ≈ 1\d(\.\d)? mm\)\./,
  );
  await expect(dialog.getByRole('button', { name: 'OK' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Distance', exact: true }).fill('3 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });

  // A second set appears once the first has edges, with its own type: two distances.
  await dialog.getByRole('button', { name: 'Edges 2', exact: true }).click();
  await clickEdge(page, at, [10, 0, 20]);
  await expect(dialog.getByRole('button', { name: 'Edges 2', exact: true })).toHaveText('1 edge');
  await dialog
    .getByRole('combobox', { name: 'Type 2', exact: true })
    .selectOption({ label: 'Two distances' });
  await expect(
    dialog.getByRole('textbox', { name: 'Second distance 2', exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Flip 2', exact: true })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Distance 2', exact: true }).fill('4 mm');
  await dialog.getByRole('textbox', { name: 'Second distance 2', exact: true }).fill('1 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  // Flip swaps the faces: still a valid preview.
  await dialog.getByRole('checkbox', { name: 'Flip 2', exact: true }).click();
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);

  // A face for each edge; one undo step takes both away.
  await expect(chip(page, 'Chamfer1')).toHaveAccessibleName('Chamfer1');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:8:20,20,20');
  await page.keyboard.press('Control+z');
  await expect(chip(page, 'Chamfer1')).toHaveCount(0);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
});

test('distance and angle: the angle is only asked for in that type, and 90° is refused', async ({
  page,
}) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  const at = await settledProjector(viewport);

  await clickEdge(page, at, [0, -10, 20]);
  await startChamfer(page);
  const dialog = page.getByRole('region', { name: 'Chamfer dialog' });
  await expect(dialog.getByRole('textbox', { name: 'Angle', exact: true })).toHaveCount(0);
  await dialog
    .getByRole('combobox', { name: 'Type', exact: true })
    .selectOption({ label: 'Distance and angle' });
  await expect(dialog.getByRole('textbox', { name: 'Angle', exact: true })).toHaveValue('45 deg');
  await dialog.getByRole('textbox', { name: 'Distance', exact: true }).fill('5 mm');
  await dialog.getByRole('textbox', { name: 'Angle', exact: true }).fill('30 deg');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('textbox', { name: 'Angle', exact: true }).fill('90 deg');
  await expect(dialog).toHaveAttribute('data-preview-status', 'error', { timeout: 15_000 });
  await expect(dialog.getByRole('status', { name: 'Feature status' })).toContainText(
    'The angle of edge set 1 is 90°. Enter an angle between 0° and 90°.',
  );
  await dialog.getByRole('textbox', { name: 'Angle', exact: true }).fill('30 deg');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:20,20,20');

  // Editing the feature opens on its stored type and values.
  await chip(page, 'Chamfer1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Chamfer1 dialog' });
  await expect(edit.getByRole('combobox', { name: 'Type', exact: true })).toHaveValue(
    'distance-angle',
  );
  await expect(edit.getByRole('textbox', { name: 'Distance', exact: true })).toHaveValue('5 mm');
  await expect(edit.getByRole('textbox', { name: 'Angle', exact: true })).toHaveValue('30 deg');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await edit.getByRole('button', { name: 'Cancel Esc' }).click();
  await expect(edit).toBeHidden();
});

test('a picked edge brings its tangent chain, which is bevelled as one', async ({ page }) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  const at = await settledProjector(viewport);

  // Round the three vertical edges the home view shows, with the Fillet tool.
  await clickEdge(page, at, [10, -10, 10]);
  await page.keyboard.press('f');
  const fillet = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(fillet.getByRole('button', { name: 'Edges', exact: true })).toHaveText('1 edge');
  await clickEdge(page, at, [-10, -10, 10]);
  await clickEdge(page, at, [10, 10, 10]);
  await expect(fillet.getByRole('button', { name: 'Edges', exact: true })).toHaveText('3 edges');
  await fillet.getByRole('textbox', { name: 'Radius', exact: true }).fill('4 mm');
  await expect(fillet).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await fillet.getByRole('button', { name: 'OK' }).click();
  await expect(fillet).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:9:20,20,20');

  // The top front edge now runs between two arcs: it comes with them and the edges beyond,
  // seven up to the sharp corner at the back.
  await clickTopFront(page, at);
  await startChamfer(page);
  const dialog = page.getByRole('region', { name: 'Chamfer dialog' });
  await expect(dialog.getByRole('button', { name: 'Edges', exact: true })).toHaveText('7 edges');
  // Unpicking one edge of a chain takes the whole chain out; picking it brings it back.
  await clickTopFront(page, at);
  await expect(dialog.getByRole('button', { name: 'Edges', exact: true })).toHaveText('Pick edges');
  await clickTopFront(page, at);
  await expect(dialog.getByRole('button', { name: 'Edges', exact: true })).toHaveText('7 edges');
  await dialog.getByRole('textbox', { name: 'Distance', exact: true }).fill('1 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:16:20,20,20');
});

test('a picked reference face says which face takes the distance', async ({ page }) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  const at = await settledProjector(viewport);

  // The top front edge, between the top face and the front one.
  await clickEdge(page, at, [0, -10, 20]);
  await startChamfer(page);
  const dialog = page.getByRole('region', { name: 'Chamfer dialog' });
  // An equal-distance chamfer takes the same distance on both faces: nothing to name.
  await expect(dialog.getByRole('button', { name: 'Reference face', exact: true })).toHaveCount(0);
  await dialog
    .getByRole('combobox', { name: 'Type', exact: true })
    .selectOption({ label: 'Two distances' });
  const face = dialog.getByRole('button', { name: 'Reference face', exact: true });
  await expect(face).toHaveText('Automatic');
  await expect(dialog.getByRole('checkbox', { name: 'Flip', exact: true })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Distance', exact: true }).fill('2 mm');
  await dialog.getByRole('textbox', { name: 'Second distance', exact: true }).fill('6 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });

  // The top face takes the 2 mm: the flip is gone, the face decides.
  await face.click();
  await clickWorld(page, at, [0, 0, 20]);
  await expect(face).toHaveText('1 face');
  await expect(dialog.getByRole('checkbox', { name: 'Flip', exact: true })).toHaveCount(0);
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:20,20,20');
  const withTop = await measureTop(page);

  // The same chamfer with the front face as the reference: 6 mm off the top instead of 2.
  await chip(page, 'Chamfer1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Chamfer1 dialog' });
  await expect(edit).toBeVisible();
  await expect(edit.getByRole('button', { name: 'Reference face', exact: true })).toHaveText(
    '1 face',
  );
  await edit.getByRole('button', { name: 'Reference face', exact: true }).click();
  await clickWorld(page, at, [0, -10, 5]);
  await expect(edit.getByRole('button', { name: 'Reference face', exact: true })).toHaveText(
    '1 face',
  );
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(edit).toBeHidden();
  await kernelReady(page);
  const withFront = await measureTop(page);
  // The top face gives up the 2 mm along the 20 mm edge, then the 6 mm.
  expect(withTop.area).toBeCloseTo(400 - 2 * 20, 0);
  expect(withFront.area).toBeCloseTo(400 - 6 * 20, 0);
  // The same wedge of material either way round: one right triangle per mm of edge.
  expect(withTop.volume).toBeCloseTo(withFront.volume, 0);
  expect(withTop.volume).toBeCloseTo(8000 - 0.5 * 2 * 6 * 20, -1);
});
