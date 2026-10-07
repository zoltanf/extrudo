import { expect, type Locator, type Page, test } from '@playwright/test';
import { exportModel, objectsOf3mf, solidFacts, solidTab } from './benchmark-helpers';
import {
  clicker,
  kernelReady,
  newSketchOnXY,
  openProject,
  pickTool,
  projector,
  sketchOnXY,
} from './helpers';

// P2-06: Extrude in a real project (ADR-0028). A plate with a hole is
// sketched, extruded from its pre-selected profile, then its top face is
// press-pulled out (join) and in (cut, previewed red); undo, redo and
// editing reopen the dialog. The Wall bracket template computes a body.
// P4-12: an extrude up to a cylinder's curved wall, with an offset.

test.use({ viewport: { width: 1440, height: 900 } });
// Three extrudes, undo, redo and an edit, each waiting for the kernel: about 22 s alone,
// over 30 s in a full parallel run on a busy machine.
test.describe.configure({ timeout: 60_000 });

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

/** A manipulator handle's centre in page px. */
async function handle(viewport: Locator, field: string) {
  const circle = viewport.locator(`[data-manipulator-handle="${field}"]`);
  const box = await viewport.boundingBox();
  const cx = Number(await circle.getAttribute('cx'));
  const cy = Number(await circle.getAttribute('cy'));
  return { x: (box?.x ?? 0) + cx, y: (box?.y ?? 0) + cy };
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

/** Turns to the home view and waits for it: returns a world → page mapping. */
async function homeView(page: Page) {
  const viewport = viewportOf(page);
  await page.keyboard.press('Shift+1');
  await page.waitForTimeout(300);
  await settled(viewport);
  return projector(viewport);
}

/** Clicks the model at a world point until it selects a face. */
async function pickFace(
  page: Page,
  at: (p: [number, number, number]) => { x: number; y: number },
  p: [number, number, number],
) {
  const viewport = viewportOf(page);
  const { x, y } = at(p);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^face:/);
}

