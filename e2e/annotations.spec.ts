import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  addParameter,
  chip,
  clickWhere,
  closeParameters,
  openParameters,
  setParameters,
  turnView,
} from './benchmark-helpers';
import { clicker, counts, kernelReady, newSketchOnXY, openProject, pickTool } from './helpers';

// P6-23 S2: annotations in the 3D view (ADR-0126 §5–6). The Annotate tool (N) pins a numbered
// note to a face; its callout shows the number and the text, is edited in place, collapses to
// its number ("Numbers only"), hides by its row's eye and the folder's, is ghosted behind the
// part (full again when selected), follows a parameter, detaches when its feature is deleted,
// and Delete and Undo remove and bring it back with its number.

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const layer = (page: Page) => page.locator('[data-annotations]');
const callout = (page: Page, n: number) => page.locator(`[data-annotation="${n}"]`);
const browser = (page: Page) => page.getByRole('complementary', { name: 'Browser' });
const row = (page: Page, n: number) => page.locator(`[data-annotation-row="${n}"]`);
const menuItem = (page: Page, name: string) =>
  page.getByRole('menuitem', { name: new RegExp(`^${name}`) });

/** The callout's anchor point on the page, px in the view (the overlay writes it). */
async function anchorOf(note: Locator): Promise<[number, number]> {
  const text = (await note.getAttribute('data-anchor')) ?? '';
  const [x, y] = text.split(',').map(Number);
  return [x ?? Number.NaN, y ?? Number.NaN];
}

async function box(page: Page) {
  await pickTool(page, 'Box');
  const dialog = page.getByRole('region', { name: 'Box dialog' });
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('textbox', { name: 'Height', exact: true }).fill('h');
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
}

