import { expect, type Locator, type Page, test } from '@playwright/test';
import { selectBodies } from './benchmark-helpers';
import { kernelReady, openProject, pickTool, projector } from './helpers';

// P3-08: Split Body (FR-FT-12). A cube cut along the YZ plane becomes two
// bodies; keeping one side leaves one body.

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

test('splits a cube along the YZ plane into two bodies, then keeps one side', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await pickTool(page, 'Box');
  const box = page.getByRole('region', { name: 'Box dialog' });
  await expect(box).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await box.getByRole('button', { name: 'OK' }).click();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
  const at = await settledProjector(viewport);
  // A point of the YZ plane's square beside the cube (x ±10, y ±10), where nothing is in front.
  const half = Number(await viewport.getAttribute('data-camera-size')) * 0.16;
  const onPlane: [number, number, number] = [0, -half * 0.75, half * 0.75];
  expect(half * 0.75).toBeGreaterThan(11);

  await selectBodies(page, ['Body1']);
  await pickTool(page, 'Split Body');
  const dialog = page.getByRole('region', { name: 'Split Body dialog' });
  await expect(dialog.getByRole('button', { name: 'Bodies', exact: true })).toHaveText('Body1');
  // The plane is the next field to pick, like Create Sketch's plane.
  const p = at(onPlane);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await expect(dialog.getByRole('button', { name: 'Plane', exact: true })).toHaveText('YZ plane');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(chip(page, 'Split Body1')).toBeVisible();
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:10,20,20 Body2:6:10,20,20');

  // Edit it to keep only the side below the plane (x < 0): one body again.
  await chip(page, 'Split Body1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Split Body1 dialog' });
  await edit.getByRole('combobox', { name: 'Keep' }).selectOption('below');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(edit).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:10,20,20');
});
