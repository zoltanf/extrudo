import { readFileSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import {
  createDocument,
  type Feature,
  type FeatureId,
  type SketchData,
  sketchInputs,
} from '../packages/core/src/index';
import { readArchive, writeArchive } from '../packages/storage/src/archive';
import { kernelReady, parameterExpression, pickTool, projector } from './helpers';

// The profiles of sketches that aren't open are found in a worker (ADR-0154). A design of six
// sketches that take the worker about a second each opens without that work on the page.

/**
 * A sketch that takes the worker about a second and draws little: a grid of 100 × 100 lines
 * (9,801 regions) beside 1,400 parallel lines whose boxes all overlap, `dx` mm to the right.
 */
function heavy(dx: number): SketchData {
  const entities: Record<string, unknown> = {};
  let n = 0;
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const id = `${n++}`;
    entities[`a${id}`] = { type: 'point', x: x0, y: y0 };
    entities[`b${id}`] = { type: 'point', x: x1, y: y1 };
    entities[`l${id}`] = { type: 'line', start: `a${id}`, end: `b${id}`, construction: false };
  };
  for (let i = 0; i < 100; i++) line(dx - 1, i + 0.5, dx + 101, i + 0.5);
  for (let i = 0; i < 100; i++) line(dx + i + 0.5, -1, dx + i + 0.5, 101);
  for (let i = 0; i < 1400; i++) line(dx + 120 + i * 0.02, 0, dx + 220 + i * 0.02, 100);
  return { entities, constraints: {}, dimensions: {} } as unknown as SketchData;
}

/** A rectangle's corners and lines. */
function rectangle(x0: number, y0: number, x1: number, y1: number): SketchData {
  const c = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ] as const;
  const entities: Record<string, unknown> = {};
  c.forEach(([x, y], i) => {
    const [nx, ny] = c[(i + 1) % 4] as readonly [number, number];
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

async function importDesign(page: Page, path: string) {
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…', exact: true }).click(),
  ]);
  await chooser.setFiles(path);
  const viewport = page.getByRole('region', { name: 'Viewport' });
  await expect(viewport).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  return viewport;
}

function writeDesign(path: string, features: Feature[]) {
  const doc = createDocument({ name: 'Profiles' });
  doc.features.push(...features);
  doc.timelineMarker = doc.features.length;
  writeFileSync(path, writeArchive(doc));
}

test('a design of heavy sketches opens without profile work on the page, and every fill arrives', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const long: number[] = [];
    (window as unknown as { __long: number[] }).__long = long;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) long.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
  });
  const path = info.outputPath('heavy.extrudo');
  writeDesign(
    path,
    Array.from({ length: 6 }, (_, i) => sketch(`z${i}`, `Sketch${i + 1}`, heavy(i * 300))),
  );
  const viewport = await importDesign(page, path);
  // While the worker is at it for more than a moment, the status bar says so.
  await expect(page.getByRole('status', { name: 'Finding profiles' })).toContainText(
    /Finding profiles \d of 6…/,
  );
  await expect(viewport).toHaveAttribute('data-sketch-fills', 'shaded=6 unshaded=0 waiting=0', {
    timeout: 90_000,
  });
  await expect(page.getByRole('status', { name: 'Finding profiles' })).toHaveCount(0);
  const longest = await page.evaluate(() =>
    Math.max(0, ...(window as unknown as { __long: number[] }).__long),
  );
  // Six detections of about a second each would block the page for seconds on end.
  expect(longest).toBeLessThan(1500);
});

test('a quick design never says it is finding profiles', async ({ page }, info) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __seen: string[] }).__seen = seen;
    new MutationObserver(() => {
      if (document.querySelector('[data-finding-profiles]')) seen.push('finding');
    }).observe(document, { subtree: true, childList: true });
  });
  const path = info.outputPath('rectangles.extrudo');
  writeDesign(path, [
    sketch('a', 'Sketch1', rectangle(0, 0, 40, 20)),
    sketch('b', 'Sketch2', rectangle(60, 0, 100, 20)),
  ]);
  const viewport = await importDesign(page, path);
  await expect(viewport).toHaveAttribute('data-sketch-fills', 'shaded=2 unshaded=0 waiting=0');
  await kernelReady(page);
  expect(await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen)).toEqual([]);
});

test('an edit while the sketch is in the worker never shows the old regions', async ({ page }) => {
  // Every answer of the worker waits 1.5 s, so the edit lands while the first job runs.
  await page.addInitScript('window.__extrudoProfilesDelay = 1500');
  const b1 = readArchive(readFileSync('fixtures/benchmarks/b1-plate.extrudo')).doc;
  writeFileSync(test.info().outputPath('b1.extrudo'), writeArchive(b1));
  const viewport = await importDesign(page, test.info().outputPath('b1.extrudo'));
  await kernelReady(page);
  // The plate is 120 mm wide; make it 60 mm before the worker answers.
  await pickTool(page, 'Parameters');
  const width = await parameterExpression(page, 'width');
  await width.fill('60 mm');
  await width.press('Enter');
  await page.keyboard.press('Escape');
  await expect(viewport).toHaveAttribute('data-sketch-fills', 'shaded=1 unshaded=0 waiting=0', {
    timeout: 20_000,
  });
  await page.mouse.move(5, 5);
  const at = await projector(viewport);
  // The old plate covered x = 10 and x = 110; the new one, 60 mm wide, covers one of them,
  // whichever side the solver kept. Old regions would pick at both.
  const picks = async (x: number) => {
    await page.mouse.click(at([x, 40, 0]).x, at([x, 40, 0]).y);
    const n = await page.getByRole('status', { name: 'Selection' }).count();
    await page.keyboard.press('Escape');
    await page.mouse.move(5, 5);
    return n;
  };
  expect((await picks(10)) + (await picks(110))).toBe(1);
});

test('without a worker the UI thread finds the profiles, and fills still appear', async ({
  page,
}, info) => {
  await page.addInitScript('window.__extrudoNoProfilesWorker = true');
  const path = info.outputPath('rectangles.extrudo');
  writeDesign(path, [
    sketch('a', 'Sketch1', rectangle(0, 0, 40, 20)),
    sketch('b', 'Sketch2', rectangle(60, 0, 100, 20)),
  ]);
  const viewport = await importDesign(page, path);
  await expect(viewport).toHaveAttribute('data-sketch-fills', 'shaded=2 unshaded=0 waiting=0');
});

test('a sketch past the deadline is stopped, the others go on, and the status bar says so', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  // A test may only shorten the deadline: 100 ms stops the heavy sketch, not the rectangle.
  await page.addInitScript('window.__extrudoProfilesDeadline = 100');
  const path = info.outputPath('mixed.extrudo');
  writeDesign(path, [
    sketch('z', 'Sketch1', heavy(0)),
    sketch('a', 'Sketch2', rectangle(0, 20, 40, 40)),
  ]);
  const viewport = await importDesign(page, path);
  await expect(viewport).toHaveAttribute('data-sketch-fills', 'shaded=1 unshaded=1 waiting=0', {
    timeout: 30_000,
  });
  await expect(page.getByRole('status', { name: 'Sketches not shaded' })).toHaveText(
    "· 1 sketch not shaded, 1 can't be picked",
  );
});
