import { expect, test } from '@playwright/test';
import {
  addParameter,
  attr,
  chip,
  clickEdge,
  closeParameters,
  expectNoProblems,
  exportModel,
  exportProject,
  fill,
  objectsOf3mf,
  ok,
  openParameters,
  pickAxis,
  primitive,
  renameBody,
  renameProject,
  setParameters,
  settled,
  solidFacts,
  solidTab,
  toolPrompt,
  turnView,
} from './benchmark-helpers';
import { clicker, kernelReady, openProject, pickTool, projector } from './helpers';

// P3-14: benchmark B7 (requirements §7) built through the UI: a knurled
// knob. A rectangle on XZ (radius `dia / 2` by `height`, from the origin) is
// revolved a whole turn about the Z axis; its top edge is chamfered; a
// Cylinder cut at the rim is one groove, and a circular pattern of that
// feature about Z makes `grooves` of them; a blind hole from below takes the
// shaft. A parameter change makes a bigger knob with fewer grooves, and the
// 3MF export is one closed solid with the volume the parameters give.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

interface Sizes {
  dia: number;
  height: number;
  bevel: number;
  groove: number;
  grooves: number;
  shaft: number;
  bore: number;
}

const START: Sizes = {
  dia: 30,
  height: 16,
  bevel: 1,
  groove: 1.6,
  grooves: 24,
  shaft: 6,
  bore: 10,
};

/** The area two circles (radii `a`, `b`, centres `d` apart) share. */
function lens(a: number, b: number, d: number) {
  const alpha = Math.acos((d * d + a * a - b * b) / (2 * d * a));
  const beta = Math.acos((d * d + b * b - a * a) / (2 * d * b));
  return (
    a * a * alpha +
    b * b * beta -
    0.5 * Math.sqrt((-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b))
  );
}

/**
 * The knob's volume, mm³: the cylinder less the chamfer's ring (a triangle
 * turned about the axis at its centroid), the grooves (each the lens it
 * shares with the rim, the whole height) and the shaft hole. Where a groove
 * crosses the chamfer it removes a little less (under 1 mm³ each): the
 * checks allow for it.
 */
function knobVolume(s: Sizes) {
  const r = s.dia / 2;
  return (
    Math.PI * r * r * s.height -
    2 * Math.PI * (r - s.bevel / 3) * (s.bevel ** 2 / 2) -
    s.grooves * lens(r, s.groove / 2, r) * s.height -
    Math.PI * (s.shaft / 2) ** 2 * s.bore
  );
}

function checkExport(file: Parameters<typeof objectsOf3mf>[0], s: Sizes) {
  const objects = objectsOf3mf(file);
  expect(objects.map((o) => o.name)).toEqual(['Knob']);
  const knob = solidFacts((objects[0] as (typeof objects)[number]).mesh);
  expect(knob.size[2]).toBeCloseTo(s.height, 3);
  // Grooves on the X axis nick the widest points: the rim is a little inside the diameter.
  expect(knob.size[0]).toBeLessThan(s.dia);
  expect(knob.size[0]).toBeGreaterThan(s.dia - s.groove);
  // The rim's arcs are a tessellation short of exact: within 0.3 %.
  expect(Math.abs(knob.volume / knobVolume(s) - 1)).toBeLessThan(3e-3);
}

