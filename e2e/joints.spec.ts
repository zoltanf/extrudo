import { expect, type Locator, type Page, test } from '@playwright/test';
import { chip, clickWhere, turnView } from './benchmark-helpers';
import { kernelReady } from './helpers';

// P6-05 J1 (ADR-0081 §4): joints between components. The hinge fixture
// (`fixtures/components/hinge.extrudo`, written by the kernel's
// `joints/hinge-fixture.test.ts`) has components Base (a plate, two knuckles and
// a Ø6 pin along X at y = 0, z = 2) and Leaf (a plate and a middle knuckle round
// the pin), and the revolute joint Hinge from the leaf's hole wall to the pin's.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const browserOf = (page: Page) => page.getByRole('complementary', { name: 'Browser' });
const viewportOf = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const componentLeaf = (page: Page, name: string) =>
  browserOf(page)
    .locator('[data-component]')
    .filter({ has: page.getByRole('button', { name, exact: true }) });
const menuItem = (page: Page, name: string) =>
  page.getByRole('menuitem', { name: new RegExp(`^${name}`) });
const blur = (page: Page) =>
  page.evaluate(
    'document.activeElement && document.activeElement.blur && document.activeElement.blur()',
  );

/** A point on the leaf's knuckle (Ø10, coaxial with the pin) facing the home view. */
const LEAF_KNUCKLE = [0, -3, 6] as const;
/** The same on the base's second knuckle (x 7…20). */
const BASE_KNUCKLE = [13.5, -3, 6] as const;

async function openHinge(page: Page) {
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import .extrudo' }).click(),
  ]);
  await chooser.setFiles('fixtures/components/hinge.extrudo');
  await expect(page).toHaveURL(/#\/p\/[^/]+$/);
  await kernelReady(page);
}

async function pickFrames(page: Page, dialog: Locator) {
  const at = await turnView(page, 'Shift+1');
  await clickWhere(page, at, LEAF_KNUCKLE, /^face:/);
  await expect(dialog.getByRole('button', { name: 'Moving part', exact: true })).toHaveText(
    /· Leaf$/,
  );
  await clickWhere(page, at, BASE_KNUCKLE, /^face:/);
  await expect(dialog.getByRole('button', { name: 'Fixed part', exact: true })).toHaveText(
    /· Base$/,
  );
}

test('a joint is made, renamed, undone, and its lost frame fixed', async ({ page }) => {
  test.setTimeout(120_000);
  await openHinge(page);
  const viewport = viewportOf(page);
  await expect(viewport).toHaveAttribute('data-joints', /^Hinge:revolute:ok:[^:]+:1,0,0$/);
  const leaf = componentLeaf(page, 'Leaf');
  const hinge = leaf.locator('[data-joint]');
  await expect(hinge).toHaveCount(1);
  await expect(hinge).toHaveAttribute('data-joint-status', 'ok');
  await expect(hinge).toHaveAttribute('data-joint-type', 'revolute');

  // J opens the dialog; the two knuckles' walls are one axis.
  await page.keyboard.press('j');
  const dialog = page.getByRole('region', { name: 'Joint dialog' });
  await expect(dialog).toBeVisible();
  await pickFrames(page, dialog);
  await dialog.getByRole('combobox', { name: 'Type' }).selectOption('revolute');
  await dialog.getByRole('textbox', { name: 'Maximum angle' }).fill('90 deg');
  await expect(dialog.locator('[data-info="joint"]')).toHaveText("Turns Leaf about Base's axis.");
  await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
  await dialog.getByRole('button', { name: /^OK/ }).click();
  await expect(dialog).toBeHidden();
  await expect(leaf.locator('[data-joint]')).toHaveCount(2);
  await expect(viewport).toHaveAttribute(
    'data-joints',
    /^Hinge:revolute:ok:[^;]+;Joint1:revolute:ok:[^:]+:-?1,0,0$/,
  );

  // F2 renames it; Ctrl+Z takes the rename and then the joint away.
  await leaf.getByRole('button', { name: 'Joint1', exact: true }).focus();
  await page.keyboard.press('F2');
  const field = browserOf(page).getByRole('textbox', { name: 'Rename Joint1' });
  await field.fill('Lid hinge');
  await field.press('Enter');
  await expect(viewport).toHaveAttribute('data-joints', /;Lid_hinge:revolute:ok:/);
  await blur(page);
  await page.keyboard.press('Control+z');
  await expect(viewport).toHaveAttribute('data-joints', /;Joint1:revolute:ok:/);
  await page.keyboard.press('Control+z');
  await expect(leaf.locator('[data-joint]')).toHaveCount(1);

  // Deleting the pin loses Hinge's fixed frame: the kernel guesses the closest
  // cylinder, which is on Leaf, so the row warns (or errs, without a match).
  await chip(page, 'Pin').click({ button: 'right' });
  await menuItem(page, 'Delete').click();
  await expect(hinge).toHaveAttribute('data-joint-status', /^(warning|error)$/);
  await hinge.click({ button: 'right' });
  await menuItem(page, 'Fix References').click();
  const fix = page.getByRole('region', { name: 'Edit Hinge dialog' });
  await expect(fix).toBeVisible();
  await expect(fix.getByRole('note', { name: 'Fix references' })).toBeVisible();
  const at = await turnView(page, 'Shift+1');
  await clickWhere(page, at, BASE_KNUCKLE, /^face:/);
  await expect(fix.locator('[data-info="joint"]')).toHaveText("Turns Leaf about Base's axis.");
  await fix.getByRole('button', { name: /^OK/ }).click();
  await expect(hinge).toHaveAttribute('data-joint-status', 'ok');

  // Two undos: the fix, then the deletion; the pin's wall is the frame again.
  await blur(page);
  await page.keyboard.press('Control+z');
  await expect(hinge).toHaveAttribute('data-joint-status', /^(warning|error)$/);
  await page.keyboard.press('Control+z');
  await expect(hinge).toHaveAttribute('data-joint-status', 'ok');
  await expect(chip(page, 'Pin')).toBeVisible();
});

