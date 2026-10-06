import { expect, type Locator, type Page, test } from '@playwright/test';
import { kernelReady, openProject, projector, saveStatus } from './helpers';

// P3-09: section analysis (FR-VP-06, ADR-0045). A clipping plane over the model with the cut
// filled in: view state, kept through recomputes and turned off and on from the browser. The
// Viewport region says what it draws (`data-section`, `data-section-clip`); picking ignores
// what is clipped away.

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** Waits until the camera has stopped moving; returns a world → page mapping. */
async function settledProjector(viewport: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const values = await Promise.all(
        ['size', 'target', 'direction', 'shift'].map((k) =>
          viewport.getAttribute(`data-camera-${k}`),
        ),
      );
      const key = values.join(' ');
      const still = key === last;
      last = key;
      return still;
    })
    .toBe(true);
  return projector(viewport);
}

const panel = (page: Page) => page.getByRole('region', { name: 'Section Analysis' });
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });

/** The offset in the section's `data-section` ("origin:xy offset=30 mm on"), in mm. */
async function offsetOf(viewport: Locator) {
  const text = (await viewport.getAttribute('data-section')) ?? '';
  return Number(/offset=(-?[\d.]+)/.exec(text)?.[1]);
}

test('cuts the view at a plane, follows the arrow and the flip, and ignores what is cut away', async ({
  page,
}) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await expect(viewport).not.toHaveAttribute('data-section', /./);
  const selection = page.locator('output[aria-label="Selection"]');

  // The bracket's inside wall face (x = 2.4, seen from the home view), off the sketch line: z = 50 and z = 20.
  let at = await settledProjector(viewport);
  const click = async (p: [number, number, number]) => {
    const { x, y } = at(p);
    await page.mouse.move(x, y);
    await page.mouse.click(x, y);
  };
  const high: [number, number, number] = [2.4, 20, 50];
  const low: [number, number, number] = [2.4, 20, 20];
  await click(high);
  await expect(viewport).toHaveAttribute('data-model-selection', /^face:/);
  await page.keyboard.press('Escape');
  await expect(selection).toBeHidden();

  // Section Analysis (Inspect, Shift+S): a new section starts by picking its plane.
  await page.getByRole('button', { name: /^Section/ }).click();
  const tool = panel(page);
  await expect(tool).toHaveAttribute('data-section-state', 'choosing');
  await tool.getByRole('button', { name: 'XY plane' }).click();
  // It starts through the middle of the model, the side above the plane cut away.
  await expect(tool).toHaveAttribute('data-section-state', 'on');
  await expect(viewport).toHaveAttribute('data-section', 'origin:xy offset=30 mm on');
  await expect(viewport).toHaveAttribute('data-section-clip', '0,0,30:0,0,1');
  const browser = page.getByRole('complementary', { name: 'Browser' });
  await expect(browser.locator('[data-section-row="on"]')).toHaveText(/Section · XY plane/);

  // The offset is an expression field.
  const offset = tool.getByRole('textbox', { name: 'Offset', exact: true });
  await offset.fill('12 mm + 23 mm');
  await expect(viewport).toHaveAttribute('data-section-clip', '0,0,35:0,0,1');
  await offset.fill('30 mm');
  await expect(viewport).toHaveAttribute('data-section-clip', '0,0,30:0,0,1');

  // Picking: the wall above the cut is gone, below it stays.
  await click(high);
  await expect(viewport).toHaveAttribute('data-model-selection', '');
  await expect(viewport).toHaveAttribute('data-model-hover', '');
  await click(low);
  await expect(viewport).toHaveAttribute('data-model-selection', /^face:/);
  await expect(selection).toHaveText('1 face ·');
  await click(high);
  await expect(viewport).toHaveAttribute('data-model-selection', '');

  // The arrow: dragging its handle up the plane's normal moves the cut.
  const handle = viewport.locator('[data-section-handle]');
  await expect(handle).toHaveCount(1);
  const box = await viewport.boundingBox();
  const at0 = async () => ({
    x: (box?.x ?? 0) + Number(await handle.getAttribute('cx')),
    y: (box?.y ?? 0) + Number(await handle.getAttribute('cy')),
  });
  const grab = await at0();
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(grab.x, grab.y - i * 6);
  await page.mouse.up();
  await expect.poll(() => offsetOf(viewport)).toBeGreaterThan(31);
  const dragged = await offsetOf(viewport);
  expect(dragged).toBeLessThan(60);
  await expect(offset).toHaveValue(`${dragged} mm`);
  await expect(viewport).toHaveAttribute('data-section-clip', `0,0,${dragged}:0,0,1`);

  // Flip: the same cut, the other side goes.
  await offset.fill('30 mm');
  await tool.getByRole('checkbox', { name: 'Flip' }).check();
  await expect(viewport).toHaveAttribute('data-section', 'origin:xy offset=30 mm flipped on');
  await expect(viewport).toHaveAttribute('data-section-clip', '0,0,30:0,0,-1');
  await click(low);
  await expect(viewport).toHaveAttribute('data-model-selection', '');
  await click(high);
  await expect(viewport).toHaveAttribute('data-model-selection', /^face:/);
  await tool.getByRole('checkbox', { name: 'Flip' }).uncheck();
  await expect(viewport).toHaveAttribute('data-section-clip', '0,0,30:0,0,1');

  // Done closes the panel; the section stays, in the browser.
  await tool.getByRole('button', { name: /^Done/ }).click();
  await expect(tool).toBeHidden();
  await expect(viewport).toHaveAttribute('data-section', 'origin:xy offset=30 mm on');
  await expect(viewport.locator('[data-section-handle]')).toHaveCount(0);

  // Editing a feature with the section on: the model changes, the section stays where it was.
  await kernelReady(page);
  await chip(page, 'Extrude1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Extrude1 dialog' });
  await expect(edit).toHaveAttribute('data-dialog-mode', 'edit');
  await edit.getByRole('textbox', { name: 'Distance' }).fill('60 mm');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(edit).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Bracket:12:40,60,60');
  await expect(viewport).toHaveAttribute('data-section', 'origin:xy offset=30 mm on');
  await expect(viewport).toHaveAttribute('data-section-clip', '0,0,30:0,0,1');
  // Undo brings the old width back; the section is not part of the undo history.
  await page.keyboard.press('Control+z');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Bracket:12:40,80,60');
  await expect(viewport).toHaveAttribute('data-section-clip', '0,0,30:0,0,1');

  // A sketch is drawn without the section (the view is of the model), and it is back after.
  await chip(page, 'Sketch1').dblclick();
  const palette = page.getByRole('region', { name: 'Sketch palette' });
  await expect(palette).toBeVisible();
  await expect(viewport).not.toHaveAttribute('data-section-clip', /./);
  await expect(viewport).toHaveAttribute('data-section', 'origin:xy offset=30 mm on');
  await palette.getByRole('button', { name: 'Finish Sketch' }).click();
  await expect(viewport).toHaveAttribute('data-section-clip', '0,0,30:0,0,1');
  // The sketch left the camera looking at it: back to the home view.
  await page.keyboard.press('Shift+1');
  await expect(viewport).toHaveAttribute('data-camera-direction', /^-0\.577,0\.577,-0\.577$/);
  at = await settledProjector(viewport);

  // Off and on again from the browser's eye, without starting over.
  await browser.getByRole('button', { name: 'Hide section', exact: true }).click();
  await expect(viewport).toHaveAttribute('data-section', 'origin:xy offset=30 mm off');
  await expect(viewport).not.toHaveAttribute('data-section-clip', /./);
  await click(high);
  await expect(viewport).toHaveAttribute('data-model-selection', /^face:/);
  await page.keyboard.press('Escape');
  await browser.getByRole('button', { name: 'Show section', exact: true }).click();
  await expect(viewport).toHaveAttribute('data-section', 'origin:xy offset=30 mm on');
  await expect(viewport).toHaveAttribute('data-section-clip', '0,0,30:0,0,1');

  // The row reopens the panel with the section as it was; Remove ends it.
  await browser
    .locator('[data-section-row]')
    .getByRole('button', { name: /^Section/ })
    .click();
  await expect(tool).toHaveAttribute('data-section-state', 'on');
  await expect(tool.getByRole('textbox', { name: 'Offset', exact: true })).toHaveValue('30 mm');
  await tool.getByRole('button', { name: 'Remove' }).click();
  await expect(viewport).not.toHaveAttribute('data-section', /./);
  await expect(viewport).not.toHaveAttribute('data-section-clip', /./);
  await expect(browser.locator('[data-section-row]')).toHaveCount(0);
  await click(high);
  await expect(viewport).toHaveAttribute('data-model-selection', /^face:/);
});

