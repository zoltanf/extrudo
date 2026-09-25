import { expect, type Page } from '@playwright/test';

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
