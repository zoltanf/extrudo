import { expect, type Locator, type Page, test } from '@playwright/test';
import { kernelReady, openProject, pickTool, saveStatus } from './helpers';

// Named views (ADR-0008's amendment, 2026-10-10): the nav bar's Named views
// menu saves the camera and restores a view; the browser's Named views folder
// lists them with restore, update, rename and delete; the save and the delete
// are document commands (one undo step) and survive a reload.

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const nav = (page: Page) => page.getByRole('navigation', { name: 'View navigation' });
const viewsButton = (page: Page) => nav(page).getByRole('button', { name: 'Named views' });
const viewsMenu = (page: Page) => page.getByRole('menu', { name: 'Named views' });
const browser = (page: Page) => page.getByRole('complementary', { name: 'Browser' });

/** Waits until the camera has stopped moving (its size, target, direction and shift stay put). */
async function cameraSettled(viewport: Locator) {
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
}

/** Opens the Named views folder in the browser (a second click would close it). */
async function openViewsFolder(page: Page) {
  const folder = browser(page).getByRole('button', { name: 'Named views' });
  if ((await folder.getAttribute('aria-expanded')) !== 'true') await folder.click();
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
}

/** Saves the current camera through the nav bar's prompt, with the given name. */
async function saveCurrentView(page: Page, name: string) {
  await viewsButton(page).click();
  await viewsMenu(page).getByRole('menuitem', { name: 'Save Current View…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save current view' });
  await expect(dialog).toBeVisible();
  const nameField = dialog.getByRole('textbox', { name: 'Name' });
  await expect(nameField).toBeFocused();
  await nameField.fill(name);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('saves the current view and lists it in the menu and the browser', async ({ page }) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);

  // The Bottom view is the camera to save.
  await page.keyboard.press('Shift+3');
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,1');
  await expect(viewport).toHaveAttribute('data-camera-up', '0,-1,0');

  // The prompt prefills the default name "View1"; saving keeps it.
  await viewsButton(page).click();
  await expect(viewsMenu(page).getByText('No named views yet.')).toBeVisible();
  await viewsMenu(page).getByRole('menuitem', { name: 'Save Current View…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save current view' });
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('View1');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  // The menu lists the view; a click restores it.
  await viewsButton(page).click();
  await expect(viewsMenu(page).getByRole('menuitem', { name: 'View1', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  // The browser's Named views folder has the row.
  await openViewsFolder(page);
  await expect(browser(page).getByRole('button', { name: 'View1', exact: true })).toBeVisible();
});

test('restoring a view turns the camera back, from the menu and the browser row', async ({
  page,
}) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);

  await page.keyboard.press('Shift+3');
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,1');
  await saveCurrentView(page, 'Bottomish');
  await expect(viewsButton(page)).toBeVisible();

  // Home view, then restore from the nav bar's menu: the Bottom view returns.
  await page.keyboard.press('Shift+1');
  await expect(viewport).toHaveAttribute('data-camera-direction', '-0.577,0.577,-0.577');
  await viewsButton(page).click();
  await viewsMenu(page).getByRole('menuitem', { name: 'Bottomish', exact: true }).click();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,1');
  await expect(viewport).toHaveAttribute('data-camera-up', '0,-1,0');

  // The same from the browser row.
  await page.keyboard.press('Shift+1');
  await expect(viewport).toHaveAttribute('data-camera-direction', '-0.577,0.577,-0.577');
  await openViewsFolder(page);
  await browser(page).getByRole('button', { name: 'Bottomish', exact: true }).click();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,1');
});

test('renames with F2 and deletes from the browser row', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await saveCurrentView(page, 'View1');
  await openViewsFolder(page);
  const row = browser(page).getByRole('button', { name: 'View1', exact: true });

  // F2 renames, as on the other rows.
  await row.click();
  await page.keyboard.press('F2');
  const field = browser(page).getByRole('textbox', { name: 'Rename View1' });
  await expect(field).toBeFocused();
  await field.fill('The Back');
  await page.keyboard.press('Enter');
  await expect(browser(page).getByRole('button', { name: 'The Back', exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);

  // The row's menu: Update to Current View and Delete (menu item names end
  // with their shortcut, "Delete Del").
  await browser(page).getByRole('button', { name: 'The Back', exact: true }).click({
    button: 'right',
  });
  const menu = page.getByRole('menu', { name: 'The Back menu' });
  await menu.getByRole('menuitem', { name: 'Update to Current View' }).click();
  await expect(menu).toBeHidden();
  await browser(page).getByRole('button', { name: 'The Back', exact: true }).click({
    button: 'right',
  });
  await page
    .getByRole('menu', { name: 'The Back menu' })
    .getByRole('menuitem', { name: /^Delete/ })
    .click();
  await expect(browser(page).getByRole('button', { name: 'The Back', exact: true })).toHaveCount(0);
  await openViewsFolder(page);
  await expect(browser(page).getByText('No named views yet')).toBeVisible();

  // The delete was one command: undo brings the view back.
  await page.keyboard.press('Control+z');
  await expect(browser(page).getByRole('button', { name: 'The Back', exact: true })).toBeVisible();
});

test('Ctrl+Z after Save removes the view', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await saveCurrentView(page, 'View1');
  await openViewsFolder(page);
  await expect(browser(page).getByRole('button', { name: 'View1', exact: true })).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(browser(page).getByRole('button', { name: 'View1', exact: true })).toHaveCount(0);
  await expect(browser(page).getByText('No named views yet')).toBeVisible();
});

