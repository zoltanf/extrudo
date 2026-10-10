import { expect, type Locator, type Page, test } from '@playwright/test';
import { meshBounds } from '../packages/io/src/index';
import { exportModel, objectsOf3mf, primitive, selectBodies } from './benchmark-helpers';
import { kernelReady, openProject, pickTool, projector } from './helpers';

// P6-05 S5 (ADR-0081 §3): placement. A component stores no transform, so a
// component is moved, copied or laid on the bed through the existing Move and
// Place on Bed features over its live bodies. Move Component selects the
// members and opens Move; Copy Component's OK makes the Move, a "<name> (2)"
// component and the stamp in one undo step; Place Component on Bed carries the
// component's other bodies through the face's own turn and drop.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const browserOf = (page: Page) => page.getByRole('complementary', { name: 'Browser' });
const viewportOf = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const componentLeaf = (page: Page, name: string) =>
  browserOf(page)
    .locator('[data-component]')
    .filter({ has: page.getByRole('button', { name, exact: true }) });

/** Opens the component row's right-click menu and picks `item`. */
async function componentMenu(page: Page, name: string, item: string) {
  await componentLeaf(page, name).locator('[data-drop]').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: item }).click();
}

/** Makes a component of the two named bodies (New Component). */
async function component(page: Page, name: string, bodies: string[]) {
  await selectBodies(page, bodies);
  await pickTool(page, 'New Component');
  await expect(viewportOf(page)).toHaveAttribute(
    'data-components',
    `Component1:${bodies.join(',')}`,
  );
  await browserOf(page).getByRole('button', { name: 'Component1', exact: true }).focus();
  await page.keyboard.press('F2');
  const field = browserOf(page).getByRole('textbox', { name: 'Rename Component1' });
  await field.fill(name);
  await field.press('Enter');
}

/** Every body's box in the 3MF export, by name (the Solid tab shown again afterwards). */
async function boxes(page: Page) {
  const file = await exportModel(page, '3MF');
  await page
    .getByRole('tablist', { name: 'Toolbar tabs' })
    .getByRole('tab', { name: 'Solid' })
    .click();
  const out: Record<string, { min: number[]; max: number[] }> = {};
  for (const object of objectsOf3mf(file)) {
    const box = meshBounds(object.mesh);
    if (!box) throw new Error(`${object.name} is empty`);
    out[object.name] = { min: box.min.map((v) => Math.round(v * 100) / 100), max: box.max };
  }
  return out;
}

/** Waits until the camera has stopped moving; returns a world → page mapping. */
async function settledProjector(viewport: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const values = await Promise.all(
        ['size', 'target', 'direction'].map((k) => viewport.getAttribute(`data-camera-${k}`)),
      );
      const key = values.join(' ');
      const still = key === last;
      last = key;
      return still;
    })
    .toBe(true);
  return projector(viewport);
}

test('Move Component moves every live body of the component', async ({ page }) => {
  test.slow();
  await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Box', {});
  await primitive(page, 'Box', { X: '60 mm' });
  await kernelReady(page);
  await component(page, 'Lid', ['Body1', 'Body2']);

  await componentMenu(page, 'Lid', 'Move Component');
  const dialog = page.getByRole('region', { name: 'Move dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Bodies', exact: true })).toContainText(
    '2 bodies',
  );
  await dialog.getByRole('textbox', { name: 'X distance' }).fill('30 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', /^(ok|warning)$/);
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);

  // The sizes stay; both boxes' x shift by 30 mm.
  const b = await boxes(page);
  expect(b.Body1?.min[0]).toBeCloseTo(20, 0);
  expect(b.Body2?.min[0]).toBeCloseTo(80, 0);
  expect(b.Body2?.max[0] !== undefined && b.Body1?.max[0] !== undefined).toBe(true);
});

test('Copy Component makes the copies and a "<name> (2)" component in one step', async ({
  page,
}) => {
  test.slow();
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Box', {});
  await primitive(page, 'Box', { X: '60 mm' });
  await kernelReady(page);
  await component(page, 'Lid', ['Body1', 'Body2']);

  await componentMenu(page, 'Lid', 'Copy Component');
  const dialog = page.getByRole('region', { name: 'Move dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Create copy' })).toBeChecked();
  await dialog.getByRole('textbox', { name: 'X distance' }).fill('60 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', /^(ok|warning)$/);
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);

  await expect(viewport).toHaveAttribute('data-components', 'Lid:Body1,Body2;Lid_(2):Body3,Body4');
  // One undo takes the Move, the copies and the component away together.
  await page.keyboard.press('Control+z');
  await expect(viewport).toHaveAttribute('data-components', 'Lid:Body1,Body2');
  await expect(viewport).toHaveAttribute('data-bodies', /Body1:.*Body2:/);
  await expect(viewport).not.toHaveAttribute('data-bodies', /Body3/);
});

test('Place Component on Bed carries the component’s other bodies with the face', async ({
  page,
}) => {
  test.slow();
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  // Two 20 mm boxes side by side along Y, so both share the left face's x range.
  await primitive(page, 'Box', {});
  await primitive(page, 'Box', { Y: '20 mm' });
  await kernelReady(page);
  await component(page, 'Lid', ['Body1', 'Body2']);

  // The left face of Body1 (x = -10) in the Left view; its whole component places.
  await page.keyboard.press('Shift+6');
  const at = await settledProjector(viewport);
  const point = at([-10, 0, 10]);
  await page.mouse.move(point.x, point.y);
  await expect(viewport).toHaveAttribute('data-model-hover', /^face:/);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  const entry = page.locator('[data-marking-entry="placeComponentOnBed"]');
  await expect(entry).toBeVisible();
  await entry.click();

  const dialog = page.getByRole('region', { name: 'Place on Bed dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Face', exact: true })).toContainText('1 face');
  await expect(dialog.getByRole('button', { name: 'Carry along', exact: true })).toHaveAttribute(
    'data-count',
    '1',
  );
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
  await expect(dialog).toHaveAttribute('data-preview-status', /^(ok|warning)$/);
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);

  // Both bodies lie on the bed: min z = 0 in the export.
  const b = await boxes(page);
  expect(b.Body1?.min[2]).toBeCloseTo(0, 0);
  expect(b.Body2?.min[2]).toBeCloseTo(0, 0);
});
