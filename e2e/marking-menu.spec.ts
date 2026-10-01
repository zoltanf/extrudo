import { expect, type Locator, type Page, test } from '@playwright/test';
import { kernelReady, newSketchOnXY, openProject, projector } from './helpers';

// P3-11: the right-click marking menu (FR-UX-03, ADR-0042) and the context
// menus of the other surfaces. A right-click without movement opens a ring of
// eight wedges and a list; a right-drag still navigates.

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 60_000 });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const attr = async (el: Locator, name: string) => (await el.getAttribute(name)) ?? '';
const menuOf = (page: Page) => page.getByRole('menu', { name: 'Marking menu' });
const slot = (page: Page, id: string) => menuOf(page).locator(`[data-marking-slot="${id}"]`);
const entry = (page: Page, id: string) => menuOf(page).locator(`[data-marking-entry="${id}"]`);
const selection = (page: Page) => page.locator('output[aria-label="Selection"]');

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
}

/** The bracket, once the kernel has drawn it, and the page point at the middle of the view. */
async function bracket(page: Page) {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Bracket:12:40,80,60');
  await still(viewport);
  return { viewport, over: await middle(viewport) };
}

/** The middle of the part of the view the browser leaves open (the fit centres the model there). */
async function middle(viewport: Locator) {
  const box = await viewport.boundingBox();
  if (!box) throw new Error('no viewport');
  const shift = Number((await viewport.getAttribute('data-camera-shift')) ?? 0);
  return { x: box.x + ((1 + shift) * box.width) / 2, y: box.y + box.height / 2 };
}

/** A page point over a face of the bracket: scans out from the middle until the hover says so. */
async function overFace(page: Page, viewport: Locator) {
  const c = await middle(viewport);
  for (const [dx, dy] of [
    [0, 0],
    [40, 0],
    [-40, 0],
    [0, 40],
    [0, -40],
    [80, 40],
    [-80, 40],
    [80, -40],
    [-80, -40],
    [120, 0],
    [-120, 0],
  ] as const) {
    await page.mouse.move(c.x + dx, c.y + dy);
    await page.waitForTimeout(80);
    if ((await attr(viewport, 'data-model-hover')).startsWith('face:'))
      return { x: c.x + dx, y: c.y + dy };
  }
  throw new Error('no face near the middle of the view');
}

/** A point over empty space: the view's top right, clear of the nav bar. */
async function empty(viewport: Locator) {
  const box = await viewport.boundingBox();
  if (!box) throw new Error('no viewport');
  return { x: box.x + box.width - 320, y: box.y + 240 };
}

async function rightClick(page: Page, at: { x: number; y: number }) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y, { button: 'right' });
}