test('B7: a knurled knob, revolved, chamfered and grooved all round', async ({ page }) => {
  test.setTimeout(120_000);
  const viewport = await openProject(page);
  await kernelReady(page);
  await renameProject(page, 'B7 Knurled knob');

  await openParameters(page);
  await addParameter(page, 'dia', '30 mm');
  await addParameter(page, 'height', '16 mm');
  await addParameter(page, 'bevel', '1 mm');
  await addParameter(page, 'groove', '1.6 mm');
  await addParameter(page, 'grooves', '24', 'unitless');
  await addParameter(page, 'shaft', '6 mm');
  await addParameter(page, 'bore', '10 mm');
  await closeParameters(page);

  // Sketch1 on XZ (sketch x is world X, sketch y is world Z): the half section, from the origin.
  await page.getByRole('button', { name: 'Create Sketch' }).click();
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XZ' })
    .click();
  await settled(viewport);
  const xz = await projector(viewport);
  const onXZ = (x: number, y: number) => xz([x, 0, y]);
  const clickXZ = clicker(page, onXZ);
  const palette = page.getByRole('region', { name: 'Sketch palette' });
  const showConstraints = palette.getByRole('checkbox', { name: 'Show constraints' });
  await showConstraints.uncheck();
  await showConstraints.blur();
  await page.keyboard.press('r');
  await clickXZ(0, 0);
  await clickXZ(20, 20);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await page.keyboard.press('d');
  for (const [picks, expr] of [
    [
      [
        [10, 20],
        [10, 26],
      ],
      'dia / 2',
    ],
    [
      [
        // The first dimension moved the right side to x = 15.
        [15, 10],
        [21, 10],
      ],
      'height',
    ],
  ] as const) {
    for (const [x, y] of picks) await clickXZ(x, y);
    const value = page.getByRole('textbox', { name: /^Value of d\d+$/ });
    await expect(value).toBeFocused();
    await value.fill(expr);
    await value.press('Enter');
    await expect(page.locator('[data-dimension-editor]')).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await expect(palette).toContainText('Fully constrained');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();

  // Revolve1: the profile a whole turn about the Z axis.
  const inside = onXZ(7, 8);
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.click(inside.x, inside.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.getByRole('button', { name: 'Revolve', exact: true }).click();
  const revolve = page.getByRole('region', { name: 'Revolve dialog' });
  await expect(revolve.getByRole('button', { name: 'Profiles', exact: true })).toHaveText(
    '1 profile',
  );
  await pickAxis(page, xz, 'z', [25, 30, 35, 40, 45, -10, -15]);
  await expect(revolve.getByRole('button', { name: 'Axis', exact: true })).toHaveText('Z axis');
  await ok(page, revolve);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:3:30,30,16');

  // Chamfer1: the top edge, picked where it comes nearest the camera.
  let at = await turnView(page, 'Shift+1');
  const toward = 15 / Math.SQRT2;
  await clickEdge(page, at, [toward, -toward, 16]);
  await page.getByRole('button', { name: /^Chamfer/ }).click();
  const chamfer = page.getByRole('region', { name: 'Chamfer dialog' });
  await expect(chamfer.getByRole('button', { name: 'Edges', exact: true })).toHaveText('1 edge');
  await fill(chamfer, { Distance: 'bevel' });
  await ok(page, chamfer);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:4:30,30,16');

  // Cylinder1: one groove down the rim, a little longer than the knob at both ends.
  await primitive(
    page,
    'Cylinder',
    { X: 'dia / 2', Diameter: 'groove', Height: 'height + 2 mm', Offset: '-1 mm' },
    'cut',
  );
  await expect(viewport).toHaveAttribute('data-bodies', /^Body1:5:/);

  // Circular Pattern1: the groove `grooves` times about Z.
  await pickTool(page, 'Circular Pattern');
  const pattern = page.getByRole('region', { name: 'Circular Pattern dialog' });
  await expect(pattern).toBeVisible();
  await pattern.getByRole('combobox', { name: 'Pattern' }).selectOption('features');
  await pattern.getByRole('checkbox', { name: /^Cylinder1 / }).check();
  await pattern.getByRole('button', { name: 'Axis', exact: true }).click();
  at = await turnView(page, 'Shift+1');
  await pickAxis(page, at, 'z', [25, 30, 35, 40, 45]);
  await expect(pattern.getByRole('button', { name: 'Axis', exact: true })).toHaveText('Z axis');
  await fill(pattern, { Count: 'grooves' });
  await ok(page, pattern);

  // Hole1: the shaft, blind from the bottom (XY at the origin, flipped to drill up).
  await page.keyboard.press('h');
  const hole = page.getByRole('region', { name: 'Hole dialog' });
  await expect(hole.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
  await hole.getByRole('combobox', { name: 'Extent' }).selectOption('blind');
  await fill(hole, { Diameter: 'shaft', Depth: 'bore', 'Drill point': '0 deg' });
  await hole.getByRole('checkbox', { name: 'Flip' }).check();
  await ok(page, hole);

  await renameBody(page, 'Body1', 'Knob');
  await expectNoProblems(page);
  // Top, bottom and chamfer, a rim piece and a groove wall per groove, the shaft's wall and floor.
  await expect(viewport).toHaveAttribute('data-bodies', 'Knob:53:30,30,16');
  await page.screenshot({ path: test.info().outputPath('knob.png') });

  // The design as it stands is the benchmark's fixture (fixtures/benchmarks/).
  await exportProject(page, 'b7-knurled-knob.extrudo');
  checkExport(await exportModel(page, '3MF'), START);
  await solidTab(page);

  // A bigger knob with fewer, wider grooves: the sketch re-solves, the pattern follows.
  // (A groove as deep as the chamfer, 2 mm here, would touch its inner edge and split it.)
  await setParameters(page, { dia: '36 mm', grooves: '18', groove: '1.8 mm' });
  await kernelReady(page);
  await expectNoProblems(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Knob:41:36,36,16');
  checkExport(await exportModel(page, '3MF'), { ...START, dia: 36, grooves: 18, groove: 1.8 });
});
