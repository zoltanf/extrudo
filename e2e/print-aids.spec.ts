import { expect, type Locator, type Page, test } from '@playwright/test';
import { meshBounds } from '../packages/io/src/index';
import { exportModel, objectsOf3mf, primitive, solidTab } from './benchmark-helpers';
import { kernelReady, openProject, projector } from './helpers';

// P3-10: the 3D-print aids (FR-3DP-02..04, ADR-0048). Print Info gives a weight, a filament
// length and a cost from the exact volume, with the walls, infill and price a person prints
// with (P4-12's amendment to ADR-0048); the overhang analysis shades the faces that lean out
// (view state, counted in `data-overhang`); Place on Bed turns a flat face down onto the bed as
// a real, undoable feature that exports as it lies.

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const printTab = (page: Page) =>
  page.getByRole('tablist', { name: 'Toolbar tabs' }).getByRole('tab', { name: '3D Print' });

async function openPrintTab(page: Page) {
  await printTab(page).click();
}

const info = (page: Page) => page.getByRole('region', { name: 'Print Info' });
const overhangPanel = (page: Page) => page.getByRole('region', { name: 'Overhang Analysis' });
const row = (panel: Locator, name: string) => panel.locator(`[data-print-row="${name}"]`);

/** The number in "49.6 g", "9.98 m", "40.12 cm³". */
const numberOf = (text: string | null) => Number(/-?[\d.]+/.exec(text ?? '')?.[0]);

/** The overhang summary's fields: `faces`, `triangles`, `area`, `bed`. */
async function counts(viewport: Locator) {
  const text = (await viewport.getAttribute('data-overhang')) ?? '';
  const get = (name: string) => Number(new RegExp(`${name}=(-?[\\d.]+)`).exec(text)?.[1]);
  return { faces: get('faces'), triangles: get('triangles'), area: get('area'), bed: get('bed') };
}

/** Waits until the camera has stopped moving; returns a world → page mapping. */
async function settledProjector(viewport: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const values = await Promise.all(
        ['size', 'target', 'direction', 'shift'].map((k) =>
          viewport.getAttribute(`data-camera-${k}`),
        ),
      );
      const key = values.join(' ');
      const still = key === last;
      last = key;
      return still;
    })
    .toBe(true);
  return projector(viewport);
}

test('Print Info: weight and filament length for PLA and PETG, a custom density, 1.75 and 2.85 mm', async ({
  page,
}) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await expect(viewport).not.toHaveAttribute('data-overhang', /./);
  await openPrintTab(page);
  await page.getByRole('button', { name: /^Print Info/ }).click();
  const panel = info(page);
  await expect(panel).toHaveAttribute('data-print-state', 'ready', { timeout: 20_000 });
  await expect(panel.locator('[data-print-scope]')).toHaveAttribute('data-print-scope', 'shown');
  await expect(panel).toContainText('no supports');

  // Solid at 100 % infill, so the numbers are the ones P3-10 showed.
  await panel.getByRole('textbox', { name: 'Infill' }).fill('100');
  // PLA is the default: weight = volume × 1.24 g/cm³ (the volume is the kernel's exact one).
  await expect(panel.getByRole('combobox', { name: 'Material' })).toHaveValue('pla');
  const volume = numberOf(await row(panel, 'volume').textContent());
  expect(volume).toBeGreaterThan(5);
  expect(numberOf(await row(panel, 'printed').textContent())).toBeCloseTo(volume, 1);
  const pla = numberOf(await row(panel, 'weight').textContent());
  expect(Math.abs(pla - volume * 1.24)).toBeLessThan(0.15);
  const filament = numberOf(await row(panel, 'filament').textContent());
  expect(await row(panel, 'filament').textContent()).toMatch(/m$/);
  // 1.75 mm filament: the volume over the cross-section (π × 0.875²).
  expect(Math.abs(filament - (volume * 1000) / (Math.PI * 0.875 ** 2) / 1000)).toBeLessThan(0.05);

  // PETG is denser: the weight follows, the volume and the filament length don't.
  await panel.getByRole('combobox', { name: 'Material' }).selectOption('petg');
  await expect
    .poll(async () => numberOf(await row(panel, 'weight').textContent()))
    .toBeGreaterThan(pla);
  const petg = numberOf(await row(panel, 'weight').textContent());
  expect(Math.abs(petg - volume * 1.27)).toBeLessThan(0.15);
  expect(numberOf(await row(panel, 'volume').textContent())).toBe(volume);
  expect(numberOf(await row(panel, 'filament').textContent())).toBe(filament);

  // A density of your own is an expression.
  await panel.getByRole('combobox', { name: 'Material' }).selectOption('custom');
  await panel.getByRole('textbox', { name: 'Density' }).fill('2');
  await expect
    .poll(async () => Math.abs(numberOf(await row(panel, 'weight').textContent()) - volume * 2))
    .toBeLessThan(0.15);
  await panel.getByRole('textbox', { name: 'Density' }).fill('0');
  await expect(panel).toContainText('A density is more than 0');
  await panel.getByRole('textbox', { name: 'Density' }).fill('1.3');

  // 2.85 mm filament is (2.85 / 1.75)² = 2.65 times shorter.
  await panel.getByRole('radio', { name: '2.85 mm' }).check();
  await expect
    .poll(async () => numberOf(await row(panel, 'filament').textContent()))
    .toBeCloseTo(filament / (2.85 / 1.75) ** 2, 1);

  // The choice is remembered (the `print.material` preference): reopen the panel after a reload.
  await page.reload();
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await kernelReady(page);
  await openPrintTab(page);
  await page.getByRole('button', { name: /^Print Info/ }).click();
  await expect(info(page).getByRole('combobox', { name: 'Material' })).toHaveValue('custom');
  await expect(info(page).getByRole('radio', { name: '2.85 mm' })).toBeChecked();
  await expect(info(page).getByRole('textbox', { name: 'Infill' })).toHaveValue('100');
});

