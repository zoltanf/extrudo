import { expect, type Locator, type Page, test } from '@playwright/test';
import { kernelReady, openProject, pickTool, projector } from './helpers';

// P4-06, slice 5: a canvas (ADR-0066 §5, FR-IO-07). The Insert tab's Canvas
// picks a picture, stores its bytes with the design and lays it on a plane;
// the dialog calibrates it against a real distance, the browser's Canvases
// folder has an eye, and the picture travels with an exported design.
//
// The picture is made here, not checked in: a 200 × 100 PNG with two marks
// 150 px apart, so a canvas of the width the dialog proposes (200 px at 100
// dpi = 20 mm) has them 15 mm apart.

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 180_000 });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const viewport = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const dialog = (page: Page, name = 'Canvas dialog') => page.getByRole('region', { name });
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });

/**
 * A 200 × 100 PNG with two black marks 150 px apart, built in the page (the
 * e2e specs typecheck without the DOM library, so the code runs as a string).
 * The marks are centred on the picture's middle, 75 px each way: at the 0.1 mm
 * a pixel is worth they are 15 mm apart on a 20 mm wide canvas.
 */
async function pngBytes(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(`(async () => {
    const canvas = new OffscreenCanvas(200, 100);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 200, 100);
    ctx.fillStyle = '#000000';
    ctx.fillRect(20, 45, 10, 10);
    ctx.fillRect(170, 45, 10, 10);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return [...new Uint8Array(await blob.arrayBuffer())];
  })()`);
  return Buffer.from(bytes as number[]);
}

/** The Insert tab's Canvas tile, then a picture through the platform's picker. */
async function pickCanvas(page: Page, bytes: Buffer): Promise<Locator> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('tab', { name: 'Insert' }).click();
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await (await chooser).setFiles({ name: 'plan.png', mimeType: 'image/png', buffer: bytes });
  const panel = dialog(page);
  await expect(panel).toBeVisible();
  return panel;
}

/** The drawn canvases by feature ID: "<width>x<height>:<origin>" each, in mm. */
async function canvases(page: Page): Promise<Record<string, string>> {
  const drawn = (await viewport(page).getAttribute('data-canvases')) ?? '';
  return Object.fromEntries(
    drawn
      .split(' ')
      .filter(Boolean)
      .map((entry) => {
        const [id, ...rest] = entry.split(':');
        return [id ?? '', rest.join(':')];
      }),
  );
}

/** What the one drawn canvas reads, "20x10:0,0,20". */
async function canvasSize(page: Page): Promise<string | undefined> {
  const [size] = Object.values(await canvases(page));
  return size;
}

async function ok(page: Page, panel: Locator) {
  await expect(panel).toHaveAttribute('data-dialog-valid', 'true');
  await panel.getByRole('button', { name: /^OK/ }).click();
  await expect(panel).toBeHidden();
  await kernelReady(page);
}

/**
 * Picks the box's top face in the model: it becomes the canvas's plane. The
 * view is fitted first, so the origin planes' squares stay well clear of the
 * face and a click on the picture lands on the face.
 */
async function pickTopFace(page: Page) {
  const view = viewport(page);
  await page.keyboard.press('F6');
  await expect.poll(async () => view.getAttribute('data-camera-size')).toBeTruthy();
  const at = await settledProjector(view);
  const top = at([0, 0, 20]);
  await page.mouse.move(top.x, top.y);
  await expect
    .poll(async () => (await viewport(page).getAttribute('data-model-hover')) ?? '')
    .toMatch(/^face:/);
  await page.mouse.click(top.x, top.y);
  await expect
    .poll(async () => (await view.getAttribute('data-model-selection')) ?? '')
    .toMatch(/^face:/);
  return at;
}

/** A 20 mm cube on XY, so the canvas has a face to lie on. */
async function addBox(page: Page) {
  await pickTool(page, 'Box');
  await ok(page, page.getByRole('region', { name: 'Box dialog' }));
  await expect(viewport(page)).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
}

/** Waits until the camera has stopped moving; returns a world → page projector. */
async function settledProjector(view: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const values = await Promise.all(
        ['size', 'target', 'direction'].map((k) => view.getAttribute(`data-camera-${k}`)),
      );
      const key = values.join(' ');
      const still = key === last;
      last = key;
      return still;
    })
    .toBe(true);
  return projector(view);
}

