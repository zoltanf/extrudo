import { expect, type Locator, type Page, test } from '@playwright/test';
import { clicker, mapping, projector, sketchOnXY } from './helpers';

// P2-03: model-mode selection (FR-VP-05). No feature makes bodies before
// P2-06, so the B-rep tests run on the kernel debug page, which draws the
// P0-02 test part (a 40 × 30 × 20 mm block, rounded vertical edges, a Ø8
// hole) in the real viewport with the shell's picking and session glue.
// The shell test selects sketch curves and profiles in the model.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const attr = async (viewport: Locator, name: string) => (await viewport.getAttribute(name)) ?? '';
const hovered = (viewport: Locator) => attr(viewport, 'data-model-hover');
const selected = (viewport: Locator) => attr(viewport, 'data-model-selection');

/** Waits until the camera has stopped moving (the fit after the part appears). */
async function settled(viewport: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const now = `${await attr(viewport, 'data-camera-size')} ${await attr(viewport, 'data-camera-target')}`;
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
}

/** The debug page with the test part, in an orthographic view. */
async function testPart(page: Page) {
  await page.goto('./#/debug/kernel');
  await expect(page.getByRole('status', { name: 'Kernel status' })).toContainText('ready', {
    timeout: 15_000,
  });
  const viewport = page.getByRole('region', { name: 'Viewport' });
  await page.getByRole('button', { name: 'Orthographic' }).click();
  await page.getByRole('button', { name: 'Render test part' }).click();
  await expect(page.getByTestId('part-summary')).toContainText('Valid solid');
  await page.waitForTimeout(400);
  await settled(viewport);
  return { viewport, at: await projector(viewport) };
}

async function shiftClick(page: Page, p: { x: number; y: number }) {
  await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Shift');
}

