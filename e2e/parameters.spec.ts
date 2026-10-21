import { expect, type Page, test } from '@playwright/test';
import {
  addUserParameter,
  openProject,
  parameterExpression,
  parametersDialog,
  pickTool,
  selectParameter,
} from './helpers';

// P0-07, ADR-0086: the Parameters dialog, opened from the toolbar (P0-04): a
// list of the parameters on the left (by group once one has a group, then the
// model parameters), the selected one's settings on the right. Values update
// live, unit errors and cycles show inline and are never committed, and every
// change is undoable (FR-PAR-01, -02, -04).

const row = (page: Page, name: string) =>
  parametersDialog(page).locator(`[data-parameter-row="${name}"]`);

/** The list's sections and their rows, as "Section: a,b". */
async function sections(page: Page): Promise<string[]> {
  return parametersDialog(page)
    .locator('[data-parameter-section]')
    .evaluateAll((list) =>
      list.map(
        (s) =>
          `${s.getAttribute('data-parameter-section')}: ${[
            ...s.querySelectorAll('[data-parameter-row]'),
          ]
            .map((r) => r.getAttribute('data-parameter-row'))
            .join(',')}`,
      ),
    );
}

async function setExpression(page: Page, name: string, value: string) {
  const field = await parameterExpression(page, name);
  await field.fill(value);
  await field.press('Enter');
}

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await openProject(page, 'wall-bracket');
  await pickTool(page, 'Parameters');
  await expect(parametersDialog(page)).toBeVisible();
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('lists the parameters by group with live values, and updates dependents, with undo', async ({
  page,
}) => {
  // The template groups its exposed parameters; the rest are under General.
  expect(await sections(page)).toEqual([
    'General: inner,holes',
    'Size: width',
    'Walls: wall',
    'Holes: tilt',
  ]);
  await expect(row(page, 'inner')).toContainText('75.20 mm');
  await expect(await parameterExpression(page, 'd1')).toHaveAccessibleDescription('= 80.00 mm');
  await expect(await parameterExpression(page, 'd3')).toHaveAccessibleDescription('= 12.00 mm');

  await setExpression(page, 'wall', '3 mm');
  await expect(row(page, 'inner')).toContainText('74.00 mm');
  await expect(row(page, 'd3')).toContainText('15.00 mm');

  const dialog = parametersDialog(page);
  await dialog.getByRole('button', { name: 'Undo' }).click();
  await expect(await parameterExpression(page, 'wall')).toHaveValue('2.4 mm');
  await expect(row(page, 'inner')).toContainText('75.20 mm');
  await dialog.getByRole('button', { name: 'Redo' }).click();
  await expect(await parameterExpression(page, 'wall')).toHaveValue('3 mm');
});

test('shows a unit error inline and never commits it', async ({ page }) => {
  const wall = await parameterExpression(page, 'wall');
  await wall.fill('10 mm + 5 deg');
  await expect(wall).toHaveAttribute('aria-invalid', 'true');
  await expect(wall).toHaveAccessibleDescription("Can't add a length and an angle.");

  // Enter and blur don't commit an invalid expression.
  await wall.press('Enter');
  await wall.press('Tab');
  await expect(row(page, 'inner')).toContainText('75.20 mm');
  await expect(parametersDialog(page).getByRole('button', { name: 'Undo' })).toBeDisabled();

  // Esc goes back to the committed expression and keeps the dialog open;
  // a second Esc, with nothing to revert, closes it.
  await wall.focus();
  await wall.press('Escape');
  await expect(wall).toHaveValue('2.4 mm');
  await expect(wall).not.toHaveAttribute('aria-invalid');
  await expect(parametersDialog(page)).toBeVisible();
  await wall.press('Escape');
  await expect(parametersDialog(page)).toBeHidden();
});

test('reports a circular reference with its path', async ({ page }) => {
  const width = await parameterExpression(page, 'width');
  await width.fill('inner + 1 mm');
  await expect(width).toHaveAccessibleDescription('width refers to itself: width → inner → width.');
  await width.press('Escape');
  await expect(width).toHaveValue('80 mm');
});

test('completes parameter names, without the ones that use the field (ADR-0096)', async ({
  page,
}) => {
  const wall = await parameterExpression(page, 'wall');
  const list = page.getByRole('listbox', { name: 'Parameters for Expression of wall' });
  const options = list.getByRole('option');

  // A part of the name, in any case; the list shows each value.
  await wall.fill('');
  await wall.pressSequentially('2 * WID');
  await expect(options.first()).toHaveText('width = 80.00 mm');
  await wall.press('ArrowDown');
  await expect(wall).toHaveAttribute('aria-activedescendant', /.+/);
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await wall.press('Enter');
  await expect(wall).toHaveValue('2 * width');
  await expect(list).toBeHidden();
  // A name typed out in full, with nothing longer, shows no list.
  await wall.press('Backspace');
  await expect(options.first()).toHaveText('width = 80.00 mm');
  await wall.press('h');
  await expect(list).toBeHidden();

  // `inner` is `width - 2 * wall`: offering it here would make a cycle.
  await wall.pressSequentially(' - i');
  await expect(options.first()).toBeVisible();
  expect(await options.allInnerTexts()).not.toContainEqual(expect.stringMatching(/^inner/));

  // Esc closes the list first, then reverts the field; the dialog stays open.
  await wall.press('Escape');
  await expect(list).toBeHidden();
  await expect(wall).toHaveValue('2 * width - i');
  await wall.press('Escape');
  await expect(wall).toHaveValue('2.4 mm');
  await expect(parametersDialog(page)).toBeVisible();

  // Ctrl+Space lists every name in scope; Tab inserts the first.
  await wall.fill('');
  await wall.press('Control+Space');
  await expect(options.first()).toBeVisible();
  await wall.press('Tab');
  await expect(wall).toBeFocused();
  await expect(wall).not.toHaveValue('');
  await expect(list).toBeHidden();
});

