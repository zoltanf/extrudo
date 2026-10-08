import { expect, type Page, test } from '@playwright/test';
import {
  addParameter,
  attr,
  chip,
  clickAt,
  closeParameters,
  expectNoProblems,
  exportModel,
  exportProject,
  fill,
  objectsOf3mf,
  ok,
  openParameters,
  pickAxis,
  renameBody,
  renameProject,
  setParameters,
  settled,
  solidFacts,
  solidTab,
  startPrimitive,
  toolPrompt,
  turnView,
  viewportOf,
  zoomOutTo,
} from './benchmark-helpers';
import { clicker, kernelReady, openProject, pickTool, projector } from './helpers';

// P4-11: benchmark B10 (requirements §7) built through the UI: a cable chain
// link. A rectangle path sketched on XZ and rounded with the sketch fillet is
// swept with a small section, so the walls' centreline becomes the link's
// frame; a cylinder is the pin at one end of it and a hole the pin's clearance
// at the other, `pin + 2 * tolerance` wide; a rectangular pattern of the body
// puts three links in a row. The tolerance comes from the 3D Print tab's
// panel, and changing it re-cuts the hole.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

interface Body {
  faces: number;
  /** Size along x, y and z, mm. */
  size: number[];
}

/** The bodies the view draws (`data-bodies`: `name:faces:x,y,z`), by name. */
async function bodies(page: Page): Promise<Record<string, Body>> {
  const drawn = await attr(viewportOf(page), 'data-bodies');
  return Object.fromEntries(
    drawn.split(' ').map((entry) => {
      const [name, faces, size] = entry.split(':');
      return [name, { faces: Number(faces), size: (size ?? '').split(',').map(Number) }];
    }),
  );
}

/** The link's own numbers at the parameters this benchmark starts with. */
const START = {
  pitch: 30,
  inner: 20,
  wall: 3,
  depth: 10,
  pin: 5,
  tolerance: 0.2,
};

/** The sweep of a `depth` x `wall` section along the walls' centreline, mm³. */
function ringVolume(s: typeof START): number {
  // The centreline's perimeter: a rounded rectangle `inner + wall` by `inner`
  // with `corner` fillets, swept with a constant section.
  const corner = 3;
  const perimeter =
    2 * (s.inner + s.wall - 2 * corner) + 2 * (s.inner - 2 * corner) + 2 * Math.PI * corner;
  return perimeter * s.depth * s.wall;
}