test('a reload keeps the saved views', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await saveCurrentView(page, 'Kept');
  await expect(saveStatus(page)).toHaveText('Saved', { timeout: 20_000 });
  await page.reload();
  await kernelReady(page);
  await openViewsFolder(page);
  await expect(browser(page).getByRole('button', { name: 'Kept', exact: true })).toBeVisible();
});

test('an orthographic view restores with its size; the projection comes back too', async ({
  page,
}) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);

  await nav(page).getByRole('button', { name: 'Orthographic' }).click();
  await expect(viewport).toHaveAttribute('data-camera-projection', 'orthographic');
  await page.keyboard.press('Shift+4');
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,1,0');
  await cameraSettled(viewport);
  const savedSize = await viewport.getAttribute('data-camera-size');

  // Away (a refit changes the size), then restore: the size and the
  // projection are the saved ones.
  await saveCurrentView(page, 'Front exact');
  await page.keyboard.press('Shift+1');
  await expect(viewport).toHaveAttribute('data-camera-direction', '-0.577,0.577,-0.577');
  expect(await viewport.getAttribute('data-camera-size')).not.toBe(savedSize);
  await viewsButton(page).click();
  await viewsMenu(page).getByRole('menuitem', { name: 'Front exact', exact: true }).click();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,1,0');
  await expect(viewport).toHaveAttribute('data-camera-size', savedSize ?? '');

  // A perspective view saved while orthographic was on restores perspective.
  await nav(page).getByRole('button', { name: 'Orthographic' }).click();
  await expect(viewport).toHaveAttribute('data-camera-projection', 'perspective');
  await page.keyboard.press('Shift+4');
  await saveCurrentView(page, 'Front look');
  await page.keyboard.press('Shift+1');
  await viewsButton(page).click();
  await viewsMenu(page).getByRole('menuitem', { name: 'Front look', exact: true }).click();
  await expect(viewport).toHaveAttribute('data-camera-projection', 'perspective');
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,1,0');
});

test('a view keeps the section shown when it was saved; one without leaves the section alone', async ({
  page,
}) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);

  // A section on the XY plane at 10 mm.
  await pickTool(page, 'Section Analysis');
  const tool = page.getByRole('region', { name: 'Section Analysis' });
  await tool.getByRole('button', { name: 'XY plane' }).click();
  await expect(tool).toHaveAttribute('data-section-state', 'on');
  await tool.getByRole('textbox', { name: 'Offset', exact: true }).fill('10 mm');
  await tool.getByRole('textbox', { name: 'Offset', exact: true }).press('Enter');
  await expect(viewport).toHaveAttribute('data-section', 'origin:xy offset=10 mm on');
  await cameraSettled(viewport);
  const savedCamera = await Promise.all(
    ['size', 'target', 'direction'].map((k) => viewport.getAttribute(`data-camera-${k}`)),
  );
  await saveCurrentView(page, 'Cut');

  // The browser row and the menu entry carry the mark; the button keeps the view's name.
  await openViewsFolder(page);
  const row = browser(page).locator('[data-view-section="planes:1"]');
  await expect(row).toContainText('1 plane');
  await expect(row.getByRole('button', { name: 'Cut', exact: true })).toBeVisible();
  await viewsButton(page).click();
  await expect(
    viewsMenu(page).locator('[data-view-section="planes:1"]').getByText('Cut'),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  // Remove the section, go home, restore "Cut": the section and the camera come back.
  await tool.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(viewport).not.toHaveAttribute('data-section', /./);
  await page.keyboard.press('Shift+1');
  await cameraSettled(viewport);
  await saveCurrentView(page, 'Plain');
  await viewsButton(page).click();
  await viewsMenu(page).getByRole('menuitem', { name: 'Cut', exact: true }).click();
  await expect(viewport).toHaveAttribute('data-section', 'origin:xy offset=10 mm on');
  await expect(viewport).toHaveAttribute('data-camera-direction', savedCamera[2] ?? '');
  await cameraSettled(viewport);
  expect(
    await Promise.all(
      ['size', 'target', 'direction'].map((k) => viewport.getAttribute(`data-camera-${k}`)),
    ),
  ).toEqual(savedCamera);

  // "Plain" was saved with no section: no mark, and restoring it (the cut is on screen again)
  // leaves the section alone.
  await expect(browser(page).locator('[data-view]', { hasText: 'Plain' })).not.toHaveAttribute(
    'data-view-section',
    /./,
  );
  await viewsButton(page).click();
  await viewsMenu(page).getByRole('menuitem', { name: 'Plain', exact: true }).click();
  await cameraSettled(viewport);
  await expect(viewport).toHaveAttribute('data-section', 'origin:xy offset=10 mm on');

  // It survives a reload.
  await expect(saveStatus(page)).toHaveText('Saved', { timeout: 20_000 });
  await page.reload();
  await kernelReady(page);
  await openViewsFolder(page);
  await expect(browser(page).locator('[data-view-section="planes:1"]')).toContainText('Cut');
});
