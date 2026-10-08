import { expect, type Locator, type Page, test } from '@playwright/test';
import { readStl } from '../packages/io/src/index';
import {
  exportModel,
  objectsOf3mf,
  ok,
  primitive,
  selectBodies,
  solidFacts,
  solidTab,
  turnView,
  viewportOf,
} from './benchmark-helpers';
import { clicker, kernelReady, mapping, openProject, pickTool, selectTab } from './helpers';

// P4-06, slice 3: mesh bodies (ADR-0066 §3). An STL, 3MF or OBJ the user
// picks becomes one body of triangles per piece; the browser tags it "Mesh",
// its creases can't be picked (there is no B-rep edge behind them), the
// features that need a solid refuse it with one message, and STL and 3MF
// export it as it is while a STEP file leaves it out.

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 240_000 });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** The P4-06 mesh fixtures, written through our own writers (`import-mesh-fixture.test.ts`). */
const CUBE_STL = 'fixtures/imports/cube.stl';
const TWO_PARTS_3MF = 'fixtures/imports/two-parts.3mf';
const OBJ = 'fixtures/imports/bracket-y-up.obj';
const OPEN_STL = 'fixtures/imports/open.stl';

const viewport = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const dialog = (page: Page, name = 'Import dialog') => page.getByRole('region', { name });
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });

/** "Body1:1:20,20,20" per drawn body: its name, face count and size in mm. */
async function bodies(page: Page) {
  const drawn = (await viewport(page).getAttribute('data-bodies')) ?? '';
  return drawn
    .split(' ')
    .filter(Boolean)
    .map((entry) => {
      const [name, faces, size] = entry.split(':');
      return { name: name ?? '', faces: Number(faces), size: (size ?? '').split(',').map(Number) };
    });
}

const sizes = async (page: Page) => (await bodies(page)).map((b) => b.size);

/** The Insert tab's Import tile, then a file through the platform's picker. */
async function importFile(page: Page, file: string): Promise<Locator> {
  const chooser = page.waitForEvent('filechooser');
  await selectTab(page, 'Home');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await (await chooser).setFiles(file);
  const panel = dialog(page);
  await expect(panel).toBeVisible();
  return panel;
}

/** The browser's row for a body, with its "Mesh" tag. */
const bodyRow = (page: Page, index = 0) => page.locator('[data-body]').nth(index);

test('an STL becomes one mesh body, and undo takes it away', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);

  const panel = await importFile(page, CUBE_STL);
  await expect(panel.locator('[data-info="file"]')).toContainText('cube.stl');
  // A mesh file has its own units, so the dialog offers them (ADR-0066 §2).
  await expect(panel.getByRole('combobox', { name: 'Units' })).toHaveValue('auto');
  // The live preview needs manifold-3d in the worker, which the recomputer
  // asks for before this recompute.
  await expect(panel).toHaveAttribute('data-preview-status', 'ok', { timeout: 90_000 });

  await panel.getByRole('button', { name: /^OK/ }).click();
  await expect(chip(page, 'Import1')).toBeVisible();
  // One face (all the triangles), 20 mm a side.
  await expect
    .poll(async () => bodies(page), { timeout: 60_000 })
    .toEqual([{ name: 'Body1', faces: 1, size: [20, 20, 20] }]);
  // The browser says which kind of body it is.
  const row = bodyRow(page);
  await expect(row).toHaveAttribute('data-body-mesh', 'true');
  await expect(row).toContainText('Mesh');

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await bodies(page)).length).toBe(0);
  await expect(chip(page, 'Import1')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(chip(page, 'Import1')).toBeVisible();
  await expect.poll(async () => (await bodies(page)).length).toBe(1);
});

