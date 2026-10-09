import { expect, type Page, test } from '@playwright/test';
import { clicker, kernelReady, openProject, pickTool, sketchOnXY } from './helpers';

// P3-16 (ADR-0041): the notification history. The bell at the status bar's right
// edge (always there since 2026-10-10) opens the session's earlier notifications:
// errors in a group of their own on top, repeats counted, each action clickable
// while it still applies and disabled once it doesn't. Ctrl+K finds it too.

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

const bell = (page: Page) =>
  page
    .getByRole('region', { name: 'Timeline' })
    .getByRole('button', { name: /^Notification history/ });
const history = (page: Page) => page.getByRole('dialog', { name: 'Notification history' });
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });
const browser = (page: Page) => page.getByRole('complementary', { name: 'Browser' });

/** Dismisses every toast on screen. */
async function dismissAll(page: Page) {
  const dismiss = page.getByRole('button', { name: 'Dismiss' });
  while ((await dismiss.count()) > 0) await dismiss.first().click();
}

test('lists earlier notifications, errors first, with actions that still apply', async ({
  page,
}) => {
  const at = await sketchOnXY(page);
  const viewport = page.getByRole('region', { name: 'Viewport' });
  const click = clicker(page, at);
  // Nothing was notified yet: the bell is there, quiet, and the panel says so.
  await expect(bell(page)).toHaveAttribute('data-unread', '0');
  await expect(bell(page)).toHaveAccessibleName('Notification history');
  await bell(page).click();
  await expect(history(page).getByText('No notifications yet.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(history(page)).toBeHidden();
  await bell(page).blur();

  // A plate, extruded: a toast says Sketch1 is hidden (with Show).
  await page.keyboard.press('r');
  await click(-30, -20);
  await click(30, 20);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();
  const plate = at(15, 5);
  await page.mouse.move(plate.x, plate.y);
  await page.mouse.click(plate.x, plate.y);
  await expect.poll(() => viewport.getAttribute('data-model-selection')).toMatch(/^profile:/);
  await page.keyboard.press('e');
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(dialog).toBeVisible();
  await expect(viewport).toHaveAttribute('data-preview', 'new', { timeout: 15_000 });
  await page.keyboard.press('1');
  await page.keyboard.press('5');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  const hidden = page.getByRole('status').filter({ hasText: 'Sketch1 is hidden' });
  await expect(hidden).toBeVisible();
  await expect(bell(page)).toHaveAttribute('data-unread', '1');
  await dismissAll(page);
  // The toast is gone, the notification is not.
  await expect(hidden).toHaveCount(0);

  // An error, twice: deleting Sketch1 is refused while Extrude1 uses it.
  const refused = "Can't delete Sketch1: Extrude1 uses it. Change or delete that first.";
  for (let i = 0; i < 2; i++) {
    await chip(page, 'Sketch1').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Delete/ }).click();
    await expect(page.getByRole('alert').last()).toHaveText(refused);
  }
  await expect(bell(page)).toHaveAttribute('data-unread', '2');
  await expect(bell(page)).toHaveAttribute('data-unread-errors', '1');
  await expect(bell(page)).toHaveAccessibleName('Notification history, 2 new, 1 error');
  await dismissAll(page);

  // A newer, plain message: Ctrl+S saves a version.
  await page.keyboard.press('Control+s');
  await page.getByRole('dialog', { name: 'Versions' }).getByRole('textbox').fill('First');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Saved V1.' })).toBeVisible();
  await dismissAll(page);
  await expect(bell(page)).toHaveAttribute('data-unread', '3');

  // Open the history: newest first, but the error group leads.
  await bell(page).click();
  const panel = history(page);
  await expect(panel).toBeVisible();
  await expect(bell(page)).toHaveAttribute('data-unread', '0');
  const rows = panel.locator('[data-notification]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('data-notification', 'error');
  await expect(rows.nth(0)).toContainText(refused);
  // Counted once, twice.
  await expect(rows.nth(0).locator('[data-count]')).toHaveAttribute('data-count', '2');
  await expect(rows.nth(1)).toContainText('Saved V1.');
  await expect(rows.nth(2)).toContainText('Sketch1 is hidden: Extrude1 used its profile.');
  await expect(panel.getByRole('region', { name: 'Errors' })).toHaveCount(1);
  await expect(panel.getByRole('region', { name: 'Earlier' })).toHaveCount(1);

  // Show still applies: it shows the sketch, and then it has nothing left to do.
  const show = rows.nth(2).getByRole('button', { name: 'Show' });
  await expect(show).toBeEnabled();
  await show.click();
  await expect(browser(page).getByRole('button', { name: 'Hide Sketch1' })).toBeVisible();
  await expect(rows.nth(2).getByRole('button', { name: /^Show/ })).toBeDisabled();
  await expect(rows.nth(2).getByRole('button', { name: /^Show/ })).toHaveAccessibleName(
    'Show (no longer applies)',
  );
  // Undone while the panel is open: the panel asks again, and Show applies again (P3-17).
  await page.keyboard.press('Control+z');
  await expect(browser(page).getByRole('button', { name: 'Show Sketch1' })).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(rows.nth(2).getByRole('button', { name: 'Show' })).toBeEnabled();
  await page.keyboard.press('Control+y');
  await expect(rows.nth(2).getByRole('button', { name: /^Show/ })).toBeDisabled();

  // Esc closes the panel and gives the focus back to its button.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(bell(page)).toBeFocused();

  // Hiding the sketch again makes the action apply again.
  await browser(page).getByRole('button', { name: 'Hide Sketch1' }).click();
  await bell(page).click();
  await expect(rows.nth(2).getByRole('button', { name: 'Show' })).toBeEnabled();

  // Clear all empties the list; the bell stays, quiet.
  await panel.getByRole('button', { name: 'Clear all' }).click();
  await expect(panel.getByText('No notifications yet.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bell(page)).toHaveAttribute('data-unread', '0');

  // Ctrl+K opens the (empty) history too.
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('combobox', { name: 'Search commands' }).fill('notification');
  await expect(palette.getByRole('option').first()).toHaveAccessibleName(
    /^Notification History Panels/,
  );
  await page.keyboard.press('Enter');
  await expect(history(page)).toBeVisible();
  await expect(history(page).getByText('No notifications yet.')).toBeVisible();
});

test("a recompute's first new error goes into the history, with Edit (P3-13)", async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await expect(bell(page)).toHaveAttribute('data-unread', '0');

  // A width of 0 breaks Extrude1 (and what needs it): one quiet entry, no toast.
  await pickTool(page, 'Parameters');
  const parameters = page.getByRole('dialog', { name: 'Parameters' });
  const width = parameters.getByRole('textbox', { name: 'Expression of width', exact: true });
  await width.fill('0 mm');
  await width.press('Enter');
  await page.keyboard.press('Escape');
  await expect(chip(page, 'Extrude1')).toHaveAccessibleName(/error/);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName(/1 new, 1 error/);
  await bell(page).click();
  const panel = history(page);
  const errorsGroup = panel.getByRole('region', { name: /^Errors/ });
  await expect(errorsGroup.locator('[data-notification="error"]')).toHaveCount(1);
  await expect(errorsGroup).toContainText('Extrude1: ');
  const edit = errorsGroup.getByRole('button', { name: 'Edit', exact: true });
  await expect(edit).toBeEnabled();

  // Edit opens the feature's dialog.
  await edit.click();
  await expect(page.getByRole('region', { name: 'Edit Extrude1 dialog' })).toBeVisible();
  // The panel stays open after an action (ADR-0041); close it, then the dialog.
  await bell(page).click();
  await expect(history(page)).toBeHidden();
  await page.getByRole('button', { name: 'Cancel Esc' }).click();
  await expect(page.getByRole('region', { name: 'Edit Extrude1 dialog' })).toBeHidden();

  // Fixed: the action no longer applies.
  await page.keyboard.press('Control+z');
  await expect(chip(page, 'Extrude1')).not.toHaveAccessibleName(/error/);
  await bell(page).click();
  await expect(
    history(page).getByRole('button', { name: 'Edit (no longer applies)' }),
  ).toBeDisabled();
});
