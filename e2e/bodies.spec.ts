import { expect, type Locator, type Page, test } from '@playwright/test';
import { clicker, kernelReady, mapping, newSketchOnXY, openProject, sketchOnXY } from './helpers';

// P2-08: bodies (ADR-0030). The browser's Bodies folder renames, hides,
// colours and removes bodies (a Remove feature, undoable), with a count
// badge; a cut that splits a body makes two; wireframe and hidden-edge
// styles draw the silhouettes of curved faces.

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
const browserOf = (page: Page) => page.getByRole('complementary', { name: 'Browser' });
const bodyRow = (page: Page, name: string) =>
  browserOf(page).getByRole('button', { name, exact: true });
const badge = (page: Page) => browserOf(page).locator('[data-folder-count]');
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });

/** Waits until the camera has stopped moving, then maps sketch mm (on XY) to page px. */
async function still(viewport: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const now = `${await attr(viewport, 'data-camera-size')} ${await attr(viewport, 'data-camera-target')} ${await attr(viewport, 'data-camera-direction')}`;
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
  return mapping(viewport);
}

async function visualStyle(page: Page, style: string) {
  await page.getByRole('button', { name: 'Visual style' }).click();
  await page.getByRole('menuitemradio', { name: style, exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}

test('renames, hides, colours and removes a body from the browser', async ({ page }) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Bracket:12:40,80,60');
  await expect(badge(page)).toHaveText('1');

  // F2 renames; the name is stored, so it survives a reload.
  await bodyRow(page, 'Bracket').focus();
  await page.keyboard.press('F2');
  const field = browserOf(page).getByRole('textbox', { name: 'Rename Bracket' });
  await field.fill('Mount');
  await field.press('Enter');
  await expect(viewport).toHaveAttribute('data-bodies', 'Mount:12:40,80,60');
  await page.reload();
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Mount:12:40,80,60');

  // The eye hides it in the view and shows it again.
  await browserOf(page).getByRole('button', { name: 'Hide Mount' }).click();
  await expect(viewport).not.toHaveAttribute('data-bodies');
  await expect(bodyRow(page, 'Mount')).toBeVisible();
  await browserOf(page).getByRole('button', { name: 'Show Mount' }).click();
  await expect(viewport).toHaveAttribute('data-bodies', 'Mount:12:40,80,60');

  // Appearance from the body's menu: a colour and an opacity, each one undo step.
  await bodyRow(page, 'Mount').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Appearance…' }).click();
  const panel = page.getByRole('dialog', { name: 'Mount appearance' });
  await panel.getByRole('radio', { name: 'Blue' }).check();
  await expect(viewport).toHaveAttribute('data-body-appearance', 'Mount:#5b7cff:1');
  await panel.getByRole('radio', { name: '50 %' }).check();
  await expect(viewport).toHaveAttribute('data-body-appearance', 'Mount:#5b7cff:0.5');
  await page.screenshot({ path: test.info().outputPath('blue-half.png') });
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.keyboard.press('Control+z');
  await expect(viewport).toHaveAttribute('data-body-appearance', 'Mount:#5b7cff:1');

  // A click on the row selects the body in the model; Delete removes it through a Remove.
  await bodyRow(page, 'Mount').click();
  await expect(viewport).toHaveAttribute('data-model-selection', /^body:/);
  await expect(bodyRow(page, 'Mount')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Delete');
  await expect(chip(page, 'Remove1')).toBeVisible();
  await kernelReady(page);
  await expect(viewport).not.toHaveAttribute('data-bodies');
  await expect(badge(page)).toHaveCount(0);
  await expect(browserOf(page).getByText('No bodies yet')).toBeVisible();
  // Undo brings it back with its name and colour.
  await page.keyboard.press('Control+z');
  await expect(chip(page, 'Remove1')).toHaveCount(0);
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Mount:12:40,80,60');
  await expect(viewport).toHaveAttribute('data-body-appearance', 'Mount:#5b7cff:1');

  // The body menu's Delete does the same.
  await bodyRow(page, 'Mount').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Delete/ }).click();
  await expect(chip(page, 'Remove1')).toBeVisible();
  await kernelReady(page);
  await expect(viewport).not.toHaveAttribute('data-bodies');
});

