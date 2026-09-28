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
    'distance:length distance:width distance:height angle:rotation',
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
  await expect(cylinder.getByRole('textbox', { name: 'X', exact: true })).toHaveValue('0 mm');
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
