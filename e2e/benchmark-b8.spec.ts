import { expect, test } from '@playwright/test';
import {
  addParameter,
  bodies,
  chip,
  clickAt,
  clickEdge,
  closeParameters,
  expectNoProblems,
  exportModel,
  exportProject,
  fill,
  ink,
  objectsOf3mf,
  ok,
  openParameters,
  pickText,
  primitive,
  renameProject,
  setParameters,
  settled,
  solidFacts,
  solidTab,
  toolPrompt,
  turnView,
  zoomOutTo,
} from './benchmark-helpers';
import { clicker, kernelReady, mapping, openProject, pickTool, projector } from './helpers';

// P4-11: benchmark B8 (requirements §7) built through the UI: a name tag (a
// keychain) with raised letters. A Box with its four vertical edges rounded, a
// hole through it for a ring, and a whole text sketched on its top face and
// embossed `letters` out of it. Changing the plate's length and thickness
// recomputes everything, the letters follow the face up, and the 3MF export is
// one closed solid between the plate's volume and the plate's plus its
// letters'.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** The plate's volume: the block less the four rounded corners' fillets, mm³. */
const plateVolume = (length: number, width: number, thick: number, corner: number) =>
  length * width * thick - 4 * corner ** 2 * (1 - Math.PI / 4) * thick;

/** The hole through it: a Ø4 mm cylinder `thick` deep. */
const holeVolume = (thick: number) => Math.PI * 2 * 2 * thick;

/** The plate less the hole: what the letters are added to. */
const withoutLetters = (length: number, width: number, thick: number, corner: number) =>
  plateVolume(length, width, thick, corner) - holeVolume(thick);

