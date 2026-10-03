import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { readArchive } from '../packages/storage/src/archive';
import {
  attr,
  chip,
  exportProject,
  renameProject,
  selectBodies,
  settled,
  turnView,
  viewportOf,
  zoomOutTo,
} from './benchmark-helpers';
import { type Clip, CURSOR_SCRIPT, clipOf, DEMO_STYLE, Recorder } from './demo-recorder';
import { kernelReady, mapping, newSketchOnXY, openProject, pickTool, projector } from './helpers';

// Regenerates the assets the app ships for onboarding (P3-12, ADR-0052):
//
//   - the template gallery's thumbnails (`apps/web/src/home/templates/*.png`),
//     rendered by the app itself in the home view;
//   - the tools' demo clips (`apps/web/public/demos/<tool>.webm`), recorded
//     from the app by driving it: see `demo-recorder.ts`;
//   - the landing page's intro video (`apps/site/public/media/intro.webm`,
//     ADR-0057): the whole window, from the home screen to a part that follows
//     a changed number.
//
// It writes into the repository, so it only runs with RECORD_ASSETS=1:
// `pnpm demos` (scripts/record-demos.mjs) does that after making sure
// Playwright's ffmpeg is installed. Review the result in the Browser pane.

test.skip(
  !process.env.RECORD_ASSETS,
  'RECORD_ASSETS=1 rewrites the checked-in thumbnails and demos',
);
test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 240_000 });

const THUMBNAILS = join(process.cwd(), 'apps', 'web', 'src', 'home', 'templates');
const DEMOS = join(process.cwd(), 'apps', 'web', 'public', 'demos');

// ---- Template thumbnails -----------------------------------------------------

const TEMPLATE_CARDS = [
  { id: 'wall-bracket', name: 'Wall bracket' },
  { id: 'storage-box', name: 'Storage box' },
  { id: 'box-with-lid', name: 'Box with a lid' },
  { id: 'pcb-enclosure', name: 'PCB enclosure' },
] as const;

for (const { id, name } of TEMPLATE_CARDS) {
  test(`thumbnail of the ${name} template`, async ({ page }) => {
    await page.goto('./');
    await page.getByRole('button', { name: `Start from the ${name} template` }).click();
    await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
    await expect(viewportOf(page)).toHaveAttribute('data-ready', 'true');
    await expect(page.getByRole('button', { name: `Project name: ${name}. Rename` })).toBeVisible();
    await kernelReady(page);
    await turnView(page, 'Shift+1');
    // An edit makes the next save take a fresh picture of the view; exporting flushes it.
    await renameProject(page, `${name} copy`);
    const bytes = await exportProject(page, `${id}.extrudo`);
    const { thumbnail } = readArchive(new Uint8Array(bytes));
    if (!thumbnail) throw new Error('the export has no thumbnail');
    await mkdir(THUMBNAILS, { recursive: true });
    await writeFile(join(THUMBNAILS, `${id}.png`), thumbnail);
  });
}

// ---- Demo clips -------------------------------------------------------------

/** A pointer that glides: the page's own mouse jumps, and a clip wants to see it travel. */
function pointer(page: Page) {
  let pos = { x: 760, y: 430 };
  const jump = async (to: { x: number; y: number }) => {
    await page.mouse.move(to.x, to.y);
    pos = to;
  };
  const moveTo = async (to: { x: number; y: number }, ms = 350) => {
    const n = Math.max(3, Math.round(ms / 40));
    const from = pos;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const e = t * t * (3 - 2 * t);
      await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
      await page.waitForTimeout(ms / n);
    }
    pos = to;
  };
  const click = async (to: { x: number; y: number }, ms = 350) => {
    await moveTo(to, ms);
    await page.mouse.click(to.x, to.y);
    await page.waitForTimeout(100);
  };
  const sync = (p: { x: number; y: number }) => {
    pos = p;
  };
  return { jump, moveTo, click, sync };
}

/** A new design with the drawn pointer, and the onboarding hint and card kept out of frame. */
async function demoProject(page: Page, from: 'blank' | 'wall-bracket' = 'blank') {
  await page.addInitScript(CURSOR_SCRIPT);
  await page.addInitScript(
    `document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(DEMO_STYLE)}; document.head.append(s); });`,
  );
  const viewport = await openProject(page, from);
  await kernelReady(page);
  return viewport;
}

