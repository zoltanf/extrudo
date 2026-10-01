import { expect, type Locator, type Page, test } from '@playwright/test';
import { kernelReady, openProject, pickTool, projector } from './helpers';

// P3-08: Draft (FR-FT-12). Two side faces of a cube tilted about the XY
// plane: a negative angle widens the cube towards its top; too steep says the
// largest angle that works.

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

/** Hovers a world point until the view hovers a face, then clicks it. */
async function clickFace(page: Page, at: At, p: [number, number, number]) {
  const { x, y } = at(p);
  await page.mouse.move(x, y);
  await expect.poll(() => viewportOf(page).getAttribute('data-model-hover')).toMatch(/^face:/);
  await page.mouse.click(x, y);
}

test('drafts two sides of a cube about the XY plane; too steep says how far it may go', async ({
  page,
}) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await pickTool(page, 'Box');
  const box = page.getByRole('region', { name: 'Box dialog' });
  await expect(box).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await box.getByRole('button', { name: 'OK' }).click();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
  const at = await settledProjector(viewport);
  // A point of the XY plane's square beside the cube (x ±10, y ±10), where nothing is in front.
  const half = Number(await viewport.getAttribute('data-camera-size')) * 0.16;
  expect(half * 0.75).toBeGreaterThan(11);

  await page.getByRole('button', { name: 'Modify', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Draft/ }).click();
  const dialog = page.getByRole('region', { name: 'Draft dialog' });
  await expect(dialog).toBeVisible();
  // The front (y = -10) and right (x = 10) faces, seen from the view a new design opens with.
  await clickFace(page, at, [0, -10, 10]);
  await expect(dialog.getByRole('button', { name: 'Faces', exact: true })).toHaveText('1 face');
  await clickFace(page, at, [10, 0, 10]);
  await expect(dialog.getByRole('button', { name: 'Faces', exact: true })).toHaveText('2 faces');
  // The neutral plane: the XY plane's square beside the cube.
  await dialog.getByRole('button', { name: 'Plane', exact: true }).click();
  const p = at([half * 0.75, -half * 0.75, 0]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await expect(dialog.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
  await expect(viewport.locator('[data-manipulators]')).toHaveAttribute(
    'data-manipulators',
    'angle:angle',
  );
  await dialog.getByRole('textbox', { name: 'Angle', exact: true }).fill('-5 deg');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(chip(page, 'Draft1')).toBeVisible();
  // Widened towards the top by 20 × tan 5° ≈ 1.75 mm on each drafted side.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:21.7,21.7,20');

  // Too steep: the front face would cross the back one; OK waits.
  await chip(page, 'Draft1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Draft1 dialog' });
  await edit.getByRole('textbox', { name: 'Angle', exact: true }).fill('60 deg');
  await expect(edit).toHaveAttribute('data-preview-status', 'error', { timeout: 15_000 });
  await expect(edit.getByRole('status', { name: 'Feature status' })).toContainText(
    /can't tilt by 60°: that is too steep for this body \(max ≈ \d+°\)/,
  );
  await expect(edit.getByRole('button', { name: 'OK' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(edit).toBeHidden();
});
