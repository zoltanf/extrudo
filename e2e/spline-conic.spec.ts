import { expect, type Page, test } from '@playwright/test';
import { clicker, counts, kernelReady, pickTool, sketchOnXY } from './helpers';

// P4-05: control-point splines and conics (ADR-0063): both drawn from the
// Create menu, a control spline closed by a line as a profile, and a conic with
// a typed rho, finished and extruded into one body. P4-12 (ADR-0063's
// amendment): a closed control spline drawn back to its first point and
// extruded, a fit spline trimmed against a line, and a spline offset.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const viewport = (page: Page) => page.getByRole('region', { name: 'Viewport' });

/**
 * A note the two tests live by: the 10 mm snap is on in e2e, so everything a
 * tool places is on a grid point, and a click that selects a curve has to land
 * where the curve runs (which is between them, so the pick's reach is what
 * finds it).
 */
const toolPrompt = (page: Page) => page.getByRole('status', { name: 'Tool prompt' });
const selection = (page: Page) => page.getByRole('region', { name: 'Selection' });
const headsUp = (page: Page) => page.getByRole('group', { name: 'Heads-up input' });

/** "Body1:7:60,40,15" per drawn body: its name, face count and size in mm. */
async function bodies(page: Page) {
  const drawn = (await viewport(page).getAttribute('data-bodies')) ?? '';
  return drawn
    .split(' ')
    .filter(Boolean)
    .map((entry) => {
      const [name, faces, size] = entry.split(':');
      return { name, faces: Number(faces), size: (size ?? '').split(',').map(Number) };
    });
}

test('a control-point spline closed by a line is one profile', async ({ page }) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);

  await pickTool(page, 'Control Point Spline');
  await expect(toolPrompt(page)).toHaveText('Click the first control point.');
  // A dome: two high poles between two low ones, so the curve is well clear of
  // the line that closes it below.
  await click(-40, 20);
  await click(-20, 40);
  await click(0, 40);
  await click(20, 20);
  const next = at(-40, 30);
  await page.mouse.move(next.x, next.y);
  await expect(page.locator('[data-preview="curve"]')).toHaveCount(1);
  await expect(toolPrompt(page)).toHaveText(
    'Click the next control point, Enter to finish, or the first one to close it.',
  );
  await page.keyboard.press('Enter');
  // Four control points, on the grid.
  await expect.poll(() => counts(page)).toMatchObject({ splines: 1, points: 4 });

  // A line from the last control point back to the first closes the loop.
  // (L, the Line tool's key: its menu item reads "Line L".)
  await page.keyboard.press('l');
  await click(20, 20);
  await click(-40, 20);
  // The Line tool keeps the end of a finished line as the start of the next,
  // so the first Esc drops that and the second leaves the tool.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);

  // The curve and the line under it make one region.
  await expect(viewport(page)).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');

  // The pointer is back in Select: a click on the curve says how many control
  // points it has. The dome's crown is at (−10, 35): the poles' own mean.
  // along the four poles.
  const crown = at(-10, 35);
  await page.mouse.move(crown.x, crown.y);
  await page.mouse.click(crown.x, crown.y);
  await expect(selection(page).locator('[data-selection-title]')).toHaveText('Spline');
  await expect(selection(page)).toContainText('Control points');
  await expect(selection(page)).toContainText('4');
});

test('a conic with a typed rho extrudes into one body', async ({ page }) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);

  await pickTool(page, 'Conic');
  await expect(toolPrompt(page)).toHaveText('Click the start of the conic.');
  await click(-20, 0);
  // The Rho field is there from the first click, and its value is remembered.
  await expect(headsUp(page)).toContainText('Rho');
  await click(20, 0);
  await click(0, 20);
  await expect.poll(() => counts(page)).toMatchObject({ splines: 1, points: 3 });

  // The selection panel's Rho field edits the conic. The pointer is back in
  // Select after Esc, and a click on the curve selects it. Not the apex: there
  // the curve runs flat, so the pick's 8 px reach is all in y and the viewport's
  // pixel-to-mm round-off is a fraction of a millimetre. On the steep side at
  // (10, 7.5) \u2014 a third of the way along the quadratic \u2014 the reach covers it.
  await page.keyboard.press('Escape');
  const onCurve = at(10, 7.5);
  await page.mouse.move(onCurve.x, onCurve.y);
  await page.mouse.click(onCurve.x, onCurve.y);
  await expect(selection(page)).toContainText('Rho');
  const rho = selection(page).getByRole('textbox', { name: 'Rho' });
  await expect(rho).toHaveValue('0.5');
  await rho.fill('0.3');
  await rho.press('Enter');
  await expect.poll(() => rho.inputValue()).toBe('0.3');

  // A line from the conic's end back to its start closes the loop.
  await page.keyboard.press('l');
  await click(20, 0);
  await click(-20, 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await expect(viewport(page)).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');

  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);

  // Pre-select the profile in the model, then extrude it 5 mm.
  const middle = at(0, 2);
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.click(middle.x, middle.y);
  await expect
    .poll(async () => viewport(page).getAttribute('data-model-selection'))
    .toMatch(/^profile:/);
  await page.keyboard.press('e');
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(dialog).toBeVisible();
  // One profile came with the pre-selection, so the field names it.
  await expect(dialog.getByRole('button', { name: 'Profiles', exact: true })).toContainText(
    'Profile',
  );
  await dialog.getByRole('textbox', { name: 'Distance' }).fill('5 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 30_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);

  // One body, 40 mm wide and 5 mm thick, as tall as the conic's fullness: a rho
  // of 0.3 puts the curve 0.3 of the shoulder's 20 mm up, so 6 mm.
  const drawn = await bodies(page);
  expect(drawn).toHaveLength(1);
  expect(drawn[0]?.size[0]).toBe(40);
  expect(drawn[0]?.size[2]).toBe(5);
  expect(drawn[0]?.size[1]).toBeGreaterThan(5);
  expect(drawn[0]?.size[1]).toBeLessThan(7);
});

