import { expect, type Locator, type Page, test } from '@playwright/test';
import { exportModel, objectsOf3mf, solidFacts } from './benchmark-helpers';
import { kernelReady, openProject, pickTool, projector } from './helpers';

// P4-13: Remove Faces (ADR-0099 §6–7). A through hole closes with the
// dialog's one pick (the wall alone: the caps grow to meet it), the body's
// volume comes back to the plain box's, and Delete on a fillet's face makes
// the feature in one step. Volumes are read from the 3MF export.

test.use({ viewport: { width: 1440, height: 900 } });
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

/** A 40 mm cube from the Box tool, centred on the origin, on the XY plane. */
async function cube(page: Page) {
  await pickTool(page, 'Box');
  const dialog = page.getByRole('region', { name: 'Box dialog' });
  await expect(dialog).toBeVisible();
  for (const name of ['Length', 'Width', 'Height']) {
    await dialog.getByRole('textbox', { name, exact: true }).fill('40 mm');
  }
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(viewportOf(page)).toHaveAttribute('data-bodies', 'Body1:6:40,40,40');
}

/** Hovers the world points in turn until the view hovers `kind`, then clicks it. */
async function clickOn(
  page: Page,
  at: At,
  points: readonly [number, number, number][],
  kind: 'face' | 'edge',
) {
  for (const p of points) {
    const { x, y } = at(p);
    let hover = '';
    let dy = 0;
    for (const tryDy of [0, 2, -2, 4]) {
      await page.mouse.move(x, y + tryDy);
      await page.waitForTimeout(150);
      hover = (await viewportOf(page).getAttribute('data-model-hover')) ?? '';
      if (new RegExp(`^${kind}:`).test(hover)) {
        dy = tryDy;
        break;
      }
    }
    if (!new RegExp(`^${kind}:`).test(hover)) continue;
    await page.mouse.click(x, y + dy);
    await expect(viewportOf(page)).toHaveAttribute('data-model-selection', new RegExp(`^${kind}:`));
    return hover;
  }
  throw new Error(`nothing to click as ${kind}`);
}

/** A Ø12 hole through the cube's top at (5, -6), from the Hole tool. */
async function drilled(page: Page, at: At) {
  await page.keyboard.press('h');
  const dialog = page.getByRole('region', { name: 'Hole dialog' });
  await expect(dialog).toBeVisible();
  const p = at([5, -6, 40]);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(150);
  await page.mouse.click(p.x, p.y);
  await expect(dialog.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
  await dialog.getByRole('textbox', { name: 'Diameter', exact: true }).fill('12 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(viewportOf(page)).toHaveAttribute('data-bodies', 'Body1:7:40,40,40');
}

test('Remove Faces closes a through hole, and Delete on a fillet face makes the feature', async ({
  page,
}) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  const at = await settledProjector(viewport);
  await drilled(page, at);

  // The Modify tab's tile opens the dialog; a click on the hole's wall picks
  // it (a through hole's pick is the wall alone: its caps grow to meet it).
  await pickTool(page, 'Remove Faces');
  const dialog = page.getByRole('region', { name: 'Remove Faces dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Faces', exact: true })).toHaveText('Pick faces');
  const hover = await clickOn(
    page,
    at,
    [
      [0.8, -1.8, 34],
      [3, -0.4, 36],
      [-0.6, -4, 32],
    ],
    'face',
  );
  expect(hover).toMatch(/^face:/);
  await expect(dialog.getByRole('button', { name: 'Faces', exact: true })).toHaveText('1 face');
  await expect(dialog.locator('[data-info="picked"]')).toHaveText(/^([1-9]\d*) faces?$/, {
    timeout: 15_000,
  });
  const picked = Number(
    (await dialog.locator('[data-info="picked"]').textContent())?.replace(/\D/g, '') ?? 0,
  );
  expect(picked).toBeGreaterThanOrEqual(1);
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 20_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);

  // The hole is gone: the plain cube again, and its volume with it.
  await expect(chip(page, 'Remove Faces1')).toBeVisible();
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:40,40,40');
  const [part] = objectsOf3mf(await exportModel(page, '3MF'));
  if (!part) throw new Error('nothing exported');
  expect(solidFacts(part.mesh).volume).toBeCloseTo(40 ** 3, -2);

  // A fillet on the top front edge, then Delete on one of its faces: one
  // Remove Faces feature in one step, the sharp edge back.
  const at2 = await settledProjector(viewport);
  await pickTool(page, 'Fillet');
  const fillet = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(fillet).toBeVisible();
  await clickOn(page, at2, [[0, -20, 40]], 'edge');
  await expect(fillet.getByRole('button', { name: 'Edges', exact: true })).toHaveText('1 edge');
  await fillet.getByRole('textbox', { name: 'Radius', exact: true }).fill('3 mm');
  await expect(fillet).toHaveAttribute('data-preview-status', 'ok', { timeout: 20_000 });
  await fillet.getByRole('button', { name: 'OK' }).click();
  await expect(fillet).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:40,40,40');

  await clickOn(
    page,
    at2,
    [
      [0, -19.1, 39.1],
      [0, -18.5, 38.5],
      [-5, -19.1, 39.1],
    ],
    'face',
  );
  await page.keyboard.press('Delete');
  await expect(chip(page, 'Remove Faces2')).toBeVisible();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:40,40,40');
  await expect(viewport).toHaveAttribute('data-model-selection', '');
  const [after] = objectsOf3mf(await exportModel(page, '3MF'));
  if (!after) throw new Error('nothing exported after the Delete');
  expect(solidFacts(after.mesh).volume).toBeCloseTo(40 ** 3, -2);
});