test('Print Info: walls and infill make the print lighter, and the cost follows the price', async ({
  page,
}) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await solidTab(page);
  await primitive(page, 'Box', { Length: '20', Width: '20', Height: '20' });
  await expect(viewport).toHaveAttribute('data-bodies', /Body1:6:20,20,20/);
  await openPrintTab(page);
  await page.getByRole('button', { name: /^Print Info/ }).click();
  const panel = info(page);
  await expect(panel).toHaveAttribute('data-print-state', 'ready', { timeout: 20_000 });

  // The cube is 8 cm³ of solid. Two walls of 0.45 mm over its 2400 mm² of surface take
  // 2160 mm³, and 15 % of the 5840 mm³ inside it is 876: 3.036 cm³ printed.
  const value = async (name: string) => numberOf(await row(panel, name).textContent());
  expect(await value('volume')).toBeCloseTo(8, 2);
  await expect.poll(async () => value('printed')).toBeCloseTo(3.04, 2);
  expect(await value('weight')).toBeCloseTo(3.76, 1);
  // π (0.875)² = 2.405 mm² of filament for every mm³ printed: 1262 mm, which the panel shows
  // in metres.
  const filament = await value('filament');
  expect(filament).toBeGreaterThan(1);
  expect(filament).toBeCloseTo(3036 / (Math.PI * 0.875 ** 2) / 1000, 2);
  // 3.76464 g of PLA at 25 per kg.
  expect(await value('cost')).toBeCloseTo(0.09, 2);
  // The price is currency-neutral: a plain number.
  expect(await row(panel, 'cost').textContent()).not.toMatch(/[$€£]/);

  // A price of your own, as an expression.
  await panel.getByRole('textbox', { name: 'Price per kg' }).fill('100');
  await expect.poll(async () => value('cost')).toBeCloseTo(0.38, 2);
  // Walls and line width: 4 walls of 0.6 mm is 5760 mm³ of skin, plus 15 % of the 2240 mm³
  // left inside it.
  await panel.getByRole('textbox', { name: 'Walls' }).fill('4');
  await panel.getByRole('textbox', { name: 'Line width' }).fill('0.6');
  await expect.poll(async () => value('printed')).toBeCloseTo(6.1, 2);
  // A whole count: 3.6 walls is 4, once the field has the value.
  await panel.getByRole('textbox', { name: 'Walls' }).fill('3.6');
  await panel.getByRole('textbox', { name: 'Walls' }).blur();
  await expect(panel.getByRole('textbox', { name: 'Walls' })).toHaveValue('4');

  // A value out of range is refused and the last one stands.
  await panel.getByRole('textbox', { name: 'Infill' }).fill('150');
  await expect(panel).toContainText('Between 0 % and 100 %');
  await panel.getByRole('textbox', { name: 'Infill' }).fill('100');
  await expect(panel.getByRole('textbox', { name: 'Infill' })).toHaveValue('100');
  // 100 % infill: the print is the solid part, whatever the walls.
  await expect.poll(async () => value('printed')).toBeCloseTo(8, 2);
  await expect.poll(async () => value('weight')).toBeCloseTo(9.92, 1);

  // These are preferences, not the design: Ctrl+Z reaches the Box (the last command) and
  // leaves the panel's settings alone.
  await panel.getByRole('textbox', { name: 'Infill' }).blur();
  await page.keyboard.press('Control+z');
  await expect(viewport).not.toHaveAttribute('data-bodies', /Body1/);
  await expect(panel.getByRole('textbox', { name: 'Infill' })).toHaveValue('100');
  await expect(panel.getByRole('textbox', { name: 'Price per kg' })).toHaveValue('100');
  await page.keyboard.press('Control+y');
  await expect(viewport).toHaveAttribute('data-bodies', /Body1:6:20,20,20/);

  // They survive a reload, unlike a session's panel.
  await page.reload();
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await kernelReady(page);
  await openPrintTab(page);
  await page.getByRole('button', { name: /^Print Info/ }).click();
  const again = info(page);
  await expect(again).toHaveAttribute('data-print-state', 'ready', { timeout: 20_000 });
  await expect(again.getByRole('textbox', { name: 'Infill' })).toHaveValue('100');
  await expect(again.getByRole('textbox', { name: 'Price per kg' })).toHaveValue('100');
  await expect(again.getByRole('textbox', { name: 'Walls' })).toHaveValue('4');
  expect(numberOf(await row(again, 'printed').textContent())).toBeCloseTo(8, 2);
});

