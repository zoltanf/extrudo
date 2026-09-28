import { expect, type Locator, type Page, test } from '@playwright/test';
import { clicker, kernelReady, mapping, newSketchOnXY, openProject, sketchOnXY } from './helpers';

// P2-11 (ADR-0033): the rollback marker drags and takes arrow keys, chips
// move by drag (refused when a reference would break), menus roll the
// marker and move features, new features go in at the marker, a guessed
// reference is a warning chip whose closest match can be kept, and a sketch
// whose face is lost gets a new plane through "Fix References".
// The Wall bracket template: Sketch1 Extrude1 Sketch2 Extrude2 Fillet1 | Plane1.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const features = (page: Page) => page.getByRole('list', { name: 'Features' });
const chip = (page: Page, name: string) =>
  features(page).getByRole('button', { name: new RegExp(`^${name}( \\(|$)`) });
const marker = (page: Page) => page.getByRole('slider', { name: 'Timeline marker' });
const menuItem = (page: Page, name: string) =>
  page.getByRole('menuitem', { name: new RegExp(`^${name}`) });
const viewportOf = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const attr = async (el: Locator, name: string) => (await el.getAttribute(name)) ?? '';

/** Chip names in timeline order, without their states. */
async function order(page: Page) {
  const labels = await features(page)
    .locator('[data-timeline-item="chip"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
  return labels.map((label) => label.replace(/ \(.*\)$/, '')).join(' ');
}

async function box(el: Locator) {
  const b = await el.boundingBox();
  if (!b) throw new Error('not visible');
  return b;
}

/** Drags from the middle of `from` to x (page px) at `from`'s height, in steps. */
async function dragTo(page: Page, from: Locator, x: number) {
  const b = await box(from);
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + b.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 8, y, { steps: 2 });
  await page.mouse.move(x, y, { steps: 8 });
}

/** A point just inside the left edge of a chip: a drop there lands before it. */
const before = async (el: Locator) => (await box(el)).x + 3;

/**
 * Zooms the view out until it is at least `size` mm tall, one wheel step at a
 * time (headless Chromium delivers wheel deltas unevenly), and returns the
 * sketch-mm → page-px mapping.
 */
