import { expect, type Locator, type Page, test } from '@playwright/test';
import { kernelReady, openProject, pickTool, projector } from './helpers';

// ADR-0141 (#79): Simplify for Print. A 40 mm cube with a Ø12 through hole
// and a 3 mm round on the top front edge: with the limits up to both, the
// Make tab's tool finds one round and one hole (each kind's card counts what
// goes and says which sizes go and stay), draws the faces that go in red (a
// `cut` preview), and OK gives the plain cube back; a slider's Keep stop keeps
// that kind; the limits down find nothing, which is a warning, not an error.

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 240_000 });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const viewportOf = (page: Page) => page.getByRole('region', { name: 'Viewport' });

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

type At = Awaited<ReturnType<typeof settledProjector>>;

/** Hovers the world points in turn until the view hovers `kind`, then clicks it. */
async function clickOn(
  page: Page,
  at: At,
  points: readonly [number, number, number][],
  kind: 'face' | 'edge' | 'body',
) {
  for (const p of points) {
    const { x, y } = at(p);
    for (const dy of [0, 2, -2, 4]) {
      await page.mouse.move(x, y + dy);
      await page.waitForTimeout(150);
      const hover = (await viewportOf(page).getAttribute('data-model-hover')) ?? '';
      if (new RegExp(`^${kind}:`).test(hover)) {
        await page.mouse.click(x, y + dy);
        return;
      }
    }
  }
  throw new Error(`nothing to click as ${kind}`);
}

async function ok(page: Page, dialog: Locator) {
  await expect(dialog).toHaveAttribute('data-preview-status', /^(ok|warning)$/, {
    timeout: 20_000,
  });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
}

/** The 40 mm cube, a Ø12 through hole at (5, −6) and a 3 mm round on the top front edge. */
async function part(page: Page) {
  const viewport = viewportOf(page);
  await pickTool(page, 'Box');
  const box = page.getByRole('region', { name: 'Box dialog' });
  for (const name of ['Length', 'Width', 'Height']) {
    await box.getByRole('textbox', { name, exact: true }).fill('40 mm');
  }
  await ok(page, box);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:40,40,40');
  const at = await settledProjector(viewport);

  await page.keyboard.press('h');
  const hole = page.getByRole('region', { name: 'Hole dialog' });
  await expect(hole).toBeVisible();
  const p = at([5, -6, 40]);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(150);
  await page.mouse.click(p.x, p.y);
  await expect(hole.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
  await hole.getByRole('textbox', { name: 'Diameter', exact: true }).fill('12 mm');
  await ok(page, hole);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:7:40,40,40');

  await pickTool(page, 'Fillet');
  const fillet = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(fillet).toBeVisible();
  await clickOn(page, at, [[0, -20, 40]], 'edge');
  await expect(fillet.getByRole('button', { name: 'Edges', exact: true })).toHaveText('1 edge');
  await fillet.getByRole('textbox', { name: 'Radius', exact: true }).fill('3 mm');
  await ok(page, fillet);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:8:40,40,40');
  return at;
}

test('Simplify for Print removes the small round and hole, and says what it found', async ({
  page,
}) => {
  const viewport = viewportOf(page);
  await openProject(page);
  await kernelReady(page);
  const at = await part(page);

  await pickTool(page, 'Simplify for Print');
  const dialog = page.getByRole('region', { name: 'Simplify for Print dialog' });
  await expect(dialog).toBeVisible();
  await clickOn(
    page,
    at,
    [
      [-12, 10, 40],
      [-15, 5, 40],
    ],
    'body',
  );
  await expect(dialog.getByRole('button', { name: 'Bodies', exact: true })).toHaveText('Body1');
  const rounds = dialog.getByRole('region', { name: 'Rounds', exact: true });
  const holes = dialog.getByRole('region', { name: 'Holes', exact: true });
  await rounds.getByRole('textbox', { name: 'Round radius', exact: true }).fill('4 mm');
  await holes.getByRole('textbox', { name: 'Hole diameter', exact: true }).fill('15 mm');

  // A card per kind: what goes, which sizes go and which stay; no chamfers on this cube.
  await expect(rounds.locator('[data-badge]')).toHaveText('1 go', { timeout: 30_000 });
  await expect(holes.locator('[data-badge]')).toHaveText('1 go');
  await expect(rounds.locator('[data-note]')).toHaveText('R3 mm goes');
  await expect(holes.locator('[data-note]')).toHaveText('Ø12 mm goes');
  await expect(dialog.locator('[data-field="maxChamferSize"]')).toHaveAttribute(
    'data-card',
    'none',
  );
  // The faces that go are drawn as a cut, not the simplified body.
  await expect(viewport).toHaveAttribute('data-preview', 'cut');

  // The slider's first stop is Keep: that kind stays, and the field empties.
  const slider = rounds.getByRole('slider', { name: 'Round radius', exact: true });
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(rounds.locator('[data-badge]')).toHaveText('Keep');
  await expect(rounds.getByRole('textbox', { name: 'Round radius', exact: true })).toHaveValue('');
  await expect(rounds.locator('[data-note]')).toHaveText('R3 mm stays', { timeout: 30_000 });
  await page.keyboard.press('End');
  await expect(rounds.getByRole('textbox', { name: 'Round radius', exact: true })).toHaveValue(
    '3 mm',
  );
  await expect(rounds.locator('[data-badge]')).toHaveText('1 go', { timeout: 30_000 });

  // Limits below both: nothing goes, a warning.
  await rounds.getByRole('textbox', { name: 'Round radius', exact: true }).fill('2 mm');
  await holes.getByRole('textbox', { name: 'Hole diameter', exact: true }).fill('10 mm');
  await expect(dialog).toHaveAttribute('data-preview-status', 'warning', { timeout: 30_000 });
  await expect(rounds.locator('[data-badge]')).toHaveText('0 go');
  await expect(holes.locator('[data-note]')).toHaveText('Ø12 mm stays');

  // Up again, and OK: the plain cube.
  await rounds.getByRole('textbox', { name: 'Round radius', exact: true }).fill('4 mm');
  await holes.getByRole('textbox', { name: 'Hole diameter', exact: true }).fill('15 mm');
  await expect(holes.locator('[data-badge]')).toHaveText('1 go', { timeout: 30_000 });
  await ok(page, dialog);
  await expect(
    page.getByRole('list', { name: 'Features' }).getByRole('button', {
      name: /^Simplify for Print1/,
    }),
  ).toBeVisible();
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:40,40,40');

  // One undo step brings the round and the hole back.
  await page.keyboard.press('Control+z');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:8:40,40,40');
});
