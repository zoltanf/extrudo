import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  type At,
  addParameter,
  chip,
  clickAt,
  clickWhere,
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
  turnView,
  viewportOf,
  zoomOutTo,
} from './benchmark-helpers';
import { kernelReady, openProject, pickTool, projector } from './helpers';

// P3-14: benchmark B5 (requirements §7) built through the UI: a PCB
// enclosure. A tray (a Box shelled open at the top) with a screw post in one
// corner (a Cylinder joined to it) and an M3 heat-set insert hole in the
// post (the Hole preset); a rectangular pattern of both features puts a post
// in every corner. The lid is a second body on the rim with countersunk M3
// clearance holes (the preset, made blind to the lid's thickness so they
// stop at the posts) at two corners, mirrored to the other two. Everything
// follows the parameters; the 3MF export has both bodies, closed, with the
// volumes the parameters give.

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
  lid: number;
  post: number;
}

const START: Sizes = { length: 80, width: 60, height: 25, wall: 2, lid: 3, post: 7 };
/** The M3 heat-set insert preset: 4 mm across, 6.5 mm deep, flat. */
const INSERT = { diameter: 4, depth: 6.5 };
/** The M3 clearance preset's countersink: 3.4 mm hole, 6.7 mm at 90°. */
const COUNTERSINK = { diameter: 3.4, head: 6.7 };

/** The tray: a block less the cavity, four posts up from the floor, less four insert holes (mm³). */
const trayVolume = (s: Sizes) =>
  s.length * s.width * s.height -
  (s.length - 2 * s.wall) * (s.width - 2 * s.wall) * (s.height - s.wall) +
  4 * Math.PI * (s.post / 2) ** 2 * (s.height - s.wall) -
  4 * Math.PI * (INSERT.diameter / 2) ** 2 * INSERT.depth;

/** One countersunk hole through the lid: the hole, and the cone above it (a frustum less its core). */
function countersunk(lid: number) {
  const r = COUNTERSINK.diameter / 2;
  const R = COUNTERSINK.head / 2;
  // 90°: the cone is as deep as it is wide at each side.
  const h = R - r;
  return Math.PI * r * r * lid + (Math.PI * h * (R * R + R * r + r * r)) / 3 - Math.PI * r * r * h;
}

const lidVolume = (s: Sizes) => s.length * s.width * s.lid - 4 * countersunk(s.lid);

/** Checks the 3MF export: two closed bodies, as big and as heavy as the parameters make them. */
function checkExport(file: Parameters<typeof objectsOf3mf>[0], s: Sizes) {
  const objects = objectsOf3mf(file);
  expect(objects.map((o) => o.name)).toEqual(['Enclosure', 'Lid']);
  const [tray, lid] = objects.map((o) => solidFacts(o.mesh));
  expect(tray?.size.map((v) => Number(v.toFixed(3)))).toEqual([s.length, s.width, s.height]);
  expect(lid?.size.map((v) => Number(v.toFixed(3)))).toEqual([s.length, s.width, s.lid]);
  // The cylinders are a tessellation short of exact: within 0.1 %.
  expect(Math.abs((tray?.volume ?? 0) / trayVolume(s) - 1)).toBeLessThan(1e-3);
  expect(Math.abs((lid?.volume ?? 0) / lidVolume(s) - 1)).toBeLessThan(1e-3);
}