test('a selected flat face takes the section at once, and stays with the face through an edit', async ({
  page,
}) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  const at = await settledProjector(viewport);
  const { x, y } = at([2.4, 20, 30]);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await expect(viewport).toHaveAttribute('data-model-selection', /^face:/);

  await page.keyboard.press('Shift+S');
  const tool = panel(page);
  await expect(tool).toHaveAttribute('data-section-state', 'on');
  await expect(viewport).toHaveAttribute('data-section', /^face:.* offset=-?[\d.]+ mm on$/);
  // The face looks along +X: the far half of the part, past the middle, is cut away.
  await expect(viewport).toHaveAttribute('data-section-clip', /^[\d.-]+,[\d.-]+,[\d.-]+:1,0,0$/);
  await expect(tool.locator('[data-section-plane]')).toHaveText('Face of Bracket');
  const before = await viewport.getAttribute('data-section-clip');

  // Changing the model moves nothing here: the face is the same one (its reference survives).
  await tool.getByRole('button', { name: /^Done/ }).click();
  await chip(page, 'Extrude1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Extrude1 dialog' });
  await edit.getByRole('textbox', { name: 'Distance' }).fill('60 mm');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await edit.getByRole('button', { name: 'OK' }).click();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Bracket:12:40,60,60');
  await expect(viewport).toHaveAttribute('data-section-clip', before ?? '');

  // Changing the plane from the panel picks planes by name.
  await page
    .getByRole('complementary', { name: 'Browser' })
    .locator('[data-section-row]')
    .getByRole('button', { name: /^Section/ })
    .click();
  await tool.getByRole('button', { name: 'Change' }).click();
  await expect(tool).toHaveAttribute('data-section-state', 'choosing');
  await tool.getByRole('button', { name: 'XZ plane' }).click();
  await expect(viewport).toHaveAttribute('data-section', /^origin:xz offset=-?[\d.]+ mm on$/);
});

