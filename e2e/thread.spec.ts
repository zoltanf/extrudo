import { expect, type Locator, type Page, test } from '@playwright/test';
import { clickAt, ok, primitive } from './benchmark-helpers';
import { kernelReady, openProject, projector } from './helpers';

// P4-02: Thread (FR-FT-15). A modeled thread on a cylinder's wall, sized to
// fit (M20 on the default Ø20 cylinder, 0.1 mm tolerance: 19.8 mm across the
// crests), edited to a size that doesn't fit; and an internal thread in a
// Hole's wall, sized from the tap-drill hole; NPT on a drafted cylinder (P4-12).
// Threads take seconds to build.

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

// P4-12: the profiles. A trapezoidal Tr 20 × 4 on a Ø20 cylinder (the crest is
// the major diameter less twice the tolerance, so 19.8 mm across, whatever the
// profile) and the PCO-1881 bottle profile in a bore (an internal thread).
test('threads a cylinder with the trapezoidal Tr 20 × 4 profile', async ({ page }) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Cylinder', {});
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:3:20,20,20');
  const at = await settledProjector(viewport);

  const s = Math.SQRT1_2 * 10;
  await clickFace(page, at, [s, -s, 10]);
  const dialog = await openThread(page);
  await expect(dialog.getByRole('button', { name: 'Faces', exact: true })).toHaveText('1 face');
  await dialog.getByRole('combobox', { name: 'Profile' }).selectOption('trapezoidal');
  await dialog.getByRole('combobox', { name: 'Size' }).selectOption('tr20x4');
  await expect(dialog.getByRole('textbox', { name: 'Diameter', exact: true })).toHaveValue('20 mm');
  await expect(dialog.getByRole('textbox', { name: 'Pitch', exact: true })).toHaveValue('4 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
  await ok(page, dialog);
  await expect(chip(page, 'Thread1')).toHaveAccessibleName('Thread1');
  await expect(viewport).toHaveAttribute('data-bodies', /^Body1:\d+:19\.8,19\.8,20$/);
});

test('cuts a two-start thread: the same size across the crests, more faces', async ({ page }) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Cylinder', {});
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:3:20,20,20');
  const at = await settledProjector(viewport);

  const s = Math.SQRT1_2 * 10;
  await clickFace(page, at, [s, -s, 10]);
  const dialog = await openThread(page);
  await dialog.getByRole('combobox', { name: 'Size' }).selectOption('m20');
  await expect(dialog.getByRole('textbox', { name: 'Starts', exact: true })).toHaveValue('1');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
  await ok(page, dialog);
  await expect(viewport).toHaveAttribute('data-bodies', /^Body1:\d+:19\.8,19\.8,20$/);
  const faces = Number((await viewport.getAttribute('data-bodies'))?.split(':')[1]);

  // Two starts: a lead of 5 mm, a tooth per start; the crests are as wide.
  await chip(page, 'Thread1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Thread1 dialog' });
  await expect(edit).toBeVisible();
  await edit.getByRole('textbox', { name: 'Starts', exact: true }).fill('2');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
  await ok(page, edit);
  await expect(viewport).toHaveAttribute('data-bodies', /^Body1:\d+:19\.8,19\.8,20$/);
  const twoStart = Number((await viewport.getAttribute('data-bodies'))?.split(':')[1]);
  expect(twoStart).toBeGreaterThan(faces);
});