test('adds, renames and deletes parameters', async ({ page }) => {
  const dialog = parametersDialog(page);
  await dialog.getByRole('button', { name: 'New parameter', exact: true }).click();
  const newExpression = dialog.getByRole('textbox', { name: 'New parameter expression' });
  await dialog.getByRole('textbox', { name: 'New parameter name' }).fill('lid');
  await newExpression.fill('inner / 2');
  await expect(newExpression).toHaveAccessibleDescription('= 37.60 mm');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  // The new parameter is selected, and its row is in General.
  const lid = dialog.getByRole('textbox', { name: 'Expression of lid', exact: true });
  await expect(lid).toHaveAccessibleDescription('= 37.60 mm');
  await expect(row(page, 'lid')).toHaveAttribute('aria-current', 'true');

  // A name that is taken is refused with a message.
  await dialog.getByRole('button', { name: 'New parameter', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'New parameter name' }).fill('width');
  await newExpression.fill('1 mm');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('A parameter named "width" already exists.');

  // Renaming carries over to the expressions that use the parameter.
  await selectParameter(page, 'wall');
  const name = dialog.getByRole('textbox', { name: 'Name of wall' });
  await name.fill('thickness');
  await name.press('Enter');
  await expect(await parameterExpression(page, 'inner')).toHaveValue('width - 2 * thickness');

  // A parameter in use can't be deleted; an unused one can.
  await selectParameter(page, 'thickness');
  await dialog.getByRole('button', { name: 'Delete thickness' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'thickness is used by inner, Extrude2 and Fillet1. Change those first.',
  );
  await selectParameter(page, 'lid');
  await dialog.getByRole('button', { name: 'Delete lid' }).click();
  await expect(row(page, 'lid')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'lid')).toHaveCount(1);
});

test('groups sort the list, and a drag or Alt+arrow reorders it', async ({ page }) => {
  const dialog = parametersDialog(page);
  // A new group, typed in place, takes holes out of General.
  await selectParameter(page, 'holes');
  await dialog.getByRole('button', { name: 'New group' }).click();
  await dialog.getByRole('textbox', { name: 'New group name' }).fill('Pattern');
  await dialog.getByRole('textbox', { name: 'New group name' }).press('Enter');
  expect(await sections(page)).toEqual([
    'General: inner',
    'Size: width',
    'Walls: wall',
    'Holes: tilt',
    'Pattern: holes',
  ]);
  await expect(
    dialog.getByRole('group', { name: 'Group of holes' }).getByRole('button', { name: 'Pattern' }),
  ).toHaveAttribute('aria-pressed', 'true');

  // A drag onto the top half of width puts holes before it, in Size; the
  // emptied Pattern group goes away.
  await row(page, 'holes').dragTo(row(page, 'width'), { targetPosition: { x: 40, y: 4 } });
  expect(await sections(page)).toEqual([
    'General: inner',
    'Size: holes,width',
    'Walls: wall',
    'Holes: tilt',
  ]);

  // Alt+↓ moves it past width; one undo each.
  await row(page, 'holes').focus();
  await page.keyboard.press('Alt+ArrowDown');
  expect(await sections(page)).toContain('Size: width,holes');
  await dialog.getByRole('button', { name: 'Undo' }).click();
  expect(await sections(page)).toContain('Size: holes,width');
  await dialog.getByRole('button', { name: 'Undo' }).click();
  expect(await sections(page)).toContain('Pattern: holes');
});

test('a design without groups has one flat list', async ({ page }) => {
  await page.keyboard.press('Escape');
  await openProject(page, 'blank');
  await pickTool(page, 'Parameters');
  // No parameters yet: the New parameter form is what the dialog shows.
  await addUserParameter(page, 'length', '40 mm');
  await addUserParameter(page, 'width', 'length / 2');
  expect(await sections(page)).toEqual(['User parameters: length,width']);
  await expect(row(page, 'width')).toContainText('ƒx');
  await expect(row(page, 'width')).toContainText('20.00 mm');
});

test('keeps a formula slider range, and refuses one that moves with the parameter', async ({
  page,
}) => {
  const dialog = parametersDialog(page);
  await selectParameter(page, 'wall');
  const max = dialog.getByRole('textbox', { name: 'Max of wall', exact: true });
  await max.fill('width / 20');
  await max.press('Enter');
  await expect(max).toHaveAccessibleDescription('= 4.00 mm');

  // The formula is what is stored: it reads back after closing.
  await page.keyboard.press('Escape');
  await pickTool(page, 'Parameters');
  await selectParameter(page, 'wall');
  await expect(max).toHaveValue('width / 20');

  // inner changes with width, so width's range can't use it.
  await selectParameter(page, 'width');
  const min = dialog.getByRole('textbox', { name: 'Min of width', exact: true });
  await min.fill('inner - 10 mm');
  await expect(min).toHaveAttribute('aria-invalid', 'true');
  await expect(min).toHaveAccessibleDescription(
    "The range can't use inner: it changes with width.",
  );
  await min.press('Escape');
  await expect(min).toHaveValue('40 mm');

  // What uses width, wall's range included; a parameter's chip selects it.
  await expect(dialog.getByRole('button', { name: 'wall · Max' })).toBeVisible();
  await dialog.getByRole('button', { name: 'inner', exact: true }).click();
  await expect(row(page, 'inner')).toHaveAttribute('aria-current', 'true');
});
