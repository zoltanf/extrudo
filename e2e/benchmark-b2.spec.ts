import { expect, test } from '@playwright/test';
import {
  addParameter,
  attr,
  chip,
  closeParameters,
  expectNoProblems,
  exportModel,
  exportProject,
  homeView,
  meshOfStl,
  objectsOf3mf,
  openParameters,
  renameProject,
  round,
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

// P2-17: benchmark B2 (requirements §7) built through the UI: a parametric
// storage box cut from a solid. Parameters (width, depth, height, wall,
// bottom) drive a rectangle on XY (dimensions), an extrude to `height`, a
// sketch on the top face whose outline is projected and offset inward by
// `wall` (Project, Offset), and a cut down by `height - bottom`. Changing the
// parameters recomputes the box, and the 3MF and STL exports are closed,
// manifold and the size and volume the parameters give.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** The box's volume: the block less the cavity (mm³). */
const boxVolume = (w: number, d: number, h: number, wall: number, bottom: number) =>
  w * d * h - (w - 2 * wall) * (d - 2 * wall) * (h - bottom);

test('B2: a parametric storage box, cut from a solid', async ({ page }) => {
  // Two sketches, two extrudes, a parameter edit and two exports, each
  // waiting for the kernel: about 40 s alone.
  test.setTimeout(120_000);
  await openProject(page);
  const viewport = viewportOf(page);
  await renameProject(page, 'B2 Storage box');

  await openParameters(page);
  await addParameter(page, 'width', '80 mm');
  await addParameter(page, 'depth', '60 mm');
  await addParameter(page, 'height', '40 mm');
  await addParameter(page, 'wall', '3 mm');
  await addParameter(page, 'bottom', '4 mm');
  await closeParameters(page);

  // Sketch1 on XY: a rectangle from the origin, dimensioned by width and depth.
  const home = await newSketchOnXY(page);
  await zoomOutTo(page, home(40, 30));
  const at = await mapping(viewport);
  const click = clicker(page, at);
  const showConstraints = page
    .getByRole('region', { name: 'Sketch palette' })
    .getByRole('checkbox', { name: 'Show constraints' });
  await showConstraints.uncheck();
  await showConstraints.blur();
  await page.keyboard.press('r');
  await expect(toolPrompt(page)).toBeVisible();
  await click(0, 0);
  await click(80, 60);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await page.keyboard.press('d');
  const dimension = async (picks: (readonly [number, number])[], expr: string) => {
    for (const [x, y] of picks) await click(x, y);
    const value = page.getByRole('textbox', { name: /^Value of d\d+$/ });
    await expect(value).toBeFocused();
    await value.fill(expr);
    await value.press('Enter');
    await expect(page.locator('[data-dimension-editor]')).toHaveCount(0);
  };
  await dimension(
    [
      [40, 0],
      [40, -10],
    ],
    'width',
  );
  await dimension(
    [
      [0, 30],
      [-10, 30],
    ],
    'depth',
  );
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Sketch palette' })).toContainText(
    'Fully constrained',
  );
  await expect(page.locator('[data-dimension]')).toHaveText(['fx: 80.00', 'fx: 60.00']);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();

  // Extrude1: its profile to `height`, a new body.
  const inside = at(40, 30);
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.click(inside.x, inside.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.keyboard.press('e');
  const extrude = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(extrude).toBeVisible();
  await expect(extrude.getByRole('combobox', { name: 'Operation' })).toHaveValue('new-body');
  await extrude.getByRole('textbox', { name: 'Distance' }).fill('height');
  await expect(extrude).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await extrude.getByRole('button', { name: 'OK' }).click();
  await expect(extrude).toBeHidden();
  await kernelReady(page);
  await expect(chip(page, 'Extrude1')).toHaveAccessibleName('Extrude1');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:80,60,40');

  // Sketch2 on the top face: its outline projected, then offset inward by `wall`.
  await homeView(page);
  await pickTool(page, 'Create Sketch');
  await expect(page.getByRole('region', { name: 'Create Sketch' })).toContainText('flat face');
  const top = (await projector(viewport))([40, 30, 40]);
  await page.mouse.move(top.x, top.y);
  await page.mouse.click(top.x, top.y);
  await expect(chip(page, 'Sketch2')).toBeVisible();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  await settled(viewport);
  await page.keyboard.press('p');
  const world = await projector(viewport);
  const face = world([40, 30, 40]);
  await page.mouse.move(face.x, face.y);
  await expect.poll(() => attr(viewport, 'data-model-hover')).toMatch(/^face:/);
  await page.mouse.click(face.x, face.y);
  await expect
    .poll(() => attr(viewport, 'data-sketch-projected'))
    .toMatch(/:curves=4:x=0\.\.80:y=0\.\.60$/);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);

  // The face fills the view: zoom out around its middle so that its edges clear the nav bar.
  await zoomOutTo(page, world([40, 30, 40]), 150);
  // The camera may be a perspective one looking at the box's middle, above the sketch plane:
  // map the plane's points through the projector, not the flat sketch mapping.
  const flat = await projector(viewport);
  const onFace = (x: number, y: number) => flat([x, y, 40]);
  const clickFace = clicker(page, onFace);
  // Offset picks the whole projected outline (its four sides meet where the face's edges do),
  // then the side to go to and a distance (3 mm, inward); the first distance becomes `wall`,
  // and the other three sides follow it.
  await page.keyboard.press('o');
  await expect(toolPrompt(page)).toBeVisible();
  await clickFace(40, 0);
  await expect(toolPrompt(page)).toContainText('Move to the side to offset to');
  const inner = onFace(40, 10);
  await page.mouse.move(inner.x, inner.y);
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=2 holes=1');
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await expect(page.locator('[data-dimension]')).toHaveCount(4);
  await page.locator('[data-dimension]').first().dblclick();
  const distance = page.getByRole('textbox', { name: /^Value of d\d+$/ });
  await expect(distance).toBeFocused();
  await distance.fill('wall');
  await distance.press('Enter');
  await expect(page.locator('[data-dimension-editor]')).toHaveCount(0);
  await expect(page.locator('[data-dimension]')).toHaveText(Array(4).fill('fx: 3.00'));
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);
  await expect(chip(page, 'Sketch2')).toHaveAccessibleName('Sketch2');

  // Extrude2: the inner profile cut down by `height - bottom`.
  const middle = onFace(40, 30);
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.click(middle.x, middle.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.keyboard.press('e');
  const cut = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(cut).toBeVisible();
  await cut.getByRole('combobox', { name: 'Operation' }).selectOption('cut');
  await cut.getByRole('textbox', { name: 'Distance' }).fill('-(height - bottom)');
  await expect(viewport).toHaveAttribute('data-preview', 'cut', { timeout: 15_000 });
  await expect(cut).toHaveAttribute('data-preview-status', 'ok');
  await cut.getByRole('button', { name: 'OK' }).click();
  await expect(cut).toBeHidden();
  await kernelReady(page);
  await expect(chip(page, 'Extrude2')).toHaveAccessibleName('Extrude2');
  // Outside four, inside four, the floor, the bottom and the rim: eleven faces.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:11:80,60,40');
  await expectNoProblems(page);
  await page.screenshot({ path: test.info().outputPath('box.png') });

  // The design as it stands is the benchmark's fixture (fixtures/benchmarks/).
  await exportProject(page, 'b2-storage-box.extrudo');

  // The parameters make the box: wider, deeper and thicker walls.
  await setParameters(page, { width: '100 mm', depth: '70 mm', wall: '4 mm' });
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:11:100,70,40');
  await expectNoProblems(page);

  // Export 3MF: one object, a closed solid the size and volume the parameters give.
  const threeMf = await exportModel(page, '3MF');
  expect(threeMf.name).toMatch(/\.3mf$/);
  const objects = objectsOf3mf(threeMf);
  expect(objects.map((o) => o.name)).toEqual(['Body1']);
  const facts = solidFacts((objects[0] as (typeof objects)[number]).mesh);
  expect(round(facts.size)).toEqual([100, 70, 40]);
  expect(facts.volume).toBeCloseTo(boxVolume(100, 70, 40, 4, 4), 0);

  // Export STL: the same solid.
  const stl = await exportModel(page, 'STL');
  expect(stl.name).toMatch(/\.stl$/);
  const stlFacts = solidFacts(meshOfStl(stl));
  expect(round(stlFacts.size)).toEqual([100, 70, 40]);
  expect(stlFacts.volume).toBeCloseTo(boxVolume(100, 70, 40, 4, 4), 0);
  expect(stlFacts.triangles).toBe(facts.triangles);
});
