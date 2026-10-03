import { expect, type Locator, type Page, test } from '@playwright/test';
import { clicker, counts, kernelReady, projector, sketchOnXY } from './helpers';

// P4-03: sketch text (ADR-0058). Shift+T places text on the sketch, the panel
// asks for the string, the font, the alignment and the height, and the letters
// come out as closed regions like any other profile: an extrude of a whole text
// sweeps its ink, one body per letter, and the letters' counters stay holes.
// Editing the string or the height dimension keeps the extrude computing.

test.use({ viewport: { width: 1440, height: 900 } });
// Two extrudes of seven letters each, an edit and a re-solve: about 30 s alone.
test.describe.configure({ timeout: 120_000 });

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
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });
const toolPrompt = (page: Page) => page.getByRole('status', { name: 'Tool prompt' });
const panel = (page: Page) => page.getByRole('region', { name: 'Text' });
const selection = (page: Page) => page.getByRole('region', { name: 'Selection' });

type Ink = { x: [number, number]; y: [number, number] };

/** The drawn texts' ink in sketch mm: "<sketchId>.<textId>:x=1.2..49.8:y=0..10". */
async function inks(page: Page): Promise<Record<string, Ink>> {
  const out: Record<string, Ink> = {};
  // The text's curves come with its font, so the attribute lands a moment later.
  await expect.poll(() => attr(viewportOf(page), 'data-text-bounds')).toContain('x=');
  for (const entry of (await attr(viewportOf(page), 'data-text-bounds')).split(' ')) {
    if (!entry) continue;
    const [id, xs, ys] = entry.split(':');
    const range = (v: string | undefined) =>
      (v?.slice(2) ?? '').split('..').map(Number) as [number, number];
    if (id && xs && ys) out[id] = { x: range(xs), y: range(ys) };
  }
  return out;
}

/** The only drawn text's ink, which every text here is. */
async function theInk(page: Page): Promise<Ink> {
  const [ink] = Object.values(await inks(page));
  if (!ink) throw new Error('no text drawn');
  return ink;
}

/** "Body1:14:6.2,10,2 Body2:22:6.6,7.5,2" as {name, faces, size: [x, y, z]}. */
async function bodies(page: Page): Promise<{ name: string; faces: number; size: number[] }[]> {
  return (await attr(viewportOf(page), 'data-bodies'))
    .split(' ')
    .filter(Boolean)
    .map((entry) => {
      const [name, faces, size] = entry.split(':');
      return { name: name ?? '', faces: Number(faces), size: (size ?? '').split(',').map(Number) };
    });
}