test('a picture lies on a plane at its own scale, and undo takes it away', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  const bytes = await pngBytes(page);
  expect(await canvases(page)).toEqual({});

  await addBox(page);
  await pickTopFace(page);
  const panel = await pickCanvas(page, bytes);
  // The picture is named, and its own width is proposed: 200 px at 100 dpi.
  await expect(panel.locator('[data-info="image"]')).toContainText('plan.png');
  await expect(panel.getByRole('textbox', { name: 'Width', exact: true })).toHaveValue('20 mm');
  await expect(panel.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
  // The live preview draws the picture before OK.
  await expect(panel).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
  await expect.poll(async () => canvasSize(page), { timeout: 30_000 }).toMatch(/^20x10:0,0,20$/);

  await ok(page, panel);
  await expect(chip(page, 'Canvas1')).toBeVisible();
  // 20 mm wide, as tall as the picture's aspect, on the face's plane at z = 20.
  await expect.poll(async () => canvasSize(page)).toMatch(/^20x10:0,0,20$/);

  // One undo step for the feature and its picture's record together.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => Object.keys(await canvases(page)).length).toBe(0);
  await expect(chip(page, 'Canvas1')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(chip(page, 'Canvas1')).toBeVisible();
  await expect.poll(async () => canvasSize(page)).toMatch(/^20x10:0,0,20$/);

  // The browser's Canvases folder lists it with an eye (ADR-0021).
  const row = page.locator('aside[aria-label="Browser"] [data-canvas]').last();
  await expect(row).toContainText('Canvas1');
  await page.getByRole('button', { name: 'Hide Canvas1' }).click();
  await expect(viewport(page)).not.toHaveAttribute('data-canvases', /./);
  await page.getByRole('button', { name: 'Show Canvas1' }).click();
  await expect.poll(async () => canvasSize(page)).toMatch(/^20x10:0,0,20$/);
});

test('calibrating makes the width the real distance gives', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  const bytes = await pngBytes(page);
  await addBox(page);
  const at = await pickTopFace(page);
  await ok(page, await pickCanvas(page, bytes));
  await expect.poll(async () => canvasSize(page)).toMatch(/^20x10:0,0,20$/);

  await chip(page, 'Canvas1').dblclick();
  const edit = dialog(page, 'Edit Canvas1 dialog');
  await expect(edit).toBeVisible();
  // The picture is drawn on the face: its marks are at ±7.5 mm along world X,
  // which is 15 mm apart — 150 px at 100 dpi.
  const left = at([-7.5, 0, 20]);
  const right = at([7.5, 0, 20]);

  await edit.getByRole('button', { name: 'Calibrate' }).click();
  await expect(edit.locator('[data-calibrate]')).toHaveAttribute('data-calibrate', '0');
  await page.mouse.click(left.x, left.y);
  await expect(edit.locator('[data-calibrate]')).toHaveAttribute('data-calibrate', '1');
  await page.mouse.click(right.x, right.y);
  await expect(edit.locator('[data-calibrate]')).toHaveAttribute('data-calibrate', '2');

  // The dialog asks what the two points really measure, and says what they are
  // on the picture now: 15 mm, to a pixel of the click.
  const apart = edit.getByText(/apart on the picture/);
  await expect(apart).toBeVisible();
  const measured = Number(/([\d.]+) mm apart/.exec((await apart.innerText()) ?? '')?.[1] ?? 0);
  expect(measured).toBeGreaterThan(14.9);
  expect(measured).toBeLessThan(15.1);

  const real = edit.getByRole('textbox', { name: 'Real distance', exact: true });
  await real.fill('30 mm');
  // Apply sets the width the real distance gives: `width × real / measured`,
  // to 0.01 mm as a plain value. (The dialog rounds the measurement it shows,
  // so the width is checked against that to a hundredth.)
  const expected = (20 * 30) / measured;
  await edit.getByRole('button', { name: 'Apply' }).click();
  await expect
    .poll(async () =>
      Number(
        (await edit.getByRole('textbox', { name: 'Width', exact: true }).inputValue()).replace(
          /[^\d.]/g,
          '',
        ),
      ),
    )
    .toBeCloseTo(expected, 1);
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
  await ok(page, edit);
  // 20 mm wide had the marks 15 mm apart; 30 mm really: about 40 mm wide, and
  // as tall as the picture's aspect.
  const drawn = /^(?<w>[\d.]+)x(?<h>[\d.]+):/.exec((await canvasSize(page)) ?? '')?.groups ?? {};
  expect(Number(drawn.w)).toBeCloseTo(expected, 1);
  expect(Number(drawn.h)).toBeCloseTo(expected / 2, 1);
});

