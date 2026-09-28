import { expect, type Locator, type Page, test } from '@playwright/test';
import { clicker, kernelReady, openProject, projector, sketchOnXY } from './helpers';

// P2-06: Extrude in a real project (ADR-0028). A plate with a hole is
// sketched, extruded from its pre-selected profile, then its top face is
// press-pulled out (join) and in (cut, previewed red); undo, redo and
// editing reopen the dialog. The Wall bracket template computes a body.

test.use({ viewport: { width: 1440, height: 900 } });

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
    '1 profile',
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
  await expect(viewport).toHaveAttribute('data-bodies', 'Bracket:10:40,80,60');
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
  await expect(viewport).toHaveAttribute('data-bodies', 'Bracket:10:40,80,60');
});
