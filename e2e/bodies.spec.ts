import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  clicker,
  kernelReady,
  mapping,
  newSketchOnXY,
  openProject,
  projector,
  sketchOnXY,
} from './helpers';

// P2-08: bodies (ADR-0030). The browser's Bodies folder renames, hides,
// colours and removes bodies (a Remove feature, undoable), with a count
// badge; a cut that splits a body makes two; wireframe and hidden-edge
// styles draw the silhouettes of curved faces.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const attr = async (el: Locator, name: string) => (await el.getAttribute(name)) ?? '';
const browserOf = (page: Page) => page.getByRole('complementary', { name: 'Browser' });
const bodyRow = (page: Page, name: string) =>
  browserOf(page).getByRole('button', { name, exact: true });
/** The body's list-item row (its `data-body`/`data-body-display` live there, not on the name). */
const bodyLeaf = (page: Page, name: string) =>
  browserOf(page)
    .locator('[data-body]')
    .filter({ has: page.getByRole('button', { name, exact: true }) });
const badge = (page: Page) => browserOf(page).locator('[data-folder-count]');
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });

/**
 * The text of a toast lying over the open dialog's OK button, if any. The
 * toasts sit in the view's bottom-right corner and live 12 seconds, so one
 * covering the button swallows the click on it (P4-11).
 */
const toastOnOk = (page: Page) =>
  page.evaluate(`(() => {
    const ok = [...document.querySelectorAll('[data-feature-dialog] button')]
      .find((b) => b.textContent.startsWith('OK'));
    const box = ok?.getBoundingClientRect();
    if (!box) return 'no OK button';
    const over = [...document.querySelectorAll('[role="status"],[role="alert"]')].find((t) => {
      const r = t.getBoundingClientRect();
      return r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
    });
    return over?.textContent ?? null;
  })()`) as Promise<string | null>;

/** Waits until the camera has stopped moving, then maps sketch mm (on XY) to page px. */
async function still(viewport: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const now = `${await attr(viewport, 'data-camera-size')} ${await attr(viewport, 'data-camera-target')} ${await attr(viewport, 'data-camera-direction')}`;
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
  return mapping(viewport);
}