test('a 3MF in centimetres gives a body of millimetres, one per object', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  const panel = await importFile(page, TWO_PARTS_3MF);
  await expect(panel).toHaveAttribute('data-preview-status', 'ok', { timeout: 90_000 });
  await panel.getByRole('button', { name: /^OK/ }).click();
  // The fixture's objects are a 4 cm and a 6 cm cube: 40 mm and 60 mm, the
  // larger keeping the first body ID (ADR-0030).
  await expect
    .poll(async () => sizes(page), { timeout: 60_000 })
    .toEqual([
      [60, 60, 60],
      [40, 40, 40],
    ]);
  expect((await bodies(page)).map((b) => b.faces)).toEqual([1, 1]);
  await expect(bodyRow(page, 0)).toHaveAttribute('data-body-mesh', 'true');
});

test('a Y-up OBJ stands up with Up "Y up"', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  const panel = await importFile(page, OBJ);
  await expect(panel).toHaveAttribute('data-preview-status', 'ok', { timeout: 90_000 });
  // Read as Z-up, the file's 4 mm thickness is in z.
  await panel.getByRole('button', { name: /^OK/ }).click();
  await expect.poll(async () => sizes(page), { timeout: 60_000 }).toEqual([[20, 30, 4]]);

  // Editing from the timeline chip turns it a quarter turn about X.
  await chip(page, 'Import1').dblclick();
  const edit = dialog(page, 'Edit Import1 dialog');
  await expect(edit).toBeVisible();
  await edit.getByRole('combobox', { name: 'Up' }).selectOption('y');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 90_000 });
  await edit.getByRole('button', { name: /^OK/ }).click();
  await expect.poll(async () => sizes(page), { timeout: 60_000 }).toEqual([[20, 4, 30]]);
});