/** Finishes the sketch, picks the profile at `inside` in the model and extrudes it 5 mm. */
async function extrudeAt(
  page: Page,
  at: (x: number, y: number) => { x: number; y: number },
  inside: [number, number],
) {
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);
  const middle = at(...inside);
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.click(middle.x, middle.y);
  await expect
    .poll(async () => viewport(page).getAttribute('data-model-selection'))
    .toMatch(/^profile:/);
  await page.keyboard.press('e');
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Distance' }).fill('5 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 30_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
}

/** A fit spline through five grid points, a wave from (−40, 0) to (40, 0). */
async function wave(page: Page, click: (x: number, y: number) => Promise<void>) {
  await pickTool(page, 'Fit Point Spline');
  for (const [x, y] of [
    [-40, 0],
    [-20, 20],
    [0, 0],
    [20, 20],
    [40, 0],
  ] as const)
    await click(x, y);
  await page.keyboard.press('Enter');
  await expect.poll(() => counts(page)).toMatchObject({ splines: 1, points: 5 });
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
}

test('a control-point spline drawn back to its first point is closed, and extrudes', async ({
  page,
}) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);

  await pickTool(page, 'Control Point Spline');
  await click(-30, -10);
  await click(30, -10);
  await click(30, 30);
  await click(-30, 30);
  // A click back on the first pole closes the loop.
  await click(-30, -10);
  await expect.poll(() => counts(page)).toMatchObject({ splines: 1, points: 4 });
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  // The loop alone is a region.
  await expect(viewport(page)).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');

  // Selected, the panel says it is closed. Between the two lower poles the
  // closed curve runs at y = −8.33 ((P3 + 23 P0 + 23 P1 + P2) / 48).
  const bottom = at(0, -25 / 3);
  await page.mouse.move(bottom.x, bottom.y);
  await page.mouse.click(bottom.x, bottom.y);
  await expect(selection(page).locator('[data-selection-title]')).toHaveText('Spline');
  await expect(selection(page).getByRole('checkbox', { name: 'Closed' })).toBeChecked();

  await extrudeAt(page, at, [0, 10]);
  const drawn = await bodies(page);
  expect(drawn).toHaveLength(1);
  expect(drawn[0]?.size[2]).toBe(5);
  // The periodic curve stays inside its poles' 60 × 40 box.
  expect(drawn[0]?.size[0]).toBeGreaterThan(30);
  expect(drawn[0]?.size[0]).toBeLessThan(60);
});

test('a fit spline trimmed against a line becomes a control spline', async ({ page }) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);
  await wave(page, click);

  // A line across the second hump.
  await page.keyboard.press('l');
  await click(10, -10);
  await click(10, 30);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);

  // T, then the part right of the line (at a fit point, where the curve runs).
  await page.keyboard.press('t');
  const stub = at(20, 20);
  await page.mouse.move(stub.x, stub.y);
  await expect(page.locator('[data-preview="removed"]')).toHaveCount(1);
  const before = await counts(page);
  await page.mouse.click(stub.x, stub.y);
  // The part under the pointer is gone (nothing left there to preview), and it
  // is still one spline beside the line.
  await expect(page.locator('[data-preview="removed"]')).toHaveCount(0);
  expect(await counts(page)).toMatchObject({ splines: 1, lines: 1 });
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);

  // Selected, it is a control spline now (its points are the poles of its piece).
  const crown = at(-20, 20);
  await page.mouse.move(crown.x, crown.y);
  await page.mouse.click(crown.x, crown.y);
  await expect(selection(page).locator('[data-selection-title]')).toHaveText('Spline');
  await expect(selection(page)).toContainText('Control points');
  await expect(selection(page).getByRole('checkbox', { name: 'Closed' })).not.toBeChecked();

  // One undo brings the fit spline back.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await counts(page)).constraints).toBe(before.constraints);
  // The fit point at the crown is back (a click there takes the point first).
  await page.mouse.click(crown.x, crown.y);
  await expect(selection(page).locator('[data-selection-title]')).toHaveText('Point');
});

test('a spline offset 2 mm is a second spline', async ({ page }) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);
  await wave(page, click);

  // O picks the spline, then the side (above the first hump) and a typed distance.
  await page.keyboard.press('o');
  await click(-20, 20);
  await expect(toolPrompt(page)).toHaveText(
    'Move to the side to offset to, and click. Type a distance to set it.',
  );
  const above = at(-20, 26);
  await page.mouse.move(above.x, above.y);
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await counts(page)).splines).toBe(2);
  // A spline's offset carries no dimension, and is fixed in place.
  const after = await counts(page);
  expect(after.dimensions).toBe(0);
  expect(after.lines).toBe(0);
});
