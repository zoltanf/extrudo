import { expect, type Page, test } from '@playwright/test';
import { sketchOnXY } from './helpers';

// P1-04: the basic drawing tools. Draws each rectangle, circle and arc mode,
// a point, the Line tool's tangent-arc drag and construction geometry, and
// reads what landed in the sketch from the overlay's summary.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const overlay = (page: Page) => page.locator('[data-sketch-summary]');
const toolPrompt = (page: Page) => page.getByRole('status', { name: 'Tool prompt' });

/** Entity and constraint counts of the open sketch (the overlay shows while a tool runs). */
async function counts(page: Page) {
  const summary = (await overlay(page).getAttribute('data-sketch-summary')) ?? '';
  return Object.fromEntries(
    summary.split(' ').map((pair) => {
      const [key, value] = pair.split('=');
      return [key, Number(value)];
    }),
  );
}

/** Picks a tool from the Create group's menu. */
async function pickTool(page: Page, name: string) {
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

type At = Awaited<ReturnType<typeof sketchOnXY>>;

function clicker(page: Page, at: At) {
  return async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
  };
}

test('draws rectangles from two corners, three points and the center', async ({ page }) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);

  await page.keyboard.press('r');
  await expect(toolPrompt(page)).toHaveText('Click the first corner.');
  await click(-40, -30);
  await click(-20, -10);
  await expect.poll(() => counts(page)).toMatchObject({ points: 8, lines: 4 });
  // Four corners joined, two horizontal and two vertical edges.
  expect((await counts(page)).constraints).toBeGreaterThanOrEqual(8);

  await pickTool(page, '3-Point Rectangle');
  await click(0, -30);
  await click(20, -20);
  await expect(toolPrompt(page)).toHaveText('Click to set the height, or type it.');
  await click(10, 0);
  await expect.poll(() => counts(page)).toMatchObject({ points: 16, lines: 8 });

  await pickTool(page, 'Center Rectangle');
  await click(-30, 20);
  await click(-20, 30);
  // Four edges, two construction diagonals and the center point.
  await expect.poll(() => counts(page)).toMatchObject({ points: 29, lines: 14 });
});

test('draws circles from the center, two points and three points', async ({ page }) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);

  await page.keyboard.press('c');
  await click(-30, -20);
  // A typed diameter becomes a dimension.
  const rim = at(-20, -20);
  await page.mouse.move(rim.x, rim.y);
  await page.keyboard.type('25');
  await page.keyboard.press('Enter');
  await expect.poll(() => counts(page)).toMatchObject({ circles: 1, dimensions: 1 });

  await pickTool(page, '2-Point Circle');
  await click(0, -20);
  await click(20, -20);
  await pickTool(page, '3-Point Circle');
  await click(-30, 20);
  await click(-20, 30);
  await click(-10, 20);
  await expect.poll(() => counts(page)).toMatchObject({ points: 3, circles: 3 });
});

test('draws 3-point, center and tangent arcs', async ({ page }) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);

  await page.keyboard.press('a');
  await click(-40, -20);
  await click(-20, -20);
  await expect(page.locator('[data-preview="guide"]')).toHaveCount(1);
  await click(-30, -10);
  await expect.poll(() => counts(page)).toMatchObject({ points: 3, arcs: 1 });

  await pickTool(page, 'Center Point Arc');
  await click(10, -20);
  await click(20, -20);
  // Round counter-clockwise to the top.
  for (const deg of [20, 45, 70, 90]) {
    const r = (deg * Math.PI) / 180;
    const p = at(10 + 10 * Math.cos(r), -20 + 10 * Math.sin(r));
    await page.mouse.move(p.x, p.y);
  }
  await expect(page.locator('[data-preview="arc"]')).toHaveCount(1);
  await click(10, -10);
  await expect.poll(() => counts(page)).toMatchObject({ arcs: 2 });

  // A line, then an arc tangent to its end.
  await page.keyboard.press('l');
  await click(-40, 20);
  await click(-20, 20);
  await page.keyboard.press('Escape');
  await pickTool(page, 'Tangent Arc');
  await expect(toolPrompt(page)).toHaveText('Click the end of a line or an arc.');
  await click(-20, 20);
  await click(-10, 30);
  await expect.poll(() => counts(page)).toMatchObject({ lines: 1, arcs: 3 });
});

test('places points, drags a tangent arc off a line, and draws construction geometry', async ({
  page,
}) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);

  await pickTool(page, 'Point');
  await click(-30, -30);
  await click(-20, -30);
  await expect.poll(() => counts(page)).toMatchObject({ points: 2, lines: 0 });

  // Line, then press on its end and drag: a tangent arc, and the chain goes on.
  await page.keyboard.press('l');
  await click(-40, 0);
  await click(-20, 0);
  const end = at(-20, 0);
  const drag = at(-10, 10);
  await page.mouse.move(end.x, end.y);
  await page.mouse.down();
  await page.mouse.move((end.x + drag.x) / 2, end.y - 4, { steps: 4 });
  await page.mouse.move(drag.x, drag.y, { steps: 4 });
  await expect(toolPrompt(page)).toHaveText('Release to place the tangent arc.');
  await expect(page.locator('[data-preview="arc"]')).toHaveCount(1);
  await page.mouse.up();
  await expect.poll(() => counts(page)).toMatchObject({ lines: 1, arcs: 1 });
  await click(-10, 30);
  await expect.poll(() => counts(page)).toMatchObject({ lines: 2, arcs: 1 });
  await page.keyboard.press('Escape');

  // X: new geometry is construction geometry, drawn dashed.
  const construction = page
    .getByRole('region', { name: 'Sketch palette' })
    .getByRole('checkbox', { name: /Construction/ });
  await expect(construction).not.toBeChecked();
  await page.keyboard.press('x');
  await expect(construction).toBeChecked();
  await click(10, -30);
  const pointer = at(30, -10);
  await page.mouse.move(pointer.x, pointer.y);
  await expect(page.locator('[data-preview="line"][data-construction]')).toHaveCount(1);
  await page.keyboard.press('x');
  await expect(construction).not.toBeChecked();
  await expect(page.locator('[data-preview="line"][data-construction]')).toHaveCount(0);
});
