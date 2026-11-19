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

// A design's sketch fills share a budget (ADR-0020's amendment of 2026-11-19). The real one
// takes millions of vertices, so the test sets a small one through `__extrudoFillBudget`: a
// rectangle's fill takes 6 vertices, so two rectangles under a budget of 6 leave the second
// with its curves only.

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

test('a sketch past the fill budget draws its curves, says so, and its region still picks', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    window.__extrudoFillBudget = 6;
  });
  const doc = createDocument({ name: 'Two rectangles' });
  doc.features.push(
    sketch('a', 'Sketch1', rectangle(-60, -20, -20, 20)),
    sketch('b', 'Sketch2', rectangle(20, -20, 60, 20)),
  );
  doc.timelineMarker = doc.features.length;
  const file = info.outputPath('two-rectangles.extrudo');
  writeFileSync(file, writeArchive(doc));
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…', exact: true }).click(),
  ]);
  await chooser.setFiles(file);
  await kernelReady(page);
  const viewport = page.getByRole('region', { name: 'Viewport' });
  await expect(viewport).toHaveAttribute('data-ready', 'true');

  // The status bar says so, in words.
  const note = page.getByRole('status', { name: 'Sketches not shaded' });
  await expect(note).toHaveText('· 1 sketch not shaded');
  await expect(note).toHaveAttribute('data-unshaded-sketches', '1');

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
