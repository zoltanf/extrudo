import { expect, test } from '@playwright/test';
import {
  addParameter,
  attr,
  chip,
  closeParameters,
  expectNoProblems,
  exportModel,
  exportProject,
  objectsOf3mf,
  openParameters,
  renameProject,
  round,
  selectBodies,
  setParameters,
  settled,
  solidFacts,
  toolPrompt,
  viewportOf,
  zoomOutTo,
} from './benchmark-helpers';
import {
  clicker,
  kernelReady,
  mapping,
  newSketchOnXY,
  openProject,
  pickTool,
  projector,
} from './helpers';

// P2-17, extended in P3-06: benchmark B3 (requirements §7) built through
// the UI: a phone stand of two bodies that are combined. A base plate
// (Sketch1 on XY, Extrude1, a new body) and a tilted back rest (Sketch2 on
// YZ, dimensioned by `setback`, `base`, `rest`, `rise` and the angle `tilt`;
// Extrude2, a second body) stand side by side, the rest's foot on the
// plate's top face. The Combine feature joins them into one body (P3-06;
// before it, a strip extruded across the foot bridged them). Parameters
// change the stand, and its 3MF export is one closed solid with the volume
// they give.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** The stand's volume: the base plate and the back rest, which only touch (mm³). */
const standVolume = (p: {
  width: number;
  depth: number;
  base: number;
  rest: number;
  rise: number;
}) => p.width * p.depth * p.base + p.width * p.rest * p.rise;

