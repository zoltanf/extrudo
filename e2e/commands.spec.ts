import { expect, type Page, test } from '@playwright/test';
import { openProject, sketchOnXY } from './helpers';

// P1-14: the shortcut registry, the Ctrl+K command palette and the S toolbox.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette' });
const toolbox = (page: Page) => page.getByRole('dialog', { name: 'Toolbox' });
const toolPrompt = (page: Page) => page.getByRole('status', { name: 'Tool prompt' });

test('the palette finds commands by fuzzy search and runs them', async ({ page }) => {
  const viewport = await openProject(page);
  await page.keyboard.press('Control+k');
  await expect(palette(page)).toBeVisible();
  const search = palette(page).getByRole('combobox', { name: 'Search commands' });
  await expect(search).toBeFocused();

  // Create Sketch from the palette waits for a plane, like the toolbar button.
  await search.fill('create sk');
  await expect(palette(page).getByRole('option').first()).toHaveAccessibleName(/Create Sketch/);
  await page.keyboard.press('Enter');
  await expect(palette(page)).toBeHidden();
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XY' })
    .click();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');

  // "3pr" ranks 3-Point Rectangle first; the tool starts.
  await page.keyboard.press('Control+k');
  await palette(page).getByRole('combobox').fill('3pr');
  const first = palette(page).getByRole('option').first();
  await expect(first).toHaveAccessibleName(/^3-Point Rectangle/);
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(palette(page)).toBeHidden();
  await expect(toolPrompt(page)).toHaveText('Click the first corner.');
  const box = await viewport.boundingBox();
  if (!box) throw new Error('no viewport');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(toolPrompt(page)).toHaveText(
    'Click the end of the first edge, or type its length (Tab: angle).',
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Arrows move through the results; the palette lists what ran recently first.
  await page.keyboard.press('Control+k');
  const recent = palette(page).getByRole('group', { name: 'Recent' }).getByRole('option');
  await expect(recent).toHaveCount(1);
  await expect(recent).toHaveAccessibleName(/^3-Point Rectangle/);
  // Only the Sketch tab's tools are offered in a sketch; later ones say when they arrive.
  await palette(page).getByRole('combobox').fill('extrude');
  await expect(palette(page).getByRole('option')).toHaveCount(0);
  await palette(page).getByRole('combobox').fill('meas');
  const measure = palette(page).getByRole('option', { name: /^Measure/ });
  await expect(measure).toHaveAttribute('aria-disabled', 'true');
  await expect(measure).toContainText('Arrives with P2-13.');
  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();
});

test('the toolbox opens at the pointer with pinned commands', async ({ page }) => {
  const at = await sketchOnXY(page);
  const p = at(20, 10);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.press('s');
  await expect(toolbox(page)).toBeVisible();
  const box = await toolbox(page).boundingBox();
  expect(Math.abs((box?.x ?? 0) - (p.x - 24))).toBeLessThan(2);
  expect(Math.abs((box?.y ?? 0) - (p.y - 24))).toBeLessThan(2);
  // The S didn't land in the search field.
  await expect(toolbox(page).getByRole('combobox')).toHaveValue('');

  // A pinned tool runs with a click.
  const pinned = toolbox(page).getByRole('region', { name: 'Pinned' });
  await pinned.getByRole('button', { name: 'Center Diameter Circle' }).click();
  await expect(toolbox(page)).toBeHidden();
  await expect(toolPrompt(page)).toHaveText('Click the center.');
  await page.keyboard.press('Escape');

  // Shift+Enter pins the highlighted result; pins are kept across reloads.
  await page.keyboard.press('s');
  await toolbox(page).getByRole('combobox').fill('slot');
  await expect(toolbox(page).getByRole('option').first()).toHaveAccessibleName(/^Overall Slot/);
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
  await expect(toolbox(page).getByRole('button', { name: 'Overall Slot' })).toBeHidden();
  await toolbox(page).getByRole('button', { name: 'Create Sketch' }).click();
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XY' })
    .click();
  await page.keyboard.press('s');
  await expect(
    toolbox(page)
      .getByRole('region', { name: 'Pinned' })
      .getByRole('button', { name: 'Overall Slot' }),
  ).toBeVisible();
});

test('shortcuts: tools that come later say so, Shift+digits turn the view', async ({ page }) => {
  const viewport = await openProject(page);
  await page.keyboard.press('f');
  await expect(page.getByText('Fillet arrives with P3-01.')).toBeVisible();

  await page.keyboard.press('Shift+2');
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  await page.keyboard.press('Shift+4');
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,1,0');
  await expect(viewport).toHaveAttribute('data-camera-up', '0,0,1');

  // The toolbar's tooltips read their keys from the same keymap.
  await page.getByRole('button', { name: 'Create Sketch' }).click();
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XY' })
    .click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /^Line L$/ })).toBeVisible();
});

test('the app bar opens search: a button by Undo/Redo, and the Help menu', async ({ page }) => {
  await openProject(page);
  const header = page.getByRole('banner');
  await header.getByRole('button', { name: 'Search commands' }).click();
  await expect(palette(page).getByRole('combobox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();

  await header.getByRole('button', { name: 'Help' }).click();
  await page.getByRole('menuitem', { name: /^Search commands/ }).click();
  await expect(palette(page).getByRole('combobox')).toBeFocused();
  await page.keyboard.type('top view');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Viewport' })).toHaveAttribute(
    'data-camera-direction',
    '0,0,-1',
  );

  await header.getByRole('button', { name: 'Help' }).click();
  await page.getByRole('menuitem', { name: /^Toolbox/ }).click();
  await expect(toolbox(page).getByRole('combobox')).toBeFocused();
  await expect(toolbox(page).getByRole('region', { name: 'Pinned' })).toBeVisible();
});
