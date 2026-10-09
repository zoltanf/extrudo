import { expect, test } from '@playwright/test';
import {
  addParameter,
  attr,
  bodies,
  chip,
  clickWhere,
  closeParameters,
  expectBody,
  expectNoProblems,
  exportModel,
  exportProject,
  fill,
  hideConstraints,
  objectsOf3mf,
  ok,
  openParameters,
  pickAxis,
  renameBody,
  renameProject,
  setParameters,
  settled,
  dimension as sharedDimension,
  solidFacts,
  solidTab,
  toolPrompt,
  turnView,
  zoomOutTo,
} from './benchmark-helpers';
import { clicker, kernelReady, openProject, pickTool, projector } from './helpers';

// P4-11: benchmark B9 (requirements §7) built through the UI: a threaded
// bottle cap and the thread adapter that screws into it. The cap is a
// rectangle revolved a whole turn, shelled open at the bottom and threaded
// on its inside wall; the adapter is a stepped profile revolved as a body of
// its own with a thread on each of its two outside walls. Every thread is
// sized to fit its face, a parameter change re-solves the sketches and refits
// them, and the 3MF export is two closed solids.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** A cylinder's volume, mm³. */
const volumeOf = (r: number, height: number) => Math.PI * r * r * height;

/** The unthreaded cap: a cylinder less the cup the shell hollows out. */
const cupVolume = () => volumeOf(16, 14) - volumeOf(14, 12);
/** The unthreaded adapter: two stacked cylinders. */
const adapterVolume = () => volumeOf(10, 10) + volumeOf(14, 10);

/**
 * A threaded shaft's crest and root radii (the ISO 68-1 basic profile with the
 * dialog's default 0.1 mm tolerance): an auto-fitted thread turns a thicker
 * shaft down to its crests, so the two cylinders bound what is left of it.
 */
const threadRadii = (diameter: number, pitch: number) => ({
  crest: diameter / 2 - 0.1,
  root: diameter / 2 - (5 / 8) * (Math.sqrt(3) / 2) * pitch - 0.1,
});