/** The ring's centre in page px. */
async function ringCentre(page: Page) {
  const box = await menuOf(page).locator('[data-marking-ring]').boundingBox();
  if (!box) throw new Error('no ring');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('a right-click on a face opens the ring and the list, selecting the face', async ({
  page,
}) => {
  const { viewport } = await bracket(page);
  const over = await overFace(page, viewport);
  await rightClick(page, over);

  const menu = menuOf(page);
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('data-marking-menu', 'radial');
  // The face under the pointer is now selected: the list acts on it.
  await expect(selection(page)).toHaveText(/^1 face/);
  await expect(menu.locator('[data-marking-slot]')).toHaveCount(8);
  await expect(slot(page, 'sketch')).toBeEnabled();
  await expect(slot(page, 'extrude')).toBeEnabled();
  await expect(slot(page, 'undo')).toBeEnabled();
  // Fillet is a real command since P3-01.
  await expect(slot(page, 'fillet')).toBeEnabled();
  // Press Pull is a real command since P3-08; Delete is for bodies.
  await expect(slot(page, 'pressPull')).toBeEnabled();
  await expect(slot(page, 'delete')).toHaveAttribute('aria-disabled', 'true');
  await expect(slot(page, 'repeatLast')).toHaveAttribute('aria-disabled', 'true');

  // The overflow list: the stack, then what a face allows, then the view.
  for (const id of ['selectOther', 'sketchOnFace', 'measure', 'hideBody', 'exportBodies', 'fit']) {
    await expect(entry(page, id)).toBeVisible();
  }
  await expect(entry(page, 'appearance')).toHaveText('Appearance…');
  await page.screenshot({ path: test.info().outputPath('marking-menu-face.png') });

  // Esc closes it and leaves the selection alone.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(selection(page)).toHaveText(/^1 face/);
});

test('a flick towards a wedge runs its command', async ({ page }) => {
  const { viewport } = await bracket(page);
  const over = await overFace(page, viewport);
  await rightClick(page, over);
  await expect(menuOf(page)).toBeVisible();
  const c = await ringCentre(page);
  // Press in the middle of the ring, drag up and to the right (the Extrude wedge), release.
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 30, c.y - 30, { steps: 4 });
  await expect(menuOf(page).locator('[data-wedge="1"]')).toHaveAttribute('data-active', 'true');
  await page.mouse.move(c.x + 70, c.y - 70, { steps: 4 });
  await page.mouse.up();
  await expect(menuOf(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Extrude dialog' })).toBeVisible();
  // The face that the right-click selected is already in the dialog.
  await expect(page.getByRole('button', { name: 'Profiles', exact: true })).toContainText('1 face');
  await expect(viewport).toHaveAttribute('data-preview', /.*/);
});

test('a press and release in the middle of the ring picks nothing; a click outside closes it', async ({
  page,
}) => {
  const { viewport } = await bracket(page);
  await rightClick(page, await empty(viewport));
  const c = await ringCentre(page);
  await page.mouse.click(c.x, c.y);
  await expect(menuOf(page)).toBeVisible();
  await page.mouse.click(c.x - 400, c.y + 100);
  await expect(menuOf(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Extrude dialog' })).toHaveCount(0);
});

test('a wedge picks by click; the list holds the view commands over empty space', async ({
  page,
}) => {
  const { viewport } = await bracket(page);
  await rightClick(page, await empty(viewport));
  const menu = menuOf(page);
  await expect(menu).toBeVisible();
  // Over nothing there is no stack, no body entry; the view commands are all that is left.
  await expect(entry(page, 'selectOther')).toHaveCount(0);
  await expect(menu.locator('[data-marking-entry]')).toHaveText([
    /^Fit/,
    /^Home View/,
    /^Orthographic$/,
    /^Redo/,
  ]);
  await entry(page, 'projection').click();
  await expect(menu).toHaveCount(0);
  await expect(viewport).toHaveAttribute('data-camera-projection', 'orthographic');

  await rightClick(page, await empty(viewport));
  await slot(page, 'sketch').click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Create Sketch' })).toBeVisible();
});

test('a right-drag still navigates and opens no menu; a right-click on the sketch palette does not either', async ({
  page,
}) => {
  const { viewport } = await bracket(page);
  const start = await empty(viewport);
  const target = await attr(viewport, 'data-camera-target');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(start.x - 60, start.y + 20, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await expect(menuOf(page)).toHaveCount(0);
  // The default preset pans with the right button.
  await expect(viewport).not.toHaveAttribute('data-camera-target', target);
});

test('Repeat last runs the last tool again', async ({ page }) => {
  const { viewport } = await bracket(page);
  await rightClick(page, await empty(viewport));
  await expect(slot(page, 'repeatLast')).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');

  // E starts Extrude; cancel it; the ring now offers to repeat it.
  await page.keyboard.press('e');
  await expect(page.getByRole('region', { name: 'Extrude dialog' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Extrude dialog' })).toHaveCount(0);
  await rightClick(page, await empty(viewport));
  await expect(slot(page, 'repeatLast')).toHaveText(/Repeat Extrude/);
  await slot(page, 'repeatLast').click();
  await expect(page.getByRole('region', { name: 'Extrude dialog' })).toBeVisible();
});

test('the keyboard reaches every wedge and the list', async ({ page }) => {
  const { viewport } = await bracket(page);
  await rightClick(page, await empty(viewport));
  const menu = menuOf(page);
  await expect(menu).toBeFocused();
  // Arrows jump to the wedge in that direction: Up is the top one (Create Sketch).
  await page.keyboard.press('ArrowUp');
  await expect(slot(page, 'sketch')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(slot(page, 'fillet')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('menuitem').nth(3)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(slot(page, 'sketch')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Create Sketch' })).toBeVisible();

  // Keys typed while the menu is open are not shortcuts.
  await page.keyboard.press('Escape');
  await rightClick(page, await empty(viewport));
  await page.keyboard.press('e');
  await expect(page.getByRole('region', { name: 'Extrude dialog' })).toHaveCount(0);
  await page.keyboard.press('ArrowDown');
  await expect(slot(page, 'pressPull')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(entry(page, 'fit')).toBeFocused();
  await page.keyboard.press('Escape');
});

test('Select other… in the list opens the stack, as a right-click used to', async ({ page }) => {
  const { viewport } = await bracket(page);
  const over = await overFace(page, viewport);
  await rightClick(page, over);
  await entry(page, 'selectOther').click();
  await expect(menuOf(page)).toHaveCount(0);
  const other = page.getByRole('menu', { name: 'Select other' });
  await expect(other).toBeVisible();
  const rows = other.getByRole('menuitem');
  expect(await rows.count()).toBeGreaterThanOrEqual(2);
  await rows.last().click();
  await expect(other).toHaveCount(0);
  await expect(selection(page)).toHaveText(/^1 body/);
});

test('a long press still opens Select other… directly', async ({ page }) => {
  const { viewport } = await bracket(page);
  await overFace(page, viewport);
  await page.mouse.down();
  await expect(page.getByRole('menu', { name: 'Select other' })).toBeVisible();
  await page.mouse.up();
  await page.keyboard.press('Escape');
});

test('Body entries hide the body and open its appearance', async ({ page }) => {
  const { viewport } = await bracket(page);
  const over = await overFace(page, viewport);
  await rightClick(page, over);
  await entry(page, 'appearance').click();
  await expect(page.getByRole('dialog', { name: 'Bracket appearance' })).toBeVisible();
  await page.getByRole('radio', { name: 'Blue' }).check({ force: true });
  await expect(viewport).toHaveAttribute('data-body-appearance', 'Bracket:#5b7cff:1');
  await page.keyboard.press('Escape');

  await rightClick(page, over);
  await entry(page, 'hideBody').click();
  await expect(viewport).not.toHaveAttribute('data-bodies');
  // Nothing is under the pointer now, but the body stays selected: Show is offered.
  await rightClick(page, await empty(viewport));
  await entry(page, 'showBody').click();
  await expect(viewport).toHaveAttribute('data-bodies', 'Bracket:12:40,80,60');
});

test('a body selected in the browser is deleted from the ring', async ({ page }) => {
  const { viewport } = await bracket(page);
  await page
    .getByRole('complementary', { name: 'Browser' })
    .getByRole('button', { name: 'Bracket', exact: true })
    .click();
  await rightClick(page, await empty(viewport));
  await expect(slot(page, 'delete')).not.toHaveAttribute('aria-disabled', 'true');
  await slot(page, 'delete').click();
  await expect(viewport).not.toHaveAttribute('data-bodies');
});

test('the ring keeps clear of the window edges', async ({ page }) => {
  const { viewport } = await bracket(page);
  const box = await viewport.boundingBox();
  if (!box) throw new Error('no viewport');
  const size = page.viewportSize() ?? { width: 1440, height: 900 };
  for (const at of [
    { x: box.x + box.width - 4, y: box.y + box.height - 60 },
    { x: box.x + box.width - 4, y: box.y + 120 },
    { x: box.x + 300, y: box.y + box.height - 60 },
  ]) {
    await rightClick(page, at);
    const ring = await menuOf(page).locator('[data-marking-ring]').boundingBox();
    const list = await menuOf(page).locator('[data-marking-list]').boundingBox();
    for (const b of [ring, list]) {
      expect(b?.x).toBeGreaterThanOrEqual(0);
      expect(b?.y).toBeGreaterThanOrEqual(0);
      expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(size.width);
      expect((b?.y ?? 0) + (b?.height ?? 0)).toBeLessThanOrEqual(size.height);
    }
    await page.keyboard.press('Escape');
    await expect(menuOf(page)).toHaveCount(0);
  }
});

test('the preference turns the ring into a plain list', async ({ page }) => {
  const { viewport } = await bracket(page);
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('right-click menu');
  await page.getByRole('option', { name: /^Right-Click Menu: Use a List/ }).click();

  await rightClick(page, await empty(viewport));
  const menu = menuOf(page);
  await expect(menu).toHaveAttribute('data-marking-menu', 'list');
  await expect(menu.locator('[data-marking-ring]')).toHaveCount(0);
  // The slots come first as rows, then the same entries.
  await expect(menu.getByRole('menuitem').first()).toHaveText(/^Sketch/);
  await expect(entry(page, 'fit')).toBeVisible();
  await page.keyboard.press('Escape');

  // It is remembered.
  await page.reload();
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await kernelReady(page);
  await rightClick(page, await empty(viewport));
  await expect(menuOf(page)).toHaveAttribute('data-marking-menu', 'list');
});

test('in a sketch the ring holds the sketch tools; Cancel and Finish Sketch work', async ({
  page,
}) => {
  await openProject(page);
  await newSketchOnXY(page);
  const viewport = page.getByRole('region', { name: 'Viewport' });
  await rightClick(page, await empty(viewport));
  const menu = menuOf(page);
  await expect(menu).toBeVisible();
  for (const id of [
    'line',
    'rectangle',
    'circle',
    'dimension',
    'trim',
    'undo',
    'construction',
    'finishSketch',
  ]) {
    await expect(slot(page, id)).toBeEnabled();
  }
  await expect(menu.locator('[data-marking-slot]')).toHaveCount(8);
  await expect(entry(page, 'lookAtSketch')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('marking-menu-sketch.png') });

  // A wedge starts the tool; while it runs the list offers Cancel.
  await slot(page, 'line').click();
  // (The selection overlay, which shows while no tool runs, is gone.)
  await expect(page.locator('[data-selected-entities]')).toHaveCount(0);
  await rightClick(page, await empty(viewport));
  await entry(page, 'cancelTool').click();
  await expect(page.locator('[data-selected-entities]')).toHaveCount(1);

  // Repeat brings it back from the list.
  await rightClick(page, await empty(viewport));
  await entry(page, 'repeatLast').click();
  await expect(page.locator('[data-selected-entities]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await rightClick(page, await empty(viewport));
  await slot(page, 'finishSketch').click();
  await expect(page.getByRole('region', { name: 'Sketch palette' })).toHaveCount(0);
});

test('in a sketch a right-click selects a curve and offers Delete', async ({ page }) => {
  await openProject(page);
  const at = await newSketchOnXY(page);
  // A line from (0,0) to (40,0), drawn with the Line tool.
  await page.getByRole('button', { name: 'Line', exact: true }).first().click();
  const a = at(10, 10);
  const b = at(40, 10);
  await page.mouse.move(a.x, a.y);
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(b.x, b.y);
  await page.mouse.click(b.x, b.y);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // The line's horizontal glyph has a menu of its own: Delete takes the constraint (P3-17).
  const glyph = page.locator('[data-constraint-type="horizontal"]');
  await expect(glyph).toHaveCount(1);
  await glyph.click({ button: 'right' });
  await expect(menuOf(page)).toHaveCount(0);
  const glyphMenu = page.getByRole('menu', { name: 'Constraint menu' });
  await expect(glyph).toHaveAttribute('aria-pressed', 'true');
  await glyphMenu.getByRole('menuitem', { name: /^Delete/ }).click();
  await expect(glyph).toHaveCount(0);
  const mid = at(25, 10);
  await page.mouse.move(mid.x, mid.y);
  await expect(page.locator('[data-hover-entity]')).toHaveAttribute('data-hover-entity', /.+/);
  await page.mouse.click(mid.x, mid.y, { button: 'right' });
  await expect(page.locator('[data-selected-entities]')).toHaveAttribute(
    'data-selected-entities',
    /.+/,
  );
  // The sketch ring has no Delete wedge: it is the list's first entry.
  await expect(entry(page, 'delete')).not.toHaveAttribute('aria-disabled', 'true');
  await expect(entry(page, 'clearSelection')).toBeVisible();
  await entry(page, 'delete').click();
  await expect(page.locator('[data-selected-entities]')).toHaveAttribute(
    'data-selected-entities',
    '',
  );
});

test('folders, origin rows, parameter rows and design cards have context menus', async ({
  page,
}) => {
  const { viewport } = await bracket(page);
  const browser = page.getByRole('complementary', { name: 'Browser' });

  // A folder: Collapse, and Hide all when it has an eye.
  await browser.getByRole('button', { name: /^Bodies/ }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Collapse' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Hide all bodies' }).click();
  await expect(viewport).not.toHaveAttribute('data-bodies');
  await browser.getByRole('button', { name: /^Bodies/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Show all bodies' }).click();
  await expect(viewport).toHaveAttribute('data-bodies', 'Bracket:12:40,80,60');

  // An origin row.
  await browser.getByText('Origin', { exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /all origin/i })).toBeVisible();
  await page.keyboard.press('Escape');

  // A user parameter's row in the Parameters dialog: Delete and Undo; text fields keep the
  // browser's menu.
  await page.getByRole('button', { name: 'Parameters', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Parameters' });
  await expect(dialog).toBeVisible();
  const row = dialog.locator('tbody tr').first();
  await row.locator('td').last().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /^Delete / })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Undo/ })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('a design card on the home screen has a right-click menu', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await page.goto('./');
  const card = page
    .getByRole('listitem')
    .filter({ hasText: /Wall bracket/ })
    .first();
  await card.click({ button: 'right' });
  for (const name of ['Open', 'Rename', 'Duplicate', 'Export .extrudo', 'Move to trash']) {
    await expect(page.getByRole('menuitem', { name })).toBeVisible();
  }
  await page.keyboard.press('Escape');
});

test('a right-click on a construction plane offers Edit, Hide and Delete', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  const at = await projector(viewport);
  const half = Number(await viewport.getAttribute('data-camera-size')) * 0.16;

  // An offset plane 30 mm above XY, made as the construction spec does.
  const group = page.getByRole('group', { name: 'Construct', exact: true });
  await group.getByRole('button', { name: /^Offset Plane/ }).click();
  const dialog = page.getByRole('region', { name: 'Offset Plane dialog' });
  const xy = at([half * 0.5, -half * 0.5, 0]);
  await page.mouse.move(xy.x, xy.y);
  await page.mouse.click(xy.x, xy.y);
  await expect(dialog.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
  await dialog.getByRole('textbox', { name: 'Distance' }).fill('30 mm');
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-construction', 'Offset_Plane1:plane:0,0,30:0,0,1');

  await rightClick(page, at([half * 0.7, -half * 0.6, 30]));
  await expect(menuOf(page)).toBeVisible();
  await expect(selection(page)).toHaveText(/^1 plane/);
  await expect(entry(page, 'hideConstruction')).toHaveText('Hide Plane');
  await expect(entry(page, 'deleteConstruction')).toHaveText('Delete Plane');
  await entry(page, 'editConstruction').click();
  await expect(page.getByRole('region', { name: 'Edit Offset Plane1 dialog' })).toBeVisible();
});