async function visualStyle(page: Page, style: string) {
  await page.getByRole('button', { name: 'Visual style' }).click();
  await page.getByRole('menuitemradio', { name: style, exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}

test('renames, hides, colours and removes a body from the browser', async ({ page }) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Bracket:12:40,80,60');
  await expect(badge(page)).toHaveText('1');

  // F2 renames; the name is stored, so it survives a reload.
  await bodyRow(page, 'Bracket').focus();
  await page.keyboard.press('F2');
  const field = browserOf(page).getByRole('textbox', { name: 'Rename Bracket' });
  await field.fill('Mount');
  await field.press('Enter');
  await expect(viewport).toHaveAttribute('data-bodies', 'Mount:12:40,80,60');
  await page.reload();
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Mount:12:40,80,60');

  // The eye cycles shown → ghost → hidden → shown (ADR-0030's amendment).
  await expect(bodyLeaf(page, 'Mount')).toHaveAttribute('data-body-display', 'shown');
  await browserOf(page).getByRole('button', { name: 'Show as ghost Mount' }).click();
  await expect(viewport).not.toHaveAttribute('data-bodies');
  await expect(viewport).toHaveAttribute('data-ghost-bodies', 'Mount');
  await expect(bodyLeaf(page, 'Mount')).toHaveAttribute('data-body-display', 'ghost');
  await browserOf(page).getByRole('button', { name: 'Hide Mount' }).click();
  await expect(viewport).not.toHaveAttribute('data-ghost-bodies');
  await expect(bodyLeaf(page, 'Mount')).toHaveAttribute('data-body-display', 'hidden');
  await browserOf(page).getByRole('button', { name: 'Show Mount' }).click();
  await expect(viewport).toHaveAttribute('data-bodies', 'Mount:12:40,80,60');
  await expect(bodyLeaf(page, 'Mount')).toHaveAttribute('data-body-display', 'shown');

  // Appearance from the body's menu: a colour and an opacity, each one undo step.
  await bodyRow(page, 'Mount').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Appearance…' }).click();
  const panel = page.getByRole('dialog', { name: 'Mount appearance' });
  await panel.getByRole('radio', { name: 'Blue' }).check();
  await expect(viewport).toHaveAttribute('data-body-appearance', 'Mount:#5b7cff:1');
  await panel.getByRole('radio', { name: '50 %' }).check();
  await expect(viewport).toHaveAttribute('data-body-appearance', 'Mount:#5b7cff:0.5');
  await page.screenshot({ path: test.info().outputPath('blue-half.png') });
  // Any colour by its hex code (P3-17): one more undo step; no swatch is checked then.
  const hex = panel.getByRole('textbox', { name: 'Hex colour' });
  await hex.fill('#12AB9');
  await hex.press('Enter');
  await expect(hex).toHaveAttribute('aria-invalid', 'true');
  await expect(viewport).toHaveAttribute('data-body-appearance', 'Mount:#5b7cff:0.5');
  await hex.fill('#12ab90');
  await hex.press('Enter');
  await expect(viewport).toHaveAttribute('data-body-appearance', 'Mount:#12ab90:0.5');
  await expect(panel.getByRole('radio', { name: 'Blue' })).not.toBeChecked();
  await expect(panel.getByLabel('Custom colour')).toHaveAttribute('data-custom-colour', 'true');
  // (Ctrl+Z in a text field is the field's own undo.)
  await hex.blur();
  await page.keyboard.press('Control+z');
  await expect(viewport).toHaveAttribute('data-body-appearance', 'Mount:#5b7cff:0.5');
  await panel.getByRole('radio', { name: '50 %' }).focus();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.keyboard.press('Control+z');
  await expect(viewport).toHaveAttribute('data-body-appearance', 'Mount:#5b7cff:1');

  // A click on the row selects the body in the model; Delete removes it through a Remove.
  await bodyRow(page, 'Mount').click();
  await expect(viewport).toHaveAttribute('data-model-selection', /^body:/);
  await expect(bodyRow(page, 'Mount')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Delete');
  await expect(chip(page, 'Remove1')).toBeVisible();
  await kernelReady(page);
  await expect(viewport).not.toHaveAttribute('data-bodies');
  await expect(badge(page)).toHaveCount(0);
  await expect(browserOf(page).getByText('No bodies yet')).toBeVisible();
  // Undo brings it back with its name and colour.
  await page.keyboard.press('Control+z');
  await expect(chip(page, 'Remove1')).toHaveCount(0);
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Mount:12:40,80,60');
  await expect(viewport).toHaveAttribute('data-body-appearance', 'Mount:#5b7cff:1');

  // The body menu's Delete does the same.
  await bodyRow(page, 'Mount').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Delete/ }).click();
  await expect(chip(page, 'Remove1')).toBeVisible();
  await kernelReady(page);
  await expect(viewport).not.toHaveAttribute('data-bodies');
});

test('the bracket shows the silhouettes of its tapered holes in wireframe', async ({ page }) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await expect(viewport).not.toHaveAttribute('data-silhouettes');
  await visualStyle(page, 'Wireframe');
  await expect
    .poll(async () => Number(await attr(viewport, 'data-silhouettes')))
    .toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath('wireframe.png') });
  // They follow the camera: looking straight down the holes' axes (orthographic), the
  // tapered walls all face up, so their outlines are gone. What is left is the outside
  // fillet's tangent line, edge-on from here: such a node counts as facing whatever the
  // sign of the noise in its normal is (EDGE_ON, viewport/silhouette.ts), so it is the
  // same pair of segments whatever the camera's last float was — 0 or 2 or 4 before.
  await page.getByRole('button', { name: 'Orthographic' }).click();
  await page.keyboard.press('Shift+2');
  await expect
    .poll(async () => Number((await attr(viewport, 'data-silhouettes')) || 0))
    .toBeLessThanOrEqual(2);
  await page.keyboard.press('Shift+1');
  await expect
    .poll(async () => Number(await attr(viewport, 'data-silhouettes')))
    .toBeGreaterThan(0);
  await visualStyle(page, 'Shaded with hidden edges');
  await expect
    .poll(async () => Number(await attr(viewport, 'data-silhouettes')))
    .toBeGreaterThan(0);
  await visualStyle(page, 'Shaded');
  await expect(viewport).not.toHaveAttribute('data-silhouettes');
});

