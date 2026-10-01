import { expect, type Locator, type Page, test } from '@playwright/test';
import { kernelReady, openProject, pickTool, projector } from './helpers';

// P2-13: measure and inspect (FR-3DP-01, ADR-0035). The status bar shows the
// size of the box around the selection; the Measure tool (I) shows what is
// picked and, for two picks, the distance, its parts and the angle, with a
// line between the closest points in the view.

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(60_000);

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** Makes a primitive from Solid › Create with `fields` typed in. */
async function primitive(page: Page, label: string, fields: [string, string][]) {
  await pickTool(page, label);
  const dialog = page.getByRole('region', { name: `${label} dialog` });
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  for (const [name, value] of fields) {
    await dialog.getByRole('textbox', { name, exact: true }).fill(value);
  }
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
}

/** Waits until the camera has stopped moving; returns a world → page mapping. */
async function settledProjector(viewport: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const values = await Promise.all(
        ['size', 'target', 'direction'].map((k) => viewport.getAttribute(`data-camera-${k}`)),
      );
      const key = values.join(' ');
      const still = key === last;
      last = key;
      return still;
    })
    .toBe(true);
  return projector(viewport);
}

test('measures faces, the distance and angle between two picks, and sizes the selection', async ({
  page,
}) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  // A 40 × 20 × 20 box about the origin, and a Ø10 × 20 cylinder beside it at x = 50.
  await primitive(page, 'Box', [['Length', '40 mm']]);
  await primitive(page, 'Cylinder', [
    ['X', '50 mm'],
    ['Diameter', '10 mm'],
  ]);
  await page.getByRole('button', { name: 'Orthographic' }).click();
  await page.keyboard.press('F6');
  const at = await settledProjector(viewport);
  const click = async (p: [number, number, number]) => {
    const { x, y } = at(p);
    await page.mouse.move(x, y);
    await page.mouse.click(x, y);
  };
  const selection = page.locator('output[aria-label="Selection"]');
  const size = page.locator('output[aria-label="Selection size"]');

  // The box's top face: the status bar sizes it.
  await click([0, 0, 20]);
  await expect(selection).toHaveText('1 face ·');
  await expect(size).toHaveText('40.00 × 20.00 × 0.00 mm ·');

  // Measure keeps the selection and describes it.
  await page.keyboard.press('i');
  const panel = page.getByRole('region', { name: 'Measure' });
  await expect(panel).toHaveAttribute('data-measure-state', 'ready');
  const row = (name: string) => panel.locator(`[data-measure-row="${name}"]`);
  // Items are titled "Face <n> · Body1" by the kernel's face order.
  const itemRow = (label: string) => panel.locator(`[data-measure-row$=" · Body1/${label}"]`);
  await expect(itemRow('Area')).toHaveText('800.00 mm²');
  await expect(itemRow('Type')).toHaveText('Flat');

  // A plain click adds the cylinder's wall (seen from the home view's side).
  const r = 5 / Math.SQRT2;
  await click([50 + r, -r, 10]);
  await expect(selection).toHaveText('2 faces ·');
  await expect(panel).toHaveAttribute('data-measure-state', 'ready');
  await expect(row('Between/Distance')).toHaveText('25.00 mm');
  await expect(row('Between/Angle')).toHaveText('90.00°');
  await expect(panel.getByText(/Radius/)).toBeVisible();
  await expect(size).toHaveText('75.00 × 20.00 × 20.00 mm ·');
  // The line between the closest points: from the box's edge at x = 20 to the wall at x = 45.
  await expect(viewport.locator('[data-measure-line]')).toHaveCount(1);
  const line = (await viewport.locator('[data-measure-line]').getAttribute('data-measure-line'))
    ?.split(/[ ,]/)
    .map(Number);
  const box = await viewport.boundingBox();
  const from = at([20, 0, 20]);
  const to = at([45, 0, 20]);
  expect(Math.abs((line?.[0] ?? 0) + (box?.x ?? 0) - from.x)).toBeLessThan(2);
  expect(Math.abs((line?.[2] ?? 0) + (box?.x ?? 0) - to.x)).toBeLessThan(2);
  await page.screenshot({ path: test.info().outputPath('measure-two-faces.png') });

  // A third click starts again with that one.
  await click([0, -10, 10]);
  await expect(selection).toHaveText('1 face ·');
  await expect(itemRow('Area')).toHaveText('800.00 mm²');
  await expect(viewport.locator('[data-measure-line]')).toHaveCount(0);

  // The X axis measures too (P3-17): measured here, so a face and an axis get their angle,
  // and the axis and the box's corner vertex their distance.
  let onAxis: { x: number; y: number } | undefined;
  for (const x of [-35, -45, -30, -55]) {
    const p = at([x, 0, 0]);
    await page.mouse.move(p.x, p.y);
    if ((await viewport.getAttribute('data-model-hover')) === 'axis:origin:x') {
      onAxis = p;
      break;
    }
    await page.waitForTimeout(100);
    if ((await viewport.getAttribute('data-model-hover')) === 'axis:origin:x') {
      onAxis = p;
      break;
    }
  }
  if (!onAxis) throw new Error('the X axis is not under the pointer');
  await page.mouse.click(onAxis.x, onAxis.y);
  await expect(panel).toHaveAttribute('data-measure-state', 'ready');
  await expect(row('X axis/Type')).toHaveText('Axis');
  await expect(row('Between/Angle')).toHaveText('0.00°');
  await expect(row('Between/Distance')).toHaveCount(0);

  // Esc closes the tool and keeps the selection; Clear empties it.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(selection).toHaveText('1 face, 1 axis ·');
  await page.keyboard.press('i');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Clear' }).click();
  await expect(selection).toBeHidden();
  await expect(panel).toHaveAttribute('data-measure-state', 'empty');
  await panel.getByRole('button', { name: 'Close Esc' }).click();
  await expect(panel).toBeHidden();
});