async function box(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test('faces, edges and vertices pre-highlight and select on a real body', async ({ page }) => {
  const { viewport, at } = await testPart(page);
  const selection = page.locator('output[aria-label="Selection"]');
  await expect(selection).toHaveText('Nothing selected');

  // A face: pre-highlight on hover, select on click.
  const top = at([10, 7, 20]);
  await page.mouse.move(top.x, top.y);
  await expect.poll(() => hovered(viewport)).toMatch(/^face:test-part:\d+$/);
  const topFace = await hovered(viewport);
  await page.mouse.click(top.x, top.y);
  await expect.poll(() => selected(viewport)).toBe(topFace);
  await expect(selection).toHaveText('1 face');

  // Shift adds another face, and takes it away again.
  const front = at([20, 0, 10]);
  await shiftClick(page, front);
  await expect(selection).toHaveText('2 faces');
  await page.screenshot({ path: test.info().outputPath('two-faces.png') });
  await shiftClick(page, front);
  await expect(selection).toHaveText('1 face');

  // An edge, a few pixels off the top front edge; a vertex where it ends at the rounded corner.
  const edge = at([20, 0, 20]);
  await page.mouse.move(edge.x, edge.y + 2);
  await expect.poll(() => hovered(viewport)).toMatch(/^edge:test-part:\d+$/);
  await page.mouse.click(edge.x, edge.y + 2);
  await expect(selection).toHaveText('1 edge');
  const corner = at([3, 0, 20]);
  await page.mouse.move(corner.x + 1, corner.y);
  await expect.poll(() => hovered(viewport)).toMatch(/^vertex:test-part:\d+$/);
  await shiftClick(page, { x: corner.x + 1, y: corner.y });
  await expect(selection).toHaveText('1 edge, 1 vertex');
  await page.mouse.move(front.x, front.y);
  await expect.poll(() => hovered(viewport)).toMatch(/^face:/);
  await page.screenshot({ path: test.info().outputPath('edge-vertex-hover.png') });

  // Esc clears; so does a click on empty space.
  await page.keyboard.press('Escape');
  await expect(selection).toHaveText('Nothing selected');
  await page.mouse.click(top.x, top.y);
  await expect(selection).toHaveText('1 face');
  const empty = await viewport.boundingBox();
  await page.mouse.click((empty?.x ?? 0) + 40, (empty?.y ?? 0) + 40);
  await expect(selection).toHaveText('Nothing selected');
  await page.mouse.move((empty?.x ?? 0) + 40, (empty?.y ?? 0) + 60);
  await expect.poll(() => hovered(viewport)).toBe('');
});

test('boxes select bodies, or faces with bodies filtered out', async ({ page }) => {
  const { viewport, at } = await testPart(page);
  const selection = page.locator('output[aria-label="Selection"]');
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
    at([i & 1 ? 40 : 0, i & 2 ? 30 : 0, i & 4 ? 20 : 0]),
  );
  const minX = Math.min(...corners.map((c) => c.x)) - 20;
  const maxX = Math.max(...corners.map((c) => c.x)) + 20;
  const minY = Math.min(...corners.map((c) => c.y)) - 20;
  const maxY = Math.max(...corners.map((c) => c.y)) + 20;
  const mid = at([20, 15, 10]);

  // Window, left to right, around the part: the body.
  await box(page, { x: minX, y: minY }, { x: maxX, y: maxY });
  await expect(selection).toHaveText('1 body');
  await page.keyboard.press('Escape');
  // A window over half the part holds no body, so it takes the faces wholly inside it
  // (the left side and its rounded edges); a crossing box, right to left, takes the body.
  await box(page, { x: minX, y: minY }, { x: mid.x, y: maxY });
  await expect(selection).toHaveText(/^[2-9] faces$/);
  await box(page, { x: mid.x + 10, y: mid.y + 10 }, { x: mid.x - 10, y: mid.y - 10 });
  await expect(selection).toHaveText('1 body');
  await expect.poll(() => selected(viewport)).toBe('body:test-part');

  // The filter lives with Select; without bodies, the window takes all eleven faces.
  const filterButton = page.getByRole('button', { name: 'Selection filter' });
  await filterButton.click();
  await page.getByRole('menuitemcheckbox', { name: 'Bodies' }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Bodies' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(filterButton).toHaveAttribute('data-filtered', 'true');
  await box(page, { x: minX, y: minY }, { x: maxX, y: maxY });
  await expect(selection).toHaveText('11 faces');

  // Faces off too: a click on a face takes nothing but its edges and vertices near the pointer.
  await filterButton.click();
  await page.getByRole('menuitemcheckbox', { name: 'Faces' }).click();
  await page.keyboard.press('Escape');
  const top = at([10, 7, 20]);
  await page.mouse.click(top.x, top.y);
  await expect(selection).toHaveText('Nothing selected');
  await filterButton.click();
  await page.getByRole('menuitem', { name: 'Select everything' }).click();
  await expect(filterButton).not.toHaveAttribute('data-filtered', 'true');
});

test('Select other lists the stack under the pointer', async ({ page }) => {
  const { viewport, at } = await testPart(page);
  const selection = page.locator('output[aria-label="Selection"]');
  const top = at([10, 7, 20]);

  // Right click without moving: the face in front, the one behind it, the body.
  // Esc closes the menu and leaves the selection alone.
  await page.mouse.click(top.x, top.y);
  await expect(selection).toHaveText('1 face');
  await page.mouse.click(top.x, top.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Select other' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(selection).toHaveText('1 face');
  await page.mouse.click(top.x, top.y, { button: 'right' });
  await expect(menu).toBeVisible();
  const rows = menu.getByRole('menuitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveText(/^Face \d+ · Test part$/);
  await expect(rows.nth(1)).toHaveText(/^Face \d+ · Test part \(hidden\)$/);
  await expect(rows.nth(2)).toHaveText('Test part');
  await page.screenshot({ path: test.info().outputPath('select-other.png') });

  // Hovering a row pre-highlights it; clicking selects it.
  await rows.nth(1).hover();
  await expect.poll(() => hovered(viewport)).toMatch(/^face:test-part:\d+$/);
  const hidden = await hovered(viewport);
  await rows.nth(1).click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => selected(viewport)).toBe(hidden);
  await expect(selection).toHaveText('1 face');

  // A long press opens it too; letting go leaves it open.
  await page.mouse.move(top.x, top.y);
  await page.mouse.down();
  await expect(menu).toBeVisible();
  await page.mouse.up();
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Test part', exact: true }).click();
  await expect(selection).toHaveText('1 body');
});

test('in the model, sketch curves and profiles select, and the status bar says what', async ({
  page,
}) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);
  await page.keyboard.press('r');
  await click(-30, -20);
  await click(30, 20);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  const viewport = page.getByRole('region', { name: 'Viewport' });
  const map = await mapping(viewport);
  const selection = page
    .getByRole('region', { name: 'Timeline' })
    .locator('output[aria-label="Selection"]');
  await expect(selection).toHaveCount(0);

  // Inside the rectangle: its profile.
  const inside = map(10, 5);
  await page.mouse.move(inside.x, inside.y);
  await expect.poll(() => hovered(viewport)).toMatch(/^profile:[\w-]+\/\w+/);
  await page.mouse.click(inside.x, inside.y);
  await expect(selection).toHaveText('1 profile ·');
  // Its top line, with Shift.
  const line = map(0, 20);
  await page.mouse.move(line.x, line.y);
  await expect.poll(() => hovered(viewport)).toMatch(/^sketchEntity:[\w-]+\/[\w-]+$/);
  await shiftClick(page, line);
  await expect(selection).toHaveText('1 profile, 1 sketch curve ·');
  await page.screenshot({ path: test.info().outputPath('model-sketch.png') });
  await page.keyboard.press('Escape');
  await expect(selection).toHaveCount(0);

  // Without profiles in the filter, a click inside takes nothing.
  await page.getByRole('button', { name: 'Selection filter' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Profiles' }).click();
  await page.keyboard.press('Escape');
  await page.mouse.click(inside.x, inside.y);
  await expect(selection).toHaveCount(0);
  expect(await selected(viewport)).toBe('');
});