test('an open mesh says how many open edges it has, and cannot be committed', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  const panel = await importFile(page, OPEN_STL);
  await expect(panel).toHaveAttribute('data-preview-status', 'error', { timeout: 90_000 });
  const status = panel.getByRole('status', { name: 'Feature status' });
  await expect(status).toContainText("open.stl isn't a closed solid (3 open edges)");
  await expect(status).not.toContainText('Internal error');
  await expect(panel).not.toHaveAttribute('data-dialog-valid', 'true');
  await expect(panel.getByRole('button', { name: /^OK/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(chip(page, 'Import1')).toHaveCount(0);
  expect(await bodies(page)).toEqual([]);
});

test('a feature that needs a solid refuses a mesh body with one message', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await (await importFile(page, CUBE_STL)).getByRole('button', { name: /^OK/ }).click();
  await expect.poll(async () => (await bodies(page)).length, { timeout: 60_000 }).toBe(1);

  // The cube's top face, in the home view (which looks from +X, −Y, +Z).
  const at = await turnView(page, 'Shift+1');
  const { x, y } = at([10, 10, 20]);
  await page.mouse.move(x, y);
  await expect.poll(() => viewportOf(page).getAttribute('data-model-hover')).toMatch(/^face:/);

  await solidTab(page);
  // A fillet needs an edge to round, and the body's edges are creases: picking
  // skips them, so the field stays empty and the dialog can't commit.
  await pickTool(page, 'Fillet');
  const fillet = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(fillet).toBeVisible();
  await page.mouse.click(x, y);
  await expect(fillet.getByRole('button', { name: 'Edges', exact: true })).toHaveText('Pick edges');
  await expect(fillet).not.toHaveAttribute('data-dialog-valid', 'true');
  await expect(fillet.getByRole('button', { name: /^OK/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await fillet.getByRole('button', { name: 'Cancel Esc' }).click();

  // A Shell given the face the user picks says why it can't: the kernel
  // refuses it with the one mesh-body message (ADR-0066 §3).
  await page.mouse.click(x, y);
  await expect(viewportOf(page)).toHaveAttribute('data-model-selection', /^face:/);
  await pickTool(page, 'Shell');
  const shell = page.getByRole('region', { name: 'Shell dialog' });
  await expect(shell).toBeVisible();
  await expect(shell.getByRole('button', { name: 'Faces to remove', exact: true })).toHaveText(
    '1 face',
  );
  await expect(shell).toHaveAttribute('data-preview-status', 'error', { timeout: 60_000 });
  await expect(shell.getByRole('status', { name: 'Feature status' })).toContainText(
    'Shell needs a solid body: this body is a mesh',
  );
  await shell.getByRole('button', { name: 'Cancel Esc' }).click();
});

test('a mesh body exports as itself, and a STEP file leaves it out', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await (await importFile(page, CUBE_STL)).getByRole('button', { name: /^OK/ }).click();
  await expect.poll(async () => (await bodies(page)).length, { timeout: 60_000 }).toBe(1);

  // STL and 3MF take its own triangles.
  const stl = await exportModel(page, 'STL');
  const facts = solidFacts(readStl(new Uint8Array(stl.bytes)).mesh);
  expect(facts.size.map((v) => Math.round(v))).toEqual([20, 20, 20]);
  expect(facts.volume).toBeCloseTo(20 ** 3, 0);
  const threeMf = objectsOf3mf(await exportModel(page, '3MF'));
  expect(threeMf).toHaveLength(1);
  expect(threeMf[0]?.name).toBe('Body1');
  expect(
    solidFacts(threeMf[0]?.mesh ?? { positions: new Float64Array(), indices: new Uint32Array() })
      .volume,
  ).toBeCloseTo(20 ** 3, 0);

  // Under STEP its checkbox is off and disabled, and the dialog says why.
  await page.getByRole('tab', { name: '3D Print' }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Export model' });
  await expect(exportDialog).toBeVisible();
  await exportDialog.getByRole('radio', { name: /^STEP/ }).check();
  const checkbox = exportDialog.locator('[data-export-bodies] input[type="checkbox"]').first();
  await expect(checkbox).toBeDisabled();
  await expect(exportDialog).toContainText("Meshes can't go into a STEP file");
  await expect(exportDialog.locator('[data-export-summary]')).toHaveAttribute(
    'data-export-summary',
    /Choose a body to export/,
  );
  await exportDialog.getByRole('button', { name: 'Close' }).click();
  expect(await viewportOf(page).getAttribute('data-bodies')).toContain('Body1:1:20,20,20');
});

// P4-06, slice 4: booleans and transforms with mesh bodies (ADR-0066 §4). A
// boolean with a mesh in it goes to manifold-3d and gives a mesh body again,
// which the browser still tags "Mesh"; Move, Mirror, Scale and Split Body work
// on it; and what still needs a solid says so.

/** The cube fixture as one mesh body. */
async function cubeBody(page: Page) {
  await (await importFile(page, CUBE_STL)).getByRole('button', { name: /^OK/ }).click();
  await expect.poll(async () => (await bodies(page)).length, { timeout: 60_000 }).toBe(1);
}

/**
 * A Ø6 circle drawn on a construction plane 10 mm **below** the cube, with the
 * sketch finished. Below, so the circle's profile is in front of the body from
 * the bottom view and can be picked; the extrude then cuts up through it.
 */
async function circleBelow(page: Page) {
  const viewport = page.getByRole('region', { name: 'Viewport' });
  // The file picker left the toolbar on the Insert tab; Create Sketch and the
  // Construct group are in the Solid tab (the Sketch tab is inside a sketch).
  await solidTab(page);
  const at = await turnView(page, 'Shift+1');
  const half = Number(await viewport.getAttribute('data-camera-size')) * 0.16;

  // An offset plane 10 mm below the XY plane, on the cube's own square.
  await pickTool(page, 'Offset Plane');
  const plane = page.getByRole('region', { name: 'Offset Plane dialog' });
  await expect(plane).toBeVisible();
  const corner = at([half * 0.5, -half * 0.5, 0]);
  await page.mouse.click(corner.x, corner.y);
  await expect(plane.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
  await plane.getByRole('textbox', { name: 'Distance' }).fill('-10 mm');
  await ok(page, plane);
  await expect(chip(page, 'Offset Plane1')).toBeVisible();

  // The circle on it, at the cube's centre. The grid would snap a 3 mm radius.
  await pickTool(page, 'Create Sketch');
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('group', { name: 'Construction planes' })
    .getByRole('button', { name: 'Offset Plane1' })
    .click();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  await expect(viewport).toHaveAttribute('data-sketch-frames', /:0,0,-10:0,0,1$/, {
    timeout: 15_000,
  });
  const map = await mapping(viewport);
  const click = clicker(page, map);
  await page.keyboard.press('c');
  await click(10, 10);
  // The diameter typed into the tool's heads-up box, so it is exactly 6 mm and
  // the grid (which is on) can't snap it to something else.
  const headsUp = page.getByRole('group', { name: 'Heads-up input' });
  await expect(headsUp).toBeVisible();
  const diameter = headsUp.getByRole('textbox', { name: 'Diameter' });
  await diameter.fill('6 mm');
  await diameter.press('Enter');
  await page.keyboard.press('Escape');
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();
  await kernelReady(page);
}

test('a hole cut through a mesh body leaves one mesh body, closed on export', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await cubeBody(page);
  await circleBelow(page);

  // From below, the circle's profile is in front of the body; E extrudes it.
  const at = await turnView(page, 'Shift+3');
  const p = at([10, 10, -10]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await expect
    .poll(async () => viewport(page).getAttribute('data-model-selection'))
    .toMatch(/^profile:/);
  await page.keyboard.press('e');
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Operation' }).selectOption('cut');
  await dialog.getByRole('combobox', { name: 'Extent' }).selectOption('through-all');
  await ok(page, dialog);
  await expect(chip(page, 'Extrude1')).toBeVisible();

  // Still one body, still one face of triangles, still tagged "Mesh".
  await expect
    .poll(async () => bodies(page), { timeout: 60_000 })
    .toEqual([{ name: 'Body1', faces: 1, size: [20, 20, 20] }]);
  await expect(bodyRow(page)).toHaveAttribute('data-body-mesh', 'true');

  // The 3MF is one closed object of the cube with a Ø6 mm hole through it
  // (8000 − π·9·20 = 7434 mm³, to half a percent: the hole is an inscribed
  // polygon, which takes off a little less).
  const threeMf = objectsOf3mf(await exportModel(page, '3MF'));
  expect(threeMf).toHaveLength(1);
  const facts = solidFacts(
    threeMf[0]?.mesh ?? { positions: new Float64Array(), indices: new Uint32Array() },
  );
  expect(facts.size.map((v) => Math.round(v))).toEqual([20, 20, 20]);
  expect(Math.abs(facts.volume - (8000 - Math.PI * 9 * 20)) / 8000).toBeLessThan(0.005);
});

test('a box joined to a mesh body becomes one mesh body, and says so', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await cubeBody(page);

  // A 10 mm box centred 20 mm along x: 5 mm of it sticks out of the cube.
  await solidTab(page);
  await primitive(page, 'Box', {
    Length: '10 mm',
    Width: '10 mm',
    Height: '10 mm',
    X: '20 mm',
    Y: '10 mm',
  });
  await expect(chip(page, 'Box1')).toBeVisible();
  await expect.poll(async () => (await bodies(page)).length, { timeout: 60_000 }).toBe(2);

  // Combine them, with the box (a solid) as the target and the mesh as its
  // tool: the target keeps its ID, and it is the body that becomes a mesh, so
  // the feature warns. (The other way round nothing becomes a mesh — the solid
  // is the tool and is used up — so the warning would be wrong.)
  await solidTab(page);
  const at = await turnView(page, 'Shift+1');
  const world = async (p: readonly [number, number, number]) => {
    const { x, y } = at(p);
    await page.mouse.move(x, y);
    await page.mouse.click(x, y);
  };
  await pickTool(page, 'Combine');
  const dialog = page.getByRole('region', { name: 'Combine dialog' });
  await expect(dialog).toBeVisible();
  // The box's top face, clear of the cube, then the cube's own top face.
  await dialog.getByRole('button', { name: 'Target', exact: true }).click();
  await world([22, 10, 10]);
  // The box's body keeps its own name, and the mesh body's after it.
  await expect(dialog.getByRole('button', { name: 'Target', exact: true })).toHaveText('Body2');
  await dialog.getByRole('button', { name: 'Tools', exact: true }).click();
  await world([10, 10, 20]);
  await expect(dialog.getByRole('button', { name: 'Tools', exact: true })).toHaveText('Body1');
  await expect(dialog).toHaveAttribute('data-preview-status', 'warning', { timeout: 30_000 });
  await expect(dialog.getByRole('status', { name: 'Feature status' })).toHaveText(
    'A solid body was combined with a mesh and is a mesh from here on: fillets and face picks no longer work on it.',
  );
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(chip(page, 'Combine1')).toHaveAttribute('data-feature-status', 'warning');

  // One body, 25 mm long, a mesh now, under the box's name (the target's).
  await expect
    .poll(async () => bodies(page), { timeout: 60_000 })
    .toEqual([{ name: 'Body2', faces: 1, size: [25, 20, 20] }]);
  await expect(bodyRow(page)).toHaveAttribute('data-body-mesh', 'true');

  // Its volume is the cube and the box: 8500 mm³.
  const threeMf = objectsOf3mf(await exportModel(page, '3MF'));
  const facts = solidFacts(
    threeMf[0]?.mesh ?? { positions: new Float64Array(), indices: new Uint32Array() },
  );
  expect(Math.abs(facts.volume - 8500) / 8500).toBeLessThan(0.005);
});

test('a mesh body moves, and splits along a plane', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await cubeBody(page);

  // Move the cube 10 mm along x: 10…30.
  await solidTab(page);
  await selectBodies(page, ['Body1']);
  await pickTool(page, 'Move');
  const move = page.getByRole('region', { name: 'Move dialog' });
  await expect(move).toBeVisible();
  await move.getByRole('textbox', { name: 'X distance' }).fill('10 mm');
  await ok(page, move);
  await expect.poll(async () => sizes(page), { timeout: 60_000 }).toEqual([[20, 20, 20]]);

  // The body moved: the exported mesh's lowest x is 10 mm, not 0.
  const threeMf = objectsOf3mf(await exportModel(page, '3MF'));
  const xs = threeMf[0]?.mesh.positions.filter((_, i) => i % 3 === 0) ?? [];
  expect(Math.min(...xs)).toBeCloseTo(10, 1);

  // Back over the origin (−10 mm, an absolute distance), so the YZ plane goes
  // through the cube's middle.
  await chip(page, 'Move1').dblclick();
  const back = page.getByRole('region', { name: 'Edit Move1 dialog' });
  await expect(back).toBeVisible();
  await back.getByRole('textbox', { name: 'X distance' }).fill('-10 mm');
  await ok(page, back);

  await solidTab(page);
  await selectBodies(page, ['Body1']);
  const at = await turnView(page, 'Shift+1');
  await pickTool(page, 'Split Body');
  const split = page.getByRole('region', { name: 'Split Body dialog' });
  await expect(split).toBeVisible();
  await expect(split.getByRole('button', { name: 'Bodies', exact: true })).toHaveText('Body1');
  // The YZ plane's square beside the cube, where nothing is in front of it.
  const half = Number(await viewport(page).getAttribute('data-camera-size')) * 0.16;
  const p = at([0, -half * 0.75, half * 0.75]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await expect(split.getByRole('button', { name: 'Plane', exact: true })).toHaveText('YZ plane');
  await ok(page, split);
  await expect(chip(page, 'Split Body1')).toBeVisible();

  // Two bodies of half the cube each, both meshes.
  await expect.poll(async () => (await bodies(page)).length, { timeout: 60_000 }).toBe(2);
  expect((await bodies(page)).map((b) => b.faces)).toEqual([1, 1]);
  expect((await sizes(page)).map((s) => s[0])).toEqual([10, 10]);
  const halves = objectsOf3mf(await exportModel(page, '3MF'));
  expect(halves).toHaveLength(2);
  const volumes = halves.map(
    (object) =>
      solidFacts(object.mesh ?? { positions: new Float64Array(), indices: new Uint32Array() })
        .volume,
  );
  expect(volumes[0]).toBeCloseTo(4000, -1);
  expect((volumes[0] ?? 0) + (volumes[1] ?? 0)).toBeCloseTo(8000, -1);
});
