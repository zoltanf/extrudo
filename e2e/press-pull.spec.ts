import { expect, type Locator, type Page, test } from '@playwright/test';
import { clicker, kernelReady, openProject, pickTool, projector, sketchOnXY } from './helpers';

// P3-08: Press Pull (Q) and Offset Face (ADR-0051, FR-FT-08, FR-FT-12). Q opens
// the dialog that fits the selection with it filled in: a face opens Offset
// Face, an edge Fillet, a sketch profile Extrude; with nothing selected it says
// what to select. Offset Face moves a face along its normal (positive out): a
// cube's top, a cylinder's wall (a radius change); every face keeps its name.

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 60_000 });

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

/** Makes a body with one of the Create tools' defaults and waits for it. */
async function primitive(page: Page, tool: 'Box' | 'Cylinder') {
  await pickTool(page, tool);
  const dialog = page.getByRole('region', { name: `${tool} dialog` });
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(viewportOf(page)).toHaveAttribute('data-bodies', /^Body1:\d+:/);
}

/** Hovers a world point until the view hovers `kind`, then clicks it. */
async function clickOn(page: Page, at: At, p: [number, number, number], kind: 'face' | 'edge') {
  const { x, y } = at(p);
  await page.mouse.move(x, y);
  await expect
    .poll(() => viewportOf(page).getAttribute('data-model-hover'))
    .toMatch(new RegExp(`^${kind}:`));
  await page.mouse.click(x, y);
  await expect(viewportOf(page)).toHaveAttribute('data-model-selection', new RegExp(`^${kind}:`));
}

/** The body's size from `data-bodies` ("Body1:6:20,20,25" → [20, 20, 25]). */
async function sizeOf(page: Page) {
  const bodies = (await viewportOf(page).getAttribute('data-bodies')) ?? '';
  return (bodies.split(':')[2] ?? '').split(',').map(Number);
}

test('Q on a face opens Offset Face: pull a cube’s top out, edit it to push it in, undo', async ({
  page,
}) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Box');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
  const at = await settledProjector(viewport);

  await clickOn(page, at, [0, 0, 20], 'face');
  await page.keyboard.press('q');
  const dialog = page.getByRole('region', { name: 'Offset Face dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Faces', exact: true })).toHaveText('1 face');
  await expect(dialog.getByRole('textbox', { name: 'Distance', exact: true })).toHaveValue('2 mm');
  await dialog.getByRole('textbox', { name: 'Distance', exact: true }).fill('5 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await expect(viewport).toHaveAttribute('data-preview', /./);
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);

  // The top moved 5 mm up: still six faces, 20 × 20 × 25.
  await expect(chip(page, 'Offset Face1')).toBeVisible();
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,25');

  // Edit it: a negative distance pushes the same face in.
  await chip(page, 'Offset Face1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Offset Face1 dialog' });
  await expect(edit.getByRole('textbox', { name: 'Distance', exact: true })).toHaveValue('5 mm');
  await edit.getByRole('textbox', { name: 'Distance', exact: true }).fill('-5 mm');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(edit).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,15');

  // Too far says how far it may go, and OK waits.
  await chip(page, 'Offset Face1').dblclick();
  await edit.getByRole('textbox', { name: 'Distance', exact: true }).fill('-25 mm');
  await expect(edit).toHaveAttribute('data-preview-status', 'error', { timeout: 15_000 });
  await expect(edit.getByRole('status', { name: 'Feature status' })).toContainText(
    /can't move in by 25 mm: that is too far for this body \(max ≈ 1\d mm\)/,
  );
  await expect(edit.getByRole('button', { name: 'OK' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(edit).toBeHidden();

  // The feature and its edit are one undo step each.
  await page.keyboard.press('Control+z');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,25');
  await page.keyboard.press('Control+z');
  await expect(chip(page, 'Offset Face1')).toHaveCount(0);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
});

test('Offset Face changes a cylinder’s radius: the wall moves out along its normal', async ({
  page,
}) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Cylinder');
  const [diameter = 0, , height = 0] = await sizeOf(page);
  const radius = diameter / 2;
  const at = await settledProjector(viewport);

  // The wall facing the camera (the home view looks from +X, −Y, +Z).
  const s = Math.SQRT1_2 * radius;
  await clickOn(page, at, [s, -s, height / 2], 'face');
  await page.keyboard.press('q');
  const dialog = page.getByRole('region', { name: 'Offset Face dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Faces', exact: true })).toHaveText('1 face');
  await dialog.getByRole('textbox', { name: 'Distance', exact: true }).fill('3 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  // Three faces still; the diameter grew by 6 mm, the height stayed.
  await expect(viewport).toHaveAttribute(
    'data-bodies',
    `Body1:3:${diameter + 6},${diameter + 6},${height}`,
  );
});