test('B3: a phone stand of two bodies, combined', async ({ page }) => {
  // Three sketches, three extrudes, a parameter edit and an export, each
  // waiting for the kernel.
  test.setTimeout(150_000);
  await openProject(page);
  const viewport = viewportOf(page);
  await renameProject(page, 'B3 Phone stand');
  const browser = page.getByRole('complementary', { name: 'Browser' });

  await openParameters(page);
  await addParameter(page, 'width', '60 mm');
  await addParameter(page, 'depth', '80 mm');
  await addParameter(page, 'base', '10 mm');
  await addParameter(page, 'setback', '50 mm');
  await addParameter(page, 'rest', '10 mm');
  await addParameter(page, 'rise', '60 mm');
  await addParameter(page, 'tilt', '70 deg', 'angle');
  await closeParameters(page);

  const dimension = async (
    click: (x: number, y: number) => Promise<void>,
    picks: (readonly [number, number])[],
    expr: string,
  ) => {
    for (const [x, y] of picks) await click(x, y);
    const value = page.getByRole('textbox', { name: /^Value of d\d+$/ });
    await expect(value).toBeFocused();
    await value.fill(expr);
    await value.press('Enter');
    await expect(page.locator('[data-dimension-editor]')).toHaveCount(0);
  };
  const palette = page.getByRole('region', { name: 'Sketch palette' });
  const hideConstraints = async () => {
    const showConstraints = palette.getByRole('checkbox', { name: 'Show constraints' });
    await showConstraints.uncheck();
    await showConstraints.blur();
  };

  // Sketch1 on XY: the base plate from the origin, `width` by `depth`.
  const home = await newSketchOnXY(page);
  await zoomOutTo(page, home(30, 40));
  const at = await mapping(viewport);
  const clickXY = clicker(page, at);
  await hideConstraints();
  await page.keyboard.press('r');
  await clickXY(0, 0);
  await clickXY(60, 80);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await page.keyboard.press('d');
  await dimension(
    clickXY,
    [
      [30, 0],
      [30, -10],
    ],
    'width',
  );
  await dimension(
    clickXY,
    [
      [0, 40],
      [-10, 40],
    ],
    'depth',
  );
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await expect(palette).toContainText('Fully constrained');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();

  // Extrude1: the plate, `base` thick, a new body.
  const inside = at(30, 40);
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.click(inside.x, inside.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.keyboard.press('e');
  const extrude = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(extrude).toBeVisible();
  await extrude.getByRole('textbox', { name: 'Distance' }).fill('base');
  await expect(extrude).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await extrude.getByRole('button', { name: 'OK' }).click();
  await expect(extrude).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:60,80,10');

  // Sketch2 on YZ (sketch x is world Y, sketch y is world Z): the back rest, a
  // parallelogram leaning back, pinned to the origin by `setback` and `base`.
  await pickTool(page, 'Create Sketch');
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'YZ' })
    .click();
  await expect(viewport).toHaveAttribute('data-camera-direction', '-1,0,0');
  await settled(viewport);
  await zoomOutTo(page, (await projector(viewport))([0, 40, 35]));
  const yz = await projector(viewport);
  const onYZ = (x: number, y: number) => yz([0, x, y]);
  const clickYZ = clicker(page, onYZ);
  await hideConstraints();
  // The origin is no entity: a point there is fixed, and the back rest hangs from it.
  await pickTool(page, 'Point');
  await clickYZ(0, 0);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await page.keyboard.press('l');
  for (const [x, y] of [
    [50, 10],
    [60, 10],
    [80, 70],
    [70, 70],
    [50, 10],
  ] as const) {
    await clickYZ(x, y);
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
  // The sides lean the same way.
  await page
    .getByRole('group', { name: 'Constraints' })
    .getByRole('button', { name: 'Parallel', exact: true })
    .click();
  await clickYZ(70, 40);
  await clickYZ(60, 40);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await page.keyboard.press('d');
  // From the origin: `setback` along, `base` up; the bottom edge is `rest` long, `rise` below the top.
  await dimension(
    clickYZ,
    [
      [0, 0],
      [50, 10],
      [25, -8],
    ],
    'setback',
  );
  await dimension(
    clickYZ,
    [
      [0, 0],
      [50, 10],
      [-8, 5],
    ],
    'base',
  );
  await dimension(
    clickYZ,
    [
      [55, 10],
      [55, 0],
    ],
    'rest',
  );
  await dimension(
    clickYZ,
    [
      [55, 10],
      [75, 70],
      [100, 40],
    ],
    'rise',
  );
  await dimension(
    clickYZ,
    [
      [55, 10],
      [70, 40],
      [72, 20],
    ],
    'tilt',
  );
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('rest-sketch.png') });
  await expect(page.locator('[data-dimension]')).toHaveText([
    'fx: 50.00',
    'fx: 10.00',
    'fx: 10.00',
    'fx: 60.00',
    'fx: 70.00°',
  ]);
  await expect(palette).toContainText('Fully constrained');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);
  await expect(chip(page, 'Sketch2')).toHaveAccessibleName('Sketch2');

  // Extrude2: the rest across the plate's width, a second body.
  const rest = onYZ(65, 40);
  await page.mouse.move(rest.x, rest.y);
  await page.mouse.click(rest.x, rest.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.keyboard.press('e');
  const second = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(second).toBeVisible();
  await expect(second.getByRole('combobox', { name: 'Operation' })).toHaveValue('new-body');
  await second.getByRole('textbox', { name: 'Distance' }).fill('width');
  await expect(second).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await second.getByRole('button', { name: 'OK' }).click();
  await expect(second).toBeHidden();
  await kernelReady(page);
  await expect(chip(page, 'Extrude2')).toHaveAccessibleName('Extrude2');
  // Two bodies, side by side: the rest's height is `rise`, and it leans back by rise / tan(tilt) more than it is thick.
  const lean = 60 / Math.tan((70 * Math.PI) / 180);
  await expect(viewport).toHaveAttribute(
    'data-bodies',
    `Body1:6:60,80,10 Body2:6:60,${(lean + 10).toFixed(1)},60`,
  );
  await expect(browser.locator('[data-folder-count]')).toHaveText('2');

  // Combine1: the plate is the target, the rest the tool; the rest is used up.
  await selectBodies(page, ['Body1', 'Body2']);
  await pickTool(page, 'Combine');
  const combine = page.getByRole('region', { name: 'Combine dialog' });
  await expect(combine).toBeVisible();
  await expect(combine.getByRole('button', { name: 'Target', exact: true })).toContainText('Body1');
  await expect(combine.getByRole('button', { name: 'Tools', exact: true })).toContainText('Body2');
  await expect(combine.getByRole('combobox', { name: 'Operation' })).toHaveValue('join');
  await expect(combine).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await combine.getByRole('button', { name: 'OK' }).click();
  await expect(combine).toBeHidden();
  await kernelReady(page);
  await expect(chip(page, 'Combine1')).toHaveAccessibleName('Combine1');
  // The base and the rest in one solid, 60 wide; the rest leans past the base's back edge.
  await expectNoProblems(page);
  await page.screenshot({ path: test.info().outputPath('stand.png') });

  // The design as it stands is the benchmark's fixture (fixtures/benchmarks/).
  await exportProject(page, 'b3-phone-stand.extrudo');

  // Parameters: a thicker base, a taller rest that leans further back.
  await setParameters(page, { base: '12 mm', rise: '70 mm', tilt: '65 deg' });
  await kernelReady(page);
  await expect(chip(page, 'Combine1')).toHaveAccessibleName('Combine1');
  await expectNoProblems(page);
  const backY = 60 + 70 / Math.tan((65 * Math.PI) / 180);
  await expect(viewport).toHaveAttribute(
    'data-bodies',
    new RegExp(`^Body1:\\d+:60,${backY.toFixed(1).replace('.', '\\.')},82$`),
  );
  await expect(browser.locator('[data-folder-count]')).toHaveText('1');

  // Export 3MF: one closed solid, as big and as heavy as the parameters make it.
  const threeMf = await exportModel(page, '3MF');
  const objects = objectsOf3mf(threeMf);
  expect(objects.map((o) => o.name)).toEqual(['Body1']);
  const facts = solidFacts((objects[0] as (typeof objects)[number]).mesh);
  expect(round(facts.size, 2)).toEqual([60, Number(backY.toFixed(2)), 82]);
  expect(facts.volume).toBeCloseTo(
    standVolume({ width: 60, depth: 80, base: 12, rest: 10, rise: 70 }),
    0,
  );
});
