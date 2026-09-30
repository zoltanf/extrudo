import { expect, type Locator, type Page, test } from '@playwright/test';
import { kernelReady, openProject, pickTool, projector } from './helpers';

// P3-03: Shell (ADR-0046, FR-FT-06, FR-UX-06). Faces are picked in the view
// (the openings), the thickness is an expression, the direction is inside or
// outside, a body with no face picked is hollowed closed, the preview is live
// and a wall that is too thick says how thick it may be. One undo step.
// (Named shell-feature: shell.spec.ts is the app shell's.)

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const viewportOf = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const browserOf = (page: Page) => page.getByRole('complementary', { name: 'Browser' });
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });

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

/** A 20 mm cube on XY, centred on the origin: x, y in −10…10, z in 0…20. */
async function cube(page: Page) {
  await pickTool(page, 'Box');
  const dialog = page.getByRole('region', { name: 'Box dialog' });
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(viewportOf(page)).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
}

/** Clicks the cube's top face (the home view looks from +X, −Y, +Z). */
async function clickTop(page: Page, at: (p: [number, number, number]) => { x: number; y: number }) {
  const { x, y } = at([0, 0, 20]);
  await page.mouse.move(x, y);
  await expect.poll(() => viewportOf(page).getAttribute('data-model-hover')).toMatch(/^face:/);
  await page.mouse.click(x, y);
  await expect(viewportOf(page)).toHaveAttribute('data-model-selection', /^face:/);
}

/** Starts the Shell tool from the toolbar (it has no key). */
const startShell = (page: Page) => page.getByRole('button', { name: /^Shell/ }).click();

test('opens the top face: 2 mm walls, live preview, and a wall that is too thick says how thick it may be', async ({
  page,
}) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  const at = await settledProjector(viewport);

  await clickTop(page, at);
  await startShell(page);
  const dialog = page.getByRole('region', { name: 'Shell dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Faces to remove', exact: true })).toHaveText(
    '1 face',
  );
  await expect(dialog.getByRole('textbox', { name: 'Thickness', exact: true })).toHaveValue('2 mm');
  await expect(dialog.getByRole('combobox', { name: 'Direction', exact: true })).toHaveValue(
    'inside',
  );
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await expect(viewport).toHaveAttribute('data-preview', /./);

  // Too thick: the message says how thick it may be, and OK waits.
  await dialog.getByRole('textbox', { name: 'Thickness', exact: true }).fill('12 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'error', { timeout: 15_000 });
  await expect(dialog.getByRole('status', { name: 'Feature status' })).toContainText(
    /A 12 mm wall is too thick for this body \(max ≈ (9\.\d|10) mm\)\./,
  );
  await expect(dialog.getByRole('button', { name: 'OK' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Thickness', exact: true }).fill('3 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);

  // Five outer faces, five inner and the rim; the outside is where it was. One undo step.
  await expect(chip(page, 'Shell1')).toHaveAccessibleName('Shell1');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:11:20,20,20');
  await page.keyboard.press('Control+z');
  await expect(chip(page, 'Shell1')).toHaveCount(0);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
});

test('outside grows the walls outwards; editing the shell opens on its stored values', async ({
  page,
}) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  const at = await settledProjector(viewport);

  await clickTop(page, at);
  await startShell(page);
  const dialog = page.getByRole('region', { name: 'Shell dialog' });
  await dialog.getByRole('combobox', { name: 'Direction', exact: true }).selectOption('outside');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  // The sides and the floor grow by 2 mm, the open top stays at z = 20: 24 × 24 × 22.
  await expect(viewport).toHaveAttribute('data-bodies', /^Body1:\d+:24,24,22$/);

  await chip(page, 'Shell1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Shell1 dialog' });
  await expect(edit.getByRole('combobox', { name: 'Direction', exact: true })).toHaveValue(
    'outside',
  );
  await expect(edit.getByRole('textbox', { name: 'Thickness', exact: true })).toHaveValue('2 mm');
  await expect(edit.getByRole('button', { name: 'Faces to remove', exact: true })).toHaveText(
    '1 face',
  );
  await edit.getByRole('combobox', { name: 'Direction', exact: true }).selectOption('inside');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(edit).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:11:20,20,20');
});

test('a body picked with no face is hollowed closed: a sealed void', async ({ page }) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page);

  // Select the body in the browser, then Shell.
  await browserOf(page).getByRole('button', { name: 'Body1', exact: true }).click();
  await startShell(page);
  const dialog = page.getByRole('region', { name: 'Shell dialog' });
  await expect(dialog.getByRole('button', { name: 'Body', exact: true })).toHaveText('1 body');
  await expect(dialog.getByRole('button', { name: 'Faces to remove', exact: true })).toHaveText(
    'Pick faces',
  );
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('textbox', { name: 'Thickness', exact: true }).fill('3 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  // The same 20 mm cube from outside, with a 14 mm cube of nothing inside: 12 faces.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:12:20,20,20');
});
