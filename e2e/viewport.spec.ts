import { expect, type Locator, type Page, test } from '@playwright/test';
import { openProject } from './helpers';

// P0-05: the viewport. The camera state is mirrored on the viewport element
// as data attributes (direction, up, target, size), so these tests check
// the camera itself, not pixels.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const open = (page: Page) => openProject(page);

const attr = async (el: Locator, name: string) => (await el.getAttribute(name)) ?? '';
const numbers = async (el: Locator, name: string) => (await attr(el, name)).split(',').map(Number);

/** Centre of the viewport's canvas area, clear of the ViewCube and the nav bar. */
async function centre(viewport: Locator) {
  const box = await viewport.boundingBox();
  if (!box) throw new Error('no viewport');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('clicking the ViewCube Top face looks straight down, then Home goes back', async ({
  page,
}) => {
  const viewport = await open(page);
  const status = page.getByRole('status', { name: 'Current view' });
  const cube = page.getByRole('group', { name: 'ViewCube' });

  // The document opens in the home view: front, right, top.
  await expect(status).toHaveText('Top Front Right view');
  await expect(viewport).toHaveAttribute('data-camera-direction', '-0.577,0.577,-0.577');

  await cube.getByRole('button', { name: 'Top', exact: true }).click();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  await expect(viewport).toHaveAttribute('data-camera-up', '0,1,0');
  await expect(status).toHaveText('Top view');

  await cube.getByRole('button', { name: 'Home view' }).click();
  await expect(viewport).toHaveAttribute('data-camera-direction', '-0.577,0.577,-0.577');
  await expect(status).toHaveText('Top Front Right view');
});

test('ViewCube edges, turn arrows and roll arrows', async ({ page }) => {
  const viewport = await open(page);
  const cube = page.getByRole('group', { name: 'ViewCube' });
  const top = cube.getByRole('button', { name: 'Top', exact: true });

  // The arrows only show when the view is face-on.
  await expect(cube.getByRole('button', { name: 'Roll the view clockwise' })).toHaveCount(0);
  await top.click();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');

  // From above, the strip below the Top face's centre is the Top Front edge.
  const box = await top.boundingBox();
  if (!box) throw new Error('no Top face');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height + 3);
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0.707,-0.707');
  await expect(page.getByRole('status', { name: 'Current view' })).toHaveText('Top Front view');

  await top.click();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  await cube.getByRole('button', { name: 'Roll the view clockwise' }).click();
  await expect(viewport).toHaveAttribute('data-camera-up', '-1,0,0');
  await cube.getByRole('button', { name: 'Roll the view counter-clockwise' }).click();
  await expect(viewport).toHaveAttribute('data-camera-up', '0,1,0');

  // Turning to the face below the Top view lands on the Front view.
  await cube.getByRole('button', { name: 'Turn to the face below' }).click();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,1,0');
  await expect(viewport).toHaveAttribute('data-camera-up', '0,0,1');
});

test('Fusion mouse: middle-drag pans, Shift+middle-drag orbits, the wheel zooms, F6 fits', async ({
  page,
}) => {
  const viewport = await open(page);
  const { x, y } = await centre(viewport);
  const direction = await attr(viewport, 'data-camera-direction');
  const fitted = await attr(viewport, 'data-camera-size');

  // Pan: the direction stays, the target moves.
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(x + 120, y + 40, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await expect(viewport).toHaveAttribute('data-camera-direction', direction);
  await expect(viewport).not.toHaveAttribute('data-camera-target', '0,0,0');

  // Orbit: the direction changes, the target stays.
  const target = await attr(viewport, 'data-camera-target');
  await page.keyboard.down('Shift');
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(x - 100, y + 60, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await page.keyboard.up('Shift');
  await expect(viewport).not.toHaveAttribute('data-camera-direction', direction);
  await expect(viewport).toHaveAttribute('data-camera-target', target);

  // Wheel up zooms in.
  const [before] = await numbers(viewport, 'data-camera-size');
  await page.mouse.wheel(0, -300);
  await expect
    .poll(async () => (await numbers(viewport, 'data-camera-size'))[0])
    .toBeLessThan(before ?? 0);

  // F6 fits the (empty) scene again: same size as when the document opened.
  await page.keyboard.press('F6');
  await expect(viewport).toHaveAttribute('data-camera-size', fitted);
  await expect(viewport).toHaveAttribute('data-camera-target', '0,0,0');
});

test('the Blender preset orbits with the middle button, and is remembered', async ({ page }) => {
  let viewport = await open(page);
  await page.getByRole('button', { name: 'Mouse controls' }).click();
  await page.getByRole('menuitemradio', { name: 'Blender' }).click();
  await page.keyboard.press('Escape');

  await page.reload();
  viewport = page.getByRole('region', { name: 'Viewport' });
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  const { x, y } = await centre(viewport);
  const direction = await attr(viewport, 'data-camera-direction');
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(x + 80, y, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await expect(viewport).not.toHaveAttribute('data-camera-direction', direction);
  await expect(viewport).toHaveAttribute('data-camera-target', '0,0,0');
});

test('the nav-bar Orbit tool orbits with the left button until Esc', async ({ page }) => {
  const viewport = await open(page);
  const orbit = page.getByRole('button', { name: 'Orbit', exact: true });
  const { x, y } = await centre(viewport);

  // Without the tool, a left-drag doesn't move the camera.
  const direction = await attr(viewport, 'data-camera-direction');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y, { steps: 4 });
  await page.mouse.up();
  await expect(viewport).toHaveAttribute('data-camera-direction', direction);

  await orbit.click();
  await expect(orbit).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y, { steps: 4 });
  await page.mouse.up();
  await expect(viewport).not.toHaveAttribute('data-camera-direction', direction);

  await page.keyboard.press('Escape');
  await expect(orbit).toHaveAttribute('aria-pressed', 'false');
});

test('projection, grid and origin settings change the picture and are remembered', async ({
  page,
}) => {
  const viewport = await open(page);
  const canvas = viewport.locator('canvas');
  const picture = () => canvas.screenshot();
  const start = await picture();

  const ortho = page.getByRole('button', { name: 'Orthographic' });
  await ortho.click();
  await expect(ortho).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await picture()).equals(start)).toBe(false);

  const grid = page.getByRole('button', { name: 'Grid', exact: true });
  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed', 'false');
  const noGrid = await picture();

  await page.getByRole('button', { name: 'Show XY plane' }).click();
  await expect(page.getByRole('button', { name: 'Hide XY plane' })).toBeVisible();
  await expect.poll(async () => (await picture()).equals(noGrid)).toBe(false);

  await page.reload();
  await expect(page.getByRole('region', { name: 'Viewport' })).toHaveAttribute(
    'data-ready',
    'true',
  );
  await expect(ortho).toHaveAttribute('aria-pressed', 'true');
  await expect(grid).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Hide XY plane' })).toBeVisible();
});
