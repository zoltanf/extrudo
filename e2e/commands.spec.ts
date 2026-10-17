import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  kernelReady,
  openAppMenu,
  openProject,
  pickMenuItem,
  pickTool,
  projector,
  sketchOnXY,
} from './helpers';

// P1-14: the shortcut registry and the search, one dialog since the owner's UI review 3
// (R3-05): Ctrl+K centred, S at the pointer, the top bar's Search button below itself.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const search = (page: Page) => page.getByRole('dialog', { name: 'Search', exact: true });
const toolPrompt = (page: Page) => page.getByRole('status', { name: 'Tool prompt' });

test('Ctrl+K opens the search centred; it finds commands by fuzzy search and runs them', async ({
  page,
}) => {
  const viewport = await openProject(page);
  await page.keyboard.press('Control+k');
  await expect(search(page)).toBeVisible();
  // Centred over a dimmed page, like a proper pop-up.
  const box = await search(page).boundingBox();
  if (!box) throw new Error('no search');
  expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(2);
  await expect(search(page)).toHaveAttribute('data-dim', 'true');
  const field = search(page).getByRole('combobox', { name: 'Search commands' });
  await expect(field).toBeFocused();

  // Create Sketch from the search waits for a plane, like the toolbar button.
  await field.fill('create sk');
  await expect(search(page).getByRole('option').first()).toHaveAccessibleName(/Create Sketch/);
  await page.keyboard.press('Enter');
  await expect(search(page)).toBeHidden();
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XY' })
    .click();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');

  // "3pr" ranks 3-Point Rectangle first; the tool starts.
  await page.keyboard.press('Control+k');
  await search(page).getByRole('combobox').fill('3pr');
  const first = search(page).getByRole('option').first();
  await expect(first).toHaveAccessibleName(/^3-Point Rectangle/);
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(search(page)).toBeHidden();
  await expect(toolPrompt(page)).toHaveText('Click the first corner.');
  const view = await viewport.boundingBox();
  if (!view) throw new Error('no viewport');
  await page.mouse.click(view.x + view.width / 2, view.y + view.height / 2);
  await expect(toolPrompt(page)).toHaveText(
    'Click the end of the first edge, or type its length (Tab: angle).',
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Arrows move through the results; the search lists what ran recently first.
  await page.keyboard.press('Control+k');
  const recent = search(page).getByRole('group', { name: 'Recent' }).getByRole('option');
  await expect(recent).toHaveCount(1);
  await expect(recent).toHaveAccessibleName(/^3-Point Rectangle/);
  // Only the Sketch tab's tools are offered in a sketch, and since the owner's UI review 3
  // (R3-11) a sketch has no 3D Print tab, so its commands wait for the model too.
  await search(page).getByRole('combobox').fill('extrude');
  await expect(search(page).getByRole('option')).toHaveCount(0);
  await search(page).getByRole('combobox').fill('send to slicer');
  await expect(search(page).getByRole('option')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(search(page)).toBeHidden();
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  // In the model, a command that can't run here says why.
  await page.keyboard.press('Control+k');
  await search(page).getByRole('combobox').fill('send to slicer');
  const later = search(page).getByRole('option', { name: /^Send to Slicer/ });
  await expect(later).toHaveAttribute('aria-disabled', 'true');
  await expect(later).toContainText(
    'Sending to a slicer needs the desktop app. In the browser, export a 3MF and open it in your slicer.',
  );
  // The long reason is cut short in its row, never a horizontal scroll bar (R3-05).
  await expect(noSideways(page)).resolves.toBe(true);
  await page.keyboard.press('Escape');
  await expect(search(page)).toBeHidden();
});

/** Whether the search's list and the dialog itself have nothing to scroll sideways. */
function noSideways(page: Page) {
  return search(page).evaluate((dialog) =>
    [dialog, ...dialog.querySelectorAll('[role=listbox], section')].every(
      (el) => el.scrollWidth <= el.clientWidth,
    ),
  );
}

test('S opens the search at the pointer, the page left clear, with the pins', async ({ page }) => {
  const at = await sketchOnXY(page);
  const p = at(20, 10);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.press('s');
  await expect(search(page)).toBeVisible();
  const box = await search(page).boundingBox();
  expect(Math.abs((box?.x ?? 0) - (p.x - 24))).toBeLessThan(2);
  expect(Math.abs((box?.y ?? 0) - (p.y - 24))).toBeLessThan(2);
  await expect(search(page)).toHaveAttribute('data-dim', 'false');
  // The S didn't land in the search field.
  await expect(search(page).getByRole('combobox')).toHaveValue('');

  // A pinned tool runs with a click.
  const pinned = search(page).getByRole('region', { name: 'Pinned' });
  await pinned.getByRole('button', { name: 'Center Diameter Circle' }).click();
  await expect(search(page)).toBeHidden();
  await expect(toolPrompt(page)).toHaveText('Click the center.');
  await page.keyboard.press('Escape');

  // Shift+Enter pins the highlighted result; pins are kept across reloads.
  await page.keyboard.press('s');
  await search(page).getByRole('combobox').fill('slot');
  await expect(search(page).getByRole('option').first()).toHaveAccessibleName(/^Overall Slot/);
  await page.keyboard.press('Shift+Enter');
  await expect(pinned.getByRole('button', { name: 'Overall Slot' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Viewport' })).toHaveAttribute(
    'data-ready',
    'true',
  );
  // Pins show where their command is offered: the slot, in a sketch.
  await page.keyboard.press('s');
  await expect(search(page).getByRole('button', { name: 'Overall Slot' })).toBeHidden();
  await search(page).getByRole('button', { name: 'Create Sketch' }).click();
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XY' })
    .click();
  await page.keyboard.press('s');
  await expect(
    search(page)
      .getByRole('region', { name: 'Pinned' })
      .getByRole('button', { name: 'Overall Slot' }),
  ).toBeVisible();
});

test('shortcuts: tools that come later say so, Shift+digits turn the view', async ({ page }) => {
  const viewport = await openProject(page);
  // No tool that is still to come has a key now (Hole's H runs since P3-04), so its tile says so.
  await page.getByRole('tab', { name: '3D Print' }).click();
  await page.getByRole('button', { name: 'Send to Slicer', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toContainText(
    'Sending to a slicer needs the desktop app. In the browser, export a 3MF and open it in your slicer.',
  );
  await page.getByRole('tab', { name: 'Solid' }).click();

  await page.keyboard.press('Shift+2');
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  await page.keyboard.press('Shift+4');
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,1,0');
  await expect(viewport).toHaveAttribute('data-camera-up', '0,0,1');

  // The toolbar's tooltips read their keys from the same keymap.
  await pickTool(page, 'Create Sketch');
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XY' })
    .click();
  // The group menus list the tools that aren't tiles (ADR-0079), with their keys too.
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /^Text Shift\+T$/ })).toBeVisible();
});

test('the Search button drops the search from itself; the app menu has one Search item', async ({
  page,
}) => {
  await openProject(page);
  const header = page.getByRole('banner');
  const button = header.getByRole('button', { name: 'Search', exact: true });
  // The page behind a modal leaves the accessibility tree: measure the button first.
  const from = await button.boundingBox();
  await button.click();
  await expect(search(page).getByRole('combobox')).toBeFocused();
  await expect(search(page).getByRole('region', { name: 'Pinned' })).toBeVisible();
  await expect(search(page)).toHaveAttribute('data-dim', 'true');
  const box = await search(page).boundingBox();
  if (!from || !box) throw new Error('no boxes');
  expect(Math.abs(box.x - from.x)).toBeLessThan(2);
  expect(box.y).toBeGreaterThanOrEqual(from.y + from.height);
  expect(box.y - (from.y + from.height)).toBeLessThan(8);
  await page.keyboard.press('Escape');
  await expect(search(page)).toBeHidden();

  const panel = await openAppMenu(page);
  await expect(panel.getByRole('menuitem', { name: /^(Toolbox|Search commands)/ })).toHaveCount(0);
  await pickMenuItem(page, 'App', 'Search…');
  await expect(search(page).getByRole('combobox')).toBeFocused();
  await page.keyboard.type('top view');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Viewport' })).toHaveAttribute(
    'data-camera-direction',
    '0,0,-1',
  );
});

test('at most ten pins, in two rows of five; an eleventh is refused (R3-05)', async ({ page }) => {
  // Eleven commands the model offers, pinned before the cap: the first ten show.
  await page.addInitScript(
    `localStorage.setItem('extrudo.toolbox.pins', JSON.stringify(${JSON.stringify([
      'sketch',
      'parameters',
      'box',
      'cylinder',
      'sphere',
      'torus',
      'extrude',
      'revolve',
      'fillet',
      'chamfer',
      'shell',
    ])}))`,
  );
  await openProject(page);
  await page.keyboard.press('Control+k');
  const pins = search(page).getByRole('region', { name: 'Pinned' }).getByRole('button');
  await expect(pins).toHaveCount(10);
  await expect(pins.last()).toHaveAccessibleName('Chamfer');
  const boxes = await pins.evaluateAll((tiles) =>
    tiles.map((t) => {
      const r = t.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y)];
    }),
  );
  expect(new Set(boxes.map(([x]) => x)).size).toBe(5);
  expect(new Set(boxes.map(([, y]) => y)).size).toBe(2);

  // An eleventh pin is refused, with the reason on its button and in the status line.
  const field = search(page).getByRole('combobox', { name: 'Search commands' });
  await field.fill('hole');
  const hole = search(page).getByRole('option', { name: /^Hole/ }).first();
  await hole.hover();
  const pin = hole.locator('[data-pin]');
  await expect(pin).toHaveAttribute('data-pin', 'full');
  await expect(pin).toHaveAttribute('title', 'Up to 10 pins: unpin one first.');
  await pin.click();
  await expect(search(page).getByRole('status')).toHaveText('Up to 10 pins: unpin one first.');
  await expect(pins).toHaveCount(10);

  // Unpinning one makes room: the stored eleventh, Shell, shows.
  await field.fill('torus');
  const torus = search(page)
    .getByRole('option', { name: /^Torus/ })
    .first();
  await torus.hover();
  await expect(torus.locator('[data-pin]')).toHaveAttribute('data-pin', 'pinned');
  await torus.locator('[data-pin]').click();
  await expect(pins).toHaveCount(10);
  await expect(pins.last()).toHaveAccessibleName('Shell');
  await expect(search(page).getByRole('status')).toHaveText('');
});

