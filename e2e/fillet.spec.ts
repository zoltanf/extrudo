import { expect, type Locator, type Page, test } from '@playwright/test';
import { kernelReady, openProject, pickTool, projector } from './helpers';

// P3-01: Fillet (ADR-0038, FR-FT-04, FR-UX-06). Edges are picked in the
// view (a picked edge brings its tangent chain), each set has its own
// radius, the preview is live, and a radius that is too large says which
// edge and how large it may be. One undo step.

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

/** Clicks an edge of the cube at its world midpoint, a couple of pixels off (as the selection tests do). */
async function clickEdge(
  page: Page,
  at: (p: [number, number, number]) => { x: number; y: number },
  midpoint: [number, number, number],
) {
  const { x, y } = at(midpoint);
  await page.mouse.move(x, y + 2);
  await expect.poll(() => viewportOf(page).getAttribute('data-model-hover')).toMatch(/^edge:/);
  await page.mouse.click(x, y + 2);
}

test('rounds edges in two sets; a radius that is too large says how large it may be', async ({
  page,
}) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  const at = await settledProjector(viewport);

  // The home view looks from +X, −Y, +Z: the top face's front and right edges show.
  await clickEdge(page, at, [0, -10, 20]);
  await expect(viewport).toHaveAttribute('data-model-selection', /^edge:/);
  await page.keyboard.press('f');
  const dialog = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Edges', exact: true })).toHaveText('1 edge');
  await expect(dialog.getByRole('textbox', { name: 'Radius', exact: true })).toHaveValue('1 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await expect(viewport).toHaveAttribute('data-preview', /./);

  // Too large: the message names the edge and the largest radius that works.
  await dialog.getByRole('textbox', { name: 'Radius', exact: true }).fill('50 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'error', { timeout: 15_000 });
  await expect(dialog.getByRole('status', { name: 'Feature status' })).toContainText(
    /Radius 50 mm is too large for edge \d+ \(max ≈ 1\d(\.\d)? mm\)\./,
  );
  await expect(dialog.getByRole('button', { name: 'OK' })).toBeDisabled();

  // A second set with its own radius appears once the first has edges.
  await dialog.getByRole('textbox', { name: 'Radius', exact: true }).fill('3 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Edges 2', exact: true }).click();
  await clickEdge(page, at, [10, 0, 20]);
  await expect(dialog.getByRole('button', { name: 'Edges 2', exact: true })).toHaveText('1 edge');
  await dialog.getByRole('textbox', { name: 'Radius 2', exact: true }).fill('1 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);

  // A face for each edge; one undo step takes both away.
  await expect(chip(page, 'Fillet1')).toHaveAccessibleName('Fillet1');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:8:20,20,20');
  await page.keyboard.press('Control+z');
  await expect(chip(page, 'Fillet1')).toHaveCount(0);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
});

test('a picked edge brings its tangent chain, which is rounded as one', async ({ page }) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  await cube(page);
  const at = await settledProjector(viewport);

  // Round the three vertical edges the home view shows.
  await clickEdge(page, at, [10, -10, 10]);
  await page.keyboard.press('f');
  const first = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(first).toBeVisible();
  await expect(first.getByRole('button', { name: 'Edges', exact: true })).toHaveText('1 edge');
  await clickEdge(page, at, [-10, -10, 10]);
  await clickEdge(page, at, [10, 10, 10]);
  await expect(first.getByRole('button', { name: 'Edges', exact: true })).toHaveText('3 edges');
  await first.getByRole('textbox', { name: 'Radius', exact: true }).fill('4 mm');
  await expect(first).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await first.getByRole('button', { name: 'OK' }).click();
  await expect(first).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:9:20,20,20');

  // The top front edge now runs between two arcs: it comes with them and the edges beyond,
  // seven up to the sharp corner at the back (left edge, arc, front, arc, right, arc, back).
  await clickEdge(page, at, [0, -10, 20]);
  await page.keyboard.press('f');
  const second = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(second.getByRole('button', { name: 'Edges', exact: true })).toHaveText('7 edges');
  // Unpicking one edge of a chain takes the whole chain out; picking it brings it back.
  await clickEdge(page, at, [0, -10, 20]);
  await expect(second.getByRole('button', { name: 'Edges', exact: true })).toHaveText('Pick edges');
  await clickEdge(page, at, [0, -10, 20]);
  await expect(second.getByRole('button', { name: 'Edges', exact: true })).toHaveText('7 edges');
  await second.getByRole('textbox', { name: 'Radius', exact: true }).fill('1 mm');
  await expect(second).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await second.getByRole('button', { name: 'OK' }).click();
  await expect(second).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:16:20,20,20');
});

test('the wall bracket’s Fillet1 rounds its bend, and its dialog opens on the two stored sets', async ({
  page,
}) => {
  const viewport = viewportOf(page);
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  // The L, two holes and two fillet faces (the template's Fillet1 has two sets).
  await expect(chip(page, 'Fillet1')).toHaveAccessibleName('Fillet1');
  await expect(viewport).toHaveAttribute('data-bodies', 'Bracket:12:40,80,60');

  // Its dialog opens on the stored sets.
  await chip(page, 'Fillet1').dblclick();
  const dialog = page.getByRole('region', { name: 'Edit Fillet1 dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Radius', exact: true })).toHaveValue(
    'wall / 2',
  );
  await expect(dialog.getByRole('textbox', { name: 'Radius 2', exact: true })).toHaveValue(
    'wall * 1.5',
  );
  await expect(dialog.getByRole('button', { name: 'Edges', exact: true })).toHaveText('1 edge');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Cancel Esc' }).click();
  await expect(dialog).toBeHidden();
});
