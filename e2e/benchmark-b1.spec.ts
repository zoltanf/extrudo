import { readFile } from 'node:fs/promises';
import { type Download, expect, type Page, test } from '@playwright/test';
import { clicker, counts, mapping, newSketchOnXY, openProject, saveStatus } from './helpers';

// P1-15: benchmark B1 (requirements §7) built through the UI, the Phase 1
// exit: a plate with four corner holes, fully constrained, its dimensions
// driven by user parameters (width, depth, hole spacing). Changing the
// parameters moves the plate and the holes, the project keeps them across a
// reload, and the SVG export matches the expected drawing exactly.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const parameters = (page: Page) => page.getByRole('dialog', { name: 'Parameters' });
const expression = (page: Page, name: string) =>
  parameters(page).getByRole('textbox', { name: `Expression of ${name}`, exact: true });
const palette = (page: Page) => page.getByRole('region', { name: 'Sketch palette' });
const dof = (page: Page) => palette(page).locator('[data-constraint-state]');
const labels = (page: Page) => page.locator('[data-dimension]');
const editor = (page: Page) => page.locator('[data-dimension-editor]');
const toolPrompt = (page: Page) => page.getByRole('status', { name: 'Tool prompt' });
const exportDialog = (page: Page) => page.getByRole('dialog', { name: 'Export sketch' });

async function openParameters(page: Page) {
  await page.getByRole('button', { name: 'Parameters', exact: true }).click();
  await expect(parameters(page)).toBeVisible();
}

async function addParameter(page: Page, name: string, value: string) {
  await parameters(page).getByRole('textbox', { name: 'New parameter name' }).fill(name);
  await parameters(page).getByRole('textbox', { name: 'New parameter expression' }).fill(value);
  await parameters(page).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(expression(page, name)).toHaveValue(value);
}

async function setParameter(page: Page, name: string, value: string) {
  await expression(page, name).fill(value);
  await expression(page, name).press('Enter');
}

async function exportSvg(page: Page): Promise<string> {
  await expect(exportDialog(page)).toBeVisible();
  await exportDialog(page).getByRole('radio', { name: 'All curves' }).check();
  const [download] = (await Promise.all([
    page.waitForEvent('download'),
    exportDialog(page).getByRole('button', { name: 'Export SVG' }).click(),
  ])) as [Download, unknown];
  return readFile(await download.path(), 'utf8');
}

/** The curves of B1 as `writeSvg` draws them (y negated): the plate, then the holes. */
function b1Paths(width: number, depth: number, spacing: number, hole: number) {
  const margin = (width - spacing) / 2;
  const r = hole / 2;
  const circle = (x: number, y: number) =>
    `<path d="M${x + r} ${-y}A${r} ${r} 0 0 0 ${x - r} ${-y}A${r} ${r} 0 0 0 ${x + r} ${-y}Z"/>`;
  return [
    `<path d="M0 0L${width} 0"/>`,
    `<path d="M${width} 0L${width} ${-depth}"/>`,
    `<path d="M${width} ${-depth}L0 ${-depth}"/>`,
    `<path d="M0 ${-depth}L0 0"/>`,
    circle(margin, margin),
    circle(width - margin, margin),
    circle(margin, depth - margin),
    circle(width - margin, depth - margin),
  ];
}