/** Opens the Hole tool (H) and clicks a flat face at a world point; returns the dialog. */
async function holeOn(page: Page, at: At, p: [number, number, number]) {
  await page.keyboard.press('h');
  const dialog = page.getByRole('region', { name: 'Hole dialog' });
  await expect(dialog).toBeVisible();
  // The Plane field picks like Create Sketch (no model hover): a click on the face places the hole.
  await clickAt(page, at, p);
  await expect(dialog.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
  return dialog;
}

/** Ticks features in a pattern's or mirror's Features list. */
async function tick(dialog: Locator, names: string[]) {
  for (const name of names) {
    await dialog.getByRole('checkbox', { name: new RegExp(`^${name} `) }).check();
  }
}

test('B5: a PCB enclosure with screw posts and countersunk lid screws', async ({ page }) => {
  test.setTimeout(120_000);
  const viewport = await openProject(page);
  await kernelReady(page);
  await renameProject(page, 'B5 PCB enclosure');

  await openParameters(page);
  await addParameter(page, 'length', '80 mm');
  await addParameter(page, 'width', '60 mm');
  await addParameter(page, 'height', '25 mm');
  await addParameter(page, 'wall', '2 mm');
  await addParameter(page, 'lid', '3 mm');
  await addParameter(page, 'post', '7 mm');
  await addParameter(page, 'inset', '8 mm');
  // Where the posts stand: `inset` in from the outside, in every corner.
  await addParameter(page, 'px', 'length / 2 - inset');
  await addParameter(page, 'py', 'width / 2 - inset');
  await closeParameters(page);

  // Box1 shelled open at the top: the tray.
  await primitive(page, 'Box', { Length: 'length', Width: 'width', Height: 'height' });
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:80,60,25');
  let at = await turnView(page, 'Shift+1');
  await clickWhere(page, at, [0, 0, 25], /^face:/);
  await page.getByRole('button', { name: /^Shell/ }).click();
  const shell = page.getByRole('region', { name: 'Shell dialog' });
  await expect(shell.getByRole('button', { name: 'Faces to remove', exact: true })).toHaveText(
    '1 face',
  );
  await fill(shell, { Thickness: 'wall' });
  await ok(page, shell);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:11:80,60,25');

  // Cylinder1: a post in the front left corner, from the bottom to the rim, joined to the tray.
  await primitive(
    page,
    'Cylinder',
    { X: '-px', Y: '-py', Diameter: 'post', Height: 'height' },
    'join',
  );
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:13:80,60,25');

  // Hole1: an M3 heat-set insert in the post's top, from the preset.
  at = await turnView(page, 'Shift+1');
  const insert = await holeOn(page, at, [-32, -22, 25]);
  await insert
    .getByRole('combobox', { name: 'Preset' })
    .selectOption({ label: 'M3 heat-set insert' });
  await expect(insert.getByRole('combobox', { name: 'Extent' })).toHaveValue('blind');
  await expect(insert.getByRole('textbox', { name: 'Depth', exact: true })).toHaveValue('6.5 mm');
  await fill(insert, { X: '-px', Y: '-py' });
  await ok(page, insert);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:15:80,60,25');

  // Rectangular Pattern1: the post and its hole in every corner, 2 × 2 along X and Y.
  await pickTool(page, 'Rectangular Pattern');
  const pattern = page.getByRole('region', { name: 'Rectangular Pattern dialog' });
  await expect(pattern).toBeVisible();
  await pattern.getByRole('combobox', { name: 'Pattern' }).selectOption('features');
  await tick(pattern, ['Cylinder1', 'Hole1']);
  await pattern.getByRole('button', { name: 'Direction', exact: true }).click();
  await pickAxis(page, at, 'x', [50, 55, 60, 65, 70]);
  await expect(pattern.getByRole('button', { name: 'Direction', exact: true })).toHaveText(
    'X axis',
  );
  await fill(pattern, { Count: '2', Distance: '2 * px' });
  await pattern.getByRole('button', { name: 'Direction 2', exact: true }).click();
  await pickAxis(page, at, 'y', [-40, -45, -50, -55, -60]);
  await expect(pattern.getByRole('button', { name: 'Direction 2', exact: true })).toHaveText(
    'Y axis',
  );
  await fill(pattern, { 'Count 2': '2', 'Distance 2': '2 * py' });
  await ok(page, pattern);
  // Four posts, each a wall, a ring on top and the insert hole's wall and floor.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:27:80,60,25');

  // Box2: the lid on the rim, a body of its own.
  await primitive(
    page,
    'Box',
    { Length: 'length', Width: 'width', Height: 'lid', Offset: 'height' },
    'new-body',
  );
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:27:80,60,25 Body2:6:80,60,3');

  // Hole2 and Hole3: countersunk M3 clearance holes over the left posts, as deep as the lid.
  at = await turnView(page, 'Shift+1');
  for (const y of [-1, 1]) {
    const screw = await holeOn(page, at, [-32, 22 * y, 28]);
    await screw.getByRole('combobox', { name: 'Preset' }).selectOption({ label: 'M3 clearance' });
    await screw.getByRole('combobox', { name: 'Type' }).selectOption('countersink');
    await screw.getByRole('combobox', { name: 'Extent' }).selectOption('blind');
    await fill(screw, { X: '-px', Y: y < 0 ? '-py' : 'py', Depth: 'lid', 'Drill point': '0 deg' });
    await expect(screw.getByRole('combobox', { name: 'Preset' })).toHaveValue('m3-clearance');
    await ok(page, screw);
  }
  // The lid's six faces and a cone and a wall for each hole.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:27:80,60,25 Body2:10:80,60,3');

  // Mirror1: both holes to the right, about the YZ plane (picked where no body is in front).
  await page.getByRole('button', { name: 'Mirror', exact: true }).click();
  const mirror = page.getByRole('region', { name: 'Mirror dialog' });
  await expect(mirror).toBeVisible();
  await mirror.getByRole('combobox', { name: 'Mirror' }).selectOption('features');
  await tick(mirror, ['Hole2', 'Hole3']);
  const plane = mirror.getByRole('button', { name: 'Plane', exact: true });
  await plane.click();
  await zoomOutTo(page, at([0, 0, 0]), 250);
  await settled(viewport);
  at = await projector(viewport);
  const half = Number(await viewport.getAttribute('data-camera-size')) * 0.16;
  for (const [y, z] of [
    [-0.5, 0.95],
    [-0.9, 0.9],
    [-0.2, 0.95],
    [-0.95, 0.5],
  ] as const) {
    const p = at([0, y * half, z * half]);
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
    if ((await plane.textContent()) === 'YZ plane') break;
    if ((await plane.textContent()) !== 'Pick a plane or flat face') {
      await mirror.getByRole('button', { name: 'Clear Plane' }).click();
    }
  }
  await expect(plane).toHaveText('YZ plane');
  await ok(page, mirror);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:27:80,60,25 Body2:14:80,60,3');

  await renameBody(page, 'Body1', 'Enclosure');
  await renameBody(page, 'Body2', 'Lid');
  await expectNoProblems(page);
  await turnView(page, 'Shift+1');
  await page.screenshot({ path: test.info().outputPath('enclosure.png') });

  // The design as it stands is the benchmark's fixture (fixtures/benchmarks/).
  await exportProject(page, 'b5-pcb-enclosure.extrudo');
  checkExport(await exportModel(page, '3MF'), START);
  await solidTab(page);

  // A longer, taller box: the posts, the inserts and the screws follow.
  await setParameters(page, { length: '100 mm', height: '30 mm' });
  await kernelReady(page);
  await expectNoProblems(page);
  await expect(chip(page, 'Mirror1')).toHaveAccessibleName('Mirror1');
  await expect(viewport).toHaveAttribute('data-bodies', 'Enclosure:27:100,60,30 Lid:14:100,60,3');
  checkExport(await exportModel(page, '3MF'), { ...START, length: 100, height: 30 });
});
