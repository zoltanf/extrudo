import { expect, type Page, test } from '@playwright/test';
import { primitive, selectBodies, turnView } from './benchmark-helpers';
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
  test.setTimeout(90_000);
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

const componentMenu = (page: Page, name: string) =>
  componentLeaf(page, name).locator('[data-drop]').first().click({ button: 'right' });

// P6-05 S4 (ADR-0081 §6): the active component stamps new features, isolation draws and picks
// only one component.
test('an active component takes new bodies, isolation shows only it', async ({ page }) => {
  test.setTimeout(90_000);
  await openProject(page);
  await primitive(page, 'Box', {});
  await kernelReady(page);
  const viewport = viewportOf(page);
  await expect(viewport).not.toHaveAttribute('data-active-component');

  // New Component activates what it made.
  await selectBodies(page, ['Body1']);
  await pickTool(page, 'New Component');
  await row(page, 'Component1').focus();
  await page.keyboard.press('F2');
  const field = browserOf(page).getByRole('textbox', { name: 'Rename Component1' });
  await field.fill('Lid');
  await field.press('Enter');
  await expect(viewport).toHaveAttribute('data-active-component', 'Lid');
  await expect(componentLeaf(page, 'Lid')).toHaveAttribute('data-component-active', '');
  await expect(page.locator('button[data-active-component="Lid"]')).toHaveText('Active: Lid');

  // A new primitive joins it; stamped features say so in their chip's tooltip.
  await primitive(page, 'Box', { X: '60 mm' });
  await expect(viewport).toHaveAttribute('data-components', 'Lid:Body1,Body2');

  // Deactivate from the status bar: the next body is loose.
  await page.locator('button[data-active-component="Lid"]').click();
  await page.getByRole('menuitem', { name: 'Deactivate' }).click();
  await expect(viewport).not.toHaveAttribute('data-active-component');
  await expect(page.locator('button[data-active-component]')).toHaveCount(0);
  await primitive(page, 'Box', { X: '-60 mm' });
  await expect(viewport).toHaveAttribute('data-components', 'Lid:Body1,Body2');
  await expect(bodyLeaf(page, 'Body3')).not.toHaveAttribute('data-body-component', /.+/);

  // The row menu activates again.
  await componentMenu(page, 'Lid');
  await page.getByRole('menuitem', { name: 'Activate', exact: true }).click();
  await expect(viewport).toHaveAttribute('data-active-component', 'Lid');
  await expect(viewport).not.toHaveAttribute('data-isolated');

  // The loose body picks in the view (home view, top of its box).
  const view = await turnView(page, 'Shift+1');
  const looseTop = [-60, 0, 20] as const;
  await page.mouse.move(view(looseTop).x, view(looseTop).y);
  await page.mouse.click(view(looseTop).x, view(looseTop).y);
  await expect(viewport).toHaveAttribute('data-model-selection', /body|face/);
  await page.keyboard.press('Escape');

  // Isolate Lid: only its bodies are drawn, the other rows are dimmed, and the loose body
  // can't be picked where it was.
  await componentMenu(page, 'Lid');
  await page.getByRole('menuitem', { name: 'Isolate', exact: true }).click();
  await expect(viewport).toHaveAttribute('data-isolated', 'Lid');
  await expect(page.locator('[data-isolation-bar]')).toHaveText(/Showing Lid only/);
  const bodies = (await viewport.getAttribute('data-bodies')) ?? '';
  expect(bodies).toMatch(/Body1:/);
  expect(bodies).toMatch(/Body2:/);
  expect(bodies).not.toMatch(/Body3:/);
  await page.mouse.click(view(looseTop).x, view(looseTop).y);
  await expect(viewport).not.toHaveAttribute('data-model-selection', /.+/);

  // Exit isolation brings everything back.
  await page
    .locator('[data-isolation-bar]')
    .getByRole('button', { name: 'Exit isolation' })
    .click();
  await expect(viewport).not.toHaveAttribute('data-isolated');
  await expect(viewport).toHaveAttribute('data-bodies', /Body1:.*Body2:.*Body3:/);
});

test('undoing New Component clears the active marker', async ({ page }) => {
  await openProject(page);
  await primitive(page, 'Box', {});
  await kernelReady(page);
  const viewport = viewportOf(page);
  await selectBodies(page, ['Body1']);
  await pickTool(page, 'New Component');
  await expect(viewport).toHaveAttribute('data-active-component', 'Component1');
  await page.keyboard.press('Control+z');
  await expect(viewport).not.toHaveAttribute('data-components');
  await expect(viewport).not.toHaveAttribute('data-active-component');
});