test('extrudes a profile, press-pulls its top face out and in, with undo, redo and edit', async ({
  page,
}) => {
  const at = await sketchOnXY(page);
  const viewport = viewportOf(page);
  const click = clicker(page, at);
  // A 60 × 40 plate around the origin with a hole of radius 10 at (−10, 0).
  await page.keyboard.press('r');
  await click(-30, -20);
  await click(30, 20);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveCount(0);
  await page.keyboard.press('c');
  await click(-10, 0);
  await click(-10, 10);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveCount(0);
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=2 holes=1');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();

  // Pre-select the plate's profile in the model, then E.
  const plate = at(15, 5);
  await page.mouse.move(plate.x, plate.y);
  await page.mouse.click(plate.x, plate.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.keyboard.press('e');
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Profiles', exact: true })).toHaveText(
    /^Profile · Sketch\d+$/,
  );
  await expect(dialog.getByRole('combobox', { name: 'Operation' })).toHaveValue('new-body');
  // Side 2, the object fields and the bodies don't show for one side to a distance, new body.
  await expect(dialog.getByRole('textbox', { name: 'Distance 2' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Bodies', exact: true })).toHaveCount(0);
  await expect(viewport).toHaveAttribute('data-preview', 'new', { timeout: 15_000 });
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok');
  const overlay = viewport.locator('[data-manipulators]');
  await expect(overlay).toHaveAttribute('data-manipulators', 'distance:distance angle:taper');

  // The arrow points at the camera in the Top view; typing goes to the heads-up box.
  await page.keyboard.press('1');
  await page.keyboard.press('5');
  const box = viewport.locator('[data-heads-up="distance"]');
  await expect(box.getByRole('textbox', { name: 'Distance' })).toHaveValue('15');
  await expect(dialog.getByRole('textbox', { name: 'Distance' })).toHaveValue('15');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(chip(page, 'Extrude1')).toBeVisible();
  await kernelReady(page);
  await expect(chip(page, 'Extrude1')).toHaveAccessibleName('Extrude1');
  // One body: the plate's six faces and the hole's wall, 15 mm thick.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:60,40,15');
  const browser = page.getByRole('complementary', { name: 'Browser' });
  await expect(browser.getByRole('button', { name: 'Hide Body1' })).toBeVisible();

  // Press-pull: the top face, dragged up, joins.
  let world = await homeView(page);
  await pickFace(page, world, [20, 10, 15]);
  await page.keyboard.press('e');
  await expect(dialog.getByRole('button', { name: 'Profiles', exact: true })).toHaveText('1 face');
  const operation = dialog.getByRole('combobox', { name: 'Operation' });
  await expect(operation).toHaveValue('join');
  await expect(dialog.getByRole('button', { name: 'Bodies', exact: true })).toHaveText('Automatic');
  await expect(viewport).toHaveAttribute('data-preview', 'join', { timeout: 15_000 });
  const distance = dialog.getByRole('textbox', { name: 'Distance' });
  await expect(distance).toHaveValue('10 mm');
  await drag(page, await handle(viewport, 'distance'), 0, -40);
  await expect.poll(async () => Number.parseFloat(await distance.inputValue())).toBeGreaterThan(10);
  await distance.fill('5 mm');
  await expect(operation).toHaveValue('join');
  await page.screenshot({ path: test.info().outputPath('join-preview.png') });
  await distance.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(chip(page, 'Extrude2')).toBeVisible();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:60,40,20');

  // Pushed in, the same face cuts: the dialog proposes it and previews it red.
  world = await projector(viewport);
  await pickFace(page, world, [20, 10, 20]);
  await page.keyboard.press('e');
  await expect(operation).toHaveValue('join');
  await page.keyboard.press('-');
  await page.keyboard.press('8');
  await expect(box.getByRole('textbox', { name: 'Distance' })).toHaveValue('-8');
  await expect(operation).toHaveValue('cut');
  await expect(viewport).toHaveAttribute('data-preview', 'cut', { timeout: 15_000 });
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok');
  await page.screenshot({ path: test.info().outputPath('cut-preview.png') });
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(chip(page, 'Extrude3')).toHaveAccessibleName('Extrude3');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:60,40,12');
  await page.screenshot({ path: test.info().outputPath('cut-result.png') });

  // Each extrude is one undo step.
  await page.keyboard.press('Control+z');
  await expect(chip(page, 'Extrude3')).toHaveCount(0);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:60,40,20');
  await page.keyboard.press('Control+y');
  await expect(chip(page, 'Extrude3')).toBeVisible();
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:60,40,12');

  // Editing Extrude1 reopens its dialog with the model rolled back to it.
  await chip(page, 'Extrude1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Extrude1 dialog' });
  await expect(edit).toHaveAttribute('data-dialog-mode', 'edit');
  await expect(edit.getByRole('textbox', { name: 'Distance' })).toHaveValue('15');
  await expect(edit.getByRole('combobox', { name: 'Operation' })).toHaveValue('new-body');
  await edit.getByRole('combobox', { name: 'Direction' }).selectOption('two-sides');
  await expect(edit.getByRole('textbox', { name: 'Distance 2' })).toHaveValue('10 mm');
  await expect(overlay).toHaveAttribute(
    'data-manipulators',
    'distance:distance angle:taper distance:distance2 angle:taper2',
  );
  await expect(viewport).toHaveAttribute('data-preview', 'new', { timeout: 15_000 });
  await expect(edit).toHaveAttribute('data-preview-status', 'ok');
  await page.screenshot({ path: test.info().outputPath('edit-two-sides.png') });
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(edit).toBeHidden();
  await kernelReady(page);
  // The plate now reaches 10 mm below the sketch; the later extrudes follow its top face.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:60,40,22');
  await page.keyboard.press('Control+z');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:60,40,12');
});

test('the Wall bracket template computes its bracket; its cut edits through all', async ({
  page,
}) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Bracket:12:40,80,60');
  const browser = page.getByRole('complementary', { name: 'Browser' });
  await expect(browser.getByRole('button', { name: 'Hide Bracket' })).toBeVisible();

  await chip(page, 'Extrude2').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Extrude2 dialog' });
  await expect(edit.getByRole('button', { name: 'Profiles', exact: true })).toHaveText(
    '2 profiles',
  );
  await expect(edit.getByRole('combobox', { name: 'Operation' })).toHaveValue('cut');
  // The options carry the theme's colours: a native list that ignores `color-scheme` (white on
  // Linux) must not show the dark theme's light text on its own white background.
  const contrasts = (await page.evaluate(`(() => {
    const luminance = (colour) => {
      const [r, g, b] = colour.match(/[\\d.]+/g).slice(0, 3).map((v) => {
        const c = Number(v) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const options = document.querySelectorAll('select[aria-label="Operation"] option');
    return [...options].map((option) => {
      const style = getComputedStyle(option);
      if (style.backgroundColor === 'rgba(0, 0, 0, 0)') return 0;
      const [a, b] = [luminance(style.color), luminance(style.backgroundColor)];
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
  })()`)) as number[];
  expect(contrasts).toHaveLength(4);
  for (const contrast of contrasts) expect(contrast).toBeGreaterThan(4.5);
  await expect(edit.getByRole('textbox', { name: 'Distance' })).toHaveValue('wall * 5');
  await expect(edit.getByRole('textbox', { name: 'Taper' })).toHaveValue('tilt / 3');
  await expect(viewport).toHaveAttribute('data-preview', 'cut', { timeout: 15_000 });
  // A taper the kernel refuses, then a good one again: the dialog recovers.
  const taper = edit.getByRole('textbox', { name: 'Taper' });
  await taper.fill('95 deg');
  await expect(edit).toHaveAttribute('data-preview-status', 'error', { timeout: 15_000 });
  await expect(edit.getByText('The taper angle must be between -90° and 90°.')).toBeVisible();
  await expect(edit).not.toHaveAttribute('data-dialog-valid');
  await taper.fill('tilt / 3');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await expect(edit.getByText('The taper angle must be between -90° and 90°.')).toHaveCount(0);
  await expect(edit).toHaveAttribute('data-dialog-valid', 'true');
  await edit.getByRole('combobox', { name: 'Extent' }).selectOption('through-all');
  await expect(edit.getByRole('textbox', { name: 'Distance' })).toHaveCount(0);
  await expect(viewport.locator('[data-manipulators]')).toHaveAttribute(
    'data-manipulators',
    'angle:taper',
  );
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('bracket-through-all.png') });
  await page.keyboard.press('Enter');
  await expect(edit).toBeHidden();
  await kernelReady(page);
  await expect(chip(page, 'Extrude2')).toHaveAccessibleName('Extrude2');
  await expect(viewport).toHaveAttribute('data-bodies', 'Bracket:12:40,80,60');
});

