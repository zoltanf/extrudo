import { expect, type Page, test } from '@playwright/test';
import { clicker, counts, pickTool, sketchOnXY } from './helpers';

// P1-10: the modify tools through the toolbar and their shortcuts: fillet
// with a typed radius, trim with its preview, offset with a typed distance,
// mirror from the Create menu; each one undo step.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

type At = Awaited<ReturnType<typeof sketchOnXY>>;

const prompt = (page: Page) => page.getByRole('status', { name: 'Tool prompt' });
const headsUp = (page: Page) => page.getByRole('group', { name: 'Heads-up input' });

/** A 60 × 40 rectangle around the origin; the Rectangle tool is left afterwards. */
async function rectangle(page: Page, at: At) {
  const click = clicker(page, at);
  await page.keyboard.press('r');
  await click(-30, -20);
  await click(30, 20);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveCount(0);
}

test('fillet a corner with a typed radius, trim with a preview, undo each', async ({ page }) => {
  const at = await sketchOnXY(page);
  await rectangle(page, at);
  const click = clicker(page, at);

  // F: Sketch Fillet. Hovering the corner shows its radius; typing locks it.
  await page.keyboard.press('f');
  await expect(prompt(page)).toHaveText('Pick a corner, or the first of two lines.');
  const corner = at(30, 20);
  await page.mouse.move(corner.x, corner.y);
  await expect(headsUp(page).getByRole('textbox', { name: 'Radius' })).toBeVisible();
  await page.keyboard.type('6');
  await page.keyboard.press('Enter');
  await click(30, 20);
  await expect
    .poll(async () => {
      const c = await counts(page);
      return [c.arcs, c.lines, c.dimensions];
    })
    .toEqual([1, 4, 1]);

  // A line across the bottom side, then T: Trim cuts its stub below the side away,
  // and holds the new end on the side (one constraint more).
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  await click(0, -30);
  await click(0, -10);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  await expect(prompt(page)).toHaveText('Click the part of a curve to cut away.');
  const stub = at(0.3, -26);
  await page.mouse.move(stub.x, stub.y);
  await expect(page.locator('[data-preview="removed"]')).toHaveCount(1);
  const before = await counts(page);
  await page.mouse.click(stub.x, stub.y);
  await expect.poll(async () => (await counts(page)).constraints).toBe(before.constraints + 1);
  expect((await counts(page)).lines).toBe(before.lines);

  // One undo takes the trim back.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await counts(page)).constraints).toBe(before.constraints);
});

test('offset a rectangle by a typed distance, and mirror it from the Create menu', async ({
  page,
}) => {
  const at = await sketchOnXY(page);
  await rectangle(page, at);
  const click = clicker(page, at);

  // O: Offset picks the whole closed chain, then the side and distance.
  await page.keyboard.press('o');
  await click(0, -20);
  await expect(prompt(page)).toHaveText(
    'Move to the side to offset to, and click. Type a distance to set it.',
  );
  const outside = at(0, -26);
  await page.mouse.move(outside.x, outside.y);
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await counts(page)).lines).toBe(8);
  expect((await counts(page)).dimensions).toBe(4);

  // A vertical line to mirror about, right of everything.
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  await click(50, -30);
  await click(50, 30);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Mirror: pick the inner rectangle's sides, Enter, then the line.
  await pickTool(page, 'Mirror');
  await expect(prompt(page)).toHaveText('Pick points and curves, then press Enter.');
  for (const [x, y] of [
    [0, -20],
    [30, 0],
    [0, 20],
    [-30, 0],
  ] as const)
    await click(x, y);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Pick the line to mirror about.');
  await click(50, 0);
  await expect.poll(async () => (await counts(page)).lines).toBe(13);
});

test('the Modify group has every modify tool, as a tile or in its menu', async ({ page }) => {
  await sketchOnXY(page);
  const group = page.getByRole('group', { name: 'Modify', exact: true });
  for (const name of ['Sketch Fillet', 'Trim', 'Offset']) {
    await expect(group.locator(`button[data-tool][data-label="${name}"]`)).toBeEnabled();
  }
  // The menu lists the tools that aren't tiles (ADR-0079).
  await page.getByRole('button', { name: 'Modify', exact: true }).click();
  for (const name of ['Sketch Chamfer', 'Extend', 'Break', 'Move', 'Copy', 'Sketch Scale']) {
    // A menu item's name ends with its shortcut ("Trim T").
    await expect(page.getByRole('menuitem', { name: new RegExp(`^${name}( .)?$`) })).toBeEnabled();
  }
});