test('a note on a face: added, edited, collapsed, hidden, ghosted, following, detached, deleted', async ({
  page,
}) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await openParameters(page);
  await addParameter(page, 'h', '10 mm');
  await closeParameters(page);
  // A 20 × 20 × h box about the origin.
  await box(page);
  await page.getByRole('button', { name: 'Orthographic' }).click();
  await expect(viewport).toHaveAttribute('data-camera-projection', 'orthographic');

  // N starts Annotate; a click on the top face opens the editor of #1 there.
  let at = await turnView(page, 'Shift+1');
  await page.keyboard.press('n');
  await clickWhere(page, at, [5, 5, 10], /^face:/);
  const editor = page.locator('[data-annotation-editor]');
  await expect(editor).toBeFocused();
  // Typed key by key: N, Delete and Backspace are the editor's, not the app's shortcuts.
  await editor.pressSequentially('Hole M4 heren');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  await expect(editor).toHaveValue('Hole M4 here');
  await page.keyboard.press('Enter');
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:full');
  await expect(callout(page, 1)).toContainText('1');
  await expect(callout(page, 1)).toContainText('Hole M4 here');
  // The new note is selected.
  await expect(viewport).toHaveAttribute('data-model-selection', /^annotation:/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(viewport).toHaveAttribute('data-model-selection', '');

  // Double-click edits the text in place.
  await callout(page, 1).dblclick();
  await expect(editor).toBeFocused();
  await editor.fill('Hole M3 here');
  await page.keyboard.press('Enter');
  await expect(callout(page, 1)).toContainText('Hole M3 here');
  await expect(row(page, 1)).toContainText('#1');
  await expect(row(page, 1)).toContainText('Hole M3 here');
  // Selected (the double-click's first click), it shows its text whatever the switch says.
  await page.keyboard.press('Escape');
  await expect(viewport).toHaveAttribute('data-model-selection', '');

  // "Numbers only" collapses it to its badge; "Show text" brings the text back.
  await browser(page).getByText('Annotations', { exact: true }).click({ button: 'right' });
  await menuItem(page, 'Numbers only').click();
  await expect(callout(page, 1)).toHaveAttribute('data-annotation-text', 'numbers');
  await expect(callout(page, 1)).not.toContainText('Hole M3 here');
  await browser(page).getByText('Annotations', { exact: true }).click({ button: 'right' });
  await menuItem(page, 'Show text').click();
  await expect(callout(page, 1)).toContainText('Hole M3 here');

  // Its row's eye hides it, and so does the folder's.
  await row(page, 1).getByRole('button', { name: 'Hide #1' }).click();
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:hidden');
  await expect(callout(page, 1)).toHaveCount(0);
  await row(page, 1).getByRole('button', { name: 'Show #1' }).click();
  await expect(callout(page, 1)).toBeVisible();
  await browser(page).getByRole('button', { name: 'Hide all annotations' }).click();
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:hidden');
  await browser(page).getByRole('button', { name: 'Show all annotations' }).click();
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:full');

  // The pointer off the browser: a note whose row is hovered is drawn in full.
  const {
    x: vx,
    y: vy,
    width: vw,
    height: vh,
  } = (await viewport.boundingBox()) ?? {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  const offView = () => page.mouse.move(vx + vw - 20, vy + vh - 20);
  await offView();
  // From below, the box hides the top face: the note is ghosted, full again when selected
  // (the pointer leaves the row, so it is the selection that draws it in full).
  at = await turnView(page, 'Shift+3');
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:ghost');
  await expect(callout(page, 1)).toHaveAttribute('data-annotation-behind', '');
  await row(page, 1).getByRole('button').first().click();
  await offView();
  await expect(viewport).toHaveAttribute('data-model-selection', /^annotation:/);
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:full');
  await expect(callout(page, 1)).not.toHaveAttribute('data-annotation-behind');
  await page.keyboard.press('Escape');
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:ghost');

  // It follows the face when h changes.
  at = await turnView(page, 'Shift+1');
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:full');
  const before = await anchorOf(callout(page, 1));
  await setParameters(page, { h: '25 mm' });
  await kernelReady(page);
  await expect.poll(async () => (await anchorOf(callout(page, 1)))[1]).toBeLessThan(before[1] - 5);
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:full');

  // Deleting the box detaches it; Undo brings the box and the note's place back.
  await chip(page, 'Box1').click({ button: 'right' });
  await menuItem(page, 'Delete').click();
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:detached:full');
  await expect(callout(page, 1)).toHaveAttribute('data-annotation-detached', '');
  await page.keyboard.press('Control+z');
  await kernelReady(page);
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:full');

  // A hidden note is drawn while its row edits it, and stays hidden.
  await row(page, 1).getByRole('button', { name: 'Hide #1' }).click();
  await row(page, 1).getByRole('button').first().dblclick();
  await expect(editor).toBeFocused();
  await editor.fill('Hole M3 here, 6 deep');
  await page.keyboard.press('Enter');
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:hidden');
  await row(page, 1).getByRole('button', { name: 'Show #1' }).click();
  await expect(callout(page, 1)).toContainText('Hole M3 here, 6 deep');
  await offView();

  // Delete removes the selected note; Undo brings it back with its number. (Fit first: the
  // taller box's top went up past the view.)
  at = await turnView(page, 'F6');
  await callout(page, 1).click();
  await expect(viewport).toHaveAttribute('data-model-selection', /^annotation:/);
  await page.keyboard.press('Delete');
  await expect(layer(page)).toHaveAttribute('data-annotations', '');
  await expect(callout(page, 1)).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:full');
  await expect(callout(page, 1)).toContainText('Hole M3 here, 6 deep');

  // Delete with the note and the body selected: both go, one undo step. (The body's row first:
  // Delete on a focused body row is the row's own, the body alone.)
  await browser(page).locator('[data-body] button[aria-pressed]').first().click();
  await callout(page, 1).click({ modifiers: ['Shift'] });
  await expect(viewport).toHaveAttribute(
    'data-model-selection',
    /annotation:.* body:|body:.* annotation:/,
  );
  await page.keyboard.press('Delete');
  await expect(layer(page)).toHaveAttribute('data-annotations', '');
  await expect(chip(page, 'Remove1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(layer(page)).toHaveAttribute('data-annotations', /^1:/);
  await expect(chip(page, 'Remove1')).toHaveCount(0);
  void at;
});

test('a click on nothing makes a free note; Esc leaves nothing behind', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await pickTool(page, 'Annotate');
  const { x, y, width, height } = (await viewport.boundingBox()) ?? {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  await page.mouse.click(x + width * 0.6, y + height * 0.7);
  const editor = page.locator('[data-annotation-editor]');
  await expect(editor).toBeFocused();
  // Esc: no note, and nothing to undo.
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(layer(page)).toHaveAttribute('data-annotations', '');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  // Again, typed: a free note #1 on the grid.
  await page.mouse.click(x + width * 0.6, y + height * 0.7);
  await editor.fill('Logo here');
  await page.keyboard.press('Enter');
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:full');
  await expect(callout(page, 1)).toContainText('Logo here');
});

test('notes in a sketch: on a point and the plane, following a drag, the Notes switch, model mode, cascades', async ({
  page,
}) => {
  await openProject(page);
  await kernelReady(page);
  const at = await newSketchOnXY(page);
  const click = clicker(page, at);
  await page.keyboard.press('r');
  await click(-30, -20);
  await click(30, 20);
  await page.keyboard.press('Escape');

  // N in the sketch: a click on the rectangle's corner pins #1 to that point, a click on
  // empty plane makes #2 there.
  await page.keyboard.press('n');
  await click(30, 20);
  const editor = page.locator('[data-annotation-editor]');
  await expect(editor).toBeFocused();
  await editor.pressSequentially('Corner');
  await page.keyboard.press('Enter');
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:full');
  await click(-20, 40);
  await expect(editor).toBeFocused();
  await editor.fill('Free in the sketch');
  await page.keyboard.press('Enter');
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:full 2:ok:full');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // Double-click edits it in the sketch as in the model.
  await callout(page, 2).dblclick();
  await expect(editor).toBeFocused();
  await editor.fill('Free note');
  await page.keyboard.press('Enter');
  await expect(callout(page, 2)).toContainText('Free note');
  await page.keyboard.press('Escape');

  // #1 follows its point while it is dragged, before the drag ends; #2 stays.
  const one = await anchorOf(callout(page, 1));
  const two = await anchorOf(callout(page, 2));
  const from = at(30, 20);
  const to = at(40, 30);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await expect.poll(async () => (await anchorOf(callout(page, 1)))[0]).toBeGreaterThan(one[0] + 20);
  await page.mouse.up();
  expect(await anchorOf(callout(page, 2))).toEqual(two);
  const moved = await anchorOf(callout(page, 1));

  // The palette's Notes switch hides both, and shows them again.
  const notes = page.getByRole('checkbox', { name: 'Show notes' });
  await notes.uncheck();
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:hidden 2:ok:hidden');
  await notes.check();
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:full 2:ok:full');

  // Delete with #2 and a line selected: both go, one undo step.
  await callout(page, 2).click();
  await page.keyboard.down('Shift');
  await click(-30, 0);
  await page.keyboard.up('Shift');
  // The sketch keeps the note in its selection (the status bar counts both).
  await expect(callout(page, 2)).toHaveAttribute('data-selected', '');
  await expect(page.locator('output[aria-label="Selection"]')).toHaveText(/1 annotation, 1 /);
  const before = await counts(page);
  await page.keyboard.press('Delete');
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:full');
  await expect.poll(async () => (await counts(page)).lines).toBeLessThan(before.lines);
  await page.keyboard.press('Control+z');
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:full 2:ok:full');
  await expect.poll(async () => (await counts(page)).lines).toBe(before.lines);

  // Deleting the annotated point keeps #1 where it was, on the plane.
  await page.keyboard.press('Escape');
  await click(40, 30);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await counts(page)).lines).toBeLessThan(before.lines);
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:full 2:ok:full');
  const kept = await anchorOf(callout(page, 1));
  expect(Math.abs(kept[0] - moved[0])).toBeLessThan(1.5);
  expect(Math.abs(kept[1] - moved[1])).toBeLessThan(1.5);

  // Finished, the sketch's notes show in the model through its plane, and hide with it.
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:full 2:ok:full');
  await browser(page).getByRole('button', { name: 'Hide Sketch1' }).click();
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:hidden 2:ok:hidden');
  await browser(page).getByRole('button', { name: 'Show Sketch1' }).click();
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:full 2:ok:full');

  // Deleting the sketch deletes its notes; Undo brings them back.
  await chip(page, 'Sketch1').click({ button: 'right' });
  await menuItem(page, 'Delete').click();
  await expect(layer(page)).toHaveAttribute('data-annotations', '');
  await page.keyboard.press('Control+z');
  await expect(layer(page)).toHaveAttribute('data-annotations', '1:ok:full 2:ok:full');
});