test('B1: a parametric plate with four corner holes', async ({ page }) => {
  await openProject(page);

  // The user parameters first; `margin` keeps the holes centred.
  await openParameters(page);
  await addParameter(page, 'width', '100 mm');
  await addParameter(page, 'depth', '80 mm');
  await addParameter(page, 'spacing', '60 mm');
  await addParameter(page, 'hole', '6 mm');
  await addParameter(page, 'margin', '(width - spacing) / 2');
  await expect(expression(page, 'margin')).toHaveAccessibleDescription('= 20.00 mm');
  await page.keyboard.press('Escape');
  await expect(parameters(page)).toHaveCount(0);

  // Zoom out around the plate's centre so that it clears the palette. The
  // grid snaps to 10 mm up to 0.83 mm per pixel.
  const viewport = page.getByRole('region', { name: 'Viewport' });
  const home = await newSketchOnXY(page);
  const centre = home(50, 40);
  await page.mouse.move(centre.x, centre.y);
  const size = async () => Number(await viewport.getAttribute('data-camera-size'));
  for (let before = await size(); before < 300; before = await size()) {
    await page.mouse.wheel(0, 100);
    await expect.poll(size).not.toBe(before);
  }
  const at = await mapping(viewport);
  expect(10 / (at(10, 0).x - at(0, 0).x)).toBeLessThan(0.8);
  const click = clicker(page, at);
  // Glyphs can sit over the corners this test clicks.
  const showConstraints = palette(page).getByRole('checkbox', { name: 'Show constraints' });
  await showConstraints.uncheck();
  await showConstraints.blur();

  // The plate from the origin (its first corner is fixed there), then four
  // holes whose centres line up with each other (inferred horizontal and
  // vertical constraints). Everything sits on grid points: snap is on.
  await page.keyboard.press('r');
  await expect(toolPrompt(page)).toBeVisible();
  await click(0, 0);
  await click(100, 80);
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  await expect(toolPrompt(page)).toBeVisible();
  for (const [x, y] of [
    [20, 20],
    [80, 20],
    [20, 60],
    [80, 60],
  ] as const) {
    await click(x, y);
    await click(x + 10, y);
  }
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  expect(await counts(page)).toMatchObject({ lines: 4, circles: 4, constraints: 13 });
  // The plate's width and depth, the hole pattern's position and size, and four radii.
  await expect(dof(page)).toHaveText('10 DOF left');

  // The holes are equal: three constraints from the first one.
  await page
    .getByRole('group', { name: 'Constraints' })
    .getByRole('button', { name: 'Equal', exact: true })
    .click();
  for (const [x, y] of [
    [90, 20],
    [30, 60],
    [90, 60],
  ] as const) {
    await expect(toolPrompt(page)).toHaveText('Pick a line, circle or arc.');
    await click(30, 20);
    await click(x, y);
  }
  await expect(dof(page)).toHaveText('7 DOF left');
  await page.keyboard.press('Escape');

  // Dimensions: pick, place, and type the expression into the new label's editor.
  await page.keyboard.press('d');
  const dimension = async (picks: (readonly [number, number])[], expr: string) => {
    for (const [x, y] of picks) await click(x, y);
    const value = page.getByRole('textbox', { name: /^Value of d\d+$/ });
    await expect(value).toBeFocused();
    await value.fill(expr);
    await value.press('Enter');
    await expect(editor(page)).toHaveCount(0);
  };
  await dimension(
    [
      [50, 0],
      [50, -10],
    ],
    'width',
  );
  await dimension(
    [
      [0, 40],
      [-10, 40],
    ],
    'depth',
  );
  // The hole pattern: the distance between centres, then from the fixed corner.
  await dimension(
    [
      [20, 20],
      [80, 20],
      [50, 12],
    ],
    'spacing',
  );
  await dimension(
    [
      [20, 20],
      [20, 60],
      [12, 40],
    ],
    'depth - 2 * margin',
  );
  await dimension(
    [
      [0, 0],
      [20, 20],
      [10, -5],
    ],
    'margin',
  );
  await dimension(
    [
      [0, 0],
      [20, 20],
      [-5, 10],
    ],
    'margin',
  );
  // Last, the holes' size: they shrink from radius 10 to 3.
  await dimension(
    [
      [30, 20],
      [40, 35],
    ],
    'hole',
  );
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);

  await expect(dof(page)).toHaveText('Fully constrained ✓');
  expect(await counts(page)).toMatchObject({ constraints: 16, dimensions: 7 });
  await expect(labels(page)).toHaveText([
    'fx: 100.00',
    'fx: 80.00',
    'fx: 60.00',
    'fx: 40.00',
    'fx: 20.00',
    'fx: 20.00',
    'fx: ⌀6.00',
  ]);
  await expect(viewport).toHaveAttribute('data-sketch-status', /free=0 fixed=\d+ conflict=0/);

  // A wider hole spacing, from the command palette (the Parameters button is
  // on the Solid tab): the open sketch follows at once, the plate stays.
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('parameters');
  await expect(page.getByRole('option').first()).toHaveAccessibleName(/^Parameters/);
  await page.keyboard.press('Enter');
  await expect(parameters(page)).toBeVisible();
  await setParameter(page, 'spacing', '70 mm');
  await expect(expression(page, 'margin')).toHaveAccessibleDescription('= 15.00 mm');
  await page.keyboard.press('Escape');
  await expect(parameters(page)).toHaveCount(0);
  await expect(labels(page)).toHaveText([
    'fx: 100.00',
    'fx: 80.00',
    'fx: 70.00',
    'fx: 50.00',
    'fx: 15.00',
    'fx: 15.00',
    'fx: ⌀6.00',
  ]);
  await expect(dof(page)).toHaveText('Fully constrained ✓');

  // A wider plate, with the sketch finished: the margin grows, the spacing stays.
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await openParameters(page);
  await setParameter(page, 'width', '120 mm');
  await expect(expression(page, 'margin')).toHaveAccessibleDescription('= 25.00 mm');
  await page.keyboard.press('Escape');
  await expect(parameters(page)).toHaveCount(0);

  // Saved: after a reload the parameters and the sketch come back.
  await expect(saveStatus(page)).toHaveText('Saved');
  await page.reload();
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await openParameters(page);
  await expect(expression(page, 'width')).toHaveValue('120 mm');
  await expect(expression(page, 'spacing')).toHaveValue('70 mm');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Edit Sketch1' }).click();
  await expect(labels(page)).toHaveText([
    'fx: 120.00',
    'fx: 80.00',
    'fx: 70.00',
    'fx: 30.00',
    'fx: 25.00',
    'fx: 25.00',
    'fx: ⌀6.00',
  ]);
  await expect(dof(page)).toHaveText('Fully constrained ✓');

  // The export is the plate as the parameters now make it, to the digit.
  await page
    .getByRole('group', { name: 'Export' })
    .getByRole('button', { name: 'Export', exact: true })
    .first()
    .click();
  await expect(exportDialog(page).locator('[data-export-summary]')).toHaveText(
    '8 curves, 120 × 80 mm',
  );
  const svg = await exportSvg(page);
  expect(svg).toContain('width="120mm" height="80mm" viewBox="0 -80 120 80"');
  expect(svg.match(/<path [^>]*\/>/g)).toEqual(b1Paths(120, 80, 70, 6));
});
