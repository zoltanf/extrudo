import { writeFile } from 'node:fs/promises';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { clicker, fileAction, kernelReady, projector, sketchOnXY } from './helpers';

// P4-03b: fonts the user brings to the design (ADR-0061). A font file picked
// with "Add font…" is stored with the design, so a text shaped with it has its
// letters here, after an export and import, and nothing says a font is
// missing. A file that isn't a readable font is refused and changes nothing.

test.use({ viewport: { width: 1440, height: 900 } });
// A sketch, a text, an extrude, an export and an import: about 40 s alone.
test.describe.configure({ timeout: 180_000 });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const viewportOf = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const attr = async (el: Locator, name: string) => (await el.getAttribute(name)) ?? '';
const panel = (page: Page) => page.getByRole('region', { name: 'Text' });
const font = (page: Page) => panel(page).getByRole('combobox', { name: 'Font' });
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });
/** A real bundled font file, added as if the user picked it from their disk. */
const FONT_FILE = 'packages/fonts/fonts/fredoka-semibold.ttf';

type Ink = { x: [number, number]; y: [number, number] };

/**
 * Waits until the camera has stopped moving. Returns the sketch-mm → page-px
 * mapping of a sketch on XY and, separately, the world-mm one (for picks in
 * the model, where the sketch's z is the model's).
 */
async function settledMaps(page: Page) {
  const viewport = viewportOf(page);
  let last = '';
  await expect
    .poll(async () => {
      const now = `${await attr(viewport, 'data-camera-size')} ${await attr(viewport, 'data-camera-target')}`;
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
  const world = await projector(viewport);
  return { world, sketch: (x: number, y: number) => world([x, y, 0]) };
}

/** The drawn text's ink in sketch mm: "<sketchId>.<textId>:x=1.2..9.8:y=0..10". */
async function theInk(page: Page): Promise<Ink> {
  const viewport = viewportOf(page);
  // The text's curves come with its font, so the attribute lands a moment later.
  await expect.poll(() => attr(viewport, 'data-text-bounds')).toContain('x=');
  const [, xs, ys] = (await attr(viewport, 'data-text-bounds')).split(' ')[0]?.split(':') ?? [];
  const range = (v: string | undefined) =>
    (v?.slice(2) ?? '').split('..').map(Number) as [number, number];
  if (!xs || !ys) throw new Error('no text drawn');
  return { x: range(xs), y: range(ys) };
}

/** "Body1:5:6.6,10,2" as {name, faces, size}. */
async function bodies(page: Page) {
  return (await attr(viewportOf(page), 'data-bodies'))
    .split(' ')
    .filter(Boolean)
    .map((entry) => {
      const [name, faces, size] = entry.split(':');
      return { name: name ?? '', faces: Number(faces), size: (size ?? '').split(',').map(Number) };
    });
}

/** Shift+T, a click on the sketch plane, then the panel with `text` in it. */
async function openTextPanel(page: Page, text: string) {
  await page.keyboard.press('Shift+T');
  const { sketch } = await settledMaps(page);
  await clicker(page, sketch)(0, 0);
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('textbox', { name: 'Text' }).fill(text);
}

/** The font ID "Add font…" settles on after `path` was given to the picker. */
async function addFont(page: Page, path: string): Promise<string> {
  const before = await font(page).inputValue();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    font(page).selectOption({ label: 'Add font…' }),
  ]);
  await chooser.setFiles(path);
  await expect(font(page)).not.toHaveValue(before);
  return font(page).inputValue();
}

/**
 * A click in the model takes the whole text of whatever letter it lands on
 * (ADR-0058: one pick per text, however many glyph curves there are).
 */
async function pickTextInModel(page: Page, ink: Ink): Promise<void> {
  const viewport = viewportOf(page);
  const at = (await settledMaps(page)).world;
  const [x0, x1] = ink.x;
  const [y0, y1] = ink.y;
  for (let y = (y0 + y1) / 2; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 0.5) {
      const p = at([x, y, 0]);
      await page.mouse.move(p.x, p.y);
      if (!/^sketchEntity:/.test(await attr(viewport, 'data-model-hover'))) continue;
      await page.mouse.click(p.x, p.y);
      await expect
        .poll(() => attr(viewport, 'data-model-selection'))
        .toMatch(/^sketchEntity:[^/]+\/[^/]+$/);
      return;
    }
  }
  throw new Error('no letter under the pointer');
}