test('Overhang analysis: shading counts follow the angle, the down direction and the bed', async ({
  page,
}) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await openPrintTab(page);
  await page.getByRole('button', { name: /^Overhang/ }).click();
  const panel = overhangPanel(page);
  await expect(panel).toHaveAttribute('data-overhang-state', 'on');
  await expect(viewport).toHaveAttribute('data-overhang', /^down=-z angle=45 faces=/);
  const browser = page.getByRole('complementary', { name: 'Browser' });
  await expect(browser.locator('[data-overhang-row="on"]')).toHaveText(/Overhangs · -Z · 45°/);

  // The default: the bed is the lowest level of the model; faces on it are not overhangs.
  const at45 = await counts(viewport);
  expect(at45.bed).toBeGreaterThan(0);

  // A limit of 0° flags every face that leans out at all: at least what 45° flags, and the
  // rounded corner's lower half.
  const angle = panel.getByRole('textbox', { name: 'Angle', exact: true });
  await angle.fill('0 deg');
  await expect(viewport).toHaveAttribute('data-overhang', /angle=0 /);
  const at0 = await counts(viewport);
  expect(at0.triangles).toBeGreaterThanOrEqual(at45.triangles);
  expect(at0.area).toBeGreaterThanOrEqual(at45.area);
  // 90° flags nothing, and an angle outside 0…90° isn't taken.
  await angle.fill('90 deg');
  await expect(viewport).toHaveAttribute('data-overhang', /angle=90 faces=0 triangles=0 area=0 /);
  await angle.fill('120 deg');
  await expect(panel).toContainText('Between');
  await expect(viewport).toHaveAttribute('data-overhang', /angle=90 /);
  await angle.fill('45 deg');
  expect(await counts(viewport)).toEqual(at45);

  // The angle is an expression: a shorter way to 45°.
  await angle.fill('90 deg / 2');
  await expect(viewport).toHaveAttribute('data-overhang', /angle=45 /);

  // The down direction: with +Z down the bed is the top of the bracket.
  await panel.getByRole('combobox', { name: 'Down' }).selectOption('+z');
  await expect(viewport).toHaveAttribute('data-overhang', /^down=\+z /);
  expect((await counts(viewport)).bed).toBeGreaterThan(0);
  await panel.getByRole('combobox', { name: 'Down' }).selectOption('-z');

  // Off: no counts, the browser row dims; on again brings the same numbers back.
  await panel.getByRole('checkbox', { name: 'Show overhangs' }).uncheck();
  await expect(viewport).toHaveAttribute('data-overhang', /^down=-z angle=45 off$/);
  await expect(browser.locator('[data-overhang-row="off"]')).toBeVisible();
  await browser.getByRole('button', { name: 'Show overhang' }).click();
  await expect(viewport).toHaveAttribute('data-overhang', /faces=/);
  expect(await counts(viewport)).toEqual(at45);

  // It works with a section on: the cut doesn't change the analysis of the model.
  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(panel).toBeHidden();
  await page.getByRole('tab', { name: 'Solid' }).click();
  await page.getByRole('button', { name: /^Section/ }).click();
  await page
    .getByRole('region', { name: 'Section Analysis' })
    .getByRole('button', { name: 'XY plane' })
    .click();
  await expect(viewport).toHaveAttribute('data-section-clip', /./);
  expect(await counts(viewport)).toEqual(at45);
  await page
    .getByRole('region', { name: 'Section Analysis' })
    .getByRole('button', { name: 'Remove' })
    .click();

  // Remove ends the analysis (from the browser row's menu).
  await browser.locator('[data-overhang-row]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(viewport).not.toHaveAttribute('data-overhang', /./);
  await expect(browser.locator('[data-overhang-row]')).toHaveCount(0);
});

