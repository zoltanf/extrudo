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

// The profiles of sketches that aren't open are found in a worker (ADR-0154). A sketch of two
// zigzag splines of 2,000 poles crossing each other takes the worker about a second; a design
// of six of them opens without that work on the page.

/** Two control splines of `poles` poles zigzagging across each other, `dx` mm to the right. */
function zigzags(poles: number, dx: number): SketchData {
  const entities: Record<string, unknown> = {};
  for (const phase of [0, 1]) {
    const ids: string[] = [];
    for (let i = 0; i < poles; i++) {
      const id = `p${phase}_${i}`;
      entities[id] = { type: 'point', x: dx + (100 * i) / (poles - 1), y: ((i + phase) % 2) * 5 };
      ids.push(id);
    }
    entities[`s${phase}`] = { type: 'spline', points: ids, mode: 'control', construction: false };
  }
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
  const path = info.outputPath('zigzags.extrudo');
  writeDesign(
    path,
    Array.from({ length: 6 }, (_, i) => sketch(`z${i}`, `Sketch${i + 1}`, zigzags(2000, i * 120))),
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
  // Where only the old plate was, nothing picks; inside the new one, the plate does.
  await page.mouse.click(at([100, 40, 0]).x, at([100, 40, 0]).y);
  await expect(page.getByRole('status', { name: 'Selection' })).toHaveCount(0);
  await page.mouse.click(at([30, 40, 0]).x, at([30, 40, 0]).y);
  await expect(page.getByRole('status', { name: 'Selection' })).toHaveText('1 profile ·');
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
  // A test may only shorten the deadline: 100 ms stops the zigzags, not the rectangle.
  await page.addInitScript('window.__extrudoProfilesDeadline = 100');
  const path = info.outputPath('mixed.extrudo');
  writeDesign(path, [
    sketch('z', 'Sketch1', zigzags(2000, 0)),
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
