import { expect, type Page, test } from '@playwright/test';
import { kernelReady, openProject, saveStatus } from './helpers';

// P1-01: the sketch feature and sketch mode. Create Sketch picks an origin
// plane (in the view or in the prompt), the camera looks at it, the toolbar
// swaps to the Sketch tab with the palette, and Finish Sketch goes back.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const toolbarTab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Toolbar tabs' }).getByRole('tab', { name });
const prompt = (page: Page) => page.getByRole('region', { name: 'Create Sketch' });
const palette = (page: Page) => page.getByRole('region', { name: 'Sketch palette' });
const sketchItem = (page: Page, name: string) =>
  page
    .getByRole('complementary', { name: 'Browser' })
    .getByRole('listitem')
    .filter({ hasText: new RegExp(`^${name}`) });

async function createSketch(page: Page) {
  await page.getByRole('button', { name: 'Create Sketch' }).click();
  await expect(prompt(page)).toBeVisible();
}

test('Create Sketch on a plane picked in the view, then Finish Sketch', async ({ page }) => {
  const viewport = await openProject(page);
  await createSketch(page);
  await expect(page.getByRole('button', { name: 'Create Sketch' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // In the home view the origin sits in the middle of the view. A point to
  // its right, 13 % of the view's height away, lies on the XY plane only.
  const box = await viewport.boundingBox();
  if (!box) throw new Error('no viewport');
  const x = box.x + box.width / 2 + box.height * 0.13;
  const y = box.y + box.height / 2;
  const surface = viewport.locator('div.touch-none').first();
  await page.mouse.move(x, y);
  await expect(surface).toHaveCSS('cursor', 'pointer');
  await expect(prompt(page).getByRole('button', { name: 'XY' })).toHaveClass(/border-accent/);
  await page.mouse.click(x, y);

  await expect(prompt(page)).toBeHidden();
  await expect(palette(page)).toBeVisible();
  await expect(palette(page).getByRole('heading')).toHaveText('Sketch1');
  await expect(toolbarTab(page, 'Sketch')).toHaveAttribute('aria-selected', 'true');
  await expect(toolbarTab(page, 'Solid')).toHaveCount(0);
  await expect(sketchItem(page, 'Sketch1')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('status', { name: 'Status', exact: true })).toContainText(
    'Editing Sketch1',
  );
  // Looking straight down at XY, sketch X to the right (the Top view).
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  await expect(viewport).toHaveAttribute('data-camera-up', '0,1,0');
  // The marker can't move while a sketch is open.
  await expect(page.getByRole('button', { name: 'Step back' })).toBeDisabled();

  await page
    .getByRole('group', { name: 'Finish' })
    .getByRole('button', { name: 'Finish Sketch' })
    .click();
  await expect(palette(page)).toBeHidden();
  await expect(toolbarTab(page, 'Solid')).toHaveAttribute('aria-selected', 'true');
  await expect(sketchItem(page, 'Sketch1')).not.toHaveAttribute('aria-current', 'true');
  await expect(
    page.getByRole('list', { name: 'Features' }).getByRole('button', { name: 'Sketch1' }),
  ).toBeVisible();

  // Creating the sketch is one undo step.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(sketchItem(page, 'Sketch1')).toHaveCount(0);
  await expect(sketchItem(page, 'No sketches yet')).toBeVisible();
});

test('Create Sketch from the prompt; Esc cancels; the sketch opens again after a reload', async ({
  page,
}) => {
  const viewport = await openProject(page);
  await createSketch(page);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Create Sketch' })).not.toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await createSketch(page);
  await prompt(page).getByRole('button', { name: 'YZ' }).click();
  await expect(palette(page)).toBeVisible();
  // The Right view: the camera looks along −X, with sketch X (world Y) to the right.
  await expect(viewport).toHaveAttribute('data-camera-direction', '-1,0,0');
  await expect(viewport).toHaveAttribute('data-camera-up', '0,0,1');
  await palette(page).getByRole('button', { name: 'Finish Sketch' }).click();
  await expect(saveStatus(page)).toHaveText('Saved');

  // Turn away, reload, and open the sketch from the browser: the camera looks at it again.
  await page
    .getByRole('group', { name: 'ViewCube' })
    .getByRole('button', { name: 'Home view' })
    .click();
  await page.reload();
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Edit Sketch1' }).click();
  await expect(palette(page).getByRole('heading')).toHaveText('Sketch1');
  await expect(viewport).toHaveAttribute('data-camera-direction', '-1,0,0');

  // Palette options: the grid is a viewport setting, Look at turns the camera back.
  const grid = palette(page).getByRole('checkbox', { name: 'Sketch grid' });
  await expect(grid).toBeChecked();
  await grid.uncheck();
  await expect(
    page.getByRole('navigation', { name: 'View navigation' }).getByRole('button', {
      name: 'Grid',
    }),
  ).not.toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('group', { name: 'ViewCube' })
    .getByRole('button', { name: 'Home view' })
    .click();
  await expect(viewport).not.toHaveAttribute('data-camera-direction', '-1,0,0');
  await palette(page).getByRole('button', { name: 'Look at' }).click();
  await expect(viewport).toHaveAttribute('data-camera-direction', '-1,0,0');
});

test('the Wall bracket’s sketches open by double-click; sketch mode looks right', async ({
  page,
}) => {
  const viewport = await openProject(page, 'wall-bracket');
  await sketchItem(page, 'Sketch1').dblclick();
  await expect(palette(page).getByRole('heading')).toHaveText('Sketch1');
  // Sketch1 sits on XZ: the Front view.
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,1,0');

  // Double-clicking another sketch's chip finishes this one and opens that one.
  await page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: 'Sketch2' })
    .dblclick();
  await expect(palette(page).getByRole('heading')).toHaveText('Sketch2');
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');

  // The constraint status is in (P1-08): the solver has loaded and solved it.
  await expect(palette(page).locator('[data-constraint-state]')).not.toHaveAttribute(
    'data-constraint-state',
    'pending',
  );
  await kernelReady(page);
  await page.mouse.move(0, 0);
  await page.evaluate('document.fonts.ready.then(() => true)');
  await expect(page).toHaveScreenshot('sketch-mode-dark.png', {
    animations: 'disabled',
    caret: 'hide',
  });
});
