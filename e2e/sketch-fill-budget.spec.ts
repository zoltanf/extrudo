import { writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import {
  createDocument,
  type Feature,
  type FeatureId,
  type SketchData,
  sketchInputs,
} from '../packages/core/src/index';
import { writeArchive } from '../packages/storage/src/archive';
import { kernelReady, projector } from './helpers';

// A design's regions share a memory budget (ADR-0154). The real one is 256 MB, so the tests
// set a small one through `__extrudoRegionBudget`: a rectangle keeps about 486 bytes, about 254
// of regions for picking and 232 of fill.

/** A rectangle's corners and lines. */
function rectangle(x0: number, y0: number, x1: number, y1: number): SketchData {
  const corners = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ] as const;
  const entities: Record<string, unknown> = {};
  corners.forEach(([x, y], i) => {
    const [nx, ny] = corners[(i + 1) % 4] as readonly [number, number];
    entities[`s${i}`] = { type: 'point', x, y };
    entities[`e${i}`] = { type: 'point', x: nx, y: ny };
    entities[`l${i}`] = { type: 'line', start: `s${i}`, end: `e${i}`, construction: false };
  });
  return { entities, constraints: {}, dimensions: {} } as unknown as SketchData;
}

const sketch = (id: string, name: string, data: SketchData): Feature => ({
  id: id as FeatureId,
  type: 'sketch',
  name,
  suppressed: false,
  inputs: sketchInputs({ kind: 'plane', id: 'origin:xy' }, data),
});

/** The mean colour of the `size` px square around a page point. */
async function meanColor(page: Page, at: { x: number; y: number }, size = 14) {
  const png = await page.screenshot({
    clip: { x: at.x - size / 2, y: at.y - size / 2, width: size, height: size },
  });
  return (await page.evaluate(`(async () => {
    const bin = atob('${png.toString('base64')}');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const g = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k];
    return sum.map((c) => c / (d.length / 4));
  })()`)) as [number, number, number];
}

const apart = (a: readonly number[], b: readonly number[]) =>
  Math.max(...a.map((c, i) => Math.abs(c - (b[i] ?? 0))));

/**
 * Opens a design of two rectangles under a budget of `bytes`. A rectangle keeps about 486 bytes:
 * about 254 of regions (its ID's length varies by a character or two) and 232 of fill.
 */
async function openTwoRectangles(page: Page, bytes: number, path: string) {
  await page.addInitScript(`window.__extrudoRegionBudget = ${bytes}`);
  const doc = createDocument({ name: 'Two rectangles' });
  doc.features.push(
    sketch('a', 'Sketch1', rectangle(-60, -20, -20, 20)),
    sketch('b', 'Sketch2', rectangle(20, -20, 60, 20)),
  );
  doc.timelineMarker = doc.features.length;
  writeFileSync(path, writeArchive(doc));
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…', exact: true }).click(),
  ]);
  await chooser.setFiles(path);
  await kernelReady(page);
  const viewport = page.getByRole('region', { name: 'Viewport' });
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await expect(viewport).toHaveAttribute('data-sketch-fills', /waiting=0$/);
  return viewport;
}

test('a sketch past the budget draws its curves, says so, and its region still picks', async ({
  page,
}, info) => {
  const viewport = await openTwoRectangles(page, 760, info.outputPath('two-rectangles.extrudo'));

  // The status bar says so, in words.
  const note = page.getByRole('status', { name: 'Sketches not shaded' });
  await expect(note).toHaveText('· 1 sketch not shaded');
  await expect(note).toHaveAttribute('data-unshaded-sketches', '1');
  await expect(note).toHaveAttribute('data-unpickable-sketches', '0');
  // Sketch1 is shaded; inside Sketch2 the view shows what lies around it, and its curves show.
  await page.mouse.move(5, 5);
  const at = await projector(viewport);
  const shaded = await meanColor(page, at([-40, 8, 0]));
  const unshaded = await meanColor(page, at([40, 8, 0]));
  const around = await meanColor(page, at([40, 32, 0]));
  expect(apart(shaded, around)).toBeGreaterThan(4);
  expect(apart(unshaded, around)).toBeLessThan(3);
  expect(apart(await meanColor(page, at([20, 8, 0])), around)).toBeGreaterThan(4);

  // Its region picks like any other, and a selected one is outlined.
  const edgeBefore = await meanColor(page, at([60, 8, 0]));
  await page.mouse.click(at([40, 8, 0]).x, at([40, 8, 0]).y);
  await expect(page.getByRole('status', { name: 'Selection' })).toHaveText('1 profile ·');
  await page.mouse.move(5, 5);
  await expect
    .poll(async () => apart(await meanColor(page, at([60, 8, 0])), edgeBefore))
    .toBeGreaterThan(4);
  // No fill came with the selection.
  expect(apart(await meanColor(page, at([40, 8, 0])), around)).toBeLessThan(3);
  await page.keyboard.press('Escape');

  // Hiding Sketch1 gives its share to Sketch2.
  await page
    .getByRole('complementary', { name: 'Browser' })
    .getByRole('button', { name: 'Hide Sketch1' })
    .click();
  await expect(note).toBeHidden();
  await page.mouse.move(5, 5);
  await expect
    .poll(async () => apart(await meanColor(page, at([40, 8, 0])), around))
    .toBeGreaterThan(4);
});

test("a sketch whose regions don't fit the budget can't be picked in the model, and says so", async ({
  page,
}, info) => {
  const viewport = await openTwoRectangles(page, 600, info.outputPath('two-rectangles.extrudo'));
  const note = page.getByRole('status', { name: 'Sketches not shaded' });
  await expect(note).toHaveText("· 1 sketch not shaded, 1 can't be picked");
  await expect(note).toHaveAttribute('data-unpickable-sketches', '1');

  // A click inside Sketch2 picks no profile there; inside Sketch1 it does.
  await page.mouse.move(5, 5);
  const at = await projector(viewport);
  await page.mouse.click(at([40, 8, 0]).x, at([40, 8, 0]).y);
  await expect(page.getByRole('status', { name: 'Selection' })).toHaveCount(0);
  await page.mouse.click(at([-40, 8, 0]).x, at([-40, 8, 0]).y);
  await expect(page.getByRole('status', { name: 'Selection' })).toHaveText('1 profile ·');
  await page.keyboard.press('Escape');

  // Hidden, Sketch1 leaves the budget to Sketch2, which picks and shades again.
  await page
    .getByRole('complementary', { name: 'Browser' })
    .getByRole('button', { name: 'Hide Sketch1' })
    .click();
  await expect(note).toBeHidden();
  await expect(viewport).toHaveAttribute('data-sketch-fills', 'shaded=1 unshaded=0 waiting=0');
  await page.mouse.click(at([40, 8, 0]).x, at([40, 8, 0]).y);
  await expect(page.getByRole('status', { name: 'Selection' })).toHaveText('1 profile ·');
});