test('a cut through a plate makes two bodies, named without shifting', async ({ page }) => {
  // The longest flow in this file (two sketches, two extrudes, a remove, two undos): about
  // 8 s on an idle machine and 25 s on one three times oversubscribed, so the default 30 s
  // is too tight for a loaded CI runner.
  test.setTimeout(90_000);
  // Both sketches first: a 40 × 20 plate around the origin (on the 10 mm snap grid), then a
  // strip across it, x from −10 to 0 (left piece 10 mm wide, right 20). The second
  // sketch opens fitted to the first (about ±13 mm up and down, a finer grid), so the strip
  // ends at ±12.
  await sketchOnXY(page);
  const viewport = page.getByRole('region', { name: 'Viewport' });
  let click = clicker(page, await still(viewport));
  await page.keyboard.press('r');
  await click(-20, -10);
  await click(20, 10);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();
  await newSketchOnXY(page);
  click = clicker(page, await still(viewport));
  await page.keyboard.press('r');
  await click(-10, -12);
  await click(0, 12);
  await page.keyboard.press('Escape');
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch2')).toBeVisible();

  // The plate, 10 mm thick.
  let world = await still(viewport);
  const plate = world(10, 5);
  await page.mouse.click(plate.x, plate.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.keyboard.press('e');
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Distance' }).fill('10 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:40,20,10');

  // The strip's profile, clear of the plate (which sits over the sketch plane), cut 10 mm up.
  // Orthographic, so the plate's top edge (10 mm up) doesn't grow over the strip.
  await page.getByRole('button', { name: 'Orthographic' }).click();
  await expect(viewport).toHaveAttribute('data-camera-projection', 'orthographic');
  world = await still(viewport);
  const strip = world(-5, 11.5);
  await page.mouse.click(strip.x, strip.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.keyboard.press('e');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Operation' }).selectOption('cut');
  await dialog.getByRole('textbox', { name: 'Distance' }).fill('10 mm');
  await expect(viewport).toHaveAttribute('data-preview', 'cut', { timeout: 15_000 });
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  // The "Sketch1 is hidden" toast from the extrude above is still up (12 s) in the same
  // corner this dialog's OK is in: it must have moved clear of it, or the click below
  // waits for the toast to go (P4-11).
  expect(await toastOnOk(page)).toBeNull();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  // The larger piece stays Body1; the other is a new body.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,10 Body2:6:10,20,10');
  await expect(badge(page)).toHaveText('2');

  // Removing Body1 leaves Body2 named as it was.
  await bodyRow(page, 'Body1').click();
  await page.keyboard.press('Delete');
  await expect(chip(page, 'Remove1')).toBeVisible();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body2:6:10,20,10');
  await expect(badge(page)).toHaveText('1');
  // The Remove's chip opens its dialog (P3-17): Body2 picked from the browser joins Body1.
  await chip(page, 'Remove1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Remove1 dialog' });
  const picked = edit.getByRole('button', { name: 'Bodies', exact: true });
  await expect(picked).toHaveText('Body1');
  await bodyRow(page, 'Body2').click();
  await expect(picked).toHaveText('2 bodies');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(edit).toBeHidden();
  await kernelReady(page);
  await expect(viewport).not.toHaveAttribute('data-bodies');
  await page.keyboard.press('Control+z');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body2:6:10,20,10');
  // Undoing the cut takes the second body and its name away.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(chip(page, 'Extrude2')).toHaveCount(0);
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:40,20,10');
});

// A body made see-through after it was drawn opaque must really draw see-through
// (ADR-0030's amendment). three bakes OPAQUE into a material's program while
// `transparent` is false and doesn't notice the prop changing; only something
// else that recompiles the programs hides it, and autosave's thumbnail does
// (it draws into a render target, which has no tone mapping). The spec keeps
// the thumbnail from drawing, so the material alone has to be right.
const patchMean = async (page: Page, x: number, y: number, size = 8) => {
  const png = await page.screenshot({ clip: { x, y, width: size, height: size } });
  return (await page.evaluate(`(async () => {
    const bin = atob('${png.toString('base64')}');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const g = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return s / (d.length / 4) / 3;
  })()`)) as number;
};

test('a body made see-through after it was drawn opaque draws see-through', async ({ page }) => {
  await page.addInitScript(`(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (type === '2d' && this.width === 256 && this.height === 256 && !this.isConnected) return null;
      return getContext.call(this, type, ...rest);
    };
  })()`);
  await page.goto('./');
  await page.getByRole('button', { name: 'Start from the PCB enclosure template' }).click();
  const viewport = page.getByRole('region', { name: 'Viewport' });
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', /^Enclosure:\d+:.* Lid:\d+:/);

  // The lid's top face (the lid sits over the enclosure's cavity) in the home view.
  const lid: [number, number] = [900, 400];
  const opaque = await patchMean(page, ...lid);

  const setOpacity = async (body: string, label: string, value: string) => {
    await bodyRow(page, body).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Appearance…' }).click();
    const panel = page.getByRole('dialog', { name: `${body} appearance` });
    await panel.getByRole('radio', { name: label }).check();
    await expect(viewport).toHaveAttribute(
      'data-body-appearance',
      new RegExp(`${body}:(#[0-9a-f]{6}|default):${value}`),
    );
    await panel.getByRole('radio', { name: label }).focus();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await page.mouse.move(1000, 700);
  };
  const distance = async () => Math.abs((await patchMean(page, ...lid)) - opaque);

  await setOpacity('Lid', '50 %', '0.5');
  await expect.poll(distance, { timeout: 8000 }).toBeGreaterThan(3);
  // And back: opaque again, the same pixels as at the start.
  await setOpacity('Lid', 'Opaque', '1');
  await expect.poll(distance, { timeout: 8000 }).toBeLessThan(1.5);
});

// Ghost bodies (ADR-0030's amendment): a third state between shown and hidden.
const menuOf = (page: Page) => page.getByRole('menu', { name: 'Marking menu' });
const markingEntry = (page: Page, id: string) =>
  menuOf(page).locator(`[data-marking-entry="${id}"]`);

/** A page point over a model face: scans out from the middle of the open view. */
async function overFace(page: Page, viewport: Locator) {
  const box = await viewport.boundingBox();
  if (!box) throw new Error('no viewport');
  const shift = Number((await viewport.getAttribute('data-camera-shift')) ?? 0);
  const c = { x: box.x + ((1 + shift) * box.width) / 2, y: box.y + box.height / 2 };
  for (const [dx, dy] of [
    [0, 0],
    [40, 0],
    [-40, 0],
    [0, 40],
    [0, -40],
    [80, 40],
    [-80, 40],
  ] as const) {
    await page.mouse.move(c.x + dx, c.y + dy);
    await page.waitForTimeout(80);
    if ((await attr(viewport, 'data-model-hover')).startsWith('face:'))
      return { x: c.x + dx, y: c.y + dy };
  }
  throw new Error('no face near the middle of the view');
}

test('a ghost body is stored, drawn grey and takes no part in picking', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start from the Box with a lid template' }).click();
  const viewport = page.getByRole('region', { name: 'Viewport' });
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', /^Box:\d+:.* Lid:\d+:/);

  const lidId = await bodyLeaf(page, 'Lid').getAttribute('data-body');
  expect(lidId).toBeTruthy();

  // Home view, then map the lid's top face centre (z = 33 above the box).
  await page.keyboard.press('Shift+1');
  await still(viewport);
  const at = await projector(viewport);
  const lidTop = at([0, 0, 33]);

  // Shown, the lid is pickable: a hover names its body.
  await page.mouse.move(lidTop.x, lidTop.y);
  await expect
    .poll(async () => attr(viewport, 'data-model-hover'), { timeout: 5000 })
    .toContain(lidId as string);

  const opaque = await patchMean(page, lidTop.x, lidTop.y);

  // The eye ghosts it: out of the drawn bodies, named in data-ghost-bodies.
  await browserOf(page).getByRole('button', { name: 'Show as ghost Lid' }).click();
  await expect(viewport).not.toHaveAttribute('data-bodies', /Lid:/);
  await expect(viewport).toHaveAttribute('data-ghost-bodies', 'Lid');
  await expect(bodyLeaf(page, 'Lid')).toHaveAttribute('data-body-display', 'ghost');

  // The ghost is drawn: its pixels sit between the opaque body and the background.
  const ghost = await patchMean(page, lidTop.x, lidTop.y);
  await browserOf(page).getByRole('button', { name: 'Hide Lid' }).click();
  await expect(viewport).not.toHaveAttribute('data-ghost-bodies');
  const hidden = await patchMean(page, lidTop.x, lidTop.y);
  expect(Math.abs(ghost - opaque)).toBeGreaterThan(3);
  expect(Math.abs(ghost - hidden)).toBeGreaterThan(3);

  // The same point names nothing now: a ghost takes no picks.
  await page.mouse.move(lidTop.x, lidTop.y);
  await page.mouse.move(lidTop.x + 1, lidTop.y + 1);
  await page.waitForTimeout(150);
  expect(await attr(viewport, 'data-model-hover')).not.toContain(lidId as string);
  expect(await attr(viewport, 'data-model-selection')).not.toContain(lidId as string);

  // A ghost is stored: it survives a reload. (Hidden -> shown -> ghost.)
  await browserOf(page).getByRole('button', { name: 'Show Lid' }).click();
  await browserOf(page).getByRole('button', { name: 'Show as ghost Lid' }).click();
  await expect(viewport).toHaveAttribute('data-ghost-bodies', 'Lid');
  await page.reload();
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-ghost-bodies', 'Lid');
  await expect(bodyLeaf(page, 'Lid')).toHaveAttribute('data-body-display', 'ghost');
});