// P6-05 J3 (ADR-0081 §4): the clearance check along the hinge's motion. As built
// the leaf turns 0…90° about the pin with nothing closer than the pin's 0.3 mm;
// past about 140° its plate reaches the base's.
test('the clearance check finds the tightest gap and a collision', async ({ page }) => {
  test.setTimeout(180_000);
  await openHinge(page);
  const viewport = viewportOf(page);
  const hinge = componentLeaf(page, 'Leaf').locator('[data-joint]');
  await expect(hinge).toHaveAttribute('data-joint-status', 'ok');

  // The joint row's Check Clearance opens the Joint panel and runs the check at once.
  const started = Date.now();
  await hinge.click({ button: 'right' });
  await menuItem(page, 'Check Clearance').click();
  const panel = page.getByRole('region', { name: 'Joint', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('region', { name: 'Clearance' })).toBeVisible();
  await expect(viewport).toHaveAttribute(
    'data-joint-check',
    /^joint=Hinge min=0\.2 tightest=0\.3 at=0 collides=none under=none samples=\d+$/,
    { timeout: 60_000 },
  );
  console.log(`[joints] clearance check of the hinge, 0-90°: ${Date.now() - started} ms`);
  const result = panel.locator('[data-joint-result]');
  await expect(result).toContainText('Tightest gap 0.30 mm at 0°–90°');
  await expect(result).toContainText('No collision from 0° to 90°.');
  // As built is where the gap was found: its leader is drawn.
  await expect(page.locator('[data-clearance-leader]')).toHaveAttribute(
    'data-clearance-leader',
    /^[\d.-]+,[\d.-]+ [\d.-]+,[\d.-]+$/,
  );
  await panel.getByRole('button', { name: /^Done/ }).click();
  await expect(panel).toBeHidden();
  const row = browserOf(page).locator('[data-joint-check-row]');
  await expect(row).toHaveText(/Clearance · Hinge/);

  // A wider range is a change to the design: the result is stale until checked again.
  await hinge.dblclick();
  const edit = page.getByRole('region', { name: 'Edit Hinge dialog' });
  await edit.getByRole('textbox', { name: 'Maximum angle' }).fill('180 deg');
  await expect(edit).toHaveAttribute('data-dialog-valid', 'true');
  await edit.getByRole('button', { name: /^OK/ }).click();
  await expect(edit).toBeHidden();
  await expect(viewport).toHaveAttribute('data-joint-check', / stale$/);
  await row.getByRole('button', { name: /Clearance · Hinge/ }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByText('The design changed: check again.')).toBeVisible();
  await expect(page.locator('[data-clearance-leader]')).toHaveCount(0);
  const again = Date.now();
  await panel.getByRole('button', { name: 'Check clearance' }).click();
  await expect(viewport).toHaveAttribute('data-joint-check', /collides=1[34]\d\.\d\.\.180\.0 /, {
    timeout: 60_000,
  });
  console.log(`[joints] clearance check of the hinge, 0-180°: ${Date.now() - again} ms`);
  const collision = result.locator('[data-joint-result-line="collision"]');
  await expect(collision).toHaveText(
    /^Collides from 1[34]\d\.\d° to 180\.0° \([\d.]+ mm³ at [\d.]+°\)/,
  );

  // Show poses the joint where the line says: inside the collision, then at the tightest
  // gap just before it, where the leader is drawn between the two closest points.
  await collision.getByRole('button', { name: /^Show/ }).click();
  await expect(viewport).toHaveAttribute('data-joint-pose', /^Hinge=(1[4-7]\d(\.\d+)?|180)$/);
  await expect(page.locator('[data-clearance-leader]')).toHaveCount(0);
  await result
    .locator('[data-joint-result-line="tightest"]')
    .getByRole('button', { name: /^Show/ })
    .click();
  await expect(viewport).toHaveAttribute('data-joint-pose', /^Hinge=1[34]\d(\.\d+)?$/);
  await expect(page.locator('[data-clearance-leader]')).toHaveAttribute(
    'data-clearance-leader',
    /^[\d.-]+,[\d.-]+ [\d.-]+,[\d.-]+$/,
  );

  // A minimum above the pin's clearance: the whole range is under it.
  const min = panel.getByRole('textbox', { name: 'Minimum gap', exact: true });
  await min.fill('0.5 mm');
  await blur(page);
  await expect(viewport).toHaveAttribute('data-joint-check', / stale$/);
  await panel.getByRole('button', { name: 'Check clearance' }).click();
  await expect(viewport).toHaveAttribute(
    'data-joint-check',
    /^joint=Hinge min=0\.5 .* under=0\.0\.\./,
    {
      timeout: 60_000,
    },
  );
  await expect(result.locator('[data-joint-result-line="under"]')).toHaveText(
    /^Under 0\.5 mm from 0° to /,
  );
});

// P6-05 J2 (ADR-0081 §4, §6): the pose is view state, drawn through a matrix.
test('a joint is posed in the view, and any tool puts it back', async ({ page }) => {
  test.setTimeout(120_000);
  await openHinge(page);
  const viewport = viewportOf(page);
  const hinge = componentLeaf(page, 'Leaf').locator('[data-joint]');
  await expect(viewport).not.toHaveAttribute('data-joint-pose', /.+/);
  await expect(viewport).not.toHaveAttribute('data-posed-bodies', /.+/);
  const at = await turnView(page, 'Shift+1');
  const knuckle = at([...LEAF_KNUCKLE]);
  await expect
    .poll(async () => {
      await page.mouse.move(knuckle.x, knuckle.y);
      return (await viewport.getAttribute('data-model-hover')) ?? '';
    })
    .toMatch(/^face:/);
  const leafFace = (await viewport.getAttribute('data-model-hover')) ?? '';

  await hinge.click({ button: 'right' });
  await menuItem(page, 'Pose').click();
  const panel = page.getByRole('region', { name: 'Joint', exact: true });
  await expect(panel).toBeVisible();
  const angle = panel.getByRole('textbox', { name: 'Angle', exact: true });

  // 90 turns the leaf about the pin: its drawn box stands up, the kernel's bodies stay.
  const bodies = await viewport.getAttribute('data-bodies');
  await angle.fill('90');
  await angle.blur();
  await expect(viewport).toHaveAttribute('data-joint-pose', 'Hinge=90');
  await expect(viewport.locator('[data-pose-bar]')).toContainText('the design is unchanged');
  const posed = (await viewport.getAttribute('data-posed-bodies')) ?? '';
  const [min, max] = (posed.split(';')[0]?.split(':')[1] ?? '')
    .split('..')
    .map((p) => p.split(',').map(Number));
  expect((max?.[2] ?? 0) - (min?.[2] ?? 0)).toBeGreaterThan(15);
  expect(await viewport.getAttribute('data-bodies')).toBe(bodies);

  // A posed body takes no pick: the knuckle's own place gives its face no more.
  await page.mouse.move(knuckle.x + 3, knuckle.y);
  await page.mouse.move(knuckle.x, knuckle.y);
  await page.waitForTimeout(200);
  expect((await viewport.getAttribute('data-model-hover')) ?? '').not.toBe(leafFace);

  // The handle turns it: drag it a little each way until the field follows.
  await angle.fill('45');
  await angle.blur();
  await expect(viewport).toHaveAttribute('data-joint-pose', 'Hinge=45');
  const handle = viewport.locator('[data-joint-handle]');
  await expect(handle).toBeVisible();
  let dragged = false;
  for (const [dx, dy] of [
    [40, 0],
    [0, 40],
    [-40, 0],
    [0, -40],
  ] as const) {
    const cx = Number(await handle.getAttribute('cx'));
    const cy = Number(await handle.getAttribute('cy'));
    const box = await viewport.boundingBox();
    const x = (box?.x ?? 0) + cx;
    const y = (box?.y ?? 0) + cy;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y + (dy * i) / 6);
    await page.mouse.up();
    if ((await viewport.getAttribute('data-joint-pose')) !== 'Hinge=45') {
      dragged = true;
      break;
    }
  }
  expect(dragged).toBe(true);
  await expect(angle).not.toHaveValue(/^45/);

  // Past the fixture's 90°: held to the limit and said so.
  await angle.fill('120');
  await angle.blur();
  await expect(panel.locator('[data-pose-limited]')).toHaveText('Limited to 90°');
  await expect(viewport).toHaveAttribute('data-joint-pose', 'Hinge=90');

  // Starting a tool (Extrude) puts everything back.
  await blur(page);
  await page.keyboard.press('e');
  await expect(viewport).not.toHaveAttribute('data-joint-pose', /.+/);
  await expect(viewport).not.toHaveAttribute('data-posed-bodies', /.+/);
  await expect(panel).toBeHidden();
});