// The shading is a shader patch, so the counts above can't see it: a screenshot of the bracket
// with +Z as down, the faces that lean out in red (P3-17). Like the
// section's, the image comes from CI's Playwright image (`--update-snapshots=all` in docker).
test('Overhang shading: the faces that lean out are red (screenshot)', async ({ page }) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await openPrintTab(page);
  await page.getByRole('button', { name: /^Overhang/ }).click();
  await expect(viewport).toHaveAttribute('data-overhang', /faces=[1-9]/);
  // With +Z as down every upward face leans out: the shading is plain to see from the home view.
  await overhangPanel(page).getByRole('combobox', { name: 'Down' }).selectOption('+z');
  await expect(viewport).toHaveAttribute('data-overhang', /^down=\+z /);
  await overhangPanel(page).getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('Shift+1');
  await settledProjector(viewport);
  await page.mouse.move(0, 0);
  await page.evaluate('document.fonts.ready.then(() => true)');
  await expect(viewport).toHaveScreenshot('overhang-shading.png', {
    animations: 'disabled',
    caret: 'hide',
  });
});

test('Place on Bed: a face goes down as an undoable feature, and the export follows', async ({
  page,
}) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  const bodies = () => viewport.getAttribute('data-bodies');
  await expect.poll(bodies).toBe('Bracket:12:40,80,60');

  // Pick the outside of the wall (x = 0, 80 × 60 mm) in the Left view.
  await page.keyboard.press('Shift+6');
  const at = await settledProjector(viewport);
  const point = at([0, 0, 30]);
  await page.mouse.move(point.x, point.y);
  await expect(viewport).toHaveAttribute('data-model-hover', /^face:/);
  await page.mouse.click(point.x, point.y);
  await expect(viewport).toHaveAttribute('data-model-selection', /^face:/);

  // The 3D Print tab's Place on Bed starts with the face picked; the preview is the result.
  await openPrintTab(page);
  await page.getByRole('button', { name: /^Place on Bed/ }).click();
  const dialog = page.getByRole('region', { name: 'Place on Bed dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Face', exact: true })).toContainText('1 face');
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
  await expect(dialog).toHaveAttribute('data-preview-status', /^(ok|warning)$/);
  await page.getByRole('button', { name: /^OK/ }).click();
  await expect(dialog).toBeHidden();

  // The bracket lies on that face: 40 mm tall now (its depth), 60 along X (its old height).
  const chipName = /^Place on Bed1/;
  await expect(
    page.getByRole('list', { name: 'Features' }).getByRole('button', { name: chipName }),
  ).toBeVisible();
  await expect.poll(bodies).toBe('Bracket:12:60,80,40');

  // The export is the model as it lies: the mesh sits on z = 0 with the face down.
  const file = await exportModel(page, '3MF');
  const [object] = objectsOf3mf(file);
  const box = meshBounds(
    object?.mesh ?? { positions: new Float64Array(), indices: new Uint32Array() },
  );
  expect(box?.min[2]).toBeCloseTo(0, 2);
  expect(box?.max[2]).toBeGreaterThan(1);

  // The overhang analysis agrees the part now stands on a face: faces lie on the bed.
  await openPrintTab(page);
  await page.getByRole('button', { name: /^Overhang/ }).click();
  await expect(viewport).toHaveAttribute('data-overhang', /^down=-z angle=45 faces=/);
  expect((await counts(viewport)).bed).toBeGreaterThan(0);
  await page
    .getByRole('region', { name: 'Overhang Analysis' })
    .getByRole('button', { name: 'Remove' })
    .click();

  // One undo takes the feature away and the bracket stands as before; redo lays it down again.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect.poll(bodies).toBe('Bracket:12:40,80,60');
  await expect(
    page.getByRole('list', { name: 'Features' }).getByRole('button', { name: chipName }),
  ).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect.poll(bodies).toBe('Bracket:12:60,80,40');
});