/** Waits until the camera has stopped moving. */
async function settled(viewport: Locator) {
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
 * A world-mm → page-px mapping for the settled camera (P2-03): an XY sketch's
 * sketch mm are world mm at z = 0, in either projection.
 */
async function worldMap(page: Page) {
  const viewport = viewportOf(page);
  await settled(viewport);
  return projector(viewport);
}

/** Every sketch-mm point inside a text's ink, a coarse grid from the middle out. */
function inkPoints(ink: Ink): [number, number][] {
  const [x0, x1] = ink.x;
  const [y0, y1] = ink.y;
  const out: [number, number][] = [];
  for (let y = (y0 + y1) / 2; y < y1; y += 1) {
    for (let x = (x0 + x1) / 2; x < x1; x += 1) out.push([x, y]);
  }
  for (let y = y0; y < (y0 + y1) / 2; y += 1) {
    for (let x = x0; x < (x0 + x1) / 2; x += 1) out.push([x, y]);
  }
  return out;
}

/**
 * A click in the model takes the whole text of whatever letter it lands on
 * (P4-03: one pick per text, however many glyph curves are there).
 */
async function pickTextInModel(page: Page, ink: Ink): Promise<void> {
  const viewport = viewportOf(page);
  const at = await worldMap(page);
  for (const [x, y] of inkPoints(ink)) {
    const p = at([x, y, 0]);
    await page.mouse.move(p.x, p.y);
    if (!/^sketchEntity:/.test(await attr(viewport, 'data-model-hover'))) continue;
    await page.mouse.click(p.x, p.y);
    await expect
      .poll(() => attr(viewport, 'data-model-selection'))
      .toMatch(/^sketchEntity:[^/]+\/[^/]+$/);
    return;
  }
  throw new Error('no letter under the pointer');
}

/** Clicks a letter in the open sketch, which selects the whole text. */
async function selectTextInSketch(page: Page, ink: Ink, expected: string): Promise<void> {
  const at = await worldMap(page);
  const field = selection(page).getByRole('textbox', { name: 'Text' });
  for (const [x, y] of inkPoints(ink)) {
    const p = at([x, y, 0]);
    await page.mouse.click(p.x, p.y);
    // The panel's Text field is there only for a picked text (a click on a
    // profile or a point of it shows something else).
    if ((await field.count()) > 0 && (await field.inputValue()) === expected) return;
  }
  throw new Error(`no text selected (wanted ${expected})`);
}

/** Shift+T, a click, the panel filled in and OK: one text at (x, y). */
async function placeText(
  page: Page,
  click: (x: number, y: number) => Promise<void>,
  text: string,
  options: { at?: [number, number]; font?: string; align?: 'Left' | 'Center' | 'Right' } = {},
) {
  const [x, y] = options.at ?? [0, 0];
  await page.keyboard.press('Shift+T');
  await expect(toolPrompt(page)).toHaveText('Click where the first line’s baseline starts.');
  await click(x, y);
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('textbox', { name: 'Text' }).fill(text);
  if (options.font) {
    await panel(page).getByRole('combobox', { name: 'Font' }).selectOption(options.font);
  }
  if (options.align) await panel(page).getByRole('button', { name: options.align }).click();
  await expect(panel(page).getByRole('textbox', { name: 'Height' })).toHaveValue('10 mm');
  await panel(page).getByRole('button', { name: 'OK' }).click();
  await expect(panel(page)).toHaveCount(0);
}

test('places text in a sketch and extrudes it into one body per letter', async ({ page }) => {
  const at = await sketchOnXY(page);
  const viewport = viewportOf(page);
  await placeText(page, clicker(page, at), 'Extrudo');

  // Two points (the anchor and the top), the upright constraint and the
  // incidence the click placed, and the height as a driving dimension.
  expect(await counts(page)).toMatchObject({
    points: 2,
    lines: 0,
    constraints: 2,
    dimensions: 1,
  });
  // Seven letters, with the counters of `d` and `o` as holes.
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=9 holes=2');
  // The letters lie on the sketch, up to the 10 mm of the height dimension.
  const ink = await theInk(page);
  expect(ink.y[1]).toBeCloseTo(10, 1);
  expect(ink.x[1] - ink.x[0]).toBeGreaterThan(20);

  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();
  await kernelReady(page);

  // In the model a click on any letter takes the whole text, so the extrude
  // sweeps every letter of it.
  await pickTextInModel(page, ink);
  await page.keyboard.press('e');
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Profiles', exact: true })).toHaveText('1 text');
  await dialog.getByRole('textbox', { name: 'Distance' }).fill('2 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 30_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(chip(page, 'Extrude1')).toHaveAccessibleName('Extrude1');

  // Seven bodies, one per letter, all 2 mm thick. `d` and `o` keep their
  // counter as a hole: front, back and two walls, four faces.
  const drawn = await bodies(page);
  expect(drawn).toHaveLength(7);
  for (const body of drawn) expect(body.size[2]).toBe(2);
  // A body is two caps and one side face per curve of its outline, so the `o`
  // (one curve for the ring, one for its counter) is the four-face one: the
  // counter is a hole through the letter, not a body of its own.
  expect(drawn.filter((b) => b.faces === 4)).toHaveLength(1);
});

test('editing the string and the height keeps the extrude computing', async ({ page }) => {
  const at = await sketchOnXY(page);
  await placeText(page, clicker(page, at), 'Extrudo');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);
  await pickTextInModel(page, await theInk(page));
  await page.keyboard.press('e');
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await dialog.getByRole('textbox', { name: 'Distance' }).fill('2 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 30_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await kernelReady(page);
  expect(await bodies(page)).toHaveLength(7);
  const before = Math.max(...(await bodies(page)).map((b) => b.size[1] as number));

  // Reopen the sketch: the extrude rolls back, and the text is still there.
  await chip(page, 'Sketch1').dblclick();
  await expect(page.getByRole('button', { name: 'Finish Sketch' }).last()).toBeVisible();
  await selectTextInSketch(page, await theInk(page), 'Extrudo');
  const field = selection(page).getByRole('textbox', { name: 'Text' });
  await expect(field).toBeVisible();
  // One more glyph: `!` is a bar over a dot, so the bodies grow with its ink.
  await field.fill('Extrudo!');
  await field.blur();
  await expect(field).toHaveValue('Extrudo!');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);
  // The extrude followed the edit, without an error.
  await expect(chip(page, 'Extrude1')).toHaveAccessibleName('Extrude1');
  const withMark = await bodies(page);
  expect(withMark.length).toBeGreaterThan(7);
  for (const body of withMark) expect(body.size[2]).toBe(2);

  // The height is a dimension on the text's own two points, so the letters grow
  // with it: 15 mm is 1.5 times 10.
  await chip(page, 'Sketch1').dblclick();
  await selectTextInSketch(page, await theInk(page), 'Extrudo!');
  const height = selection(page).getByRole('textbox', { name: 'Height' });
  await expect(height).toHaveValue('10 mm');
  await height.fill('15 mm');
  await height.blur();
  await expect(height).toHaveValue('15 mm');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);
  await expect(chip(page, 'Extrude1')).toHaveAccessibleName('Extrude1');
  const after = Math.max(...(await bodies(page)).map((b) => b.size[1] as number));
  expect(after / before).toBeGreaterThan(1.4);
  expect(after / before).toBeLessThan(1.6);
});

