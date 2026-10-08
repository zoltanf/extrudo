import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  clicker,
  kernelReady,
  mapping,
  newSketchOnXY,
  pickTool,
  projector,
  sketchOnXY,
} from './helpers';

// P2-09: sketches on faces and the Project tool (ADR-0031). A box is
// extruded, a sketch is started on its top face, a circle in it is cut into
// the box, and the sketch follows the face when the box gets taller. The
// Project tool brings the box's top face into a sketch on XY, and the
// projected outline follows a taper added to the box.

test.use({ viewport: { width: 1440, height: 900 } });
// Two extrudes and their dialogs, each waiting for the kernel.
test.describe.configure({ timeout: 90_000 });

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
const prompt = (page: Page) => page.getByRole('status', { name: 'Tool prompt' });

/** Waits until the camera has stopped moving. */
async function settled(viewport: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const now = `${await attr(viewport, 'data-camera-size')} ${await attr(viewport, 'data-camera-target')} ${await attr(viewport, 'data-camera-direction')}`;
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
}

/** A 60 × 40 box around the origin, 15 mm tall: Sketch1 and Extrude1. */
async function box(page: Page) {
  const at = await sketchOnXY(page);
  const viewport = viewportOf(page);
  const click = clicker(page, at);
  await page.keyboard.press('r');
  await click(-30, -20);
  await click(30, 20);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  const plate = at(15, 5);
  await page.mouse.move(plate.x, plate.y);
  await page.mouse.click(plate.x, plate.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.keyboard.press('e');
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('1');
  await page.keyboard.press('5');
  await expect(dialog.getByRole('textbox', { name: 'Distance' })).toHaveValue('15');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:60,40,15');
  return viewport;
}

/** Turns to the home view and waits for it: returns a world → page mapping. */
async function homeView(page: Page) {
  const viewport = viewportOf(page);
  await page.keyboard.press('Shift+1');
  await page.waitForTimeout(300);
  await settled(viewport);
  return projector(viewport);
}

/** The frame of sketch `name` from the Viewport region ("origin:normal"). */
async function frameOf(page: Page, id: string) {
  const frames = (await attr(viewportOf(page), 'data-sketch-frames')).split(' ');
  const found = frames.find((f) => f.startsWith(`${id}:`));
  return found?.slice(id.length + 1);
}

/** The feature ID behind a timeline chip (its sketch is drawn with this ID). */
async function sketchIds(page: Page) {
  return (await attr(viewportOf(page), 'data-sketches')).split(' ').filter(Boolean);
}

test('sketches on a top face, cuts a hole from it, and follows the face', async ({ page }) => {
  const viewport = await box(page);
  const [plateSketch] = await sketchIds(page);

  // Create Sketch, then a click on the top face: the sketch lies on it.
  const world = await homeView(page);
  await pickTool(page, 'Create Sketch');
  const create = page.getByRole('region', { name: 'Create Sketch' });
  await expect(create).toContainText('flat face');
  const top = world([15, 10, 15]);
  await page.mouse.move(top.x, top.y);
  await page.mouse.click(top.x, top.y);
  await expect(chip(page, 'Sketch2')).toBeVisible();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  const faceSketch = (await sketchIds(page)).find((id) => id !== plateSketch) as string;
  await expect.poll(() => frameOf(page, faceSketch)).toBe('0,0,15:0,0,1');
  await settled(viewport);

  // A circle of radius 10 around the origin.
  const at = await mapping(viewport);
  const click = clicker(page, at);
  await page.keyboard.press('c');
  await click(0, 0);
  await click(10, 0);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveCount(0);
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);
  await expect(chip(page, 'Sketch2')).toHaveAccessibleName('Sketch2');

  // Its profile pushed into the box proposes a cut, like the face it lies on.
  const centre = at(0, 0);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.click(centre.x, centre.y);
  await expect
    .poll(() => attr(viewport, 'data-model-selection'))
    .toMatch(new RegExp(`^profile:${faceSketch}/`));
  await page.keyboard.press('e');
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  const operation = dialog.getByRole('combobox', { name: 'Operation' });
  await expect(operation).toHaveValue('join');
  await page.keyboard.press('-');
  await page.keyboard.press('5');
  await expect(operation).toHaveValue('cut');
  await expect(viewport).toHaveAttribute('data-preview', 'cut', { timeout: 15_000 });
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(chip(page, 'Extrude2')).toHaveAccessibleName('Extrude2');
  // The hole's wall and floor: eight faces, still 15 mm tall.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:8:60,40,15');
  await page.screenshot({ path: test.info().outputPath('hole-on-top.png') });
  // The cut used Sketch2's profile, so Sketch2 is hidden: over the hole the pointer finds its
  // floor, not the used profile floating where the top face was. A toast says so, and its
  // Show button shows the sketch again.
  expect(await sketchIds(page)).not.toContain(faceSketch);
  await page.mouse.move(centre.x + 3, centre.y + 3);
  await page.mouse.move(centre.x, centre.y);
  await expect.poll(() => attr(viewport, 'data-model-hover')).toMatch(/^face:/);
  const toast = page.getByRole('status').filter({ hasText: 'Sketch2 is hidden' });
  await expect(toast).toHaveText(/Sketch2 is hidden: Extrude2 used its profile\./);
  // Toasts sit in the view's bottom-right corner (ADR-0007 amendment, 2026-09-28), with the
  // notification history's bell (32 px) in the corner itself and the toasts 8 px above it.
  const bell = page.getByRole('button', { name: /^Notification history/ });
  const [view, note, button] = [
    await viewport.boundingBox(),
    await toast.boundingBox(),
    await bell.boundingBox(),
  ];
  if (!view || !note || !button) throw new Error('no view, toast or bell');
  expect(view.x + view.width - (note.x + note.width)).toBeCloseTo(12, 0);
  expect(view.y + view.height - (button.y + button.height)).toBeCloseTo(12, 0);
  expect(button.y - (note.y + note.height)).toBeCloseTo(8, 0);
  await toast.getByRole('button', { name: 'Show' }).click();
  await expect(toast).toBeHidden();
  await expect.poll(() => sketchIds(page)).toContain(faceSketch);
  await expect(
    page
      .getByRole('complementary', { name: 'Browser' })
      .getByRole('button', { name: 'Hide Sketch2' }),
  ).toBeVisible();

  // A taller box: the sketch rides up with the top face, and the hole with it.
  await chip(page, 'Extrude1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Extrude1 dialog' });
  const distance = edit.getByRole('textbox', { name: 'Distance' });
  await distance.fill('25');
  await distance.press('Enter');
  await expect(edit).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:8:60,40,25');
  await expect.poll(() => frameOf(page, faceSketch)).toBe('0,0,25:0,0,1');
  await expect(chip(page, 'Sketch2')).toHaveAccessibleName('Sketch2');
  await expect(chip(page, 'Extrude2')).toHaveAccessibleName('Extrude2');

  // Undo puts it back down; opening the sketch again looks at the face where it is.
  await page.keyboard.press('Control+z');
  await kernelReady(page);
  await expect.poll(() => frameOf(page, faceSketch)).toBe('0,0,15:0,0,1');
  await homeView(page);
  await chip(page, 'Sketch2').dblclick();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  await expect(page.getByRole('button', { name: 'Finish Sketch' }).last()).toBeVisible();
});