/** A 560 × 350 clip around a page point: a sketch is small in the view, so its demo goes in close. */
const around = (p: { x: number; y: number }, width = 560): Clip => ({
  x: Math.round(p.x - width / 2),
  y: Math.round(p.y - (width * 5) / 16),
  width,
  height: Math.round((width * 5) / 8),
});

/** Records `flow` and writes `<tool>.webm`; the clip is the whole work area's 8:5 right part unless given. */
async function record(page: Page, tool: string, flow: () => Promise<void>, clip?: Clip) {
  const box = await viewportOf(page).boundingBox();
  if (!box) throw new Error('no viewport');
  const recorder = new Recorder(page, clip ?? clipOf(box));
  recorder.start();
  try {
    await flow();
    await page.waitForTimeout(200);
  } finally {
    await recorder.stop();
  }
  const seconds = await recorder.encode(join(DEMOS, `${tool}.webm`));
  console.log(`${tool}: ${recorder.frames.length} screenshots, ${seconds.toFixed(1)} s`);
}

/** A 20 mm cube on XY centred on the origin (the Box tool's defaults), or another size. */
async function cube(page: Page, size?: string) {
  await pickTool(page, 'Box');
  const dialog = page.getByRole('region', { name: 'Box dialog' });
  await expect(dialog).toBeVisible();
  if (size) {
    for (const field of ['Length', 'Width', 'Height']) {
      await dialog.getByRole('textbox', { name: field, exact: true }).fill(size);
    }
  }
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
}

/** Types into a dialog's field the way a person does: select it, then key by key. */
async function typeInto(page: Page, field: ReturnType<Page['getByRole']>, text: string) {
  await field.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(text, { delay: 170 });
}

/** Sketch mm → page px in the settled sketch view. */
async function sketchView(page: Page) {
  await newSketchOnXY(page);
  await settled(viewportOf(page));
  return mapping(viewportOf(page));
}