test('a font added to the design shapes a text, and travels with the design', async ({
  page,
}, info) => {
  await sketchOnXY(page);
  const viewport = viewportOf(page);
  await openTextPanel(page, 'Hi');

  // The bundled fonts are offered, and "Add font…" asks for a font file.
  await expect(font(page).locator('option', { hasText: 'Inter Regular' })).toHaveCount(1);
  const id = await addFont(page, FONT_FILE);
  expect(id).toMatch(/^attachment:[0-9a-f-]+$/);
  // The design's own fonts are listed under their own group, named by the font
  // itself (this subset calls itself "Fredoka Light"), and the panel says
  // plainly where it lives.
  await expect(font(page).locator('optgroup[label="This design"] option')).toHaveText(
    'Fredoka Light',
  );
  await expect(panel(page).getByText('Saved inside this design')).toBeVisible();
  await expect(panel(page).getByText('licence allows embedding')).toBeVisible();

  await panel(page).getByRole('button', { name: 'OK' }).click();
  await expect(panel(page)).toHaveCount(0);

  // The letters came out as profiles: `H` and `i`, and `i`'s dot is ink of its
  // own, so there are three regions.
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=3 holes=0', {
    timeout: 30_000,
  });
  // They rise to the 10 mm of the height dimension.
  const ink = await theInk(page);
  expect(ink.y[1]).toBeGreaterThan(9);
  expect(ink.y[1]).toBeLessThan(11);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);

  // The text is picked whole, so the extrude sweeps every letter of it.
  await pickTextInModel(page, ink);
  await page.keyboard.press('e');
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Profiles', exact: true })).toHaveText('1 text');
  await dialog.getByRole('textbox', { name: 'Distance' }).fill('2 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 30_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await kernelReady(page);
  await expect(chip(page, 'Extrude1')).toHaveAccessibleName('Extrude1');
  // Three solids: `H`, `i`'s stem and `i`'s dot, which the font draws apart.
  const drawn = await bodies(page);
  expect(drawn).toHaveLength(3);
  for (const body of drawn) expect(body.size[2]).toBe(2);

  // The design carries the font: the exported file has it with the document.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    fileAction(page, 'Export .extrudo'),
  ]);
  const file = info.outputPath('with-font.extrudo');
  await download.saveAs(file);

  // Importing it as a new design: the font came with it, so the text still
  // has its letters and nothing says a font is missing.
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import .extrudo' }).click(),
  ]);
  await chooser.setFiles(file);
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await kernelReady(page);
  await expect(chip(page, 'Sketch1')).toHaveAccessibleName('Sketch1');
  await expect(chip(page, 'Extrude1')).toHaveAccessibleName('Extrude1');
  expect(await bodies(page)).toHaveLength(3);
  await expect(page.getByText(/font is missing from the file/)).toHaveCount(0);
  await expect(page.getByText(/which isn't available/)).toHaveCount(0);
});

test('a file that is not a font is refused, and the font stays', async ({ page }, info) => {
  await sketchOnXY(page);
  await openTextPanel(page, 'Hi');
  // A small text file with a font's name: the parser, not the picker, refuses it.
  const notAFont = info.outputPath('notes.ttf');
  await writeFile(notAFont, 'This is a note about the design, not a font.\n');

  const chosen = await font(page).inputValue();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    font(page).selectOption({ label: 'Add font…' }),
  ]);
  await chooser.setFiles(notAFont);
  await expect(page.getByRole('alert')).toContainText("This file isn't a font Extrudo can read");
  // Nothing was stored, so the select keeps the font it had.
  await expect(font(page)).toHaveValue(chosen);
  await expect(font(page).locator('optgroup[label="This design"] option')).toHaveCount(0);
  // And the text still draws with the bundled font: its letters are there.
  await panel(page).getByRole('button', { name: 'OK' }).click();
  const ink = await theInk(page);
  expect(ink.y[1]).toBeGreaterThan(9);
  expect(ink.x[1] - ink.x[0]).toBeGreaterThan(5);
  await expect(viewportOf(page)).toHaveAttribute('data-sketch-profiles', 'profiles=3 holes=0');
});