test('projects a face into a sketch, and the projection follows the model', async ({ page }) => {
  const viewport = await box(page);
  const [plateSketch] = await sketchIds(page);

  // A sketch on XY, and P: the view picks the box's faces and edges.
  await newSketchOnXY(page);
  const sketch = (await sketchIds(page)).find((id) => id !== plateSketch) as string;
  await page.keyboard.press('p');
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toHaveAttribute(
    'data-active',
    'true',
  );
  const world = await projector(viewport);
  const top = world([15, 10, 15]);
  await page.mouse.move(top.x, top.y);
  await expect.poll(() => attr(viewport, 'data-model-hover')).toMatch(/^face:/);
  await page.mouse.click(top.x, top.y);
  await expect
    .poll(() => attr(viewport, 'data-sketch-projected'))
    .toBe(`${sketch}:curves=4:x=-30..30:y=-20..20`);
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
  await page.screenshot({ path: test.info().outputPath('projected.png') });
  // Projecting it again is refused.
  await page.mouse.click(top.x, top.y);
  await expect(page.getByRole('alert')).toContainText('already projected');
  await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);
  await expect(chip(page, 'Sketch2')).toHaveAccessibleName('Sketch2');

  // A 5° inward taper on the box shrinks its top face; the projection follows.
  await chip(page, 'Extrude1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Extrude1 dialog' });
  const taper = edit.getByRole('textbox', { name: 'Taper' });
  await taper.fill('-5');
  await taper.press('Enter');
  await expect(edit).toBeHidden();
  await kernelReady(page);
  await expect
    .poll(() => attr(viewport, 'data-sketch-projected'))
    .toBe(`${sketch}:curves=4:x=-28.688..28.688:y=-18.688..18.688`);
  // One undo takes the taper back, with what followed from it.
  await page.keyboard.press('Control+z');
  await expect
    .poll(() => attr(viewport, 'data-sketch-projected'))
    .toBe(`${sketch}:curves=4:x=-30..30:y=-20..20`);
  await kernelReady(page);
  await expect(chip(page, 'Sketch2')).toHaveAccessibleName('Sketch2');
});
