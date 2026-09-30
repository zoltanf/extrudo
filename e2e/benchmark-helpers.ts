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
import { kernelReady, pickTool, projector } from './helpers';

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

// Steps of the v0.3 benchmarks (B4, B5, B7: P3-14): model-mode picks in a
// settled view, primitives and dialogs filled with expressions, and parts of
// an exported mesh.

/** A world (mm) → page (px) mapping of the view. */
export type At = (p: readonly [number, number, number]) => { x: number; y: number };

/** Turns the view with a shortcut (`Shift+1` home, `Shift+3` bottom…), waits for it to settle and maps it. */
export async function turnView(page: Page, key: string): Promise<At> {
  await page.keyboard.press(key);
  await page.waitForTimeout(300);
  await settled(viewportOf(page));
  return projector(viewportOf(page));
}

/** Hovers a world point until the view reports `hover` under the pointer, then clicks there. */
export async function clickWhere(
  page: Page,
  at: At,
  p: readonly [number, number, number],
  hover: RegExp,
  dy = 0,
) {
  const { x, y } = at(p);
  // A move right after the view turned can go unanswered: nudge the pointer until it is.
  let nudge = 0;
  await expect
    .poll(async () => {
      await page.mouse.move(x, y + dy + (nudge++ % 2));
      return attr(viewportOf(page), 'data-model-hover');
    })
    .toMatch(hover);
  await page.mouse.click(x, y + dy + ((nudge - 1) % 2));
}

/** Clicks an edge at its world midpoint, a couple of pixels off (as the selection tests do). */
export const clickEdge = (page: Page, at: At, midpoint: readonly [number, number, number]) =>
  clickWhere(page, at, midpoint, /^edge:/, 2);

/** Clicks a plane's square (or whatever is in front) while a dialog's field picks planes. */
export async function clickAt(page: Page, at: At, p: readonly [number, number, number]) {
  const { x, y } = at(p);
  await page.mouse.move(x, y);
  await page.waitForTimeout(150);
  await page.mouse.click(x, y);
}

/** Hovers points along an origin axis until the view reports it, then clicks. */
export async function pickAxis(page: Page, at: At, axis: 'x' | 'y' | 'z', along: number[]) {
  const viewport = viewportOf(page);
  for (const t of along) {
    const p = at(axis === 'x' ? [t, 0, 0] : axis === 'y' ? [0, t, 0] : [0, 0, t]);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(150);
    if ((await viewport.getAttribute('data-model-hover')) === `axis:origin:${axis}`) {
      await page.mouse.click(p.x, p.y);
      return;
    }
  }
  throw new Error(`no point of the ${axis} axis can be picked`);
}

/** Fills a dialog's textboxes by their names (exact). */
export async function fill(dialog: Locator, fields: Record<string, string>) {
  for (const [name, value] of Object.entries(fields)) {
    await dialog.getByRole('textbox', { name, exact: true }).fill(value);
  }
}

/** Waits for a dialog's preview, presses OK and waits for the recompute. */
export async function ok(page: Page, dialog: Locator) {
  await expect(dialog).toHaveAttribute('data-preview-status', /^(ok|warning)$/, {
    timeout: 15_000,
  });
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
}

/** Opens a primitive from Solid › Create (`Box`, `Cylinder`…) and returns its dialog. */
export async function startPrimitive(page: Page, label: string) {
  await pickTool(page, label);
  const dialog = page.getByRole('region', { name: `${label} dialog` });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** A primitive on its default plane (XY) with its fields and operation, committed. */
export async function primitive(
  page: Page,
  label: string,
  fields: Record<string, string>,
  operation?: 'new-body' | 'join' | 'cut' | 'intersect',
) {
  const dialog = await startPrimitive(page, label);
  await fill(dialog, fields);
  if (operation) {
    await dialog.getByRole('combobox', { name: 'Operation' }).selectOption(operation);
  }
  await ok(page, dialog);
}

/** Renames a body in the browser's Bodies folder (F2 on its row). */
export async function renameBody(page: Page, from: string, to: string) {
  const browser = page.getByRole('complementary', { name: 'Browser' });
  await browser.getByRole('button', { name: from, exact: true }).focus();
  await page.keyboard.press('F2');
  const field = browser.getByRole('textbox', { name: `Rename ${from}` });
  await field.fill(to);
  await field.press('Enter');
  await expect(browser.getByRole('button', { name: to, exact: true })).toBeVisible();
}

/** The extent (size along x, y, z, and the lowest corner) of a mesh's nodes that pass `keep`. */
export function extentOf(
  mesh: TriangleMesh,
  keep: (x: number, y: number, z: number) => boolean = () => true,
) {
  type Vec3 = [number, number, number];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const p = mesh.positions;
  for (let i = 0; i + 2 < p.length; i += 3) {
    const v = [p[i] as number, p[i + 1] as number, p[i + 2] as number];
    if (!keep(v[0] as number, v[1] as number, v[2] as number)) continue;
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] as number, v[k] as number);
      max[k] = Math.max(max[k] as number, v[k] as number);
    }
  }
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return { min, max, size };
}

/** Back to the Solid tab (a model export leaves the 3D Print tab open). */
export async function solidTab(page: Page) {
  await page
    .getByRole('tablist', { name: 'Toolbar tabs' })
    .getByRole('tab', { name: 'Solid' })
    .click();
}