test('B9: a threaded bottle cap and a thread adapter, both revolved', async ({ page }) => {
  // Threads take seconds to build, and there are four of them between the
  // two bodies (and again after the parameter change).
  test.setTimeout(240_000);
  const viewport = await openProject(page);
  await kernelReady(page);
  await renameProject(page, 'B9 Bottle cap');

  await openParameters(page);
  await addParameter(page, 'capDia', '32 mm');
  await addParameter(page, 'capHeight', '14 mm');
  await addParameter(page, 'wall', '2 mm');
  await addParameter(page, 'adapterLow', '20 mm');
  await addParameter(page, 'stepHeight', '10 mm');
  await closeParameters(page);

  const palette = page.getByRole('region', { name: 'Sketch palette' });
  const dimension = (
    click: (x: number, y: number) => Promise<void>,
    picks: (readonly [number, number])[],
    expr: string,
  ) => sharedDimension(page, click, picks, expr);

  // Sketch1 on XZ (sketch x is world X, y is world Z): the cap's half section
  // from the origin, `capDia / 2` by `capHeight`.
  await pickTool(page, 'Create Sketch');
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XZ' })
    .click();
  await settled(viewport);
  const xz = await projector(viewport);
  const clickXZ = clicker(page, (x, y) => xz([x, 0, y]));
  await hideConstraints(page);
  await page.keyboard.press('r');
  await clickXZ(0, 0);
  await clickXZ(20, 20);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await page.keyboard.press('d');
  await dimension(
    clickXZ,
    [
      [10, 20],
      [10, 27],
    ],
    'capDia / 2',
  );
  await dimension(
    clickXZ,
    [
      // The first dimension moved the right side to x = 16.
      [16, 10],
      [23, 10],
    ],
    'capHeight',
  );
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await expect(palette).toContainText('Fully constrained');
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();

  // Revolve1: the section a whole turn about the Z axis.
  const inside = xz([8, 0, 7]);
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.click(inside.x, inside.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await pickTool(page, 'Revolve');
  const revolve = page.getByRole('region', { name: 'Revolve dialog' });
  await expect(revolve.getByRole('button', { name: 'Profiles', exact: true })).toHaveText(
    /^Profile · Sketch\d+$/,
  );
  await pickAxis(page, xz, 'z', [25, 30, 35, 40, 45, -10, -15]);
  await expect(revolve.getByRole('button', { name: 'Axis', exact: true })).toHaveText('Z axis');
  await ok(page, revolve);
  await renameBody(page, 'Body1', 'Cap');
  await expectBody(page, 'Cap', [32, 32, 14], 3);

  // Shell1: the cap's bottom face, hollowed 2 mm inwards: a cup open below.
  await turnView(page, 'Shift+3');
  const below = await projector(viewport);
  await clickWhere(page, below, [0, 0, 0], /^face:/);
  await pickTool(page, 'Shell');
  const shell = page.getByRole('region', { name: 'Shell dialog' });
  await expect(shell.getByRole('button', { name: 'Faces to remove', exact: true })).toHaveText(
    '1 face',
  );
  await expect(shell.getByRole('combobox', { name: 'Direction', exact: true })).toHaveValue(
    'inside',
  );
  await fill(shell, { Thickness: 'wall' });
  await ok(page, shell);
  await expectBody(page, 'Cap', [32, 32, 14], 5);

  // Thread1: the cap's inside wall, sized to fit it (M30 in the Ø28 wall).
  // The shell's cup is closed at the top, so its inside is only seen from
  // below — the bottom view is still the current one — and only the wall
  // itself (a point inside the cup's hollow picks the lid above it).
  await clickWhere(page, below, [-13.5, 0, 6], /^face:/);
  await pickTool(page, 'Thread');
  const thread = page.getByRole('region', { name: 'Thread dialog' });
  await expect(thread.getByRole('button', { name: 'Faces', exact: true })).toHaveText('1 face');
  await expect(thread.getByRole('combobox', { name: 'Size' })).toHaveValue('auto');
  await expect(thread).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
  await ok(page, thread);
  await expect(chip(page, 'Thread1')).toHaveAccessibleName('Thread1');
  await expectBody(page, 'Cap', [32, 32, 14]);
  // The thread's turns are its faces now.
  expect((await bodies(page)).Cap?.faces).toBeGreaterThan(10);

  // Sketch2 on XZ below the cap: the adapter's stepped half section, drawn on
  // grid points and dimensioned with the parameters.
  await pickTool(page, 'Create Sketch');
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XZ' })
    .click();
  await settled(viewport);
  // The adapter's section reaches 30 mm below the cap, which the sketch's own
  // fit doesn't show: zoom out around the middle of the view (a point of the
  // model can be under a floating panel).
  const box = await viewport.boundingBox();
  if (!box) throw new Error('no viewport');
  // Far enough that z = −30 mm clears the nav bar at the view's foot.
  await zoomOutTo(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 100);
  const below2 = await projector(viewport);
  const clickBelow = clicker(page, (x, y) => below2([x, 0, y]));
  await hideConstraints(page);
  // The origin is no entity: a point there is fixed, and the profile hangs off it.
  await pickTool(page, 'Point');
  await clickBelow(0, 0);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await page.keyboard.press('l');
  for (const [x, y] of [
    [0, -30],
    [10, -30],
    [10, -20],
    [20, -20],
    [20, -10],
    [0, -10],
    [0, -30],
  ] as const) {
    await clickBelow(x, y);
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await page.keyboard.press('d');
  // The bottom of the profile `3 * stepHeight` below the origin and
  // `adapterLow / 2` to the right of it, both measured from the origin point.
  await dimension(
    clickBelow,
    [
      [0, 0],
      [10, -30],
      [15, -16],
    ],
    '3 * stepHeight',
  );
  await dimension(
    clickBelow,
    [
      [0, 0],
      [10, -30],
      [5, 8],
    ],
    'adapterLow / 2',
  );
  // The two steps, each `stepHeight` tall.
  await dimension(
    clickBelow,
    [
      [10, -25],
      [26, -25],
    ],
    'stepHeight',
  );
  await dimension(
    clickBelow,
    [
      [20, -15],
      [26, -15],
    ],
    'stepHeight',
  );
  // The top is as wide as the cap's inside, `capDia / 2 - wall`; that is the
  // last freedom (a sixth dimension would over-constrain the sketch).
  await dimension(
    clickBelow,
    [
      [10, -10],
      [10, -3],
    ],
    'capDia / 2 - wall',
  );
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await expect(palette).toContainText('Fully constrained');
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch2')).toBeVisible();

  // Revolve2: the step a whole turn about Z, a body of its own.
  const inStep = below2([5, 0, -25]);
  await page.mouse.move(inStep.x, inStep.y);
  await page.mouse.click(inStep.x, inStep.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await pickTool(page, 'Revolve');
  const revolve2 = page.getByRole('region', { name: 'Revolve dialog' });
  await revolve2.getByRole('combobox', { name: 'Operation' }).selectOption('new-body');
  await pickAxis(page, below2, 'z', [-35, -40, -45, 35, 40, 45]);
  await expect(revolve2.getByRole('button', { name: 'Axis', exact: true })).toHaveText('Z axis');
  await ok(page, revolve2);
  // The cap's row was renamed, so the free name "Body1" is the adapter's.
  await renameBody(page, 'Body1', 'Adapter');
  await expectBody(page, 'Adapter', [28, 28, 20], 5);

  // Thread2: both outside walls, sized to fit (M20 on Ø20, M24 on Ø28).
  const front = await turnView(page, 'Shift+4');
  await clickWhere(page, front, [0, -10, -25], /^face:/);
  await pickTool(page, 'Thread');
  const thread2 = page.getByRole('region', { name: 'Thread dialog' });
  await expect(thread2.getByRole('button', { name: 'Faces', exact: true })).toHaveText('1 face');
  await clickWhere(page, front, [0, -14, -15], /^face:/);
  await expect(thread2.getByRole('button', { name: 'Faces', exact: true })).toHaveText('2 faces');
  await expect(thread2).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
  await ok(page, thread2);
  await expect(chip(page, 'Thread2')).toHaveAccessibleName('Thread2');
  // Each thread turns its step down to its crests (M20's are Ø19.8, M24's
  // Ø23.8): the upper step, Ø28 as drawn, is the wider of the two.
  await expectBody(page, 'Cap', [32, 32, 14]);
  await expectBody(page, 'Adapter', [23.8, 23.8, 20]);

  await expectNoProblems(page);
  await page.screenshot({ path: test.info().outputPath('b9.png') });

  // The design as it stands is the benchmark's fixture (fixtures/benchmarks/).
  await exportProject(page, 'b9-bottle-cap.extrudo');
  const start = await exportModel(page, '3MF');
  await solidTab(page);
  const objects = objectsOf3mf(start);
  expect(objects.map((o) => o.name)).toEqual(['Cap', 'Adapter']);
  const [cap, adapter] = objects.map((o) => solidFacts(o.mesh));
  // The cap's internal thread puts matter on its crests and takes it off its
  // roots: a little either way of the unthreaded cup.
  expect(cap?.volume).toBeLessThan(cupVolume());
  expect(cap?.volume).toBeGreaterThan(cupVolume() * 0.8);
  // The adapter's two threads turn it down to M20 and M24, which is a third
  // of its matter: between the cylinders the roots and the crests make.
  const m20 = threadRadii(20, 2.5);
  const m24 = threadRadii(24, 3);
  expect(adapter?.volume).toBeLessThan(adapterVolume());
  expect(adapter?.volume).toBeGreaterThan(volumeOf(m20.root, 10) + volumeOf(m24.root, 10));
  expect(adapter?.volume).toBeLessThan(volumeOf(m20.crest, 10) + volumeOf(m24.crest, 10));
  expect(adapter?.size[2]).toBeCloseTo(20, 3);

  // A bigger cap and a wider adapter: the sketches re-solve and both threads
  // refit. The cap's Ø36 bore takes M39 (a bore takes the thread just above
  // it) and the adapter's Ø36 collar M36, so the two parts' threads mesh.
  await setParameters(page, { capDia: '40 mm', adapterLow: '24 mm' });
  await kernelReady(page);
  await expectNoProblems(page);
  await expectBody(page, 'Cap', [40, 40, 14]);
  await expectBody(page, 'Adapter', [35.8, 35.8, 20]);

  const changed = objectsOf3mf(await exportModel(page, '3MF'));
  await solidTab(page);
  expect(changed.map((o) => o.name)).toEqual(['Cap', 'Adapter']);
  const [cap2, adapter2] = changed.map((o) => solidFacts(o.mesh));
  expect(cap2?.size[0]).toBeCloseTo(40, 1);
  expect(cap2?.size[2]).toBeCloseTo(14, 3);
  expect(adapter2?.size[0]).toBeCloseTo(35.8, 1);
  expect(adapter2?.size[2]).toBeCloseTo(20, 3);
  // Both bodies grew.
  expect(cap2?.volume).toBeGreaterThan(cap?.volume ?? 0);
  expect(adapter2?.volume).toBeGreaterThan(adapter?.volume ?? 0);
});