test('a centred text sits on its anchor, in any font', async ({ page }) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);
  await placeText(page, click, 'Ag', {
    font: 'allerta-stencil-regular@1',
    align: 'Center',
  });
  const stencil = await inks(page);
  await page.keyboard.press('Escape');
  // The same word in the default font, so the font choice can be seen to count.
  await placeText(page, click, 'Ag', { at: [0, 30], align: 'Center' });
  const both = Object.values(await inks(page));
  const [first, second] = both;
  if (!first || !second) throw new Error('no text drawn');

  // Centred: each ink straddles its anchor horizontally, which the clicks put
  // at (0, 0) and (0, 30), and both rise to the 10 mm of their height.
  expect(Math.abs((first.x[0] + first.x[1]) / 2)).toBeLessThan(1);
  expect(Math.abs((second.x[0] + second.x[1]) / 2)).toBeLessThan(1);
  expect(first.y[1]).toBeCloseTo(10, 1);
  expect(second.y[1]).toBeCloseTo(40, 1);
  // The two fonts draw `Ag` at their own widths (Allerta Stencil's is a little
  // wider here), so the pick really took.
  expect(Math.abs(first.x[1] - first.x[0] - (second.x[1] - second.x[0]))).toBeGreaterThan(0.5);
  expect(Object.keys(stencil)).toHaveLength(1);

  // The font and the alignment are stored, and the panel says so.
  await page.keyboard.press('Escape');
  await selectTextInSketch(page, second, 'Ag');
  await expect(selection(page).getByRole('combobox', { name: 'Font' })).toHaveValue(
    'inter-regular@1',
  );
  await expect(selection(page).getByRole('button', { name: 'Center' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
  await selectTextInSketch(page, first, 'Ag');
  await expect(selection(page).getByRole('combobox', { name: 'Font' })).toHaveValue(
    'allerta-stencil-regular@1',
  );
});

test('Esc closes the panel and cancels the text', async ({ page }) => {
  const at = await sketchOnXY(page);
  await page.keyboard.press('Shift+T');
  await expect(toolPrompt(page)).toHaveText('Click where the first line’s baseline starts.');
  await clicker(page, at)(0, 0);
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('textbox', { name: 'Text' }).fill('Nope');

  // The first Esc closes the panel and keeps the tool; nothing was placed.
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  expect(await counts(page)).toMatchObject({ points: 0, constraints: 0, dimensions: 0 });
  await expect(toolPrompt(page)).toHaveText('Click where the first line’s baseline starts.');
  // The second ends the tool, and the sketch is as it was.
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await expect(viewportOf(page)).not.toHaveAttribute('data-text-bounds', /\S/);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();
  await kernelReady(page);
  await expect(viewportOf(page)).not.toHaveAttribute('data-bodies', /\S/);
});

test('the Create menu and the palette offer the Text tool', async ({ page }) => {
  await sketchOnXY(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const item = page.getByRole('menuitem', { name: /^Text/ });
  await expect(item).toContainText('Shift+T');
  await item.click();
  await expect(toolPrompt(page)).toHaveText('Click where the first line’s baseline starts.');
  await page.keyboard.press('Escape');

  // The palette finds it in a sketch (ADR-0023: only this mode's tools are listed).
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('combobox', { name: 'Search commands' }).fill('text');
  await expect(palette.getByRole('option', { name: /^Text/ }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(toolPrompt(page)).toHaveText('Click where the first line’s baseline starts.');
});