/** Draws a rectangle in the open sketch (not recorded). */
async function drawRectangle(
  page: Page,
  at: Awaited<ReturnType<typeof mapping>>,
  [x1, y1]: [number, number],
  [x2, y2]: [number, number],
) {
  await page.keyboard.press('r');
  for (const [x, y] of [
    [x1, y1],
    [x2, y2],
  ] as const) {
    const p = at(x, y);
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press('Escape');
}

test('demo: sketch', async ({ page }) => {
  const viewport = await demoProject(page);
  const p = pointer(page);
  const tile = page.getByRole('button', { name: 'Create Sketch' });
  await record(page, 'sketch', async () => {
    await tile.click();
    const box = await tile.boundingBox();
    if (box) p.sync({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await page.waitForTimeout(320);
    // The XY plane's square, a little off the middle (the home view: x ≥ 0, y ≤ 0).
    const world = await projector(viewport);
    const s = Number(await attr(viewport, 'data-camera-size')) * 0.16;
    await p.moveTo(world([s * 0.45, -s * 0.45, 0]), 450);
    await page.waitForTimeout(260);
    await p.click(world([s * 0.45, -s * 0.45, 0]), 80);
    await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
    await settled(viewport);
  });
});

test('demo: line', async ({ page }) => {
  await demoProject(page);
  const at = await sketchView(page);
  const p = pointer(page);
  await p.jump(at(-40, 20));
  await record(
    page,
    'line',
    async () => {
      await page.keyboard.press('l');
      await p.click(at(-30, -15), 380);
      await p.click(at(10, -15), 340);
      await p.click(at(10, 15), 340);
      await page.keyboard.press('Escape');
    },
    around(at(0, 0)),
  );
});

test('demo: rectangle', async ({ page }) => {
  await demoProject(page);
  const at = await sketchView(page);
  const p = pointer(page);
  await p.jump(at(-40, 20));
  await record(
    page,
    'rectangle',
    async () => {
      await page.keyboard.press('r');
      await p.click(at(-30, -15), 380);
      await p.click(at(30, 15), 520);
      await page.keyboard.press('Escape');
    },
    around(at(0, 0)),
  );
});

test('demo: circle', async ({ page }) => {
  await demoProject(page);
  const at = await sketchView(page);
  const p = pointer(page);
  await p.jump(at(-30, 20));
  await record(
    page,
    'circle',
    async () => {
      await page.keyboard.press('c');
      await p.click(at(0, 0), 380);
      await p.click(at(20, 0), 450);
      await page.keyboard.press('Escape');
    },
    around(at(0, 0)),
  );
});

test('demo: dimension', async ({ page }) => {
  await demoProject(page);
  const at = await sketchView(page);
  await drawRectangle(page, at, [-30, -15], [30, 15]);
  const p = pointer(page);
  await p.jump(at(-35, 25));
  await record(
    page,
    'dimension',
    async () => {
      await page.keyboard.press('d');
      await p.click(at(0, -15), 380);
      await p.click(at(0, -26), 340);
      await page.keyboard.type('45', { delay: 180 });
      await page.waitForTimeout(160);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(320);
      await page.keyboard.press('Escape');
    },
    around(at(0, 0)),
  );
});

/** A sketch rectangle, finished, and the home view with its profile selected. */
async function profileInHomeView(page: Page, from: [number, number], to: [number, number]) {
  const at = await sketchView(page);
  await drawRectangle(page, at, from, to);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();
  const world = await turnView(page, 'Shift+1');
  const middle = world([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, 0]);
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.click(middle.x, middle.y);
  await expect.poll(() => attr(viewportOf(page), 'data-model-selection')).toMatch(/^profile:/);
  return world;
}

test('demo: extrude', async ({ page }) => {
  await demoProject(page);
  await profileInHomeView(page, [-20, -10], [20, 10]);
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await record(page, 'extrude', async () => {
    await page.keyboard.press('e');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(390);
    await page.keyboard.type('25', { delay: 200 });
    await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(320);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await kernelReady(page);
    await page.waitForTimeout(320);
  });
});

test('demo: revolve', async ({ page }) => {
  const viewport = await demoProject(page);
  const world = await profileInHomeView(page, [10, 0], [30, 20]);
  // Add the Y axis to the selection (Shift-click) where the view reports it.
  let picked = false;
  for (const t of [22, 18, 25, 14, 10]) {
    const a = world([0, t, 0]);
    await page.mouse.move(a.x, a.y);
    await page.waitForTimeout(150);
    if ((await attr(viewport, 'data-model-hover')) === 'axis:origin:y') {
      await page.keyboard.down('Shift');
      await page.mouse.click(a.x, a.y);
      await page.keyboard.up('Shift');
      picked = true;
      break;
    }
  }
  expect(picked).toBe(true);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/axis:origin:y/);
  const dialog = page.getByRole('region', { name: 'Revolve dialog' });
  await record(page, 'revolve', async () => {
    await page.getByRole('button', { name: 'Revolve', exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(580);
    await typeInto(page, dialog.getByRole('textbox', { name: 'Angle' }), '180');
    await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(460);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await kernelReady(page);
    await page.waitForTimeout(260);
  });
});

/** Glides to a world point until the view hovers `kind` there, then clicks. */
async function pickModel(
  page: Page,
  p: ReturnType<typeof pointer>,
  at: (w: readonly [number, number, number]) => { x: number; y: number },
  w: readonly [number, number, number],
  kind: 'face' | 'edge',
) {
  const target = at(w);
  const aim = { x: target.x, y: target.y + (kind === 'edge' ? 2 : 0) };
  await p.moveTo(aim, 450);
  await expect
    .poll(() => attr(viewportOf(page), 'data-model-hover'))
    .toMatch(new RegExp(`^${kind}:`));
  await page.waitForTimeout(200);
  await page.mouse.click(aim.x, aim.y);
  await page.waitForTimeout(160);
}

test('demo: fillet', async ({ page }) => {
  await demoProject(page);
  await cube(page);
  const at = await turnView(page, 'Shift+1');
  const p = pointer(page);
  await p.jump({ x: 1000, y: 650 });
  const dialog = page.getByRole('region', { name: 'Fillet dialog' });
  await record(page, 'fillet', async () => {
    await pickModel(page, p, at, [0, -10, 20], 'edge');
    await page.keyboard.press('f');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(320);
    await typeInto(page, dialog.getByRole('textbox', { name: 'Radius', exact: true }), '4');
    await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(390);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await kernelReady(page);
  });
});

test('demo: shell', async ({ page }) => {
  await demoProject(page);
  await cube(page);
  const at = await turnView(page, 'Shift+1');
  const p = pointer(page);
  await p.jump({ x: 1000, y: 650 });
  const dialog = page.getByRole('region', { name: 'Shell dialog' });
  await record(page, 'shell', async () => {
    await pickModel(page, p, at, [0, 0, 20], 'face');
    await page.getByRole('button', { name: /^Shell/ }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(390);
    await typeInto(page, dialog.getByRole('textbox', { name: 'Thickness', exact: true }), '3');
    await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(390);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await kernelReady(page);
  });
});

test('demo: hole', async ({ page }) => {
  await demoProject(page);
  await cube(page, '40 mm');
  const at = await turnView(page, 'Shift+1');
  const p = pointer(page);
  await p.jump({ x: 1000, y: 650 });
  const dialog = page.getByRole('region', { name: 'Hole dialog' });
  await record(page, 'hole', async () => {
    await page.keyboard.press('h');
    await expect(dialog).toBeVisible();
    await p.click(at([5, -6, 40]), 450);
    await expect(dialog.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
    await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(390);
    await typeInto(page, dialog.getByRole('textbox', { name: 'Diameter', exact: true }), '10');
    await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(390);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await kernelReady(page);
  });
});

test('demo: pressPull', async ({ page }) => {
  await demoProject(page);
  await cube(page);
  const at = await turnView(page, 'Shift+1');
  const p = pointer(page);
  await p.jump({ x: 1000, y: 650 });
  const dialog = page.getByRole('region', { name: 'Offset Face dialog' });
  await record(page, 'pressPull', async () => {
    await pickModel(page, p, at, [0, 0, 20], 'face');
    await page.keyboard.press('q');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(320);
    await typeInto(page, dialog.getByRole('textbox', { name: 'Distance', exact: true }), '8');
    await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(390);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await kernelReady(page);
  });
});

test('demo: rectangularPattern', async ({ page }) => {
  const viewport = await demoProject(page);
  await cube(page);
  await turnView(page, 'Shift+1');
  // Zoomed out, so the copies fit beside the dialog.
  await zoomOutTo(page, { x: 700, y: 450 }, 130);
  await settled(viewport);
  const at = await projector(viewport);
  await selectBodies(page, ['Body1']);
  // Where the view reports the X axis, found before recording so the clip goes straight there.
  let spot: { x: number; y: number } | undefined;
  for (const t of [25, 30, 35, -25, -30, -35]) {
    const a = at([t, 0, 0]);
    await page.mouse.move(a.x, a.y);
    await page.waitForTimeout(150);
    if ((await attr(viewport, 'data-model-hover')) === 'axis:origin:x') {
      spot = a;
      break;
    }
  }
  const p = pointer(page);
  await p.jump({ x: 1000, y: 650 });
  const dialog = page.getByRole('region', { name: 'Rectangular Pattern dialog' });
  await record(page, 'rectangularPattern', async () => {
    await pickTool(page, 'Rectangular Pattern');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Direction', exact: true }).click();
    if (!spot) throw new Error('the X axis can’t be picked');
    await p.click(spot, 450);
    await expect(dialog.getByRole('button', { name: 'Direction', exact: true })).toHaveText(
      'X axis',
    );
    await typeInto(page, dialog.getByRole('textbox', { name: 'Count', exact: true }), '3');
    await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(260);
    await typeInto(page, dialog.getByRole('textbox', { name: 'Distance', exact: true }), '30');
    await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(460);
    await dialog.getByRole('button', { name: 'OK' }).click();
    await expect(dialog).toBeHidden();
    await kernelReady(page);
  });
});

// ---- The landing page's intro (ADR-0057) ------------------------------------

const INTRO = join(process.cwd(), 'apps', 'site', 'public', 'media', 'intro.webm');

test('intro: the landing page video', async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(CURSOR_SCRIPT);
  await page.addInitScript(
    `document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(DEMO_STYLE)}; document.head.append(s); });`,
  );
  // Info toasts ("Sketch1 is hidden…") and their bell would clutter a still frame.
  const quiet =
    '[role="status"]:has(button[aria-label="Dismiss"]), button[aria-label^="Notification history"] { display: none !important; }';
  await page.addInitScript(
    `document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(quiet)}; document.head.append(s); });`,
  );
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
  // Keep the tour's card off the home screen: the video shows the plain flow.
  await page.getByRole('button', { name: 'Dismiss the tour' }).click();
  const p = pointer(page);
  await p.jump({ x: 900, y: 600 });
  const press = async (target: ReturnType<Page['getByRole']>, ms = 500) => {
    const box = await target.boundingBox();
    if (!box) throw new Error('nothing to press');
    await p.click({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, ms);
  };

  const recorder = new Recorder(page, { x: 0, y: 0, width: 1440, height: 900 });
  recorder.start();
  try {
    await page.waitForTimeout(900);
    await press(page.getByRole('button', { name: 'New design' }), 700);
    await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
    const viewport = viewportOf(page);
    await expect(viewport).toHaveAttribute('data-ready', 'true');
    await kernelReady(page);
    await page.waitForTimeout(500);

    // A sketch on XY: a rectangle and one dimension.
    await press(page.getByRole('button', { name: 'Create Sketch' }));
    await page.waitForTimeout(300);
    const world = await projector(viewport);
    const s = Number(await attr(viewport, 'data-camera-size')) * 0.16;
    await p.click(world([s * 0.45, -s * 0.45, 0]), 600);
    await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
    await settled(viewport);
    const at = await mapping(viewport);
    await press(page.getByRole('button', { name: /^Rectangle/ }));
    await p.click(at(-20, -10), 600);
    await p.moveTo(at(10, 0), 300);
    await p.click(at(20, 10), 500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await press(page.getByRole('button', { name: /^Dimension/ }));
    await p.click(at(0, -10), 600);
    await p.click(at(0, -17), 400);
    await page.waitForTimeout(250);
    await page.keyboard.type('40', { delay: 200 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await press(page.getByRole('button', { name: 'Finish Sketch' }).last());
    await kernelReady(page);

    // Into 3D: extrude the profile, then round an edge.
    const home = await turnView(page, 'Shift+1');
    await p.click(home([0, 0, 0]), 600);
    await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
    await press(page.getByRole('button', { name: /^Extrude/ }));
    const extrude = page.getByRole('region', { name: 'Extrude dialog' });
    await expect(extrude).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await typeInto(page, extrude.getByRole('textbox', { name: 'Distance', exact: true }), '15');
    await expect(extrude).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(600);
    await press(extrude.getByRole('button', { name: 'OK' }), 400);
    await expect(extrude).toBeHidden();
    await kernelReady(page);
    await page.waitForTimeout(400);

    const solid = await turnView(page, 'Shift+1');
    await pickModel(page, p, solid, [0, -10, 15], 'edge');
    await press(page.getByRole('button', { name: /^Fillet/ }));
    const fillet = page.getByRole('region', { name: 'Fillet dialog' });
    await expect(fillet).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await typeInto(page, fillet.getByRole('textbox', { name: 'Radius', exact: true }), '4');
    await expect(fillet).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(600);
    await press(fillet.getByRole('button', { name: 'OK' }), 400);
    await expect(fillet).toBeHidden();
    await kernelReady(page);
    await page.waitForTimeout(700);

    // Change one number, and the whole part follows: Extrude1's distance, edited in its
    // dialog (not modal, so the preview shows the part grow), keeps its rounded edge.
    // Zoom out first so the taller part stays in the frame.
    const middle = solid([0, 0, 7]);
    await p.moveTo(middle, 500);
    await zoomOutTo(page, middle, 90);
    await settled(viewport);
    const extrudeChip = chip(page, 'Extrude1');
    const chipBox = await extrudeChip.boundingBox();
    if (!chipBox) throw new Error('no Extrude1 chip');
    const chipAt = { x: chipBox.x + chipBox.width / 2, y: chipBox.y + chipBox.height / 2 };
    await p.moveTo(chipAt, 700);
    await page.waitForTimeout(200);
    await page.mouse.dblclick(chipAt.x, chipAt.y);
    const edit = page.getByRole('region', { name: 'Edit Extrude1 dialog' });
    await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(500);
    await typeInto(page, edit.getByRole('textbox', { name: 'Distance', exact: true }), '35');
    await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(1200);
    await press(edit.getByRole('button', { name: 'OK' }), 400);
    await expect(edit).toBeHidden();
    await kernelReady(page);
    await p.moveTo({ x: 1250, y: 700 }, 600);
    await page.waitForTimeout(1800);
  } finally {
    await recorder.stop();
  }
  const seconds = await recorder.encode(INTRO, {
    size: { width: 1280, height: 800 },
    bitrate: '1200k',
    crf: 26,
    holdMs: 1500,
  });
  console.log(`intro: ${recorder.frames.length} screenshots, ${seconds.toFixed(1)} s`);
});