/**
 * Drags the section handle `id` along its arrow (`sign` 1: towards the arrowhead, which points
 * to the side that is cut away), `distance` px in small steps. The arrowheads are listed in
 * `data-section-arrow` in the order the handles are drawn.
 */
async function dragHandle(page: Page, viewport: Locator, id: string, tip: number, sign: 1 | -1) {
  const handle = viewport.locator(`[data-section-handle="${id}"]`);
  const box = await viewport.boundingBox();
  const hx = (box?.x ?? 0) + Number(await handle.getAttribute('cx'));
  const hy = (box?.y ?? 0) + Number(await handle.getAttribute('cy'));
  const tips = (
    (await page.locator('[data-section-arrow]').getAttribute('data-section-arrow')) ?? ''
  )
    .split(';')
    .map((t) => t.split(',').map(Number));
  const [tx = 0, ty = 0] = tips[tip] ?? [];
  const ux = tx - Number(await handle.getAttribute('cx'));
  const uy = ty - Number(await handle.getAttribute('cy'));
  const length = Math.hypot(ux, uy) || 1;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++)
    await page.mouse.move(hx + sign * (ux / length) * i * 5, hy + sign * (uy / length) * i * 5);
  await page.mouse.up();
}

test('cuts at two planes at once: a corner is gone, each row has its own arrow and Remove', async ({
  page,
}) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  const at = await settledProjector(viewport);
  const click = async (p: [number, number, number]) => {
    const { x, y } = at(p);
    await page.mouse.move(x, y);
    await page.mouse.click(x, y);
  };

  await page.getByRole('button', { name: /^Section/ }).click();
  const tool = panel(page);
  await tool.getByRole('button', { name: 'XY plane' }).click();
  await expect(viewport).toHaveAttribute('data-section', 'origin:xy offset=30 mm on');

  // A second plane: the panel lists both, the limit is three.
  await tool.getByRole('button', { name: 'Add plane', exact: true }).click();
  await expect(tool).toHaveAttribute('data-section-state', 'choosing');
  await tool.getByRole('button', { name: 'YZ plane' }).click();
  await expect(tool).toHaveAttribute('data-section-state', 'on');
  await expect(viewport).toHaveAttribute(
    'data-section',
    'origin:xy offset=30 mm on;origin:yz offset=20 mm on',
  );
  await expect(viewport).toHaveAttribute('data-section-clip', '0,0,30:0,0,1;20,0,0:1,0,0');
  await expect(tool.locator('[data-section-index]')).toHaveCount(2);
  const browser = page.getByRole('complementary', { name: 'Browser' });
  await expect(browser.locator('[data-section-row="on"]')).toHaveText(/Section · 2 planes/);
  await expect(viewport.locator('[data-section-handle]')).toHaveCount(2);

  // Picking: the wall above z = 30 and the foot beyond x = 20 are cut away; the rest stays.
  await click([2.4, 20, 50]);
  await expect(viewport).toHaveAttribute('data-model-selection', '');
  await click([30, 20, 2.4]);
  await expect(viewport).toHaveAttribute('data-model-selection', '');
  await click([2.4, 20, 20]);
  await expect(viewport).toHaveAttribute('data-model-selection', /^face:/);
  await click([30, 20, 2.4]);
  await expect(viewport).toHaveAttribute('data-model-selection', '');
  await click([10, 20, 2.4]);
  await expect(viewport).toHaveAttribute('data-model-selection', /^face:/);

  // The second row's arrow moves its own cut only.
  await dragHandle(page, viewport, '1', 1, 1);
  await expect
    .poll(async () =>
      Number(/yz offset=(-?[\d.]+)/.exec((await viewport.getAttribute('data-section')) ?? '')?.[1]),
    )
    .toBeGreaterThan(21);
  expect(await viewport.getAttribute('data-section')).toMatch(/^origin:xy offset=30 mm on;/);
  const second = tool.locator('[data-section-index="1"]').getByRole('textbox', { name: 'Offset' });
  await second.fill('20 mm');
  await expect(viewport).toHaveAttribute('data-section-clip', '0,0,30:0,0,1;20,0,0:1,0,0');

  // Flip belongs to its row.
  await tool.locator('[data-section-index="1"]').getByRole('checkbox', { name: 'Flip' }).check();
  await expect(viewport).toHaveAttribute('data-section-clip', '0,0,30:0,0,1;20,0,0:-1,0,0');
  await tool.locator('[data-section-index="1"]').getByRole('checkbox', { name: 'Flip' }).uncheck();

  // Remove one row; the other stays, as a single section again.
  await tool
    .locator('[data-section-index="0"]')
    .getByRole('button', { name: 'Remove', exact: true })
    .click();
  await expect(viewport).toHaveAttribute('data-section', 'origin:yz offset=20 mm on');
  await expect(viewport).toHaveAttribute('data-section-clip', '20,0,0:1,0,0');
  await expect(browser.locator('[data-section-row="on"]')).toHaveText(/Section · YZ plane/);
  await expect(tool.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(1);
});