test('Q on an edge opens Fillet with it, and the Press Pull wedge of the marking menu opens Offset Face', async ({
  page,
}) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Box');
  const at = await settledProjector(viewport);

  // The cube's front-top edge (x, y ±10, z 0…20; its midpoint is (0, −10, 20)): hover a
  // couple of pixels below it until the view says edge.
  const edge = at([0, -10, 20]);
  let found = false;
  for (const dy of [2, 3, 4, 1, 5, 0]) {
    await page.mouse.move(edge.x, edge.y + dy);
    await page.waitForTimeout(80);
    if (((await viewport.getAttribute('data-model-hover')) ?? '').startsWith('edge:')) {
      await page.mouse.click(edge.x, edge.y + dy);
      found = true;
      break;
    }
  }
  expect(found).toBe(true);
  await expect(viewport).toHaveAttribute('data-model-selection', /^edge:/);
  await page.keyboard.press('q');
  const fillet = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(fillet).toBeVisible();
  await expect(fillet.getByRole('button', { name: 'Edges', exact: true })).toHaveText('1 edge');
  await page.keyboard.press('Escape');
  await expect(fillet).toBeHidden();

  // The wedge: a right-click on the top face selects it, then Press Pull.
  const top = at([0, 0, 20]);
  await page.mouse.move(top.x, top.y);
  await expect.poll(() => viewport.getAttribute('data-model-hover')).toMatch(/^face:/);
  await page.mouse.click(top.x, top.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Marking menu' });
  await expect(menu).toBeVisible();
  const wedge = menu.locator('[data-marking-slot="pressPull"]');
  await expect(wedge).toBeEnabled();
  await wedge.click();
  await expect(menu).toHaveCount(0);
  const dialog = page.getByRole('region', { name: 'Offset Face dialog' });
  await expect(dialog.getByRole('button', { name: 'Faces', exact: true })).toHaveText('1 face');
});

test('Q on a sketch profile opens Extrude; with nothing selected it says what to select', async ({
  page,
}) => {
  const at = await sketchOnXY(page);
  const viewport = viewportOf(page);
  const click = clicker(page, at);
  await page.keyboard.press('r');
  await click(-30, -20);
  await click(30, 20);
  await page.keyboard.press('Escape');
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();

  // Nothing selected: a message, no dialog.
  await page.keyboard.press('q');
  await expect(
    page.getByText(/^Select a face to move, an edge to round or a sketch profile/),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Extrude dialog' })).toHaveCount(0);

  // A profile selected in the model: Q opens Extrude with it.
  const plate = at(15, 5);
  await page.mouse.move(plate.x, plate.y);
  await page.mouse.click(plate.x, plate.y);
  await expect.poll(() => viewport.getAttribute('data-model-selection')).toMatch(/^profile:/);
  await page.keyboard.press('q');
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Profiles', exact: true })).toHaveText(
    '1 profile',
  );
  await expect(dialog.getByRole('combobox', { name: 'Operation' })).toHaveValue('new-body');
});
