import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Opens a project in the shell from a fresh home screen (P0-08): a blank
 * design, or the Wall bracket template (parameters, a timeline, a body).
 * Each Playwright test has its own browser context, so storage starts empty.
 */
export async function openProject(page: Page, from: 'blank' | 'wall-bracket' = 'blank') {
  await page.goto('./');
  if (from === 'blank') {
    await page.getByRole('button', { name: 'New design' }).click();
  } else {
    await page.getByRole('button', { name: 'Start from the Wall bracket template' }).click();
  }
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  const viewport = page.getByRole('region', { name: 'Viewport' });
  // The viewport is lazy: wait until its first frame is drawn.
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  return viewport;
}

export const saveStatus = (page: Page) => page.getByRole('status', { name: 'Save status' });

/** Opens a sketch on XY and waits for the Top view. Returns a sketch-mm → page-px mapping. */
export async function sketchOnXY(page: Page) {
  const viewport = await openProject(page);
  await page.getByRole('button', { name: 'Create Sketch' }).click();
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XY' })
    .click();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  await expect(viewport).toHaveAttribute('data-camera-up', '0,1,0');
  return mapping(viewport);
}

export async function mapping(viewport: Locator) {
  const box = await viewport.boundingBox();
  if (!box) throw new Error('no viewport');
  const [tx = 0, ty = 0] = ((await viewport.getAttribute('data-camera-target')) ?? '')
    .split(',')
    .map(Number);
  const size = Number(await viewport.getAttribute('data-camera-size'));
  // Orthographic or perspective, the target plane is `size` mm tall on screen.
  const perPixel = size / box.height;
  return (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - tx) / perPixel,
    y: box.y + box.height / 2 - (y - ty) / perPixel,
  });
}