test('a symmetric extrude measures the whole length or each side (P4-12)', async ({ page }) => {
  const at = await sketchOnXY(page);
  const viewport = viewportOf(page);
  const click = clicker(page, at);
  // A 60 × 40 plate around the origin.
  await page.keyboard.press('r');
  await click(-30, -20);
  await click(30, 20);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();

  const plate = at(15, 5);
  await page.mouse.move(plate.x, plate.y);
  await page.mouse.click(plate.x, plate.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.keyboard.press('e');
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Direction' }).selectOption('symmetric');
  const measure = dialog.getByRole('combobox', { name: 'Measure' });
  await expect(measure).toBeVisible();
  await measure.selectOption('half');
  await dialog.getByRole('textbox', { name: 'Distance' }).fill('10 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  // The distance is each side's: 20 mm tall.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:60,40,20');

  // Back to the whole length: 10 mm all in all, and the stored input goes.
  await chip(page, 'Extrude1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Extrude1 dialog' });
  await expect(edit.getByRole('combobox', { name: 'Measure' })).toHaveValue('half');
  await edit.getByRole('combobox', { name: 'Measure' }).selectOption('whole');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(edit).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:60,40,10');
});

test('extrudes up to a cylinder’s curved wall, then 2 mm past it', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  // A Ø30 cylinder lying along Y (on XZ, which grows towards −Y) above the
  // origin: its axis at x = 0, z = 30, from y = 15 to −15.
  await settled(viewport);
  const home = await projector(viewport);
  const half = Number(await viewport.getAttribute('data-camera-size')) * 0.16;
  await pickTool(page, 'Cylinder');
  const cylinder = page.getByRole('region', { name: 'Cylinder dialog' });
  const plane = home([half * 0.6, 0, half * 0.6]);
  await page.mouse.move(plane.x, plane.y);
  await page.mouse.click(plane.x, plane.y);
  await expect(cylinder.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XZ plane');
  for (const [name, value] of [
    ['X', '0 mm'],
    ['Y', '30 mm'],
    ['Offset', '-15 mm'],
    ['Diameter', '30 mm'],
    ['Height', '30 mm'],
  ]) {
    await cylinder.getByRole('textbox', { name, exact: true }).fill(value as string);
  }
  await expect(cylinder).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await cylinder.getByRole('button', { name: 'OK' }).click();
  await expect(cylinder).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:3:30,30,30');

  // A 20 × 20 square under it on XY.
  const at = await newSketchOnXY(page);
  const click = clicker(page, at);
  await page.keyboard.press('r');
  await click(-10, -10);
  await click(10, 10);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();

  // From below (Shift+3) the square is in front of the cylinder: pick it, then E.
  await page.keyboard.press('Shift+3');
  await page.waitForTimeout(300);
  await settled(viewport);
  let below = await projector(viewport);
  const square = below([5, 5, 0]);
  await page.mouse.move(square.x, square.y);
  await page.mouse.click(square.x, square.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.keyboard.press('e');
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Extent' }).selectOption('to-object');
  const object = dialog.getByRole('button', { name: 'To object', exact: true });
  await object.click();
  // The wall beside the square, seen from below: (−12, 4, 30 − √(225 − 144)),
  // off the XZ plane's square (on the +X side the taper's heads-up box covers it). A field that takes planes picks through the
  // plane picker (no `data-model-hover`), curved faces included for To object.
  below = await projector(viewport);
  const wall = below([-12, 4, 21]);
  await page.mouse.move(wall.x, wall.y, { steps: 3 });
  await page.mouse.click(wall.x, wall.y);
  await expect(object).toHaveText('1 face');
  await expect(dialog.getByRole('textbox', { name: 'Offset', exact: true })).toHaveValue('0 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  // It ends on the wall: highest at the square's sides x = ±10, 30 − √(225 − 100) ≈ 18.8.
  await expect(viewport).toHaveAttribute('data-bodies', /^Body1:3:30,30,30 Body2:\d+:20,20,18\.8$/);

  // 2 mm past the wall, along the extrude.
  await chip(page, 'Extrude1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Extrude1 dialog' });
  await edit.getByRole('textbox', { name: 'Offset', exact: true }).fill('2 mm');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(edit).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', /^Body1:3:30,30,30 Body2:\d+:20,20,20\.8$/);
});

test('tapers an ellipse profile (P4-12: a ruled loft, no more refusal)', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  const at = await sketchOnXY(page);
  const click = clicker(page, at);
  // A 40 × 20 ellipse about the origin: centre (0, 0), major (20, 0), minor (0, 10).
  await pickTool(page, 'Ellipse');
  await click(0, 0);
  await click(20, 0);
  await click(0, 10);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveCount(0);
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();

  // Pre-select the ellipse's profile, then E and a 10° taper.
  const inside = at(0, 0);
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.click(inside.x, inside.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.keyboard.press('e');
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Distance', exact: true }).fill('20 mm');
  await dialog.getByRole('textbox', { name: 'Taper', exact: true }).fill('10 deg');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 20_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  // The ellipse is 40 × 20; a 10° taper over 20 mm widens each side by
  // 20·tan 10° ≈ 3.53 mm, so the box is 47.1 × 27.1 × 20.
  await expect(viewport).toHaveAttribute('data-bodies', /^Body1:\d+:47\.1,27\.1,20$/);
  await expect(page.getByRole('alert')).toHaveCount(0);

  const file = await exportModel(page, '3MF');
  await solidTab(page);
  const objects = objectsOf3mf(file);
  expect(objects).toHaveLength(1);
  const mesh = objects[0]?.mesh;
  if (!mesh) throw new Error('no mesh');
  const facts = solidFacts(mesh);
  // Steiner: A L + P tan L²/2 + π tan² L³/3 for the ellipse's area and perimeter.
  const a = 20;
  const b = 10;
  const hh = (a - b) ** 2 / (a + b) ** 2;
  const perimeter = Math.PI * (a + b) * (1 + (3 * hh) / (10 + Math.sqrt(4 - 3 * hh)));
  const t = Math.tan((10 * Math.PI) / 180);
  const exact = Math.PI * a * b * 20 + (perimeter * t * 400) / 2 + (Math.PI * t * t * 8000) / 3;
  expect(Math.abs(facts.volume - exact) / exact).toBeLessThan(0.02);
});