test('Overhangs take a picked face as down, and Place on Bed spins the part (P3-17)', async ({
  page,
}) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  const bodies = () => viewport.getAttribute('data-bodies');
  await expect.poll(bodies).toBe('Bracket:12:40,80,60');

  // The outside of the wall, selected before any tool starts.
  await page.keyboard.press('Shift+6');
  const at = await settledProjector(viewport);
  const point = at([0, 0, 30]);
  await page.mouse.move(point.x, point.y);
  await expect(viewport).toHaveAttribute('data-model-hover', /^face:/);
  await page.mouse.click(point.x, point.y);
  await expect(viewport).toHaveAttribute('data-model-selection', /^face:/);

  // Overhangs: "Use selected face" makes its outward direction (-X) the way down.
  await openPrintTab(page);
  await page.getByRole('button', { name: /^Overhang/ }).click();
  const panel = overhangPanel(page);
  await expect(viewport).toHaveAttribute('data-overhang', /^down=-z /);
  const useFace = panel.getByRole('button', { name: 'Use selected face' });
  await expect(useFace).toBeEnabled();
  await useFace.click();
  await expect(viewport).toHaveAttribute('data-overhang', /^down=face\(-1,0,0\) angle=45 faces=/);
  await expect(panel.getByRole('combobox', { name: 'Down' })).toHaveValue('face');
  // The face is the bed now: it is bed contact, not an overhang.
  expect((await counts(viewport)).bed).toBeGreaterThan(0);
  const browser = page.getByRole('complementary', { name: 'Browser' });
  await expect(browser.locator('[data-overhang-row="on"]')).toHaveText(/Overhangs · Face · 45°/);
  // An axis from the list replaces the face.
  await panel.getByRole('combobox', { name: 'Down' }).selectOption('-z');
  await expect(viewport).toHaveAttribute('data-overhang', /^down=-z /);
  await expect(panel.getByRole('combobox', { name: 'Down' })).toHaveValue('-z');
  await panel.getByRole('button', { name: 'Remove' }).click();

  // Place on Bed with a Spin: the bracket lies on the wall, then turns 90° about the vertical.
  await openPrintTab(page);
  await page.getByRole('button', { name: /^Place on Bed/ }).click();
  const dialog = page.getByRole('region', { name: 'Place on Bed dialog' });
  await expect(dialog.getByRole('button', { name: 'Face', exact: true })).toContainText('1 face');
  await dialog.getByRole('textbox', { name: 'Spin', exact: true }).fill('90 deg');
  await expect(dialog).toHaveAttribute('data-preview-status', /^(ok|warning)$/);
  await page.getByRole('button', { name: /^OK/ }).click();
  await expect(dialog).toBeHidden();
  // 60 along X and 80 along Y without the spin: the spin swaps them.
  await expect.poll(bodies).toBe('Bracket:12:80,60,40');
});

test('Place on Bed is in the context list of a flat face', async ({ page }) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await page.keyboard.press('Shift+6');
  const at = await settledProjector(viewport);
  const point = at([0, 0, 30]);
  await page.mouse.move(point.x, point.y);
  await expect(viewport).toHaveAttribute('data-model-hover', /^face:/);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  const entry = page.locator('[data-marking-entry="placeOnBed"]');
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page.getByRole('region', { name: 'Place on Bed dialog' })).toBeVisible();
});
