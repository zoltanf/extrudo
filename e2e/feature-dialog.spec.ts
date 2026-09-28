import { expect, type Locator, type Page, test } from '@playwright/test';
import { kernelReady, projector } from './helpers';

// P2-05: the feature dialog framework, on the dialog debug page
// (`#/debug/dialog`): the real shell on an in-memory document with a 20 mm
// test box, computed by the debug kernel worker, with "Press Pull (test)"
// (press-pull of flat faces by the kernel's `test-press` test feature),
// which has what Extrude doesn't: a toggle that shows a field and a custom
// input mapping. Extrude's own tests are in `extrude.spec.ts` (P2-06).

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

/** Waits until the camera has stopped moving (the fit after the box appears). */
async function settled(viewport: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const now = `${await attr(viewport, 'data-camera-size')} ${await attr(viewport, 'data-camera-target')}`;
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
}

async function debugPage(page: Page) {
  await page.goto('./#/debug/dialog');
  await kernelReady(page);
  const viewport = page.getByRole('region', { name: 'Viewport' });
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(400);
  await settled(viewport);
  return { viewport, at: await projector(viewport) };
}

async function openPressPull(page: Page) {
  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('combobox').fill('press pull');
  await palette.getByRole('option', { name: /^Press Pull \(test\)/ }).click();
  const dialog = page.getByRole('region', { name: 'Press Pull dialog' });
  await expect(dialog).toBeVisible();
  return dialog;
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

test('pre-selection, live preview, a dragged arrow, typing into the box, OK and undo', async ({
  page,
}) => {
  const { viewport, at } = await debugPage(page);
  // Pick the top face first (pre-selection, UI spec §3.3).
  const top = at([10, 10, 20]);
  await page.mouse.click(top.x, top.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^face:box:0:\d+$/);

  const dialog = await openPressPull(page);
  const faces = dialog.getByRole('button', { name: 'Faces', exact: true });
  await expect(faces).toHaveText('1 face');
  await expect(faces).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
  // The join's tool previews in green over the box; the arrow sits on the face.
  await expect(viewport).toHaveAttribute('data-preview', 'join', { timeout: 15_000 });
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok');
  const overlay = viewport.locator('[data-manipulators]');
  await expect(overlay).toHaveAttribute('data-manipulators', 'distance:distance');
  await page.screenshot({ path: test.info().outputPath('join-preview.png') });

  // Dragging the arrow's head up lengthens the distance; the preview follows.
  const distance = dialog.getByRole('textbox', { name: 'Distance' });
  await expect(distance).toHaveValue('5 mm');
  await drag(page, await handle(viewport, 'distance'), 0, -60);
  await expect.poll(async () => Number.parseFloat(await distance.inputValue())).toBeGreaterThan(6);
  await expect(distance).toHaveValue(/^\d+(\.\d+)? mm$/);
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok');

  // Typing a number goes straight into the heads-up box next to the arrow.
  const box = viewport.locator('[data-heads-up="distance"]');
  await expect(box).toBeVisible();
  await page.keyboard.press('8');
  await expect(box.getByRole('textbox', { name: 'Distance' })).toBeFocused();
  await expect(box.getByRole('textbox', { name: 'Distance' })).toHaveValue('8');
  await expect(distance).toHaveValue('8');
  await page.screenshot({ path: test.info().outputPath('heads-up.png') });

  // Enter commits the field and presses OK: one feature, one undo step.
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(viewport).not.toHaveAttribute('data-preview', /./);
  const chip = page.getByRole('button', { name: /^Press Pull1/ });
  await expect(chip).toBeVisible();
  await kernelReady(page);
  await expect(chip).not.toHaveAccessibleName(/error/);
  await page.screenshot({ path: test.info().outputPath('committed.png') });
  await page.keyboard.press('Control+Z');
  await expect(chip).toBeHidden();
  await page.keyboard.press('Control+Y');
  await expect(chip).toBeVisible();

  // Editing reopens the same dialog with the stored values; Esc cancels without a change.
  await chip.dblclick();
  const edit = page.getByRole('region', { name: 'Edit Press Pull1 dialog' });
  await expect(edit).toHaveAttribute('data-dialog-mode', 'edit');
  await expect(edit.getByRole('textbox', { name: 'Distance' })).toHaveValue('8');
  await edit.getByRole('combobox', { name: 'Operation' }).selectOption('cut');
  await expect(viewport).toHaveAttribute('data-preview', 'cut', { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('cut-preview.png') });
  await edit.getByRole('button', { name: 'Cancel' }).first().click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
});

test('picking in the dialog, the angle arc, invalid input and kernel errors', async ({ page }) => {
  const { viewport, at } = await debugPage(page);
  const dialog = await openPressPull(page);
  const faces = dialog.getByRole('button', { name: 'Faces', exact: true });
  await expect(faces).toHaveText('Pick a flat face');
  await expect(dialog).not.toHaveAttribute('data-dialog-valid', /./);

  // The faces field takes only faces: an edge isn't pre-highlighted, a face is.
  const edge = at([20, 10, 20]);
  await page.mouse.move(edge.x, edge.y);
  await expect.poll(() => attr(viewport, 'data-model-hover')).not.toMatch(/^edge:/);
  const side = at([20, 10, 10]);
  await page.mouse.move(side.x, side.y);
  await expect.poll(() => attr(viewport, 'data-model-hover')).toMatch(/^face:box:0:\d+$/);
  await page.mouse.click(side.x, side.y);
  await expect(faces).toHaveText('1 face');
  await expect(viewport).toHaveAttribute('data-model-selection', /^face:box:0:\d+$/);
  await expect(viewport).toHaveAttribute('data-preview', 'join', { timeout: 15_000 });

  // Tilt shows the angle field and its arc; dragging the arc changes the angle.
  await dialog.getByRole('checkbox', { name: 'Tilt' }).check();
  const angle = dialog.getByRole('textbox', { name: 'Angle' });
  await expect(angle).toHaveValue('15 deg');
  const overlay = viewport.locator('[data-manipulators]');
  await expect(overlay).toHaveAttribute('data-manipulators', 'distance:distance angle:angle');
  await drag(page, await handle(viewport, 'angle'), 0, -30);
  await expect(angle).not.toHaveValue('15 deg');
  await expect(angle).toHaveValue(/^-?\d+ deg$/);
  await expect(viewport.locator('[data-heads-up="angle"]')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('angle-arc.png') });

  // Invalid input: red underline and message, OK refused, the last preview dimmed.
  const distance = dialog.getByRole('textbox', { name: 'Distance' });
  await distance.fill('5 mm +');
  await expect(distance).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog).not.toHaveAttribute('data-dialog-valid', /./);
  await expect(viewport).toHaveAttribute('data-preview-dimmed', 'true');
  await expect(viewport).toHaveAttribute('data-preview', 'join');
  await page.screenshot({ path: test.info().outputPath('invalid-input.png') });

  // A draft the kernel refuses: its message in the dialog, the preview still dimmed.
  await distance.fill('0 mm');
  await expect(dialog.getByRole('status', { name: 'Feature status' })).toHaveText(
    'The distance is zero.',
    { timeout: 15_000 },
  );
  await expect(dialog).toHaveAttribute('data-preview-status', 'error');
  await expect(viewport).toHaveAttribute('data-preview-dimmed', 'true');
  await expect(dialog).not.toHaveAttribute('data-dialog-valid', /./);
  await page.screenshot({ path: test.info().outputPath('kernel-error.png') });

  // Esc on text that doesn't evaluate puts back the last value that did; Esc again cancels.
  await distance.fill('0 mm *');
  await distance.press('Escape');
  await expect(distance).toHaveValue('0 mm');
  await expect(distance).not.toHaveAttribute('aria-invalid', /./);
  await expect(dialog).toBeVisible();
  await distance.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: /^Press Pull1/ })).toHaveCount(0);
  await expect(viewport).not.toHaveAttribute('data-preview', /./);
});
