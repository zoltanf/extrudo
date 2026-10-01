import { expect, test } from '@playwright/test';
import {
  addParameter,
  chip,
  clickAt,
  clickEdge,
  clickWhere,
  closeParameters,
  expectNoProblems,
  exportModel,
  exportProject,
  extentOf,
  fill,
  objectsOf3mf,
  ok,
  openParameters,
  primitive,
  renameBody,
  renameProject,
  setParameters,
  settled,
  solidFacts,
  solidTab,
  startPrimitive,
  turnView,
  zoomOutTo,
} from './benchmark-helpers';
import { kernelReady, openProject, projector } from './helpers';

// P3-14: benchmark B4 (requirements §7) built through the UI: a box with a
// lid that fits, driven by a `clearance` parameter. The box is a Box
// primitive shelled open at the top, its bottom edges chamfered (against
// elephant's foot); an offset plane at the rim carries the lid's plate, a
// second body, and a lip joined under it is the cavity less `clearance` on
// every side; the lid's top edges are filleted. The 3MF export has both
// bodies, closed; the lip is `clearance` inside the cavity, before and after
// the parameters change.

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
  length: number;
  width: number;
  height: number;
  wall: number;
  clearance: number;
  lid: number;
  lip: number;
  bevel: number;
}

const START: Sizes = {
  length: 60,
  width: 40,
  height: 30,
  wall: 2,
  clearance: 0.2,
  lid: 3,
  lip: 5,
  bevel: 0.8,
};

/** The box: a block less the cavity, less the bottom chamfer (four mitred prisms), mm³. */
const boxVolume = (s: Sizes) =>
  s.length * s.width * s.height -
  (s.length - 2 * s.wall) * (s.width - 2 * s.wall) * (s.height - s.wall) -
  (s.bevel ** 2 * (s.length + s.width) - (4 * s.bevel ** 3) / 3);

/** The lip's outline: the cavity less `clearance` on each side. */
const lipSize = (s: Sizes) => [
  s.length - 2 * (s.wall + s.clearance),
  s.width - 2 * (s.wall + s.clearance),
];

/** The lid before its fillet: the plate and the lip, mm³. */
const lidBlockVolume = (s: Sizes) => {
  const [x = 0, y = 0] = lipSize(s);
  return s.length * s.width * s.lid + x * y * s.lip;
};

/** Checks both bodies of a 3MF export and that the lid fits the box. */
function checkExport(file: Parameters<typeof objectsOf3mf>[0], s: Sizes) {
  const objects = objectsOf3mf(file);
  expect(objects.map((o) => o.name)).toEqual(['Box', 'Lid']);
  const [box, lid] = objects.map((o) => o.mesh) as [
    (typeof objects)[number]['mesh'],
    (typeof objects)[number]['mesh'],
  ];
  const boxFacts = solidFacts(box);
  const lidFacts = solidFacts(lid);
  expect(boxFacts.size.map((v) => Number(v.toFixed(3)))).toEqual([s.length, s.width, s.height]);
  expect(lidFacts.size.map((v) => Number(v.toFixed(3)))).toEqual([
    s.length,
    s.width,
    s.lid + s.lip,
  ]);
  // Flat faces only: the box's volume is exact.
  expect(boxFacts.volume).toBeCloseTo(boxVolume(s), 1);
  // The fillet takes about r² (1 − π/4) along each top edge.
  const fillet = 1.5 ** 2 * (1 - Math.PI / 4) * 2 * (s.length + s.width);
  expect(Math.abs(lidFacts.volume - (lidBlockVolume(s) - fillet))).toBeLessThan(fillet * 0.05);

  // The lid sits on the rim: its plate from z = height, the lip hanging into the cavity.
  const whole = extentOf(lid);
  expect(whole.min[2]).toBeCloseTo(s.height - s.lip, 3);
  expect(whole.max[2]).toBeCloseTo(s.height + s.lid, 3);
  // The lip (every node below the rim) is the cavity less `clearance` on each side, centred.
  const lip = extentOf(lid, (_x, _y, z) => z < s.height - 1e-3);
  const [lx = 0, ly = 0] = lipSize(s);
  expect(lip.size[0]).toBeCloseTo(lx, 3);
  expect(lip.size[1]).toBeCloseTo(ly, 3);
  expect(lip.min[0]).toBeCloseTo(-lx / 2, 3);
  expect(lip.min[1]).toBeCloseTo(-ly / 2, 3);
  // The cavity: the box's nodes above the floor and inside the walls.
  const inner = extentOf(
    box,
    (x, y, z) =>
      z > s.wall + 1e-3 && Math.abs(x) < s.length / 2 - 1e-3 && Math.abs(y) < s.width / 2 - 1e-3,
  );
  expect(inner.size[0]).toBeCloseTo(s.length - 2 * s.wall, 3);
  expect(inner.size[1]).toBeCloseTo(s.width - 2 * s.wall, 3);
  // The gap on each side is the clearance.
  expect((inner.size[0] - lip.size[0]) / 2).toBeCloseTo(s.clearance, 3);
  expect((inner.size[1] - lip.size[1]) / 2).toBeCloseTo(s.clearance, 3);
}

