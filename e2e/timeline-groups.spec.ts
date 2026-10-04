import { expect, type Locator, type Page, test } from '@playwright/test';
import { kernelReady, openProject } from './helpers';

// P4-09 (ADR-0065 §1 and §2): timeline groups. A run of neighbouring chips
// picked with Shift groups from the chip menu or the marking menu; a folded
// group is one chip with its name, member count and worst status, an open one a
// band with its label; the marker passes a folded group whole and opens one it
// rolls into; suppressing a group suppresses every member; each of these is one
// undo step, and a reload keeps the group.
//
// The Wall bracket template: Sketch1 Extrude1 Sketch2 Extrude2 Fillet1 | Plane1.

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 90_000 });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const features = (page: Page) => page.getByRole('list', { name: 'Features' });
const chip = (page: Page, name: string) =>
  features(page).getByRole('button', { name: new RegExp(`^${name}( \\(|$|\\s)`) });
const groupChip = (page: Page, name: string) =>
  features(page).getByRole('button', { name: new RegExp(`^${name}, \\d+ features`) });
const marker = (page: Page) => page.getByRole('slider', { name: 'Timeline marker' });
const menuItem = (page: Page, name: string) =>
  page.getByRole('menuitem', { name: new RegExp(`^${name}`) });
const viewport = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const attr = async (el: Locator, name: string) => (await el.getAttribute(name)) ?? '';

/** The chip names in timeline order, without their states. */
async function order(page: Page) {
  const labels = await features(page)
    .locator('[data-timeline-item="chip"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
  return labels.map((label) => label.replace(/, \d+ features.*$/, '').replace(/ \(.*\)$/, ''));
}

async function box(el: Locator) {
  const b = await el.boundingBox();
  if (!b) throw new Error('not visible');
  return b;
}

/** Drags from the middle of `from` to x (page px) at its height, in steps. */
async function dragTo(page: Page, from: Locator, x: number) {
  const b = await box(from);
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + b.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 8, y, { steps: 2 });
  await page.mouse.move(x, y, { steps: 8 });
}

/** The arrow beside a folded group's chip, which opens it. */
const expandArrow = (page: Page) =>
  features(page)
    .locator('li:has([data-group-collapsed])')
    .getByRole('button', { name: /^Expand/ });

/** A point just inside the left edge of a chip: a drop there lands before it. */
const before = async (el: Locator) => (await box(el)).x + 3;

/** A page point over empty space: the middle of the open part of the view, scanned outwards. */
async function empty(page: Page, view: Locator): Promise<{ x: number; y: number }> {
  const b = await box(view);
  const shift = Number((await attr(view, 'data-camera-shift')) ?? 0);
  const middle = { x: b.x + ((1 + shift) * b.width) / 2, y: b.y + b.height / 2 };
  const offsets: [number, number][] = [
    [0, 0],
    [-90, -70],
    [90, -70],
    [-90, 70],
    [90, 70],
    [-180, 0],
    [180, 0],
    [0, -150],
    [0, 150],
  ];
  for (const [dx, dy] of offsets) {
    await page.mouse.move(middle.x + dx, middle.y + dy);
    if ((await attr(view, 'data-model-hover')) === '')
      return { x: middle.x + dx, y: middle.y + dy };
  }
  return middle;
}

/** Picks the two neighbouring chips of the bracket's sketch and extrude. */
async function pickTwoChips(page: Page) {
  await chip(page, 'Extrude1').click();
  await chip(page, 'Sketch2').click({ modifiers: ['Shift'] });
  const picked = await attr(features(page), 'data-selected-features');
  expect(picked.split(' ')).toHaveLength(2);
}

/** Groups the picked chips from the chip menu. */
async function groupPicked(page: Page) {
  await chip(page, 'Extrude1').click({ button: 'right' });
  const item = menuItem(page, 'Group 2 features');
  await expect(item).toBeVisible();
  await item.click();
  await expect(features(page).locator('[data-group-band]')).toBeVisible();
}