test('Ctrl+Z steps the display state back one at a time', async ({ page }) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Bracket:12:40,80,60');

  await browserOf(page).getByRole('button', { name: 'Show as ghost Bracket' }).click();
  await expect(bodyLeaf(page, 'Bracket')).toHaveAttribute('data-body-display', 'ghost');
  await browserOf(page).getByRole('button', { name: 'Hide Bracket' }).click();
  await expect(bodyLeaf(page, 'Bracket')).toHaveAttribute('data-body-display', 'hidden');

  await page.keyboard.press('Control+z');
  await expect(bodyLeaf(page, 'Bracket')).toHaveAttribute('data-body-display', 'ghost');
  await expect(viewport).toHaveAttribute('data-ghost-bodies', 'Bracket');
  await page.keyboard.press('Control+z');
  await expect(bodyLeaf(page, 'Bracket')).toHaveAttribute('data-body-display', 'shown');
});

test('the marking menu offers Show as Ghost and ghosts the body', async ({ page }) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Bracket:12:40,80,60');
  await still(viewport);

  // Select the body from its row, then right-click a face of it.
  await bodyRow(page, 'Bracket').click();
  const over = await overFace(page, viewport);
  await page.mouse.move(over.x, over.y);
  await page.mouse.click(over.x, over.y, { button: 'right' });

  const ghost = markingEntry(page, 'ghostBody');
  await expect(ghost).toBeVisible();
  await expect(ghost).toHaveText('Show as Ghost');
  await expect(markingEntry(page, 'showBody')).toHaveCount(0);
  await expect(markingEntry(page, 'hideBody')).toHaveText('Hide Body');
  await ghost.click();

  await expect(viewport).toHaveAttribute('data-ghost-bodies', 'Bracket');
  await expect(bodyLeaf(page, 'Bracket')).toHaveAttribute('data-body-display', 'ghost');
});