test('B4: a box with a lid that fits, by a clearance parameter', async ({ page }) => {
  test.setTimeout(120_000);
  const viewport = await openProject(page);
  await kernelReady(page);
  await renameProject(page, 'B4 Box with lid');

  await openParameters(page);
  await addParameter(page, 'length', '60 mm');
  await addParameter(page, 'width', '40 mm');
  await addParameter(page, 'height', '30 mm');
  await addParameter(page, 'wall', '2 mm');
  await addParameter(page, 'clearance', '0.2 mm');
  await addParameter(page, 'lid', '3 mm');
  await addParameter(page, 'lip', '5 mm');
  await addParameter(page, 'bevel', '0.8 mm');
  await addParameter(page, 'rounding', '1.5 mm');
  await closeParameters(page);

  // Offset Plane1: the rim's plane, `height` above XY (picked while nothing is in front of it).
  let at = await turnView(page, 'Shift+1');
  const half = Number(await viewport.getAttribute('data-camera-size')) * 0.16;
  const construct = page.getByRole('group', { name: 'Construct', exact: true });
  await construct.getByRole('button', { name: /^Offset Plane/ }).click();
  const offset = page.getByRole('region', { name: 'Offset Plane dialog' });
  await expect(offset).toBeVisible();
  await clickAt(page, at, [half * 0.5, -half * 0.5, 0]);
  await expect(offset.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
  await fill(offset, { Distance: 'height' });
  await ok(page, offset);
  // Out of the way until the lid needs it.
  await page.getByRole('button', { name: 'Hide Offset Plane1' }).click();

  // Box1: the block, centred on the origin.
  await primitive(page, 'Box', { Length: 'length', Width: 'width', Height: 'height' });
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:60,40,30');

  // Shell1: the top face removed, `wall` thick.
  at = await turnView(page, 'Shift+1');
  await clickWhere(page, at, [0, 0, 30], /^face:/);
  await page.getByRole('button', { name: /^Shell/ }).click();
  const shell = page.getByRole('region', { name: 'Shell dialog' });
  await expect(shell.getByRole('button', { name: 'Faces to remove', exact: true })).toHaveText(
    '1 face',
  );
  await fill(shell, { Thickness: 'wall' });
  await ok(page, shell);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:11:60,40,30');

  // Chamfer1: the four bottom edges, seen from below.
  at = await turnView(page, 'Shift+3');
  // Zoomed out, clear of the dialog on the right.
  await zoomOutTo(page, at([0, 0, 0]), 150);
  await settled(viewport);
  at = await projector(viewport);
  const bottom: [number, number, number][] = [
    [0, -20, 0],
    [30, 0, 0],
    [0, 20, 0],
    [-30, 0, 0],
  ];
  await clickEdge(page, at, bottom[0] as [number, number, number]);
  await page.getByRole('button', { name: /^Chamfer/ }).click();
  const chamfer = page.getByRole('region', { name: 'Chamfer dialog' });
  const edges = chamfer.getByRole('button', { name: 'Edges', exact: true });
  await expect(edges).toHaveText('1 edge');
  for (const [k, p] of bottom.slice(1).entries()) {
    await clickEdge(page, at, p);
    await expect(edges).toHaveText(`${k + 2} edges`);
  }
  await fill(chamfer, { Distance: 'bevel' });
  await ok(page, chamfer);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:15:60,40,30');

  // Box2: the lid's plate on the offset plane, a body of its own.
  await page.getByRole('button', { name: 'Show Offset Plane1' }).click();
  at = await turnView(page, 'Shift+1');
  const plate = await startPrimitive(page, 'Box');
  // Over the open box the offset plane is in front of the floor.
  await clickAt(page, at, [0, 0, 30]);
  await expect(plate.getByRole('button', { name: 'Plane', exact: true })).toHaveText(
    'Offset Plane1',
  );
  await fill(plate, { Length: 'length', Width: 'width', Height: 'lid' });
  await plate.getByRole('combobox', { name: 'Operation' }).selectOption('new-body');
  await ok(page, plate);
  await page.getByRole('button', { name: 'Hide Offset Plane1' }).click();
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:15:60,40,30 Body2:6:60,40,3');

  // Box3: the lip under the plate, joined to it (it touches only the plate: the clearance
  // keeps it off the walls).
  await primitive(
    page,
    'Box',
    {
      Length: 'length - 2 * (wall + clearance)',
      Width: 'width - 2 * (wall + clearance)',
      Height: 'lip',
      Offset: 'height - lip',
    },
    'join',
  );
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:15:60,40,30 Body2:11:60,40,8');

  // Fillet1: the lid's four top edges.
  at = await turnView(page, 'Shift+1');
  const top: [number, number, number][] = [
    [0, -20, 33],
    [30, 0, 33],
    [0, 20, 33],
    [-30, 0, 33],
  ];
  await clickEdge(page, at, top[0] as [number, number, number]);
  await page.keyboard.press('f');
  const fillet = page.getByRole('region', { name: 'Fillet dialog' });
  const filletEdges = fillet.getByRole('button', { name: 'Edges', exact: true });
  await expect(filletEdges).toHaveText('1 edge');
  for (const [k, p] of top.slice(1).entries()) {
    await clickEdge(page, at, p);
    await expect(filletEdges).toHaveText(`${k + 2} edges`);
  }
  await fill(fillet, { Radius: 'rounding' });
  await ok(page, fillet);

  await renameBody(page, 'Body1', 'Box');
  await renameBody(page, 'Body2', 'Lid');
  await expectNoProblems(page);
  // The lid: plate, lip and four fillet faces.
  await expect(viewport).toHaveAttribute('data-bodies', 'Box:15:60,40,30 Lid:15:60,40,8');
  await page.screenshot({ path: test.info().outputPath('box-and-lid.png') });

  // The design as it stands is the benchmark's fixture (fixtures/benchmarks/).
  await exportProject(page, 'b4-box-with-lid.extrudo');
  checkExport(await exportModel(page, '3MF'), START);
  await solidTab(page);

  // A looser fit and a longer box: the lid follows and still fits.
  await setParameters(page, { clearance: '0.4 mm', length: '70 mm', lid: '4 mm' });
  await kernelReady(page);
  await expectNoProblems(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Box:15:70,40,30 Lid:15:70,40,9');
  await expect(chip(page, 'Fillet1')).toHaveAccessibleName('Fillet1');
  checkExport(await exportModel(page, '3MF'), {
    ...START,
    clearance: 0.4,
    length: 70,
    lid: 4,
  });
});