test('the section box cuts at six planes, its face handles drag it, and it excludes planes', async ({
  page,
}) => {
  const viewport = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await page.getByRole('button', { name: /^Section/ }).click();
  const tool = panel(page);
  await tool.getByRole('button', { name: 'Box', exact: true }).click();
  await expect(tool).toHaveAttribute('data-section-mode', 'box');
  // The shown bodies' box grown 5 %: the bracket is 40 x 80 x 60 mm.
  const boxOf = async () => {
    const text = (await viewport.getAttribute('data-section')) ?? '';
    const m = /^box=(-?[\d.]+),(-?[\d.]+),(-?[\d.]+):([\d.]+),([\d.]+),([\d.]+) (on|off)$/.exec(
      text,
    );
    return m ? { c: m.slice(1, 4).map(Number), h: m.slice(4, 7).map(Number), on: m[7] } : undefined;
  };
  await expect.poll(boxOf).toBeDefined();
  const start = await boxOf();
  expect(start?.c[0]).toBeCloseTo(20, 0);
  expect(start?.h[0]).toBeCloseTo(21, 0);
  expect(start?.h[2]).toBeCloseTo(31.5, 0);
  const clip = (await viewport.getAttribute('data-section-clip')) ?? '';
  expect(clip.split(';')).toHaveLength(6);
  await expect(viewport.locator('[data-section-handle^="box:"]')).toHaveCount(6);

  // Dragging the top face's handle down shrinks the box from the top; the bottom stays.
  const before = start?.h[2] ?? 0;
  await dragHandle(page, viewport, 'box:+z', 4, -1);
  await expect.poll(async () => (await boxOf())?.h[2] ?? 99).toBeLessThan(before - 1);
  const after = await boxOf();
  expect((after?.c[2] ?? 0) - (after?.h[2] ?? 0)).toBeCloseTo((start?.c[2] ?? 0) - before, 0);

  // The fields are expressions.
  await tool.getByRole('textbox', { name: 'Half-size X', exact: true }).fill('10 mm');
  await expect.poll(async () => (await boxOf())?.h[0]).toBe(10);

  // Turning it off keeps it; a box and planes exclude each other.
  await tool.getByRole('checkbox', { name: 'Show section' }).uncheck();
  await expect.poll(async () => (await boxOf())?.on).toBe('off');
  await expect(viewport).not.toHaveAttribute('data-section-clip', /./);
  await expect(
    page.getByRole('complementary', { name: 'Browser' }).locator('[data-section-row="off"]'),
  ).toHaveText(/Section · Box/);
  await tool.getByRole('button', { name: 'Add plane', exact: true }).click();
  await tool.getByRole('button', { name: 'XY plane' }).click();
  await expect(viewport).toHaveAttribute('data-section', /^origin:xy offset=/);
  await expect(viewport.locator('[data-section-handle^="box:"]')).toHaveCount(0);
});

for (const theme of ['dark', 'light'] as const) {
  test(`a section of the bracket looks right in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript(
      (t) => localStorage.setItem('extrudo.theme', JSON.stringify(t)),
      theme,
    );
    const viewport = await openProject(page, 'wall-bracket');
    await expect(saveStatus(page)).toHaveText('Saved');
    await kernelReady(page);
    // Cut through the middle of the bracket, looking at the L of its side (XZ plane at y = 0).
    await page.getByRole('button', { name: /^Section/ }).click();
    await panel(page).getByRole('button', { name: 'XZ plane' }).click();
    await expect(viewport).toHaveAttribute('data-section', 'origin:xz offset=0 mm on');
    await panel(page).getByRole('button', { name: /^Done/ }).click();
    await expect(panel(page)).toBeHidden();
    await settledProjector(viewport);
    await page.mouse.move(0, 0);
    await page.evaluate('document.fonts.ready.then(() => true)');
    await expect(page).toHaveScreenshot(`section-${theme}.png`, {
      animations: 'disabled',
      caret: 'hide',
    });
  });
}