test('the bracket shows the silhouettes of its tapered holes in wireframe', async ({ page }) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await expect(viewport).not.toHaveAttribute('data-silhouettes');
  await visualStyle(page, 'Wireframe');
  await expect
    .poll(async () => Number(await attr(viewport, 'data-silhouettes')))
    .toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath('wireframe.png') });
  // They follow the camera: looking straight down the holes' axes (orthographic), the
  // tapered walls all face up, so there is no outline; back in the home view there is.
  await page.getByRole('button', { name: 'Orthographic' }).click();
  await page.keyboard.press('Shift+2');
  await expect(viewport).not.toHaveAttribute('data-silhouettes');
  await page.keyboard.press('Shift+1');
  await expect
    .poll(async () => Number(await attr(viewport, 'data-silhouettes')))
    .toBeGreaterThan(0);
  await visualStyle(page, 'Shaded with hidden edges');
  await expect
    .poll(async () => Number(await attr(viewport, 'data-silhouettes')))
    .toBeGreaterThan(0);
  await visualStyle(page, 'Shaded');
  await expect(viewport).not.toHaveAttribute('data-silhouettes');
});

test('a cut through a plate makes two bodies, named without shifting', async ({ page }) => {
  // Both sketches first: a 40 × 20 plate around the origin (on the 10 mm snap grid), then a
  // strip across it, x from −10 to 0 (left piece 10 mm wide, right 20 mm). The second
  // sketch opens fitted to the first (about ±13 mm up and down, a finer grid), so the strip
  // ends at ±12.
  await sketchOnXY(page);
  const viewport = page.getByRole('region', { name: 'Viewport' });
  let click = clicker(page, await still(viewport));
  await page.keyboard.press('r');
  await click(-20, -10);
  await click(20, 10);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();
  await newSketchOnXY(page);
  click = clicker(page, await still(viewport));
  await page.keyboard.press('r');
  await click(-10, -12);
  await click(0, 12);
  await page.keyboard.press('Escape');
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch2')).toBeVisible();

  // The plate, 10 mm thick.
  let world = await still(viewport);
  const plate = world(10, 5);
  await page.mouse.click(plate.x, plate.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.keyboard.press('e');
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Distance' }).fill('10 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:40,20,10');

  // The strip's profile, clear of the plate (which sits over the sketch plane), cut 10 mm up.
  // Orthographic, so the plate's top edge (10 mm up) doesn't grow over the strip.
  await page.getByRole('button', { name: 'Orthographic' }).click();
  await expect(viewport).toHaveAttribute('data-camera-projection', 'orthographic');
  world = await still(viewport);
  const strip = world(-5, 11.5);
  await page.mouse.click(strip.x, strip.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.keyboard.press('e');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Operation' }).selectOption('cut');
  await dialog.getByRole('textbox', { name: 'Distance' }).fill('10 mm');
  await expect(viewport).toHaveAttribute('data-preview', 'cut', { timeout: 15_000 });
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  // The larger piece stays Body1; the other is a new body.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,10 Body2:6:10,20,10');
  await expect(badge(page)).toHaveText('2');

  // Removing Body1 leaves Body2 named as it was.
  await bodyRow(page, 'Body1').click();
  await page.keyboard.press('Delete');
  await expect(chip(page, 'Remove1')).toBeVisible();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body2:6:10,20,10');
  await expect(badge(page)).toHaveText('1');
  // Undoing the cut takes the second body and its name away.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(chip(page, 'Extrude2')).toHaveCount(0);
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:40,20,10');
});
