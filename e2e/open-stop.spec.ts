import { readFileSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { applyCommand, updateFeatureInputs } from '../packages/core/src/index';
import { readArchive, writeArchive } from '../packages/storage/src/archive';
import { kernelReady, saveStatus } from './helpers';

// ADR-0155: Stop while a design opens skips the running feature for now. The PCB
// enclosure benchmark with its post pattern raised to 12 × 12 keeps one kernel call
// busy (13.9 s in Node on the Ubuntu machine, longer in a browser and on a busy
// machine), so the pattern is still running when Stop is pressed. No time is asserted.

test.use({ viewport: { width: 1440, height: 900 } });

const PATTERN = 'Rectangular Pattern1';
const notice = (page: Page) => page.locator('[data-model-progress="preparing"]');
const stopButton = (page: Page) =>
  page.getByRole('button', { name: 'Stop: open the design without this feature for now' });
const chip = (page: Page) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${PATTERN}`) });
const status = (page: Page) => page.getByRole('status', { name: 'Status', exact: true });

/** The benchmark with its pattern at 12 × 12, as a file to import. */
function manyPosts(path: string): void {
  let doc = readArchive(readFileSync('fixtures/benchmarks/b5-pcb-enclosure.extrudo')).doc;
  const pattern = doc.features.find((f) => f.name === PATTERN);
  if (!pattern) throw new Error(`the benchmark has no ${PATTERN}`);
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
        count1: expr('count1', '12'),
        distance1: expr('distance1', '2 * px / 11'),
        count2: expr('count2', '12'),
        distance2: expr('distance2', '2 * py / 11'),
      },
    }),
  ).doc;
  writeFileSync(path, writeArchive({ ...doc, name: 'Many posts' }));
}

/**
 * The stored project's document file as the project store keeps it in OPFS
 * (`projects/<id>/document.json`): its text and when it was written.
 */
async function storedDocument(page: Page): Promise<{ text: string; modified: number }> {
  const id = page.url().split('#/p/')[1]?.split(/[/?]/)[0] ?? '';
  return page.evaluate(`(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await (await root.getDirectoryHandle('projects')).getDirectoryHandle(${JSON.stringify(id)});
    const file = await (await dir.getFileHandle('document.json')).getFile();
    return { text: await file.text(), modified: file.lastModified };
  })()`);
}

/** Waits until the pattern is the running feature and Stop is offered. */
async function patternRunning(page: Page) {
  await expect(notice(page).locator('[data-progress-feature]')).toHaveText(PATTERN, {
    timeout: 60_000,
  });
  await expect(stopButton(page)).toBeVisible();
}

test('Stop while a design opens skips the running feature; Try again builds it, with Stop again', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const file = info.outputPath('many-posts.extrudo');
  manyPosts(file);
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…', exact: true }).click(),
  ]);
  await chooser.setFiles(file);
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  const url = page.url();

  await patternRunning(page);
  // The notice offers Stop alone: no Cancel while a design opens (ADR-0111).
  await expect(page.locator('[data-model-cancel]')).toHaveCount(0);
  await expect(saveStatus(page)).toContainText('Saved');
  const before = await storedDocument(page);
  expect(before.text).toContain(PATTERN);
  await stopButton(page).click();

  // The toast says what happened and offers Try again.
  const toast = page.locator('[data-toast]').filter({ hasText: 'was stopped' });
  await expect(toast).toContainText(
    `${PATTERN} was stopped, so the design opened without it. Nothing in the design changed.`,
  );
  await expect(toast.getByRole('button', { name: 'Try again' })).toBeVisible();

  // The design shows without the pattern: its chip and the status bar say so.
  await kernelReady(page, 60_000);
  await expect(notice(page)).toHaveCount(0);
  await expect(chip(page)).toHaveAttribute('data-feature-status', 'error');
  await expect(chip(page)).toHaveAccessibleName(`${PATTERN} (error)`);
  await expect(status(page)).toContainText('1 error');
  await chip(page).hover();
  await expect(page.getByRole('tooltip')).toContainText(
    'Stopped: this feature took too long while the design opened. Try again to build it.',
  );
  await page.mouse.move(700, 450);

  // Nothing in the document changed: nothing to undo, nothing saved. The stored file is the
  // same text, written at the same time, well past the autosave's delay (800 ms).
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(saveStatus(page)).toContainText('Saved');
  await page.waitForTimeout(1500);
  expect(await storedDocument(page)).toEqual(before);

  // Try again from the chip's menu: the pattern runs again, shown as at open, with Stop.
  await chip(page).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Try Again' }).click();
  await patternRunning(page);
  // Stop again, from the keyboard: the focus lands on the pattern's chip, not the page.
  await stopButton(page).focus();
  await page.keyboard.press('Enter');
  await kernelReady(page, 60_000);
  await expect(chip(page)).toHaveAttribute('data-feature-status', 'error');
  await expect(chip(page)).toBeFocused();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();

  // Nothing about the stop is stored: opening the design again computes the pattern again.
  await page.goto('./');
  await page.goto(url);
  await patternRunning(page);

  // Stop, then Edit Feature to lower the count: the dialog doesn't start the long
  // computation by itself; it says so until a value changes, and OK builds the new one.
  await stopButton(page).click();
  await kernelReady(page, 60_000);
  await expect(chip(page)).toHaveAttribute('data-feature-status', 'error');
  await chip(page).dblclick();
  const edit = page.getByRole('region', { name: `Edit ${PATTERN} dialog` });
  await expect(edit).toHaveAttribute('data-preview-status', 'error', { timeout: 30_000 });
  await expect(edit.getByRole('status', { name: 'Feature status' })).toContainText(
    'Stopped while the design opened, so there is no preview yet. Change a value to build it.',
  );
  await edit.getByRole('textbox', { name: 'Count', exact: true }).first().fill('2');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
  await expect(edit).toHaveAttribute('data-dialog-valid', 'true');
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(edit).toBeHidden();
  await kernelReady(page, 60_000);
  await expect(chip(page)).not.toHaveAttribute('data-feature-status', 'error');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
});
