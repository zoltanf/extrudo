import { expect, type Page, test } from '@playwright/test';
import { primitive, selectBodies } from './benchmark-helpers';
import { kernelReady, openProject, pickTool } from './helpers';

// P6-05 S3 (ADR-0081): components in the browser. A component is a named set of bodies
// (metadata on the body): New Component, rename, drag a body in and out, the body menu's
// Move to Component, the eye (shown, ghost, hidden), Delete Component, undo.

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
const row = (page: Page, name: string) =>
  browserOf(page).getByRole('button', { name, exact: true });
const bodyLeaf = (page: Page, name: string) =>
  browserOf(page)
    .locator('[data-body]')
    .filter({ has: page.getByRole('button', { name, exact: true }) });
const componentLeaf = (page: Page, name: string) =>
  browserOf(page)
    .locator('[data-component]')
    .filter({ has: page.getByRole('button', { name, exact: true }) });
const bodiesHeader = (page: Page) => browserOf(page).locator('[data-drop="bodies"]');

test('components organise, show, ghost, hide and delete as a unit', async ({ page }) => {
  await openProject(page);
  await primitive(page, 'Box', {});
  await primitive(page, 'Box', { X: '60 mm' });
  await kernelReady(page);
  const viewport = viewportOf(page);
  await expect(viewport).not.toHaveAttribute('data-components');

  // New Component gathers the selected bodies and numbers itself.
  await selectBodies(page, ['Body1', 'Body2']);
  await pickTool(page, 'New Component');
  await expect(viewport).toHaveAttribute('data-components', 'Component1:Body1,Body2');
  await expect(componentLeaf(page, 'Component1')).toHaveAttribute(
    'data-component-display',
    'shown',
  );
  await expect(bodyLeaf(page, 'Body1')).toHaveAttribute('data-body-component', /.+/);

  // F2 renames in place.
  await row(page, 'Component1').focus();
  await page.keyboard.press('F2');
  const field = browserOf(page).getByRole('textbox', { name: 'Rename Component1' });
  await field.fill('Lid');
  await field.press('Enter');
  await expect(viewport).toHaveAttribute('data-components', 'Lid:Body1,Body2');

  // A body row dragged onto the Bodies folder's header leaves its component.
  await row(page, 'Body2').click();
  await bodyLeaf(page, 'Body2').dragTo(bodiesHeader(page));
  await expect(viewport).toHaveAttribute('data-components', 'Lid:Body1');
  await expect(bodyLeaf(page, 'Body2')).not.toHaveAttribute('data-body-component', /.+/);

  // The body's menu moves it back into a component.
  await bodyLeaf(page, 'Body2').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to Component' }).click();
  await page.getByRole('menuitem', { name: 'Lid', exact: true }).click();
  await expect(viewport).toHaveAttribute('data-components', 'Lid:Body1,Body2');

  // The component's eye cycles shown → ghost → hidden → shown.
  await browserOf(page).getByRole('button', { name: 'Show as ghost Lid' }).click();
  await expect(componentLeaf(page, 'Lid')).toHaveAttribute('data-component-display', 'ghost');
  await expect(viewport).toHaveAttribute('data-ghost-bodies', 'Body1 Body2');
  await browserOf(page).getByRole('button', { name: 'Hide Lid' }).click();
  await expect(componentLeaf(page, 'Lid')).toHaveAttribute('data-component-display', 'hidden');
  await expect(viewport).not.toHaveAttribute('data-bodies');
  await expect(viewport).not.toHaveAttribute('data-ghost-bodies');
  await browserOf(page).getByRole('button', { name: 'Show Lid' }).click();
  await expect(viewport).toHaveAttribute('data-bodies', /Body1:.*Body2:/);

  // A click on the component selects all its bodies.
  await row(page, 'Lid').click();
  await expect
    .poll(async () => ((await viewport.getAttribute('data-model-selection')) ?? '').split(' '))
    .toHaveLength(2);
  expect(await viewport.getAttribute('data-model-selection')).toMatch(/^body:.* body:/);

  // Delete Component: the bodies stay, loose; one undo brings it back.
  await componentLeaf(page, 'Lid').locator('[data-drop]').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete Component' }).click();
  await expect(viewport).not.toHaveAttribute('data-components');
  await expect(viewport).toHaveAttribute('data-bodies', /Body1:.*Body2:/);
  await page.keyboard.press('Control+z');
  await expect(viewport).toHaveAttribute('data-components', 'Lid:Body1,Body2');
});