test('the search has no horizontal scroll bar at any width (R3-05)', async ({ page }) => {
  await openProject(page);
  for (const width of [1440, 1024, 720, 480]) {
    await page.setViewportSize({ width, height: 900 });
    await page.keyboard.press('Control+k');
    await expect(search(page)).toBeVisible();
    // The whole grouped list, Send to Slicer's long reason in it, and then a search.
    await expect(noSideways(page)).resolves.toBe(true);
    await search(page).getByRole('combobox').fill('slicer');
    await expect(search(page).getByRole('option').first()).toBeVisible();
    await expect(noSideways(page)).resolves.toBe(true);
    await page.keyboard.press('Escape');
    await expect(search(page)).toBeHidden();
  }
});

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

test('Look at Selection turns and fits the camera to the selected face (UI spec §3.1)', async ({
  page,
}) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);

  // Nothing selected: the command is not offered.
  await page.keyboard.press('Control+k');
  await search(page).getByRole('combobox', { name: 'Search commands' }).fill('look at selection');
  await expect(search(page).getByRole('option', { name: /^Look at Selection/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // The outside of the wall (x = 0, 80 mm wide, z from 3.6 to 60 mm: centre (0, 0, 31.8)), seen from the home view.
  await page.keyboard.press('Shift+6');
  const at = await settledProjector(viewport);
  const point = at([0, 0, 30]);
  await page.mouse.move(point.x, point.y);
  await expect(viewport).toHaveAttribute('data-model-hover', /^face:/);
  await page.mouse.click(point.x, point.y);
  await expect(viewport).toHaveAttribute('data-model-selection', /^face:/);
  // Turn away and move the target off the face, so the command has something to do.
  await page.keyboard.press('Shift+1');
  await settledProjector(viewport);
  await expect(viewport).toHaveAttribute('data-model-selection', /^face:/);
  const before = await viewport.getAttribute('data-camera-target');

  await page.keyboard.press('Control+k');
  await search(page).getByRole('combobox', { name: 'Search commands' }).fill('look at selection');
  await search(page)
    .getByRole('option', { name: /^Look at Selection/ })
    .click();
  await settledProjector(viewport);
  const target = ((await viewport.getAttribute('data-camera-target')) ?? '').split(',').map(Number);
  expect(target[0]).toBeCloseTo(0, 0);
  expect(target[1]).toBeCloseTo(0, 0);
  // The outside fillet (1.5 × the 2.4 mm wall) takes the face's lowest 3.6 mm: 3.6..60.
  expect(Math.abs((target[2] ?? 0) - 31.8)).toBeLessThan(1);
  expect(await viewport.getAttribute('data-camera-target')).not.toBe(before);
  // A flat face is faced square on: the camera looks along the face's inward normal (+X).
  const direction = ((await viewport.getAttribute('data-camera-direction')) ?? '')
    .split(',')
    .map(Number);
  expect(Math.abs(direction[0] ?? 0)).toBeCloseTo(1, 1);
});