test('a picked run groups, folds, renames and survives a reload', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  // Plane1 is rolled back in the template, so the marker is after Fillet1.
  await expect(marker(page)).toHaveAttribute('aria-valuenow', '5');

  // Two neighbouring chips picked with Shift, then grouped from the chip menu: an
  // open band around them with its name as a label. Esc puts the chips back first.
  await pickTwoChips(page);
  await page.keyboard.press('Escape');
  await expect(features(page)).not.toHaveAttribute('data-selected-features', /.+/.source);
  await pickTwoChips(page);
  await groupPicked(page);
  await expect(features(page).locator('[data-group-label]')).toHaveText(/Group1/);
  expect(await order(page)).toEqual([
    'Sketch1',
    'Extrude1',
    'Sketch2',
    'Extrude2',
    'Fillet1',
    'Plane1',
  ]);

  // Folding it: one chip with a folder glyph, the name, the member count and the
  // worst of its members' statuses.
  await features(page).locator('[data-group-label]').click();
  const folded = features(page).locator('[data-group][data-group-collapsed]');
  await expect(folded).toHaveAccessibleName('Group1, 2 features');
  await expect(features(page).locator('[data-group-band]')).toHaveCount(0);
  expect(await order(page)).toEqual(['Sketch1', 'Group1', 'Extrude2', 'Fillet1', 'Plane1']);

  // F2 renames the group; the name is stored, so it survives a reload.
  await folded.focus();
  await page.keyboard.press('F2');
  const dialog = page.getByRole('dialog', { name: 'Rename Group1' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Bracket pair');
  await page.keyboard.press('Enter');
  await expect(groupChip(page, 'Bracket pair')).toBeVisible();

  // Undo takes the rename back, then the fold, then the group itself.
  await page.keyboard.press('Control+z');
  await expect(groupChip(page, 'Group1')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(features(page).locator('[data-group-band]')).toBeVisible();
  await expect(features(page).locator('[data-group-collapsed]')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(features(page).locator('[data-group-band]')).toHaveCount(0);
  await expect(chip(page, 'Extrude1')).toBeVisible();

  // Redo it all, and the stored name comes back with a reload.
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  await expect(groupChip(page, 'Group1')).toBeVisible();
  await folded.focus();
  await page.keyboard.press('F2');
  await page
    .getByRole('dialog', { name: 'Rename Group1' })
    .getByRole('textbox', { name: 'Name' })
    .fill('Bracket pair');
  await page.keyboard.press('Enter');
  await page.reload();
  await expect(viewport(page)).toHaveAttribute('data-ready', 'true');
  await kernelReady(page);
  await expect(groupChip(page, 'Bracket pair')).toBeVisible();
});

test('the marker passes a folded group whole, and rolling into one opens it', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await pickTwoChips(page);
  await groupPicked(page);
  await features(page).locator('[data-group-label]').click();
  await expect(features(page).locator('[data-group-collapsed]')).toBeVisible();

  // Stepping back from Fillet1: 4, 3, then over the group (not into it): the gap
  // between Extrude1 and Sketch2 is nowhere to stop.
  const step = page.getByRole('button', { name: 'Step back' });
  for (const at of ['4', '3', '1']) {
    await step.click();
    await expect(marker(page)).toHaveAttribute('aria-valuenow', at);
  }
  await expect(marker(page)).toHaveAttribute('aria-valuetext', 'After Sketch1');
  await step.click();
  await expect(marker(page)).toHaveAttribute('aria-valuenow', '0');
  await expect(step).toBeDisabled();

  // The arrow keys step the same way.
  await marker(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(marker(page)).toHaveAttribute('aria-valuenow', '1');
  await page.keyboard.press('ArrowRight');
  await expect(marker(page)).toHaveAttribute('aria-valuenow', '3');
  await page.keyboard.press('ArrowLeft');
  await expect(marker(page)).toHaveAttribute('aria-valuenow', '1');

  // With the group open the marker can go between its members (Roll Back to Here
  // on Sketch1), which is the gap the folded group hid.
  await expandArrow(page).click();
  await expect(features(page).locator('[data-group-band]')).toBeVisible();
  await chip(page, 'Extrude2').click({ button: 'right' });
  await menuItem(page, 'Roll Forward to Here').click();
  await expect(marker(page)).toHaveAttribute('aria-valuenow', '4');
  await chip(page, 'Extrude1').click({ button: 'right' });
  await menuItem(page, 'Roll Back to Here').click();
  await expect(marker(page)).toHaveAttribute('aria-valuenow', '2');
  await expect(marker(page)).toHaveAttribute('aria-valuetext', 'After Extrude1');

  // Folding a group the marker is inside opens it again: the marker never rests
  // inside a folded group.
  await features(page).locator('[data-group-label]').click();
  await expect(features(page).locator('[data-group-band]')).toBeVisible();
  await expect(features(page).locator('[data-group-collapsed]')).toHaveCount(0);
  await expect(marker(page)).toHaveAttribute('aria-valuenow', '2');
});

test("a group's menu renames, suppresses, shows and ungroups it", async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await pickTwoChips(page);
  await groupPicked(page);
  await features(page).locator('[data-group-label]').click();
  const folded = features(page).locator('[data-group][data-group-collapsed]');

  // Suppressing the group suppresses both of its members, in one step, and the
  // features after them lose what they had, so the view has nothing to draw.
  await folded.click({ button: 'right' });
  await menuItem(page, 'Suppress').click();
  await expect(viewport(page)).not.toHaveAttribute('data-bodies');
  await expandArrow(page).click();
  await expect(chip(page, 'Extrude1')).toHaveAccessibleName('Extrude1 (suppressed)');
  await expect(chip(page, 'Sketch2')).toHaveAccessibleName('Sketch2 (suppressed)');

  // Two undos: the unfold, then the suppression of both at once.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expandArrow(page).click();
  await expect(chip(page, 'Extrude1')).toHaveAccessibleName('Extrude1');
  await expect(chip(page, 'Sketch2')).toHaveAccessibleName('Sketch2');
  await kernelReady(page);
  await expect(viewport(page)).toHaveAttribute('data-bodies', 'Bracket:12:40,80,60');

  // A feature in a group renames and hides as it does on its own.
  await chip(page, 'Extrude1').click({ button: 'right' });
  await menuItem(page, 'Rename').click();
  const dialog = page.getByRole('dialog', { name: 'Rename Extrude1' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Extrude A');
  await page.keyboard.press('Enter');
  await expect(chip(page, 'Extrude A')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(chip(page, 'Extrude1')).toBeVisible();

  // The group menu ungroups it, and its members stay as they are.
  await features(page).locator('[data-group-label]').click();
  await expect(features(page).locator('[data-group-collapsed]')).toBeVisible();
  await features(page).locator('[data-group-collapsed]').click({ button: 'right' });
  await expect(menuItem(page, 'Ungroup 2 features')).toBeVisible();
  await menuItem(page, 'Ungroup 2 features').click();
  await expect(features(page).locator('[data-group]')).toHaveCount(0);
  expect(await order(page)).toEqual([
    'Sketch1',
    'Extrude1',
    'Sketch2',
    'Extrude2',
    'Fillet1',
    'Plane1',
  ]);
});

test('dragging a folded group moves its members together', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  // The fillet and the plane after it: nothing depends on them, so they can go.
  await chip(page, 'Fillet1').click();
  await chip(page, 'Plane1').click({ modifiers: ['Shift'] });
  await chip(page, 'Fillet1').click({ button: 'right' });
  await menuItem(page, 'Group 2 features').click();
  // The group holds the last two features, so the marker has to leave the gap
  // inside it before the group can fold (a group the marker is in stays open).
  await page.getByRole('button', { name: 'Step back' }).click();
  await expect(marker(page)).toHaveAttribute('aria-valuenow', '4');
  await features(page).locator('[data-group-label]').click();
  await expect(features(page).locator('[data-group-collapsed]')).toBeVisible();

  // After Extrude1: both members move, in their order, in one command.
  await dragTo(
    page,
    features(page).locator('[data-group-collapsed]'),
    await before(chip(page, 'Sketch2')),
  );
  await expect(features(page).locator('[data-drop-index]')).toHaveAttribute('data-drop-index', '2');
  await expect(features(page).locator('[data-drop-refused]')).toHaveCount(0);
  await page.mouse.up();
  await expect
    .poll(() => order(page))
    .toEqual(['Sketch1', 'Extrude1', 'Group1', 'Sketch2', 'Extrude2']);
  await kernelReady(page);

  // Undo puts them back, still one group.
  await page.keyboard.press('Control+z');
  await expect
    .poll(() => order(page))
    .toEqual(['Sketch1', 'Extrude1', 'Sketch2', 'Extrude2', 'Group1']);
  await expect(features(page).locator('[data-group-collapsed]')).toBeVisible();
});

test('a group that could not move anywhere is refused as a whole', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  // Everything after the extrude and the sketch on its face uses them, so the
  // group of the two has nowhere to go.
  await pickTwoChips(page);
  await groupPicked(page);
  await features(page).locator('[data-group-label]').click();
  await expect(features(page).locator('[data-group-collapsed]')).toBeVisible();
  await dragTo(
    page,
    features(page).locator('[data-group-collapsed]'),
    await before(chip(page, 'Sketch1')),
  );
  // The indicator says why, and nothing moves.
  await expect(features(page).locator('[data-drop-refused]')).toHaveCount(1);
  await expect(features(page).locator('[data-drop-refused]')).toHaveAttribute(
    'title',
    /Can't move Extrude1 before Sketch1/,
  );
  await page.mouse.up();
  expect(await order(page)).toEqual(['Sketch1', 'Group1', 'Extrude2', 'Fillet1', 'Plane1']);
});

test('the marking menu groups the picked chips too', async ({ page }) => {
  const view = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await expect(view).toHaveAttribute('data-bodies', 'Bracket:12:40,80,60');
  await pickTwoChips(page);

  const at = await empty(page, view);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const entry = page
    .getByRole('menu', { name: 'Marking menu' })
    .locator('[data-marking-entry="group"]');
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(features(page).locator('[data-group-band]')).toBeVisible();
  await expect(features(page).locator('[data-group-label]')).toHaveText(/Group1/);
  await kernelReady(page);
});