test('threads a bore with the PCO-1881 bottle profile', async ({ page }) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Cylinder', { Diameter: '40 mm', Height: '20 mm' });
  await page.keyboard.press('Shift+1');
  let at = await settledProjector(viewport);
  // A through bore a little under the thread's root (Ø27.43 + 0.2): Ø27.
  await page.keyboard.press('h');
  const hole = page.getByRole('region', { name: 'Hole dialog' });
  await expect(hole).toBeVisible();
  const { x, y } = at([0, 0, 20]);
  await page.mouse.click(x, y);
  await expect(hole.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
  await hole.getByRole('textbox', { name: 'X', exact: true }).fill('0 mm');
  await hole.getByRole('textbox', { name: 'Y', exact: true }).fill('0 mm');
  await hole.getByRole('combobox', { name: 'Extent' }).selectOption('through');
  await hole.getByRole('textbox', { name: 'Diameter', exact: true }).fill('27 mm');
  await ok(page, hole);

  at = await settledProjector(viewport);
  const dialog = await openThread(page);
  const r = 13.5 * Math.SQRT1_2;
  await clickFace(page, at, [-r, r, 14]);
  await expect(dialog.getByRole('button', { name: 'Faces', exact: true })).toHaveText('1 face');
  await dialog.getByRole('combobox', { name: 'Profile' }).selectOption('bottle');
  await dialog.getByRole('combobox', { name: 'Size' }).selectOption('pco-1881');
  await expect(dialog.getByRole('textbox', { name: 'Diameter', exact: true })).toHaveValue(
    '27.43 mm',
  );
  await expect(dialog.getByRole('textbox', { name: 'Pitch', exact: true })).toHaveValue('2.7 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
  await ok(page, dialog);
  await expect(chip(page, 'Thread1')).toHaveAccessibleName('Thread1');
  // The outside is untouched. About two turns of a 2.7 mm pitch fit in 20 mm.
  await expect(viewport).toHaveAttribute('data-bodies', /^Body1:\d+:40,40,20$/);
});

// P4-12 (ADR-0056's third amendment): a thread on a cone follows it. The
// default cylinder made Ø21.97 and drafted 1.79° about XY narrows to NPT 1/2's
// major diameter at its top (Ø20.72), the small end; NPT 1/2 cut into it keeps
// the height and takes the crests (and the lead-in at each end) in from the
// cone, and the dialog's Thread line names it.
test('cuts NPT 1/2 into a drafted cylinder: the thread follows the cone', async ({ page }) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Cylinder', { Diameter: '21.97 mm' });
  // The display mesh's box: 21.9 or 22 across, depending on where its facets fall.
  const cylinderBox = /^Body1:3:(21\.9|22),(21\.9|22),20$/;
  await expect(viewport).toHaveAttribute('data-bodies', cylinderBox);
  const at = await settledProjector(viewport);
  const half = Number(await viewport.getAttribute('data-camera-size')) * 0.16;

  await page.getByRole('button', { name: 'Modify', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Draft/ }).click();
  const draft = page.getByRole('region', { name: 'Draft dialog' });
  await expect(draft).toBeVisible();
  await clickFace(page, at, [0, -10.985, 10]);
  await expect(draft.getByRole('button', { name: 'Faces', exact: true })).toHaveText('1 face');
  await draft.getByRole('button', { name: 'Plane', exact: true }).click();
  await clickAt(page, at, [half * 0.75, -half * 0.75, 0]);
  await expect(draft.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
  await draft.getByRole('textbox', { name: 'Angle', exact: true }).fill('1.79 deg');
  await ok(page, draft);
  await expect(chip(page, 'Draft1')).toBeVisible();
  await expect(viewport).toHaveAttribute('data-bodies', cylinderBox);
  const sizeOf = async () => {
    const [, faces, size] = ((await viewport.getAttribute('data-bodies')) ?? '').split(':');
    const [x, y, z] = (size ?? '').split(',').map(Number);
    return { faces: Number(faces), x: x as number, y: y as number, z };
  };
  const cone = await sizeOf();

  // The cone's wall at half height, where its radius is 10.985 − 10 tan 1.79°.
  const r = (10.985 - 10 * Math.tan((1.79 * Math.PI) / 180)) * Math.SQRT1_2;
  await clickFace(page, await settledProjector(viewport), [r, -r, 10]);
  const dialog = await openThread(page);
  await expect(dialog.getByRole('button', { name: 'Faces', exact: true })).toHaveText('1 face');
  await dialog.getByRole('combobox', { name: 'Size' }).selectOption('npt-1q2');
  await expect(dialog.getByRole('textbox', { name: 'Pitch', exact: true })).toHaveValue(
    '1 in / 14',
  );
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
  await expect(dialog.locator('[data-info="designation"]')).toContainText('NPT 1/2');
  await ok(page, dialog);
  await expect(chip(page, 'Thread1')).toHaveAccessibleName('Thread1');
  // As tall as before, narrower across: the crests are a tolerance under the
  // cone and the lead-ins take each end down to the root.
  await expect(viewport).not.toHaveAttribute('data-bodies', cylinderBox);
  const threaded = await sizeOf();
  expect(threaded.faces).toBeGreaterThan(20);
  expect(threaded.z).toBe(20);
  expect(threaded.x).toBeLessThanOrEqual(cone.x - 0.1);
  expect(threaded.y).toBeLessThanOrEqual(cone.y - 0.1);
  expect(threaded.x).toBeGreaterThan(cone.x - 1);
});