async function zoomOut(page: Page, size: number) {
  const viewport = viewportOf(page);
  const b = await box(viewport);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  for (let i = 0; i < 20; i++) {
    const now = Number(await attr(viewport, 'data-camera-size'));
    if (now >= size) break;
    await page.mouse.wheel(0, 200);
    await expect.poll(async () => Number(await attr(viewport, 'data-camera-size'))).not.toBe(now);
  }
  // Let the camera settle before mapping.
  let last = '';
  await expect
    .poll(async () => {
      const now = `${await attr(viewport, 'data-camera-size')} ${await attr(viewport, 'data-camera-target')}`;
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
  return mapping(viewport);
}

async function dismiss(page: Page) {
  await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
}

test('the marker drags, takes keys and follows Roll Back to Here', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await expect(marker(page)).toHaveAttribute('aria-valuenow', '5');
  await expect(marker(page)).toHaveAttribute('aria-valuetext', 'After Fillet1');

  // Dragged between Extrude1 and Sketch2: a ghost shows where it goes, and the model rolls
  // back when it is let go, one undo step.
  await dragTo(page, marker(page), await before(chip(page, 'Sketch2')));
  await expect(features(page).locator('[data-marker-ghost]')).toHaveAttribute(
    'data-marker-ghost',
    '2',
  );
  await page.mouse.up();
  await expect(marker(page)).toHaveAttribute('aria-valuenow', '2');
  await expect(chip(page, 'Sketch2')).toHaveAccessibleName('Sketch2 (rolled back)');
  await expect(chip(page, 'Extrude1')).toHaveAccessibleName('Extrude1');
  await kernelReady(page);
  await expect.poll(() => attr(viewportOf(page), 'data-sketches')).not.toContain(' ');
  await page.keyboard.press('Control+z');
  await expect(marker(page)).toHaveAttribute('aria-valuenow', '5');

  // Keys on the focused marker.
  await marker(page).focus();
  await page.keyboard.press('End');
  await expect(marker(page)).toHaveAttribute('aria-valuenow', '6');
  await expect(chip(page, 'Plane1')).not.toHaveAccessibleName(/rolled back/);
  await page.keyboard.press('Home');
  await expect(marker(page)).toHaveAttribute('aria-valuetext', 'At the start');
  await page.keyboard.press('ArrowRight');
  await expect(marker(page)).toHaveAttribute('aria-valuenow', '1');

  // The chip menu rolls to a feature, back or forward.
  await chip(page, 'Extrude2').click({ button: 'right' });
  await menuItem(page, 'Roll Forward to Here').click();
  await expect(marker(page)).toHaveAttribute('aria-valuenow', '4');
  await chip(page, 'Sketch1').click({ button: 'right' });
  await menuItem(page, 'Roll Back to Here').click();
  await expect(marker(page)).toHaveAttribute('aria-valuenow', '1');
  await expect(chip(page, 'Extrude1')).toHaveAccessibleName('Extrude1 (rolled back)');
});

test('chips move by drag, unless a reference would break', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  expect(await order(page)).toBe('Sketch1 Extrude1 Sketch2 Extrude2 Fillet1 Plane1');

  // Sketch2 (the holes, on XY) uses nothing: it can go before Extrude1.
  await dragTo(page, chip(page, 'Sketch2'), await before(chip(page, 'Extrude1')));
  const indicator = features(page).locator('[data-drop-index]');
  await expect(indicator).toHaveAttribute('data-drop-index', '1');
  await expect(indicator).not.toHaveAttribute('data-drop-refused', /./);
  await page.mouse.up();
  await expect.poll(() => order(page)).toBe('Sketch1 Sketch2 Extrude1 Extrude2 Fillet1 Plane1');
  await kernelReady(page);
  await expect(chip(page, 'Extrude2')).toHaveAccessibleName('Extrude2');
  await expect(viewportOf(page)).toHaveAttribute('data-bodies', /^Bracket:/);
  await page.keyboard.press('Control+z');
  await expect.poll(() => order(page)).toBe('Sketch1 Extrude1 Sketch2 Extrude2 Fillet1 Plane1');

  // Extrude2 cuts Sketch2's profiles: before Sketch2 is refused, the indicator says so.
  await dragTo(page, chip(page, 'Extrude2'), await before(chip(page, 'Sketch2')));
  await expect(indicator).toHaveAttribute('data-drop-refused', 'true');
  await page.mouse.up();
  await expect(page.getByRole('alert')).toHaveText(
    "Can't move Extrude2 before Sketch2: Extrude2 uses Sketch2.",
  );
  expect(await order(page)).toBe('Sketch1 Extrude1 Sketch2 Extrude2 Fillet1 Plane1');
  await dismiss(page);

  // Esc puts a dragged chip back.
  await dragTo(page, chip(page, 'Fillet1'), await before(chip(page, 'Sketch1')));
  await expect(indicator).toHaveAttribute('data-drop-index', '0');
  await page.keyboard.press('Escape');
  await expect(indicator).toHaveCount(0);
  await page.mouse.up();
  expect(await order(page)).toBe('Sketch1 Extrude1 Sketch2 Extrude2 Fillet1 Plane1');

  // Move to End: refused for Sketch2, fine for Fillet1 (past the marker: rolled back).
  await chip(page, 'Sketch2').click({ button: 'right' });
  await menuItem(page, 'Move to End').click();
  await expect(page.getByRole('alert')).toHaveText(
    "Can't move Sketch2 after Extrude2: Extrude2 uses Sketch2.",
  );
  await dismiss(page);
  await chip(page, 'Fillet1').click({ button: 'right' });
  await menuItem(page, 'Move to End').click();
  await expect.poll(() => order(page)).toBe('Sketch1 Extrude1 Sketch2 Extrude2 Plane1 Fillet1');
  await expect(chip(page, 'Fillet1')).toHaveAccessibleName('Fillet1 (rolled back)');
  await expect(marker(page)).toHaveAttribute('aria-valuenow', '4');
});

