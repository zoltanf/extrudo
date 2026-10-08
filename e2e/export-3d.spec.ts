import { readFile } from 'node:fs/promises';
import { type Download, expect, type Page, test } from '@playwright/test';
import { checkManifold, meshBounds, read3mf, readStl } from '../packages/io/src/index';
import { fileAction, kernelReady, openProject } from './helpers';

// P2-12: the model exports as 3MF (an object per body, named, in mm), binary
// STL and STEP AP242 from the 3D Print tab's Export, the Home tab or a
// body's menu. Mesh exports are tessellated in the kernel at a preset or
// custom resolution; every exported STL here passes the manifold check.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Export model' });
const summary = (page: Page) => dialog(page).locator('[data-export-summary]');

async function openExport(page: Page) {
  await page
    .getByRole('tablist', { name: 'Toolbar tabs' })
    .getByRole('tab', { name: '3D Print' })
    .click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}

async function save(page: Page, button: string): Promise<{ name: string; bytes: Buffer }> {
  const [download] = (await Promise.all([
    page.waitForEvent('download'),
    dialog(page).getByRole('button', { name: button }).click(),
  ])) as [Download, unknown];
  const path = await download.path();
  return { name: download.suggestedFilename(), bytes: await readFile(path) };
}

/** The triangle count the summary shows once meshing is done. */
async function triangles(page: Page): Promise<number> {
  await expect(summary(page)).toHaveAttribute('data-export-summary', /triangles.*watertight/, {
    timeout: 20_000,
  });
  const text = (await summary(page).getAttribute('data-export-summary')) ?? '';
  return Number(/([\d,]+) triangles/.exec(text)?.[1]?.replace(/,/g, ''));
}

const size = (b: ReturnType<typeof meshBounds>) =>
  b ? b.max.map((v, k) => Math.round(v - (b.min[k] as number))) : [];

test('the Wall bracket exports as 3MF, STL and STEP', async ({ page }) => {
  test.setTimeout(90_000);
  await openProject(page, 'wall-bracket');
  await kernelReady(page);

  // 3MF (the default): one object, the bracket, named and in millimetres.
  await openExport(page);
  await expect(dialog(page).getByRole('checkbox', { name: 'Bracket' })).toBeChecked();
  await expect(dialog(page).getByRole('radio', { name: /^3MF/ })).toBeChecked();
  const medium = await triangles(page);
  const threeMf = await save(page, 'Export 3MF');
  await expect(dialog(page)).toBeHidden();
  expect(threeMf.name).toBe('Wall bracket - Bracket.3mf');
  const model = read3mf(threeMf.bytes);
  expect(model.unit).toBe('millimeter');
  expect(model.parts.sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
  expect(model.objects.map((o) => [o.name, o.type])).toEqual([['Bracket', 'model']]);
  expect(model.build).toEqual([model.objects[0]?.id]);
  const object = model.objects[0]?.mesh;
  if (!object) throw new Error('no object');
  expect(checkManifold(object)).toMatchObject({ ok: true, triangles: medium });
  expect(size(meshBounds(object)).sort()).toEqual([40, 60, 80]);

  // STL at the Fine preset: more triangles, one closed and manifold mesh.
  await openExport(page);
  await dialog(page).getByRole('radio', { name: /^STL/ }).check();
  await dialog(page)
    .getByRole('radio', { name: /^Coarse/ })
    .check();
  const coarse = await triangles(page);
  await dialog(page).getByRole('radio', { name: /^Fine/ }).check();
  const fine = await triangles(page);
  expect(fine).toBeGreaterThan(coarse);
  const stl = await save(page, 'Export STL');
  expect(stl.name).toBe('Wall bracket - Bracket.stl');
  expect(stl.bytes.length).toBe(84 + 50 * fine);
  const { mesh, header } = readStl(new Uint8Array(stl.bytes));
  expect(header).toMatch(/^Extrudo .*: Wall bracket \(mm\)/);
  const report = checkManifold(mesh);
  expect(report).toMatchObject({
    ok: true,
    triangles: fine,
    boundaryEdges: 0,
    nonManifoldEdges: 0,
    misorientedEdges: 0,
  });
  expect(size(meshBounds(mesh)).sort()).toEqual([40, 60, 80]);

  // The dialog remembers the format and resolution; a custom deviation is checked.
  await openExport(page);
  await expect(dialog(page).getByRole('radio', { name: /^STL/ })).toBeChecked();
  await expect(dialog(page).getByRole('radio', { name: /^Fine/ })).toBeChecked();
  await dialog(page)
    .getByRole('radio', { name: /^Custom/ })
    .check();
  const deviation = dialog(page).getByRole('textbox', { name: 'Deviation' });
  await deviation.fill('0 mm');
  await deviation.press('Tab');
  await expect(dialog(page).getByRole('button', { name: 'Export STL' })).toBeEnabled();
  await expect(deviation).toHaveAccessibleDescription(/Between 0\.001 mm and 5\.000 mm/);
  await deviation.fill('0.2 mm');
  await deviation.press('Tab');
  expect(await triangles(page)).toBeLessThan(fine);

  // STEP: exact geometry, AP242, the body as a named product.
  await dialog(page).getByRole('radio', { name: /^STEP/ }).check();
  await expect(summary(page)).toHaveAttribute('data-export-summary', /1 body, exact geometry/);
  await expect(dialog(page).getByRole('radio', { name: /^Fine/ })).toHaveCount(0);
  const step = await save(page, 'Export STEP');
  expect(step.name).toBe('Wall bracket - Bracket.step');
  const text = step.bytes.toString('latin1');
  expect(text.startsWith('ISO-10303-21;')).toBe(true);
  expect(text).toContain('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF');
  expect(text).toContain("PRODUCT('Bracket','Bracket'");
  expect(text).toContain('SI_UNIT(.MILLI.,.METRE.)');
  expect(text.match(/MANIFOLD_SOLID_BREP/g)).toHaveLength(1);
});

test('a body menu and the Home tab open the export', async ({ page }) => {
  test.setTimeout(60_000);
  await openProject(page, 'wall-bracket');
  await kernelReady(page);

  // A body's menu picks that body.
  const browser = page.getByRole('complementary', { name: 'Browser' });
  await browser.getByRole('button', { name: 'Bracket', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Export…' }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('checkbox', { name: 'Bracket' })).toBeChecked();
  // With no body chosen there is nothing to export.
  await dialog(page).getByRole('checkbox', { name: 'Bracket' }).uncheck();
  await expect(summary(page)).toHaveAttribute('data-export-summary', 'Choose a body to export.');
  await expect(dialog(page).getByRole('button', { name: /^Export / })).toBeDisabled();
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(page)).toBeHidden();

  // The Home tab's Export Model.
  await fileAction(page, 'Export Model');
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('checkbox', { name: 'Bracket' })).toBeChecked();
});