test('B8: a name tag with embossed letters', async ({ page }) => {
  // A box, four fillets, a hole, a sketch with a text, an emboss, a parameter
  // change and two exports, each waiting for the kernel: about 20 s.
  test.setTimeout(180_000);
  const viewport = await openProject(page);
  await kernelReady(page);
  await renameProject(page, 'B8 Name tag');

  await openParameters(page);
  await addParameter(page, 'length', '60 mm');
  await addParameter(page, 'width', '20 mm');
  await addParameter(page, 'thick', '3 mm');
  await addParameter(page, 'corner', '5 mm');
  await addParameter(page, 'letters', '1 mm');
  await closeParameters(page);

  // Box1: the plate, centred on the origin like the Box tool places it.
  await primitive(page, 'Box', { Length: 'length', Width: 'width', Height: 'thick' });
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:60,20,3');

  // Fillet1: its four vertical edges. A plate this thin hides one corner from
  // the home view, so three edges come from there and the fourth from the back.
  // The first pick is made at the fitted zoom, where the corners' vertices are
  // well off their edges; afterwards the dialog's filter takes edges only, and
  // zooming out clears them of the dialog on the right.
  let at = await turnView(page, 'Shift+1');
  await clickEdge(page, at, [30, -10, 1.5]);
  await page.keyboard.press('f');
  const fillet = page.getByRole('region', { name: 'Fillet dialog' });
  const edges = fillet.getByRole('button', { name: 'Edges', exact: true });
  await expect(edges).toHaveText('1 edge');
  await zoomOutTo(page, at([0, 0, 1.5]), 110);
  await settled(viewport);
  at = await projector(viewport);
  const uprights: [number, number, number][] = [
    [30, 10, 1.5],
    [-30, -10, 1.5],
  ];
  for (const [k, p] of uprights.entries()) {
    await clickEdge(page, at, p);
    await expect(edges).toHaveText(`${k + 2} edges`);
  }
  let back = await turnView(page, 'Shift+5');
  await zoomOutTo(page, back([0, 0, 1.5]), 110);
  await settled(viewport);
  back = await projector(viewport);
  await clickEdge(page, back, [-30, 10, 1.5]);
  await expect(edges).toHaveText('4 edges');
  await fill(fillet, { Radius: 'corner' });
  await ok(page, fillet);
  // Four rounded corners: the top and bottom faces are whole again.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:10:60,20,3');

  // Hole1: through the top face, 6 mm from its left end, for the ring.
  at = await turnView(page, 'Shift+1');
  await page.keyboard.press('h');
  const hole = page.getByRole('region', { name: 'Hole dialog' });
  await expect(hole).toBeVisible();
  await expect(hole.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
  // The click takes the face and places the hole where it landed.
  await clickAt(page, at, [-24, 0, 3]);
  await expect(hole.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
  await fill(hole, { X: '-length / 2 + 6 mm', Y: '0 mm', Diameter: '4 mm' });
  await hole.getByRole('combobox', { name: 'Extent', exact: true }).selectOption('through');
  await ok(page, hole);
  await expect(chip(page, 'Hole1')).toHaveAccessibleName('Hole1');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:11:60,20,3');

  // Sketch1 on the top face: the text, centred on the plate's right half.
  await pickTool(page, 'Create Sketch');
  await expect(page.getByRole('region', { name: 'Create Sketch' })).toContainText('flat face');
  await clickAt(page, at, [15, 0, 3]);
  await expect(chip(page, 'Sketch1')).toBeVisible();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  const palette = page.getByRole('region', { name: 'Sketch palette' });
  // The letters are drawn where they are put, so the grid would snap their
  // anchor to the origin; their ink is read back instead.
  const snap = palette.getByRole('checkbox', { name: 'Snap to grid' });
  await snap.uncheck();
  await snap.blur();
  // "Show profiles" makes a click anywhere in a letter's ink take its text.
  const showProfiles = palette.getByRole('checkbox', { name: 'Show profiles' });
  if (!(await showProfiles.isChecked())) await showProfiles.check();
  await showProfiles.blur();
  const sketch = await mapping(viewport);
  await page.keyboard.press('Shift+T');
  await expect(toolPrompt(page)).toHaveText('Click where the first line’s baseline starts.');
  await clicker(page, sketch)(4, -4);
  const text = page.getByRole('region', { name: 'Text' });
  await expect(text).toBeVisible();
  await text.getByRole('textbox', { name: 'Text' }).fill('EXTRUDO');
  await text.getByRole('button', { name: 'Center' }).click();
  await text.getByRole('textbox', { name: 'Height' }).fill('8 mm');
  await text.getByRole('button', { name: 'OK' }).click();
  await expect(text).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  // Eight millimetres of cap height, centred on the anchor at (4, -4).
  // "EXTRUDO" at that height is 50.8 mm wide, so it is centred on x = 4 to lie
  // between the hole's edge (at -length / 2 + 6 + 2 = -22) and the far end.
  const drawnInk = await ink(page);
  expect(drawnInk.y[1] - drawnInk.y[0]).toBeCloseTo(8, 0);
  expect((drawnInk.x[0] + drawnInk.x[1]) / 2).toBeCloseTo(4, 0);
  expect(drawnInk.x[0]).toBeGreaterThan(-22);
  expect(drawnInk.x[1]).toBeLessThan(30);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();
  await kernelReady(page);

  // Emboss1: the whole text `letters` out of the top face it was drawn on.
  at = await turnView(page, 'Shift+1');
  await pickText(page, at, drawnInk, ([u, v]) => [u, v, 3]);
  await pickTool(page, 'Emboss');
  const emboss = page.getByRole('region', { name: 'Emboss dialog' });
  await expect(emboss).toBeVisible();
  await expect(emboss.getByRole('button', { name: 'Profiles', exact: true })).toHaveText('1 text');
  // The top face itself, clear of the letters and the hole.
  await clickAt(page, at, [-15, -6, 3]);
  await expect(emboss.getByRole('button', { name: 'Face', exact: true })).toHaveText('1 face');
  await fill(emboss, { Depth: 'letters' });
  await ok(page, emboss);
  await expect(chip(page, 'Emboss1')).toHaveAccessibleName('Emboss1');

  await expectNoProblems(page);
  // One body: the letters stand on the plate, they don't float beside it.
  const drawn = await bodies(page);
  expect(Object.keys(drawn)).toEqual(['Body1']);
  const tag = drawn.Body1;
  // The letters stand `letters` out of the plate's top face, and each of the
  // seven brings a cap and its walls.
  expect(tag?.size[0]).toBeCloseTo(60, 1);
  expect(tag?.size[1]).toBeCloseTo(20, 1);
  expect(tag?.size[2]).toBeCloseTo(4, 1);
  expect(tag?.faces).toBeGreaterThan(40);
  await page.screenshot({ path: test.info().outputPath('name-tag.png') });

  // The design as it stands is the benchmark's fixture (fixtures/benchmarks/).
  await exportProject(page, 'b8-name-tag.extrudo');
  const [start] = objectsOf3mf(await exportModel(page, '3MF'));
  await solidTab(page);
  expect(start?.name).toBe('Body1');
  if (!start) throw new Error('nothing exported');
  // Flat faces only, so the volume is exact: the plate less the hole, plus the
  // letters, which fill a fifth to all of their ink's bounding box.
  const plate = solidFacts(start.mesh);
  const inkBox = (drawnInk.x[1] - drawnInk.x[0]) * (drawnInk.y[1] - drawnInk.y[0]);
  expect(plate.volume).toBeGreaterThan(withoutLetters(60, 20, 3, 5) + inkBox * 0.2);
  expect(plate.volume).toBeLessThan(withoutLetters(60, 20, 3, 5) + inkBox);

  // A longer, thicker plate: the sketch rides up with it and the letters stand
  // out of the new top face.
  await setParameters(page, { length: '70 mm', thick: '4 mm' });
  await kernelReady(page);
  await expectNoProblems(page);
  await expect(chip(page, 'Emboss1')).toHaveAccessibleName('Emboss1');
  const grown = await bodies(page);
  expect(Object.keys(grown)).toEqual(['Body1']);
  expect(grown.Body1?.size[0]).toBeCloseTo(70, 1);
  expect(grown.Body1?.size[1]).toBeCloseTo(20, 1);
  expect(grown.Body1?.size[2]).toBeCloseTo(5, 1);

  const [bigger] = objectsOf3mf(await exportModel(page, '3MF'));
  await solidTab(page);
  expect(bigger?.name).toBe('Body1');
  if (!bigger) throw new Error('nothing exported');
  const biggerPlate = solidFacts(bigger.mesh);
  expect(biggerPlate.size[0]).toBeCloseTo(70, 1);
  expect(biggerPlate.size[2]).toBeCloseTo(5, 1);
  expect(biggerPlate.volume).toBeGreaterThan(withoutLetters(70, 20, 4, 5) + inkBox * 0.2);
  expect(biggerPlate.volume).toBeLessThan(withoutLetters(70, 20, 4, 5) + inkBox);
  expect(biggerPlate.volume).toBeGreaterThan(plate.volume);
});
