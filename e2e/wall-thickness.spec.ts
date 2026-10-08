import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  addParameter,
  closeParameters,
  ok,
  openParameters,
  primitive,
  settled,
  solidTab,
} from './benchmark-helpers';
import { kernelReady, openProject, pickTool, projector } from './helpers';

// P5-06: the wall-thickness check (FR-3DP-07, ADR-0072). Rays from every triangle of the
// display mesh along its inward normal give the wall's thickness there; what is below the
// minimum is shaded, the thinnest wall is marked, and the panel and `data-thickness` on the
// Viewport region say what was found. The analysis is view state (like the overhang's): it
// follows every recompute and is not undoable.

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // A shader that fails to compile is a console error (the thin-wall patch, ADR-0072 §3).
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const printTab = (page: Page) =>
  page.getByRole('tablist', { name: 'Toolbar tabs' }).getByRole('tab', { name: '3D Print' });

async function openPrintTab(page: Page) {
  await printTab(page).click();
}

const panel = (page: Page) => page.getByRole('region', { name: 'Wall Thickness' });
const viewportOf = (page: Page) => page.getByRole('region', { name: 'Viewport' });

/** The summary's fields: `min`, `thin`, `area`, `thinnest`, `bodies`. */
async function counts(view: Locator) {
  const text = (await view.getAttribute('data-thickness')) ?? '';
  const get = (name: string) => new RegExp(`${name}=([^ ]+)`).exec(text)?.[1];
  return {
    text,
    min: get('min'),
    thin: Number(get('thin')),
    area: Number(get('area')),
    thinnest: get('thinnest'),
    bodies: Number(get('bodies')),
  };
}

const minimum = (page: Page) => panel(page).getByRole('textbox', { name: 'Minimum', exact: true });

/** Turns the check on with the panel open (3D Print › Wall Thickness). */
async function openCheck(page: Page) {
  await openPrintTab(page);
  await page.getByRole('button', { name: /^Wall Thickness/ }).click();
  await expect(panel(page)).toBeVisible();
  await expect(viewportOf(page)).toHaveAttribute('data-thickness', /thin=/);
}

/** A 20 mm cube from the Box tool (x, y −10…10, z 0…20), already computed. */
async function cube(page: Page) {
  await primitive(page, 'Box', {});
  await expect(viewportOf(page)).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
}

/** Shells the cube open at the top with 2 mm walls (the top face gets picked). */
async function shellTheCube(page: Page) {
  const view = viewportOf(page);
  await settled(view);
  const at = await projector(view);
  const { x, y } = at([0, 0, 20]);
  await page.mouse.move(x, y);
  await expect.poll(() => view.getAttribute('data-model-hover')).toMatch(/^face:/);
  await page.mouse.click(x, y);
  await expect(view).toHaveAttribute('data-model-selection', /^face:/);
  await solidTab(page);
  await pickTool(page, 'Shell');
  const dialog = page.getByRole('region', { name: 'Shell dialog' });
  await expect(dialog.getByRole('button', { name: 'Faces to remove', exact: true })).toHaveText(
    '1 face',
  );
  await dialog.getByRole('textbox', { name: 'Thickness', exact: true }).fill('2 mm');
  await ok(page, dialog);
  await expect(view).toHaveAttribute('data-bodies', 'Body1:11:20,20,20');
}

test('a 1 mm plate: nothing is thin at two line widths, everything at 1.5 mm', async ({ page }) => {
  const view = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await primitive(page, 'Box', { Length: '40', Width: '40', Height: '1' });
  await expect(view).toHaveAttribute('data-bodies', /Body1:6:40,40,1/);

  await openCheck(page);
  // Two line widths of the print material: 0.9 mm at the default 0.45 mm (ADR-0072 §2).
  await expect(minimum(page)).toHaveValue('0.9 mm');
  await expect(panel(page)).toContainText('No wall is thinner than 0.9 mm.');
  expect((await counts(view)).thin).toBe(0);

  // Above 1 mm: the plate's two large faces are thin, the thinnest wall is the plate itself.
  await minimum(page).fill('1.5 mm');
  await minimum(page).blur();
  await expect(view).toHaveAttribute('data-thickness', /min=1.5 thin=/);
  const at15 = await counts(view);
  expect(at15.thin).toBeGreaterThan(0);
  expect(at15.thinnest).toBe('1');
  expect(at15.area).toBeCloseTo(3200, 0);
  expect(at15.bodies).toBe(1);
  await expect(panel(page)).toContainText('Thinnest wall: 1.00 mm');
  await expect(panel(page)).toContainText('Thin area: 3200 mm² in 1 body');
});

