import { expect, type Page, test } from '@playwright/test';

// P0-07: the Parameters dialog on the debug page. Values update live, unit
// errors and cycles show inline and are never committed, and every change is
// undoable (FR-PAR-01, -02, -04).

const expression = (page: Page, name: string) =>
  page.getByRole('textbox', { name: `Expression of ${name}`, exact: true });

async function setExpression(page: Page, name: string, value: string) {
  const field = expression(page, name);
  await field.fill(value);
  await field.press('Enter');
}

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('./#/debug/parameters');
  await expect(page.getByRole('dialog', { name: 'Parameters' })).toBeVisible();
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('shows live values and updates dependents, with undo', async ({ page }) => {
  await expect(expression(page, 'inner')).toHaveAccessibleDescription('= 75.20 mm');
  await expect(expression(page, 'd1')).toHaveAccessibleDescription('= 18.80 mm');

  await setExpression(page, 'wall', '3 mm');
  await expect(expression(page, 'inner')).toHaveAccessibleDescription('= 74.00 mm');
  await expect(expression(page, 'd1')).toHaveAccessibleDescription('= 18.50 mm');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(expression(page, 'wall')).toHaveValue('2.4 mm');
  await expect(expression(page, 'inner')).toHaveAccessibleDescription('= 75.20 mm');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(expression(page, 'wall')).toHaveValue('3 mm');
});

test('shows a unit error inline and never commits it', async ({ page }) => {
  const wall = expression(page, 'wall');
  await wall.fill('10 mm + 5 deg');
  await expect(wall).toHaveAttribute('aria-invalid', 'true');
  await expect(wall).toHaveAccessibleDescription("Can't add a length and an angle.");

  // Enter and blur don't commit an invalid expression.
  await wall.press('Enter');
  await wall.press('Tab');
  await expect(expression(page, 'inner')).toHaveAccessibleDescription('= 75.20 mm');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  // Esc goes back to the committed expression and keeps the dialog open.
  await wall.focus();
  await wall.press('Escape');
  await expect(wall).toHaveValue('2.4 mm');
  await expect(wall).not.toHaveAttribute('aria-invalid');
  await expect(page.getByRole('dialog', { name: 'Parameters' })).toBeVisible();
});

test('reports a circular reference with its path', async ({ page }) => {
  const width = expression(page, 'width');
  await width.fill('inner + 1 mm');
  await expect(width).toHaveAccessibleDescription('width refers to itself: width → inner → width.');
  await width.press('Escape');
  await expect(width).toHaveValue('80 mm');
});

test('adds, renames and deletes parameters', async ({ page }) => {
  await page.getByRole('textbox', { name: 'New parameter name' }).fill('lid');
  const newExpression = page.getByRole('textbox', { name: 'New parameter expression' });
  await newExpression.fill('inner / 2');
  await expect(newExpression).toHaveAccessibleDescription('= 37.60 mm');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(expression(page, 'lid')).toHaveAccessibleDescription('= 37.60 mm');
  await expect(newExpression).toHaveValue('');

  // A name that is taken is refused with a message.
  await page.getByRole('textbox', { name: 'New parameter name' }).fill('width');
  await newExpression.fill('1 mm');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('A parameter named "width" already exists.');

  // Renaming carries over to the expressions that use the parameter.
  const name = page.getByRole('textbox', { name: 'Name of wall' });
  await name.fill('thickness');
  await name.press('Enter');
  await expect(expression(page, 'inner')).toHaveValue('width - 2 * thickness');

  // A parameter in use can't be deleted; an unused one can.
  await page.getByRole('button', { name: 'Delete thickness' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'thickness is used by inner. Change that first.',
  );
  await page.getByRole('button', { name: 'Delete lid' }).click();
  await expect(expression(page, 'lid')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(expression(page, 'lid')).toHaveCount(1);
});
