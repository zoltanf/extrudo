import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Download, expect, type Locator, type Page } from '@playwright/test';
import {
  checkManifold,
  type MeshObject,
  meshBounds,
  read3mf,
  readStl,
  type TriangleMesh,
} from '../packages/io/src/index';

// Shared steps of the benchmark specs (B2, B3: requirements §7): user
// parameters, sketch views that clear the palette, camera settling, and the
// 3D Print export read back through `@extrudo/io`.

export const viewportOf = (page: Page) => page.getByRole('region', { name: 'Viewport' });
export const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });
export const toolPrompt = (page: Page) => page.getByRole('status', { name: 'Tool prompt' });
const parameters = (page: Page) => page.getByRole('dialog', { name: 'Parameters' });
const expression = (page: Page, name: string) =>
  parameters(page).getByRole('textbox', { name: `Expression of ${name}`, exact: true });

/** Selects bodies by name in the browser's Bodies folder: a click, then Shift-clicks for the rest. */
export async function selectBodies(page: Page, names: readonly string[]) {
  const browser = page.getByRole('complementary', { name: 'Browser' });
  const [first, ...rest] = names;
  if (first === undefined) return;
  await browser.getByRole('button', { name: first, exact: true }).click();
  for (const name of rest) {
    await browser.getByRole('button', { name, exact: true }).click({ modifiers: ['Shift'] });
  }
  for (const name of names) {
    await expect(browser.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
}

export const attr = async (el: Locator, name: string) => (await el.getAttribute(name)) ?? '';

export async function openParameters(page: Page) {
  await page.getByRole('button', { name: 'Parameters', exact: true }).click();
  await expect(parameters(page)).toBeVisible();
}

export async function closeParameters(page: Page) {
  await page.keyboard.press('Escape');
  await expect(parameters(page)).toHaveCount(0);
}

/** Adds a user parameter; its unit (the New parameter row's select) is Length unless `unit` says so. */
export async function addParameter(
  page: Page,
  name: string,
  value: string,
  unit: 'length' | 'angle' | 'unitless' = 'length',
) {
  await parameters(page).getByRole('textbox', { name: 'New parameter name' }).fill(name);
  await parameters(page).getByRole('combobox', { name: 'New parameter unit' }).selectOption(unit);
  await parameters(page).getByRole('textbox', { name: 'New parameter expression' }).fill(value);
  await parameters(page).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(expression(page, name)).toHaveValue(value);
}

/** Changes user parameters in the dialog, then closes it. */
export async function setParameters(page: Page, values: Record<string, string>) {
  await openParameters(page);
  for (const [name, value] of Object.entries(values)) {
    await expression(page, name).fill(value);
    await expression(page, name).press('Enter');
  }
  await closeParameters(page);
}

/** Waits until the camera has stopped moving. */
export async function settled(viewport: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const now = `${await attr(viewport, 'data-camera-size')} ${await attr(viewport, 'data-camera-target')} ${await attr(viewport, 'data-camera-direction')}`;
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
}

/**
 * Zooms out around a page point until the view is `size` mm tall, one wheel
 * step at a time (headless Chromium delivers wheel deltas unevenly), so that
 * a sketch clears the palette while the grid still snaps to 10 mm.
 */
export async function zoomOutTo(page: Page, at: { x: number; y: number }, size = 300) {
  const viewport = viewportOf(page);
  await page.mouse.move(at.x, at.y);
  const current = async () => Number(await viewport.getAttribute('data-camera-size'));
  for (let before = await current(); before < size; before = await current()) {
    await page.mouse.wheel(0, 100);
    await expect.poll(current).not.toBe(before);
  }
}

/** Turns to the home view and waits for it. */
export async function homeView(page: Page) {
  await page.keyboard.press('Shift+1');
  await page.waitForTimeout(300);
  await settled(viewportOf(page));
}

/** No timeline feature has a warning or an error. */
export async function expectNoProblems(page: Page) {
  await expect(page.locator('[data-feature-status]')).toHaveCount(0);
}

const exportDialog = (page: Page) => page.getByRole('dialog', { name: 'Export model' });

export interface Exported {
  name: string;
  bytes: Buffer;
}

/** Exports the model from the 3D Print tab as `format` ("3MF" or "STL") with the dialog's defaults. */
export async function exportModel(page: Page, format: '3MF' | 'STL'): Promise<Exported> {
  await page
    .getByRole('tablist', { name: 'Toolbar tabs' })
    .getByRole('tab', { name: '3D Print' })
    .click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = exportDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: new RegExp(`^${format}`) }).check();
  // The summary says "watertight" once the bodies are meshed.
  await expect(dialog.locator('[data-export-summary]')).toHaveAttribute(
    'data-export-summary',
    /triangles.*watertight/,
    { timeout: 20_000 },
  );
  const [download] = (await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: `Export ${format}` }).click(),
  ])) as [Download, unknown];
  await expect(exportDialog(page)).toBeHidden();
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

export interface MeshFacts {
  triangles: number;
  volume: number;
  /** Size along x, y and z, mm. */
  size: number[];
}

/** Checks that a mesh is one closed manifold solid and reports its size and volume. */
export function solidFacts(mesh: TriangleMesh): MeshFacts {
  const report = checkManifold(mesh);
  expect(report).toMatchObject({
    ok: true,
    boundaryEdges: 0,
    nonManifoldEdges: 0,
    misorientedEdges: 0,
    badTriangles: 0,
  });
  expect(report.triangles).toBeGreaterThan(0);
  const box = meshBounds(mesh);
  if (!box) throw new Error('empty mesh');
  return {
    triangles: report.triangles,
    volume: report.volume,
    size: box.max.map((v, k) => v - (box.min[k] as number)),
  };
}

/** The objects of a 3MF export (in millimetres, one per body). */
export function objectsOf3mf(file: Exported): MeshObject[] {
  const model = read3mf(file.bytes);
  expect(model.unit).toBe('millimeter');
  expect(model.build).toEqual(model.objects.map((o) => o.id));
  return model.objects;
}

/** The mesh of a binary STL export. */
export function meshOfStl(file: Exported): TriangleMesh {
  return readStl(new Uint8Array(file.bytes)).mesh;
}

export const round = (values: number[], digits = 3) => values.map((v) => Number(v.toFixed(digits)));

export async function renameProject(page: Page, name: string) {
  await page.getByRole('button', { name: /^Project name: / }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill(name);
  await page.getByRole('textbox', { name: 'Project name' }).press('Enter');
  await expect(page.getByRole('button', { name: `Project name: ${name}. Rename` })).toBeVisible();
}

/**
 * Exports the design as an `.extrudo` file from the File menu. With
 * `WRITE_FIXTURES=1` the file is also written to `fixtures/benchmarks/<file>`
 * (the fixtures the kernel tests recompute: `pnpm e2e` with that variable
 * set rewrites them; review the diff).
 */
export async function exportProject(page: Page, fixture: string): Promise<Buffer> {
  await page.getByRole('button', { name: 'File menu' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Export .extrudo' }).click(),
  ]);
  const bytes = await readFile(await download.path());
  // A zip archive.
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
  if (process.env.WRITE_FIXTURES) {
    // Playwright runs from the repository root.
    const dir = join(process.cwd(), 'fixtures', 'benchmarks');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fixture), bytes);
  }
  return bytes;
}