test('a 20 mm cube is thick enough; shelled to 2 mm its walls are thin', async ({ page }) => {
  const view = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  await openCheck(page);
  await minimum(page).fill('5 mm');
  await minimum(page).blur();
  await expect(view).toHaveAttribute('data-thickness', /min=5 thin=0 /);
  await expect(panel(page)).toContainText('No wall is thinner than 5.0 mm.');

  await panel(page).getByRole('button', { name: /^Done/ }).click();
  await shellTheCube(page);
  await openCheck(page);
  await expect(view).toHaveAttribute('data-thickness', /min=5 thin=[1-9]/);
  const shelled = await counts(view);
  expect(shelled.thin).toBeGreaterThan(0);
  expect(shelled.thinnest).toBe('2');
  await expect(panel(page)).toContainText('Thinnest wall: 2.00 mm');
});

test('"Show thin walls" shades or not; the browser row toggles and removes the check', async ({
  page,
}) => {
  const view = viewportOf(page);
  const browser = page.getByRole('complementary', { name: 'Browser' });
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  await openCheck(page);
  await expect(browser.locator('[data-thickness-row="on"]')).toHaveText(/Wall thickness · 0.9 mm/);

  await panel(page).getByRole('checkbox', { name: 'Show thin walls' }).uncheck();
  await expect(view).toHaveAttribute('data-thickness', 'min=0.9 off');
  await expect(browser.locator('[data-thickness-row="off"]')).toBeVisible();
  await browser.getByRole('button', { name: 'Show wall thickness' }).click();
  await expect(view).toHaveAttribute('data-thickness', /thin=/);
  await expect(browser.locator('[data-thickness-row="on"]')).toBeVisible();

  await panel(page).getByRole('button', { name: 'Remove' }).click();
  await expect(panel(page)).toBeHidden();
  await expect(view).not.toHaveAttribute('data-thickness', /./);
  await expect(browser.locator('[data-thickness-row]')).toHaveCount(0);
});

test('a parameter in the Minimum field; undoing a feature leaves the check as it was', async ({
  page,
}) => {
  const view = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  // The parameter first, so the shell is the last command and Ctrl+Z reaches it.
  await openParameters(page);
  await addParameter(page, 'wall', '3 mm');
  await closeParameters(page);
  await shellTheCube(page);

  await openCheck(page);
  await minimum(page).fill('wall');
  await minimum(page).blur();
  await expect(view).toHaveAttribute('data-thickness', /min=3 thin=[1-9]/);
  const onWall = await counts(view);
  expect(onWall.thin).toBeGreaterThan(0);
  expect(onWall.thinnest).toBe('2');

  // Undoing the shell (a document feature) takes the feature out, not the check's settings.
  await page.keyboard.press('Control+z');
  await kernelReady(page);
  await expect(view).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
  await expect(view).toHaveAttribute('data-thickness', /min=3 thin=0 /);
  await expect(minimum(page)).toHaveValue('wall');
  await expect(panel(page).getByRole('checkbox', { name: 'Show thin walls' })).toBeChecked();
});

test('a hidden body is neither measured nor counted', async ({ page }) => {
  const view = viewportOf(page);
  const browser = page.getByRole('complementary', { name: 'Browser' });
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  await shellTheCube(page);
  await openCheck(page);
  await minimum(page).fill('5 mm');
  await minimum(page).blur();
  await expect(view).toHaveAttribute('data-thickness', /min=5 thin=[1-9]/);
  expect((await counts(view)).bodies).toBe(1);

  await browser.getByRole('button', { name: 'Hide Body1' }).click();
  await expect(view).toHaveAttribute(
    'data-thickness',
    'min=5 thin=0 area=0 thinnest=none bodies=0',
  );
  await expect(panel(page)).toContainText('No wall is thinner than 5.0 mm.');
});

// The timings of ADR-0072's Results: how long the Wall bracket takes, from the click to the
// counts (the display mesh is small: one synchronous pass, the numbers land a frame later).
test('the Wall bracket measures when the check opens (timing)', async ({ page }) => {
  const view = viewportOf(page);
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await openPrintTab(page);
  const start = Date.now();
  await page.getByRole('button', { name: /^Wall Thickness/ }).click();
  await expect(view).toHaveAttribute('data-thickness', /thin=/);
  console.log(
    `wall bracket: ${Date.now() - start} ms from click to counts: ${await view.getAttribute('data-thickness')}`,
  );
  // Solid walls: nothing is thinner than two line widths.
  expect((await counts(view)).thin).toBe(0);
});
