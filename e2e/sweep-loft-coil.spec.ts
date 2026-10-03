import { expect, type Page, test } from '@playwright/test';
import {
  attr,
  chip,
  clickEdge,
  clickWhere,
  ok,
  primitive,
  startPrimitive,
  turnView,
  viewportOf,
} from './benchmark-helpers';
import { clicker, kernelReady, openProject, pickTool, sketchOnXY } from './helpers';

// P4-01 (ADR-0055): Sweep, Loft and Coil in a real project. A circle on XY is
// swept along a vertical edge of a box (the path need not touch the profile),
// lofted to the box's top face, and a coil is made with its defaults, then
// edited to another type and section.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** A sketch on XY with a circle of radius 10 at (40, 0), then a 20 mm box at the origin. */
async function circleAndBox(page: Page) {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);
  await page.keyboard.press('c');
  await click(40, 0);
  await click(50, 0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();
  await primitive(page, 'Box', {});
  await expect(viewportOf(page)).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
  return turnView(page, 'Shift+1');
}

test('sweeps a circle along an edge of a box, then undoes it', async ({ page }) => {
  const at = await circleAndBox(page);
  const viewport = viewportOf(page);
  await pickTool(page, 'Sweep');
  const dialog = page.getByRole('region', { name: 'Sweep dialog' });
  await expect(dialog).toBeVisible();
  // The profile first (the pick field), then the path: the box's front right vertical edge.
  await clickWhere(page, at, [40, 5, 0], /^profile:/);
  await expect(dialog.getByRole('button', { name: 'Profiles', exact: true })).toHaveText(
    /^Profile · Sketch1$/,
  );
  await dialog.getByRole('button', { name: 'Path', exact: true }).click();
  await clickEdge(page, at, [10, -10, 10]);
  await expect(dialog.getByRole('button', { name: 'Path', exact: true })).toHaveText(/1 edge/);
  await expect(dialog.getByRole('combobox', { name: 'Operation' })).toHaveValue('new-body');
  await expect(viewport).toHaveAttribute('data-preview', 'new', { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('sweep-preview.png') });
  await ok(page, dialog);
  await expect(chip(page, 'Sweep1')).toHaveAccessibleName('Sweep1');
  // The circle went up the edge's 20 mm: a cylinder beside the box.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20 Body2:3:20,20,20');

  // Editing: half the size at the end.
  await chip(page, 'Sweep1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Sweep1 dialog' });
  await edit.getByRole('textbox', { name: 'End scale', exact: true }).fill('0.5');
  await ok(page, edit);
  // It shrinks about the path (the edge at x = 10): the top circle, radius 5, is drawn in to x 20…30.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20 Body2:3:30,20,20');
  await expect(chip(page, 'Sweep1')).toHaveAccessibleName('Sweep1');

  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
});

test('lofts from a circle to the top face of a box', async ({ page }) => {
  const at = await circleAndBox(page);
  const viewport = viewportOf(page);
  await pickTool(page, 'Loft');
  const dialog = page.getByRole('region', { name: 'Loft dialog' });
  await expect(dialog).toBeVisible();
  await clickWhere(page, at, [40, 5, 0], /^profile:/);
  await clickWhere(page, at, [0, 0, 20], /^face:/);
  await expect(dialog.getByRole('button', { name: 'Sections', exact: true })).toHaveText(
    /2 sections/,
  );
  // A body's face proposes a join; a new body here.
  const operation = dialog.getByRole('combobox', { name: 'Operation' });
  await expect(operation).toHaveValue('join');
  await operation.selectOption('new-body');
  await expect(viewport).toHaveAttribute('data-preview', 'new', { timeout: 15_000 });
  await ok(page, dialog);
  await expect(chip(page, 'Loft1')).toHaveAccessibleName('Loft1');
  // Circle to square, smooth: five sides (OCCT lines the circle up in pieces) and two caps.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20 Body2:7:60,20,20');
});

test('makes a coil with its defaults, then edits its type and section', async ({ page }) => {
  await openProject(page);
  const viewport = viewportOf(page);
  const dialog = await startPrimitive(page, 'Coil');
  await expect(dialog.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
  await expect(dialog.getByRole('textbox', { name: 'Pitch', exact: true })).toHaveCount(0);
  await expect(viewport).toHaveAttribute('data-preview', 'new', { timeout: 15_000 });
  expect(await attr(viewport.locator('[data-manipulators]'), 'data-manipulators')).toBe(
    'distance:diameter distance:height',
  );
  await ok(page, dialog);
  // 5 turns of a 2 mm wire on 20 mm, 20 mm high (a face per turn): the wire's half below the plane.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:22,22,22');

  await chip(page, 'Coil1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Coil1 dialog' });
  await edit.getByRole('combobox', { name: 'Type' }).selectOption('height-pitch');
  await expect(edit.getByRole('textbox', { name: 'Revolutions', exact: true })).toHaveCount(0);
  await edit.getByRole('textbox', { name: 'Pitch', exact: true }).fill('5 mm');
  await edit.getByRole('combobox', { name: 'Section', exact: true }).selectOption('square');
  await ok(page, edit);
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:18:22,22,22');

  // A pitch the wire doesn't fit in is refused in words.
  await chip(page, 'Coil1').dblclick();
  const again = page.getByRole('region', { name: 'Edit Coil1 dialog' });
  await again.getByRole('textbox', { name: 'Pitch', exact: true }).fill('1 mm');
  await expect(again.getByRole('status', { name: 'Feature status' })).toContainText(
    'as tall as the pitch',
    { timeout: 15_000 },
  );
  await again.getByRole('button', { name: /^Cancel Esc/ }).click();
});