test('B10: a cable chain link, swept and patterned', async ({ page }) => {
  // Two sketches, a sweep, a pin, a hole, a pattern, a parameter change and two
  // exports: about 30 s alone.
  test.setTimeout(240_000);
  const viewport = await openProject(page);
  await kernelReady(page);
  await renameProject(page, 'B10 Chain link');

  await openParameters(page);
  await addParameter(page, 'pitch', '30 mm');
  await addParameter(page, 'inner', '20 mm');
  await addParameter(page, 'wall', '3 mm');
  await addParameter(page, 'depth', '10 mm');
  await addParameter(page, 'pin', '5 mm');
  await closeParameters(page);

  // The print tolerance, from the 3D Print tab's panel (P4-08).
  await page
    .getByRole('tablist', { name: 'Toolbar tabs' })
    .getByRole('tab', { name: '3D Print' })
    .click();
  await page.getByRole('button', { name: 'Tolerance', exact: true }).click();
  const tolerance = page.getByRole('region', { name: 'Print tolerance' });
  await expect(tolerance).toHaveAttribute('data-tolerance', 'unset');
  await tolerance.getByRole('button', { name: 'Normal 0.2 mm' }).click();
  await expect(tolerance).toHaveAttribute('data-tolerance', 'set');
  await tolerance.getByRole('button', { name: /^Done/ }).click();
  await solidTab(page);

  const palette = page.getByRole('region', { name: 'Sketch palette' });
  const hideConstraints = async () => {
    const showConstraints = palette.getByRole('checkbox', { name: 'Show constraints' });
    await showConstraints.uncheck();
    await showConstraints.blur();
  };
  /** Picks entities in the open sketch and types the dimension's expression. */
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

  // Sketch1 on XZ (sketch x is world X, y is world Z): the walls' centreline, a
  // rounded rectangle from (-(inner + wall) / 2, wall / 2) to
  // ((inner + wall) / 2, inner + wall / 2).
  await pickTool(page, 'Create Sketch');
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XZ' })
    .click();
  await settled(viewport);
  let xz = await projector(viewport);
  await zoomOutTo(page, xz([0, 0, 0]), 90);
  await settled(viewport);
  xz = await projector(viewport);
  const clickXZ = clicker(page, (x, y) => xz([x, 0, y]));
  await hideConstraints();
  // The rectangle, drawn on grid points above the origin so both distances
  // from the origin below have the sign the model wants.
  await page.keyboard.press('r');
  await clickXZ(-10, 10);
  await clickXZ(10, 30);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  // Its height first: the right side, then the bottom side (whose middle the
  // height leaves where it is).
  await page.keyboard.press('d');
  await dimension(
    clickXZ,
    [
      [10, 15],
      [18, 15],
    ],
    'inner',
  );
  await dimension(
    clickXZ,
    [
      [0, 10],
      [0, 2],
    ],
    'inner + wall',
  );
  // The origin is no entity: a point there is fixed, and the corner is measured
  // from it.
  await pickTool(page, 'Point');
  await clickXZ(0, 0);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await page.keyboard.press('d');
  // Across from the origin to the bottom left corner (a label above the pair),
  // then up it (a label beside it).
  await dimension(
    clickXZ,
    [
      [0, 0],
      [-10, 10],
      [-6, 20],
    ],
    '(inner + wall) / 2',
  );
  await dimension(
    clickXZ,
    [
      [0, 0],
      [-10, 10],
      [-20, 5],
    ],
    'wall / 2',
  );
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await expect(palette).toContainText('Fully constrained');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();

  // Fillet the path's four corners, 3 mm: the radius goes into the heads-up
  // box first, so every corner comes out the same size.
  await chip(page, 'Sketch1').dblclick();
  await pickTool(page, 'Fillet');
  await expect(toolPrompt(page)).toBeVisible();
  xz = await projector(viewport);
  await clickXZ(0, 0);
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  for (const [u, v] of [
    [-11.5, 1.5],
    [11.5, 1.5],
    [11.5, 21.5],
    [-11.5, 21.5],
  ] as const) {
    await clickXZ(u, v);
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();
  await kernelReady(page);

  // Sketch2 on YZ (sketch x is world Y, y is world Z): the section, `depth` by
  // `wall`. A sweep carries the profile exactly where its sketch drew it
  // (ADR-0055: it need not touch the path), so the section is centred on the
  // path's own centreline: it spans the bottom wall, from z = 0 to z = `wall`,
  // and is centred on y = 0.
  await pickTool(page, 'Create Sketch');
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'YZ' })
    .click();
  await settled(viewport);
  let yz = await projector(viewport);
  await zoomOutTo(page, yz([0, 0, 0]), 90);
  await settled(viewport);
  yz = await projector(viewport);
  const clickYZ = clicker(page, (x, y) => yz([0, x, y]));
  // "Show profiles" is what the sweep's first field picks: a profile region.
  const showProfiles = palette.getByRole('checkbox', { name: 'Show profiles' });
  if (!(await showProfiles.isChecked())) await showProfiles.check();
  await showProfiles.blur();
  // The section straddles the origin, so the grid would snap its corners away.
  const snap = palette.getByRole('checkbox', { name: 'Snap to grid' });
  await snap.uncheck();
  await snap.blur();
  await page.keyboard.press('r');
  await clickYZ(-5, -10);
  await clickYZ(5, 10);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await page.keyboard.press('d');
  // Its width first: the bottom side, then its height (the right side, whose
  // middle the width leaves where it is).
  await dimension(
    clickYZ,
    [
      [0, -10],
      [0, -18],
    ],
    'depth',
  );
  await dimension(
    clickYZ,
    [
      [5, 0],
      [13, 0],
    ],
    'wall',
  );
  // Then its place, from the fixed point at the origin: up to the top left
  // corner, which is `wall` above the origin once this is typed (so the bottom
  // one, `wall` below it, lands on z = 0), then across to that bottom left
  // corner.
  await pickTool(page, 'Point');
  await clickYZ(0, 0);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await page.keyboard.press('d');
  await dimension(
    clickYZ,
    [
      [0, 0],
      [-5, 1.5],
      [-12, 1],
    ],
    'wall',
  );
  await dimension(
    clickYZ,
    [
      [0, 0],
      [-5, 0],
      [-3, 6],
    ],
    'depth / 2',
  );
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await expect(palette).toContainText('Fully constrained');
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch2')).toBeVisible();
  await kernelReady(page);

  // Sweep1: the section along the path, which follows it.
  let at = await turnView(page, 'Shift+1');
  await pickTool(page, 'Sweep');
  const sweep = page.getByRole('region', { name: 'Sweep dialog' });
  await expect(sweep).toBeVisible();
  // The section, in the half of Sketch2's rectangle that the path is not in
  // front of, and clear of Sketch1's curves.
  await clickAt(page, at, [0, -3, 1.5]);
  await expect(sweep.getByRole('button', { name: 'Profiles', exact: true })).toHaveText(
    /^Profile · Sketch2$/,
  );
  await sweep.getByRole('button', { name: 'Path', exact: true }).click();
  // The path: its bottom line first (the sweep starts where the path does), then
  // the other seven curves, each on its own middle. Every pick is at least 5 mm
  // off Sketch2, whose curves would come first in the pick.
  const path: [number, number, number][] = [
    [6, 0, 1.5],
    [11.5, 0, 11.5],
    [-6, 0, 21.5],
    [-11.5, 0, 11.5],
    [10.62, 0, 2.38],
    [10.62, 0, 20.62],
    [-10.62, 0, 20.62],
    [-10.62, 0, 2.38],
  ];
  const curves = sweep.getByRole('button', { name: 'Path', exact: true });
  for (const [k, p] of path.entries()) {
    await clickWhereCurve(page, at, p);
    // One curve shows its name, more than one a count.
    await expect(curves).toHaveText(k === 0 ? /^Line · Sketch1$/ : `${k + 1} sketch curves`);
  }
  await expect(sweep.getByRole('combobox', { name: 'Orientation' })).toHaveValue('follow');
  await expect(viewport).toHaveAttribute('data-preview', 'new', { timeout: 20_000 });
  await ok(page, sweep);
  await expect(chip(page, 'Sweep1')).toHaveAccessibleName('Sweep1');
  await renameBody(page, 'Body1', 'Link');
  const link = (await bodies(page)).Link;
  expect(link?.size[0]).toBeCloseTo(26, 1);
  expect(link?.size[1]).toBeCloseTo(10, 1);
  expect(link?.size[2]).toBeCloseTo(23, 1);

  // Cylinder1: the pin, on the link's outside face at the top of its frame,
  // `pin` across and 3 mm out.
  const back = await turnView(page, 'Shift+5');
  const pin = await startPrimitive(page, 'Cylinder');
  await expect(pin.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
  await clickAt(page, back, [0, 5, 21.5]);
  await expect(pin.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
  await expect(pin.getByRole('combobox', { name: 'Operation' })).toHaveValue('join');
  await fill(pin, {
    Diameter: 'pin',
    Height: '3 mm',
    X: '0 mm',
    Y: 'inner + wall / 2',
  });
  await ok(page, pin);
  const pinned = (await bodies(page)).Link;
  // The pin stands 3 mm off the face: the link is now 13 mm deep.
  expect(pinned?.size[0]).toBeCloseTo(26, 1);
  expect(pinned?.size[1]).toBeCloseTo(13, 1);
  expect(pinned?.size[2]).toBeCloseTo(24, 1);

  // Hole1: the pin's clearance at the other end, from the opposite side face,
  // `wall` deep into that wall. A side face is picked in the front view: in an
  // oblique view an origin plane lies in front of it and wins (the plane
  // picker takes a plane unless the face is at least as near).
  at = await turnView(page, 'Shift+4');
  await page.keyboard.press('h');
  const hole = page.getByRole('region', { name: 'Hole dialog' });
  await expect(hole).toBeVisible();
  await clickAt(page, at, [0, -5, 1.5]);
  await expect(hole.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
  // On a face the hole goes through; this one is blind, `wall` deep.
  await hole.getByRole('combobox', { name: 'Extent', exact: true }).selectOption('blind');
  await fill(hole, { X: '0 mm', Y: 'wall / 2', Diameter: 'pin + 2 * tolerance', Depth: 'wall' });
  await expect(hole.getByRole('combobox', { name: 'Extent', exact: true })).toHaveValue('blind');
  await expect(hole.getByText('= 5.40 mm')).toBeVisible();
  await ok(page, hole);
  await expect(chip(page, 'Hole1')).toHaveAccessibleName('Hole1');

  // Rectangular Pattern1: three links along Y, `pitch` apart.
  at = await turnView(page, 'Shift+1');
  await page
    .getByRole('complementary', { name: 'Browser' })
    .getByRole('button', { name: 'Link', exact: true })
    .click();
  await pickTool(page, 'Rectangular Pattern');
  const pattern = page.getByRole('region', { name: 'Rectangular Pattern dialog' });
  await expect(pattern.getByRole('button', { name: 'Bodies', exact: true })).toHaveText('Link');
  await pattern.getByRole('button', { name: 'Direction', exact: true }).click();
  await pickAxis(page, at, 'y', [30, 35, 40, 45, -30, -35]);
  await expect(pattern.getByRole('button', { name: 'Direction', exact: true })).toHaveText(
    'Y axis',
  );
  await fill(pattern, { Count: '3', Distance: 'pitch' });
  await expect(pattern).toHaveAttribute('data-preview-status', 'ok', { timeout: 20_000 });
  await ok(page, pattern);
  await expect(chip(page, 'Rectangular Pattern1')).toBeVisible();

  await expectNoProblems(page);
  const drawn = await bodies(page);
  expect(Object.keys(drawn)).toHaveLength(3);
  for (const body of Object.values(drawn)) {
    expect(body.size[0]).toBeCloseTo(26, 1);
    expect(body.size[1]).toBeCloseTo(13, 1);
    expect(body.size[2]).toBeCloseTo(24, 1);
  }
  await page.screenshot({ path: test.info().outputPath('chain-link.png') });

  // The design as it stands is the benchmark's fixture (fixtures/benchmarks/).
  await exportProject(page, 'b10-chain-link.extrudo');
  const [link3] = objectsOf3mf(await exportModel(page, '3MF'));
  await solidTab(page);
  expect(link3?.name).toBe('Link');
  if (!link3) throw new Error('nothing exported');
  // Flat faces and cylinders only, so the volume is near exact: the centreline's
  // perimeter times the section, plus the pin, less the hole (the pin and the
  // hole take about the same amount off each other).
  const swept = ringVolume(START);
  const pinVolume = Math.PI * (START.pin / 2) ** 2 * 3;
  const startVolume = solidFacts(link3.mesh).volume;
  expect(startVolume).toBeGreaterThan(swept * 0.995);
  expect(startVolume).toBeLessThan(swept + pinVolume);

  // A looser tolerance and a wider pitch: the hole grows to 5.6 mm and the
  // links step further apart.
  await page
    .getByRole('tablist', { name: 'Toolbar tabs' })
    .getByRole('tab', { name: '3D Print' })
    .click();
  await page.getByRole('button', { name: 'Tolerance', exact: true }).click();
  await tolerance.getByRole('button', { name: 'Loose 0.3 mm' }).click();
  await expect(tolerance).toHaveAttribute('data-tolerance', 'set');
  await tolerance.getByRole('button', { name: /^Done/ }).click();
  await solidTab(page);
  await setParameters(page, { pitch: '34 mm' });
  await kernelReady(page);
  await expectNoProblems(page);
  expect(Object.keys(await bodies(page))).toHaveLength(3);
  await expect(chip(page, 'Hole1')).toHaveAccessibleName('Hole1');

  // The hole's diameter, as the dialog reads it: `pin + 2 * tolerance`.
  await chip(page, 'Hole1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Hole1 dialog' });
  await expect(edit.getByRole('textbox', { name: 'Diameter', exact: true })).toHaveValue(
    'pin + 2 * tolerance',
  );
  await expect(edit.getByText('= 5.60 mm')).toBeVisible();
  await edit.getByRole('button', { name: /^Cancel Esc/ }).click();

  const after = objectsOf3mf(await exportModel(page, '3MF'));
  await solidTab(page);
  // The copies are named from their instance (P3-07), so they are Link's
  // Body1 and Body2.
  expect(after.map((o) => o.name)).toEqual(['Link', 'Body1', 'Body2']);
  for (const object of after) {
    expect(solidFacts(object.mesh).size[1]).toBeCloseTo(13, 1);
  }
  // The wider hole took a little more matter off each link.
  expect(solidFacts((after[0] as (typeof after)[0]).mesh).volume).toBeLessThan(startVolume);
});

/**
 * Clicks a sketch curve of the path where the view reports one, in a picking
 * tool's field (the Sweep dialog's Path), and waits for the count.
 */
async function clickWhereCurve(
  page: Page,
  at: (p: readonly [number, number, number]) => { x: number; y: number },
  p: readonly [number, number, number],
) {
  const viewport = viewportOf(page);
  const { x, y } = at(p);
  await expect
    .poll(async () => {
      await page.mouse.move(x, y);
      return attr(viewport, 'data-model-hover');
    })
    .toMatch(/^sketchEntity:/);
  await page.mouse.click(x, y);
}