test('Esc cancels a calibration, and leaves the picture alone', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  const bytes = await pngBytes(page);
  await addBox(page);
  const at = await pickTopFace(page);
  await ok(page, await pickCanvas(page, bytes));
  await expect.poll(async () => canvasSize(page)).toMatch(/^20x10:0,0,20$/);

  // A calibration that Esc ends leaves the dialog open and the width alone.
  await chip(page, 'Canvas1').dblclick();
  const edit = dialog(page, 'Edit Canvas1 dialog');
  await edit.getByRole('button', { name: 'Calibrate' }).click();
  const mark = at([-7.5, 0, 20]);
  await page.mouse.click(mark.x, mark.y);
  await expect(edit.locator('[data-calibrate]')).toHaveAttribute('data-calibrate', '1');
  await edit.getByRole('button', { name: /Calibrat/ }).focus();
  await page.keyboard.press('Escape');
  await expect(edit).toBeVisible();
  await expect(edit.getByRole('textbox', { name: 'Width', exact: true })).toHaveValue('20 mm');
  await expect(edit.getByRole('textbox', { name: 'Real distance', exact: true })).toHaveCount(0);
  // The picture is still on the face the two clicks were meant to measure on.
  await expect(edit.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
  await edit.getByRole('button', { name: 'Cancel Esc' }).click();
  await expect.poll(async () => canvasSize(page)).toMatch(/^20x10:0,0,20$/);
});

test('a canvas follows its construction plane when it moves', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  const view = viewport(page);
  const bytes = await pngBytes(page);

  // An offset plane 40 mm above XY, picked in the view like any construction
  // geometry (ADR-0040).
  const settled = await settledProjector(view);
  const half = Number(await view.getAttribute('data-camera-size')) * 0.16;
  await page
    .getByRole('group', { name: 'Construct', exact: true })
    .getByRole('button', { name: 'Offset Plane' })
    .click();
  const planeDialog = page.getByRole('region', { name: 'Offset Plane dialog' });
  await expect(planeDialog).toBeVisible();
  const square = settled([half * 0.5, -half * 0.5, 0]);
  await page.mouse.click(square.x, square.y);
  await expect(planeDialog.getByRole('button', { name: 'Plane', exact: true })).toHaveText(
    'XY plane',
  );
  await planeDialog.getByRole('textbox', { name: 'Distance' }).fill('40 mm');
  await ok(page, planeDialog);
  await expect(view).toHaveAttribute('data-construction', /Offset_Plane1:plane:0,0,40:0,0,1/);

  // The picture on that plane: the dialog picks its square in the view.
  const panel = await pickCanvas(page, bytes);
  const away = await settledProjector(view);
  // While the Plane field picks, the view offers its planes and faces (no
  // `data-model-hover`: that belongs to the model picker).
  const onPlane = away([half * 0.5, -half * 0.5, 40]);
  await page.mouse.click(onPlane.x, onPlane.y);
  await expect(panel.getByRole('button', { name: 'Plane', exact: true })).toHaveText(
    'Offset Plane1',
  );
  await expect(panel).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
  await ok(page, panel);
  await expect.poll(async () => canvasSize(page)).toMatch(/^20x10:0,0,40$/);

  // Moving the plane moves the picture with it.
  await chip(page, 'Offset Plane1').dblclick();
  const move = page.getByRole('region', { name: 'Edit Offset Plane1 dialog' });
  await move.getByRole('textbox', { name: 'Distance' }).fill('60 mm');
  await ok(page, move);
  await expect.poll(async () => canvasSize(page)).toMatch(/^20x10:0,0,60$/);
});

test('the picture travels with an exported design', async ({ page }, info) => {
  await openProject(page);
  await kernelReady(page);
  const bytes = await pngBytes(page);
  await ok(page, await pickCanvas(page, bytes));
  // The default plane is XY, at the origin.
  await expect.poll(async () => canvasSize(page)).toMatch(/^20x10:0,0,0$/);

  const file = info.outputPath('canvas.extrudo');
  await page.getByRole('button', { name: 'File menu' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Export .extrudo' }).click(),
  ]);
  await download.saveAs(file);

  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import .extrudo' }).click(),
  ]);
  await chooser.setFiles(file);
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await kernelReady(page);
  await expect(chip(page, 'Canvas1')).toBeVisible();
  await expect.poll(async () => canvasSize(page), { timeout: 60_000 }).toMatch(/^20x10:0,0,0$/);
  expect(await page.getByText(/is missing from this design/).count()).toBe(0);
});
