import { expect, type Page, test } from '@playwright/test';
import { kernelReady, startFromTemplate } from './helpers';

const kernelWorkers = (page: Page) =>
  page.workers().filter((w) => w.url().includes('kernelWorker'));

test.setTimeout(120_000);

/**
 * The home screen starts the kernel worker in idle time (ADR-0102 §8), and
 * opening a design takes that spare over instead of spawning a second one:
 * one worker throughout.
 */
test('the home screen prewarms the kernel and the template takes it over', async ({ page }) => {
  await page.goto('./');
  await expect.poll(async () => kernelWorkers(page).length, { timeout: 15_000 }).toBe(1);
  await startFromTemplate(page, 'Wall bracket');
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await kernelReady(page);
  // The spare was taken, not a second worker spawned.
  expect(kernelWorkers(page)).toHaveLength(1);
});
