import { expect, type Locator, type Page, test } from '@playwright/test';
import { ok, primitive } from './benchmark-helpers';
import { kernelReady, openProject, projector } from './helpers';

// P4-02: Thread (FR-FT-15). A modeled thread on a cylinder's wall, sized to
// fit (M20 on the default Ø20 cylinder, 0.1 mm tolerance: 19.8 mm across the
// crests), edited to a size that doesn't fit; and an internal thread in a
// Hole's wall, sized from the tap-drill hole. Threads take seconds to build.

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

async function openThread(page: Page) {
  await page.getByRole('button', { name: 'Modify', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Thread/ }).click();
  const dialog = page.getByRole('region', { name: 'Thread dialog' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('threads a cylinder to fit, then refuses a thread larger than the shaft', async ({ page }) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Cylinder', {});
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:3:20,20,20');
  const at = await settledProjector(viewport);

  // The wall facing the camera (the home view looks from +X, −Y, +Z), picked before the tool.
  const s = Math.SQRT1_2 * 10;
  await clickFace(page, at, [s, -s, 10]);
  const dialog = await openThread(page);
  await expect(dialog.getByRole('button', { name: 'Faces', exact: true })).toHaveText('1 face');
  await expect(dialog.getByRole('combobox', { name: 'Size' })).toHaveValue('auto');
  // Fit the face stores no size: Diameter and Pitch are hidden.
  await expect(dialog.getByRole('textbox', { name: 'Diameter', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: 'Tolerance', exact: true })).toHaveValue(
    '0.1 mm',
  );
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
  await ok(page, dialog);
  await expect(chip(page, 'Thread1')).toHaveAccessibleName('Thread1');
  // M20 less twice the tolerance across the crests; the cylinder's three faces and the thread's.
  await expect(viewport).toHaveAttribute('data-bodies', /^Body1:\d+:19\.8,19\.8,20$/);
  const faces = Number((await viewport.getAttribute('data-bodies'))?.split(':')[1]);
  expect(faces).toBeGreaterThan(20);

  // Edit it to M24: the shaft is thinner than that thread's root.
  await chip(page, 'Thread1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Thread1 dialog' });
  await expect(edit).toBeVisible();
  await edit.getByRole('combobox', { name: 'Size' }).selectOption('m24');
  await expect(edit.getByRole('textbox', { name: 'Diameter', exact: true })).toHaveValue('24 mm');
  await expect(edit.getByRole('textbox', { name: 'Pitch', exact: true })).toHaveValue('3 mm');
  await expect(edit).toHaveAttribute('data-preview-status', 'error', { timeout: 60_000 });
  await expect(edit.getByRole('status', { name: 'Feature status' })).toContainText(
    "thinner than the M24 thread's root",
  );
  await expect(edit.getByRole('button', { name: 'OK' })).toBeDisabled();
  // Typing the numbers of a preset shows that preset.
  await edit.getByRole('textbox', { name: 'Diameter', exact: true }).fill('16 mm');
  await edit.getByRole('textbox', { name: 'Pitch', exact: true }).fill('1.5 mm');
  await expect(edit.getByRole('combobox', { name: 'Size' })).toHaveValue('m16x1.5');
  await expect(edit).toHaveAttribute('data-preview-status', /^(ok|warning)$/, { timeout: 60_000 });
  await edit.getByRole('button', { name: 'Cancel Esc' }).click();
  await expect(edit).toBeHidden();
});

test('an internal thread in a Hole’s wall finds its size from the tap-drill hole', async ({
  page,
}) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Cylinder', {});
  await page.keyboard.press('Shift+1');
  let at = await settledProjector(viewport);
  // A through hole at the top's centre: 8.5 mm, M10's tap drill.
  await page.keyboard.press('h');
  const hole = page.getByRole('region', { name: 'Hole dialog' });
  await expect(hole).toBeVisible();
  const { x, y } = at([0, 0, 20]);
  await page.mouse.click(x, y);
  await expect(hole.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
  await hole.getByRole('textbox', { name: 'X', exact: true }).fill('0 mm');
  await hole.getByRole('textbox', { name: 'Y', exact: true }).fill('0 mm');
  await hole.getByRole('combobox', { name: 'Extent' }).selectOption('through');
  await hole.getByRole('textbox', { name: 'Diameter', exact: true }).fill('8.5 mm');
  await ok(page, hole);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:4:20,20,20');

  // The far side of the hole's wall, seen past the near rim.
  at = await settledProjector(viewport);
  const dialog = await openThread(page);
  const r = 4.25 * Math.SQRT1_2;
  await clickFace(page, at, [-r, r, 17]);
  await expect(dialog.getByRole('button', { name: 'Faces', exact: true })).toHaveText('1 face');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
  await ok(page, dialog);
  await expect(chip(page, 'Thread1')).toHaveAccessibleName('Thread1');
  // The outside is untouched; the hole's wall became the thread's faces.
  await expect(viewport).toHaveAttribute('data-bodies', /^Body1:\d+:20,20,20$/);
  const faces = Number((await viewport.getAttribute('data-bodies'))?.split(':')[1]);
  expect(faces).toBeGreaterThan(20);
});
