// The inch grid (P6-18 S2, ADR-0113 §2): in a design whose unit is inches the
// viewport grid and sketch snapping work in fractions of an inch and feet, so
// points drawn with snapping on land on the drawn lines; a metric design keeps
// the millimetre grid. Sketches store mm either way, so the check reads the
// stored document.
import { expect, type Page, test } from '@playwright/test';
import { clicker, counts, newSketchOnXY, openProject, saveStatus } from './helpers';

test.use({ viewport: { width: 1440, height: 900 } });

const status = (page: Page) => page.getByRole('status', { name: 'Status', exact: true });
const browser = (page: Page) => page.getByRole('complementary', { name: 'Browser' });

/** Opens the Document settings folder in the browser (a second click would close it). */
async function openSettingsFolder(page: Page) {
  const folder = browser(page).getByRole('button', { name: 'Document settings' });
  if ((await folder.getAttribute('aria-expanded')) !== 'true') await folder.click();
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
}

/** The points of every sketch in the stored document, in mm. */
async function storedPoints(page: Page): Promise<[number, number][]> {
  const id = page.url().split('/').pop() as string;
  return (await page.evaluate(`(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await (await root.getDirectoryHandle('projects')).getDirectoryHandle(${JSON.stringify(id)});
    const doc = JSON.parse(await (await (await dir.getFileHandle('document.json')).getFile()).text());
    const points = [];
    for (const feature of doc.features) {
      for (const input of Object.values(feature.inputs ?? {})) {
        if (input && input.kind === 'sketchData') {
          for (const entity of Object.values(input.sketch.entities)) {
            if (entity.type === 'point') points.push([entity.x, entity.y]);
          }
        }
      }
    }
    return points;
  })()`)) as [number, number][];
}

/** Draws one line with snapping on (the palette default) and waits for the save. */
async function drawSnappedLine(page: Page) {
  const at = await newSketchOnXY(page);
  const palette = page.getByRole('region', { name: 'Sketch palette' });
  await expect(palette.getByRole('checkbox', { name: 'Snap to grid' })).toBeChecked();
  await page.keyboard.press('l');
  const click = clicker(page, at);
  await click(-20, 30);
  await click(30, -10);
  await expect.poll(() => counts(page)).toMatchObject({ points: 2, lines: 1 });
  await page.keyboard.press('Escape');
  await expect(saveStatus(page)).toHaveText('Saved', { timeout: 20_000 });
}

test('an inch design draws on the inch grid, in sixteenths of an inch and up', async ({ page }) => {
  await openProject(page);
  await openSettingsFolder(page);
  await browser(page).getByRole('combobox', { name: 'Units' }).selectOption('in');
  await expect(status(page)).toHaveText('0 features · in');

  await drawSnappedLine(page);
  const points = await storedPoints(page);
  expect(points).toHaveLength(2);
  const sixteenth = 25.4 / 16;
  for (const [x, y] of points) {
    // On the drawn lines: whole multiples of the finest inch level…
    expect(Math.abs(x / sixteenth - Math.round(x / sixteenth))).toBeLessThan(1e-6);
    expect(Math.abs(y / sixteenth - Math.round(y / sixteenth))).toBeLessThan(1e-6);
    // …and not on the millimetre lattice the metric grid would have given:
    // no multiple of an inch level 1/16 and up is a whole mm within ±40 mm of
    // the origin (the first one sits at 127 mm).
    expect(Math.abs(x - Math.round(x))).toBeGreaterThan(1e-6);
    expect(Math.abs(y - Math.round(y))).toBeGreaterThan(1e-6);
  }
});

test('a mm design draws on the millimetre grid', async ({ page }) => {
  await openProject(page);
  await drawSnappedLine(page);
  const points = await storedPoints(page);
  expect(points).toHaveLength(2);
  for (const [x, y] of points) {
    expect(Math.abs(x - Math.round(x))).toBeLessThan(1e-6);
    expect(Math.abs(y - Math.round(y))).toBeLessThan(1e-6);
  }
});
