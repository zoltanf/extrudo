import { readFileSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import {
  addParameter,
  applyCommand,
  type ParameterId,
  updateFeatureInputs,
} from '../packages/core/src/index';
import { readArchive, writeArchive } from '../packages/storage/src/archive';
import { kernelReady, parameterExpression, parametersDialog, pickTool } from './helpers';

// ADR-0161: Stop during a long update after an edit. The PCB enclosure benchmark with its post
// pattern's counts set by a parameter `n` opens quickly at n = 2; setting n = 12 keeps one kernel
// call busy (13.9 s in Node on the Ubuntu machine at 12 × 12, longer in a browser and on a busy
// machine). The 30 s long-feature rule is lowered to 2 s through the test hook, which may only
// lower it. No time is asserted.

test.use({ viewport: { width: 1440, height: 900 } });

const PATTERN = 'Rectangular Pattern1';
const updating = (page: Page) => page.locator('[data-model-progress="updating"]');
const stopButton = (page: Page) =>
  page.getByRole('button', { name: 'Stop: update the model without this feature for now' });
const cancelButton = (page: Page) =>
  page.getByRole('button', { name: 'Cancel: undo the changes since the last model' });
const chip = (page: Page) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${PATTERN}`) });

/** The benchmark with its pattern counted by `n` (2 to start with), as a file to import. */
function postsByParameter(path: string): void {
  let doc = readArchive(readFileSync('fixtures/benchmarks/b5-pcb-enclosure.extrudo')).doc;
  const pattern = doc.features.find((f) => f.name === PATTERN);
  if (!pattern) throw new Error(`the benchmark has no ${PATTERN}`);
  doc = applyCommand(
    doc,
    addParameter({
      parameter: { id: 'pn' as ParameterId, name: 'n', expression: '2', unit: 'unitless' },
    }),
  ).doc;
  // Only the expression changes: the input keeps its parameter name and unit.
  const expr = (key: string, value: string) => {
    const input = pattern.inputs[key];
    if (input?.kind !== 'expr') throw new Error(`the pattern has no ${key} expression`);
    return { ...input, expr: value };
  };
  doc = applyCommand(
    doc,
    updateFeatureInputs({
      id: pattern.id,
      inputs: {
        count1: expr('count1', 'n'),
        distance1: expr('distance1', '2 * px / (n - 1)'),
        count2: expr('count2', 'n'),
        distance2: expr('distance2', '2 * py / (n - 1)'),
      },
    }),
  ).doc;
  writeFileSync(path, writeArchive({ ...doc, name: 'Posts by n' }));
}

/** Opens the design (n = 2), then sets n = 12: a long update whose pattern is running. */
async function longUpdate(page: Page, path: string) {
  await page.addInitScript('window.__extrudoLongFeatureMs = 2000');
  postsByParameter(path);
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…', exact: true }).click(),
  ]);
  await chooser.setFiles(path);
  await kernelReady(page, 60_000);
  await setN(page, '12');
  await expect(updating(page).locator('[data-progress-feature]')).toHaveText(PATTERN, {
    timeout: 60_000,
  });
}

async function setN(page: Page, value: string) {
  await pickTool(page, 'Parameters');
  const field = await parameterExpression(page, 'n');
  await field.fill(value);
  await field.press('Enter');
  await page.keyboard.press('Escape');
  await expect(parametersDialog(page)).toHaveCount(0);
}

async function readN(page: Page): Promise<string> {
  await pickTool(page, 'Parameters');
  const value = await (await parameterExpression(page, 'n')).inputValue();
  await page.keyboard.press('Escape');
  await expect(parametersDialog(page)).toHaveCount(0);
  return value;
}

test('a long update offers Stop before Cancel after the long-feature time; Stop keeps the edit', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  await longUpdate(page, info.outputPath('posts.extrudo'));
  const notice = updating(page);
  await expect(cancelButton(page)).toBeVisible();
  // After the (lowered) long-feature time: Stop appears before Cancel, with the sentence.
  await expect(notice.locator('[data-feature-long]')).toHaveText(
    'This feature is taking a long time.',
    { timeout: 30_000 },
  );
  await expect(stopButton(page)).toBeVisible();
  await expect(notice.getByRole('button')).toHaveText(['Stop', 'Cancel']);
  // The same quiet style as Cancel (the owner, 2026-11-23).
  expect(await stopButton(page).getAttribute('class')).toBe(
    await cancelButton(page).getAttribute('class'),
  );
  // The bar stretches to the notice's content width.
  const bar = await notice.locator('progress').boundingBox();
  const line = await notice.locator('[data-feature-long]').boundingBox();
  expect((bar?.width ?? 0) + 1).toBeGreaterThanOrEqual(line?.width ?? 0);

  await stopButton(page).click();
  const toast = page.locator('[data-toast]').filter({ hasText: 'was stopped' });
  await expect(toast).toContainText(
    `${PATTERN} was stopped, so the model was updated without it. Your change is kept.`,
  );
  await expect(toast.getByRole('button', { name: 'Try again' })).toBeVisible();
  await kernelReady(page, 60_000);
  await expect(chip(page)).toHaveAttribute('data-feature-status', 'error');
  await chip(page).hover();
  await expect(page.getByRole('tooltip')).toContainText(
    'Stopped: this feature took too long. Try again to build it.',
  );
  await page.mouse.move(700, 450);
  // The edit is kept: n is still 12, and it can be undone.
  expect(await readN(page)).toBe('12');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
});

test('Ctrl+Z during a long update is Cancel; while it waits, "Cancelling…" offers Stop alone, which ends the wait', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  await longUpdate(page, info.outputPath('posts.extrudo'));
  const notice = updating(page);
  await expect(cancelButton(page)).toBeVisible();
  const quiet = await cancelButton(page).getAttribute('class');
  // Ctrl+Z does what Cancel does: the changes are undone at once, with Cancel's toast.
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-toast]').filter({ hasText: 'Update cancelled' })).toContainText(
    'Update cancelled: your last changes were undone. Redo brings them back.',
  );
  // The pattern still runs, so the cancel waits for it: "Cancelling…" with Stop alone, at once.
  await expect(notice).toHaveAttribute('data-model-cancelling', 'true');
  await expect(notice).toContainText('Cancelling…');
  await expect(notice.locator('[data-cancelling-text]')).toHaveText(
    'Your changes are undone once the running feature ends. Stop ends it now.',
  );
  const stop = page.getByRole('button', { name: 'Stop: end the running feature now' });
  await expect(notice.getByRole('button')).toHaveText(['Stop']);
  expect(await stop.getAttribute('class')).toBe(quiet);
  // Ctrl+Z again while it waits undoes nothing more.
  await page.keyboard.press('Control+z');
  await expect(notice).toHaveAttribute('data-model-cancelling', 'true');

  await stop.click();
  await kernelReady(page, 60_000);
  // Nothing was marked: no "was stopped" toast, the pattern built, n back at 2, Redo brings 12.
  await expect(page.locator('[data-toast]').filter({ hasText: 'was stopped' })).toHaveCount(0);
  await expect(chip(page)).not.toHaveAttribute('data-feature-status', 'error');
  expect(await readN(page)).toBe('2');
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
});