test.describe(() => {
  // Two extrudes and a sketch on a face, each waiting for the kernel.
  test.describe.configure({ timeout: 120_000 });

  test('inserts at the marker; a guessed face warns, a lost one is fixed', async ({ page }) => {
    const viewport = viewportOf(page);
    // A 60 × 40 box, 15 mm tall: Sketch1 and Extrude1.
    const at = await sketchOnXY(page);
    const click = clicker(page, at);
    await page.keyboard.press('r');
    await click(-30, -20);
    await click(30, 20);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
    const plate = at(15, 5);
    await page.mouse.move(plate.x, plate.y);
    await page.mouse.click(plate.x, plate.y);
    await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
    await page.keyboard.press('e');
    const dialog = page.getByRole('region', { name: 'Extrude dialog' });
    await dialog.getByRole('textbox', { name: 'Distance' }).fill('15');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await kernelReady(page);
    await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:60,40,15');
    // The "Sketch1 is hidden" toast sits over the timeline.
    await page
      .getByRole('status')
      .filter({ hasText: 'is hidden' })
      .getByRole('button', { name: 'Dismiss' })
      .click();

    // Sketch2 on the box's top face (selected first, then Create Sketch).
    await page.getByRole('button', { name: 'Orthographic' }).click();
    const top = at(-15, -10);
    await page.mouse.move(top.x, top.y);
    await page.mouse.click(top.x, top.y);
    await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^face:/);
    await page.getByRole('button', { name: 'Create Sketch' }).click();
    await expect(chip(page, 'Sketch2')).toBeVisible();
    await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
    await kernelReady(page);
    // Extrude1 hid Sketch1 (it used its profile): Sketch2 is the sketch drawn, on the top.
    await expect.poll(() => attr(viewport, 'data-sketch-frames')).toMatch(/^\S+:0,0,15:0,0,1$/);
    const sketch2 = (await attr(viewport, 'data-sketch-frames')).split(':')[0] as string;

    // Roll back before Sketch2 and add a slot cut there: new features go in at the marker.
    await marker(page).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(marker(page)).toHaveAttribute('aria-valuenow', '2');
    await newSketchOnXY(page);
    const slot = await zoomOut(page, 90);
    await page.keyboard.press('r');
    // On grid points (snap to grid is on): a slot across the box, off its middle.
    await clicker(page, slot)(-40, 0);
    await clicker(page, slot)(40, 10);
    await page.keyboard.press('Escape');
    await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
    await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
    expect(await order(page)).toBe('Sketch1 Extrude1 Sketch3 Sketch2');
    await expect(marker(page)).toHaveAttribute('aria-valuenow', '3');
    const end = (await mapping(viewport))(36, 5);
    await page.mouse.move(end.x, end.y);
    await page.mouse.click(end.x, end.y);
    await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
    await page.keyboard.press('e');
    await dialog.getByRole('combobox', { name: 'Operation' }).selectOption('cut');
    await dialog.getByRole('textbox', { name: 'Distance' }).fill('20');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    expect(await order(page)).toBe('Sketch1 Extrude1 Sketch3 Extrude2 Sketch2');
    await expect(marker(page)).toHaveAttribute('aria-valuenow', '4');
    await expect(chip(page, 'Sketch2')).toHaveAccessibleName('Sketch2 (rolled back)');

    // Rolled forward, Sketch2's face is split by the cut: the kernel takes the closest piece
    // and warns. Keep Closest Match stores it: no warning, one undo step.
    await page.getByRole('button', { name: 'Roll forward to end' }).click();
    await kernelReady(page);
    await expect(chip(page, 'Sketch2')).toHaveAccessibleName('Sketch2 (warning)');
    await expect(chip(page, 'Sketch2')).toHaveAttribute('data-feature-status', 'warning');
    await chip(page, 'Sketch2').click({ button: 'right' });
    await menuItem(page, 'Keep Closest Match').click();
    await kernelReady(page);
    await expect(chip(page, 'Sketch2')).toHaveAccessibleName('Sketch2');
    await page.keyboard.press('Control+z');
    await kernelReady(page);
    await expect(chip(page, 'Sketch2')).toHaveAccessibleName('Sketch2 (warning)');
    await page.keyboard.press('Control+y');
    await kernelReady(page);
    await expect(chip(page, 'Sketch2')).toHaveAccessibleName('Sketch2');

    // Suppressing the box loses the face: an error. Fix References picks a new plane.
    await chip(page, 'Extrude1').click({ button: 'right' });
    await menuItem(page, 'Suppress').click();
    await kernelReady(page);
    await expect(chip(page, 'Sketch2')).toHaveAccessibleName('Sketch2 (error)');
    await chip(page, 'Sketch2').click({ button: 'right' });
    await menuItem(page, 'Fix References').click();
    const prompt = page.getByRole('region', { name: 'Redefine Plane' });
    await expect(prompt).toContainText('Sketch2');
    await prompt.getByRole('button', { name: 'XY' }).click();
    await expect(prompt).toBeHidden();
    await kernelReady(page);
    await expect(chip(page, 'Sketch2')).toHaveAccessibleName('Sketch2');
    await expect
      .poll(() => attr(viewport, 'data-sketch-frames'))
      .toContain(`${sketch2}:0,0,0:0,0,1`);
    // One undo step puts it back on the lost face.
    await page.keyboard.press('Control+z');
    await kernelReady(page);
    await expect(chip(page, 'Sketch2')).toHaveAccessibleName('Sketch2 (error)');
  });
});
