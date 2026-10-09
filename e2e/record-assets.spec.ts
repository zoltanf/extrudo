import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { readArchive } from '../packages/storage/src/archive';
import {
  addParameter,
  attr,
  chip,
  clickEdge,
  clickWhere,
  closeParameters,
  exportProject,
  openParameters,
  renameProject,
  selectBodies,
  settled,
  toolPrompt,
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
//   - the landing page's walkthrough (`apps/site/src/images/walkthrough/`,
//     ADR-0057 amendment): nine stills of a PCB enclosure built from sketches,
//     each a WebP pair (1440 and 960 px wide) encoded in Chromium.
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

// ---- Example pictures (P6-06 S4) ---------------------------------------------

// The examples gallery's pictures (`docs/guide/images/examples/<id>.png`) and
// the app's More examples… thumbnails. Each is the template thumbnails'
// treatment: the design's own 256 px snapshot (framed for itself, transparent,
// from the home view's direction), taken from a copy of the example.
const EXAMPLE_PICTURES = join(process.cwd(), 'docs', 'guide', 'images', 'examples');
const EXAMPLES = JSON.parse(
  readFileSync(join(process.cwd(), 'fixtures', 'examples', 'examples.json'), 'utf8'),
) as { id: string; title: string }[];

for (const { id, title } of EXAMPLES) {
  test(`picture of the ${title} example`, async ({ page }) => {
    await page.goto(`./#/example/${id}`);
    await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
    await expect(viewportOf(page)).toHaveAttribute('data-ready', 'true');
    await kernelReady(page);
    await turnView(page, 'Shift+1');
    // An edit makes the next save take a fresh picture of the view; exporting flushes it.
    await renameProject(page, `${title} copy`);
    const bytes = await exportProject(page, `${id}.extrudo`);
    const { thumbnail } = readArchive(new Uint8Array(bytes));
    if (!thumbnail) throw new Error('the export has no thumbnail');
    await mkdir(EXAMPLE_PICTURES, { recursive: true });
    await writeFile(join(EXAMPLE_PICTURES, `${id}.png`), thumbnail);
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
    await pickTool(page, 'Revolve');
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

test('demo: chamfer', async ({ page }) => {
  await demoProject(page);
  await cube(page);
  const at = await turnView(page, 'Shift+1');
  const p = pointer(page);
  await p.jump({ x: 1000, y: 650 });
  const dialog = page.getByRole('region', { name: 'Chamfer dialog' });
  await record(page, 'chamfer', async () => {
    await pickModel(page, p, at, [0, -10, 20], 'edge');
    await page.getByRole('button', { name: /^Chamfer/ }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
    await page.waitForTimeout(320);
    await typeInto(page, dialog.getByRole('textbox', { name: 'Distance', exact: true }), '3');
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
    await pickTool(page, 'Shell');
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

// ---- The landing page's walkthrough (ADR-0057 amendment) ---------------------

const WALKTHROUGH = join(process.cwd(), 'apps', 'site', 'src', 'images', 'walkthrough');
/** WebP quality for the walkthrough stills; lower it (not below 0.7) if a file is over target. */
const WEBP_QUALITY = 0.82;

/** Encodes a full-page PNG to a 1440- and a 960-wide WebP in Chromium and writes both. */
async function saveWebp(page: Page, stem: string, png: Buffer, quality: number) {
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  const blank = await page.context().newPage();
  let encoded: { wide: string; small: string };
  try {
    encoded = (await blank.evaluate(
      `(async () => {
        const img = new Image();
        img.src = ${JSON.stringify(dataUrl)};
        await img.decode();
        const make = (w, h) => {
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, w, h);
          return canvas.toDataURL('image/webp', ${quality});
        };
        return { wide: make(1440, 900), small: make(960, 600) };
      })()`,
    )) as { wide: string; small: string };
  } finally {
    await blank.close();
  }
  const decode = (url: string) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  const wide = decode(encoded.wide);
  const small = decode(encoded.small);
  await mkdir(WALKTHROUGH, { recursive: true });
  await writeFile(join(WALKTHROUGH, `${stem}.webp`), wide);
  await writeFile(join(WALKTHROUGH, `${stem}-960.webp`), small);
  console.log(
    `${stem}: ${(wide.length / 1024).toFixed(1)} kB at 1440, ${(small.length / 1024).toFixed(1)} kB at 960`,
  );
}

/** Saves the page as one walkthrough still (a WebP pair), the pointer clear of the model. */
async function shot(page: Page, stem: string) {
  // A corner of the view with no hover highlight (the status bar's foot).
  await page.mouse.move(1430, 862);
  await page.waitForTimeout(200);
  await saveWebp(page, stem, await page.screenshot(), WEBP_QUALITY);
}

/** The eight corners of the largest box the walkthrough shows: 100 x 60 x 30 at (0, 0, 15). */
const LARGEST_BOX: readonly (readonly [number, number, number])[] = [-50, 50].flatMap((x) =>
  [-30, 30].flatMap(
    (y) =>
      [
        [x, y, 0],
        [x, y, 30],
      ] as (readonly [number, number, number])[],
  ),
);

/** The page box the eight corners of `LARGEST_BOX` project to. */
function projectedFrame(at: (p: readonly [number, number, number]) => { x: number; y: number }) {
  const xs = LARGEST_BOX.map((p) => at(p).x);
  const ys = LARGEST_BOX.map((p) => at(p).y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/**
 * The part of the view the model may fill, in page px: the browser's right edge
 * to the feature dialog's (or the Customizer's) left edge, and the toolbar's
 * bottom to the nav bar's top. Measured from the live page, not from constants.
 */
async function openSpace(page: Page) {
  const box = async (locator: ReturnType<Page['getByRole']>) => {
    if ((await locator.count()) === 0) return undefined;
    return (await locator.first().boundingBox()) ?? undefined;
  };
  const browser = await box(page.getByRole('complementary', { name: 'Browser' }));
  const dialog = await box(page.getByRole('region', { name: 'Extrude dialog' }));
  const toolbar = await box(page.getByRole('tabpanel', { name: 'Solid' }));
  const nav = await box(page.getByLabel('View navigation'));
  return {
    left: browser ? browser.x + browser.width : 250,
    // The Customizer (picture 9) is the tightest panel on the right; x 1100 is its edge.
    right: Math.min(dialog ? dialog.x : 1172, 1100),
    top: toolbar ? toolbar.y + toolbar.height : 150,
    bottom: nav ? nav.y : 800,
  };
}

/** Pans the view so points follow the drag (the Extrudo preset's right-drag pans). */
async function panBy(page: Page, dx: number, dy: number) {
  const from = { x: 720, y: 470 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up({ button: 'right' });
}

/**
 * The home view framed tightly: the largest box's projected corners span
 * 75-85 % of the open width, stay within 85 % of its height, and are centred in
 * the open space within 30 px. The rule is asserted, so a UI change that breaks
 * the framing fails the recorder instead of silently making bad pictures.
 */
async function frameTight(page: Page) {
  const viewport = viewportOf(page);
  await turnView(page, 'Shift+1');
  await settled(viewport);
  const space = await openSpace(page);
  const openWidth = space.right - space.left;
  const openHeight = space.bottom - space.top;
  const mid = { x: (space.left + space.right) / 2, y: (space.top + space.bottom) / 2 };
  for (let i = 0; i < 40; i++) {
    const frame = projectedFrame(await projector(viewport));
    const width = frame.maxX - frame.minX;
    const cx = (frame.minX + frame.maxX) / 2;
    const cy = (frame.minY + frame.maxY) / 2;
    const dx = mid.x - cx;
    const dy = mid.y - cy;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
      await panBy(page, Math.max(-200, Math.min(200, dx)), Math.max(-200, Math.min(200, dy)));
      continue;
    }
    // Zoom to 80 % in one analytic step (wheel factor = exp(deltaY * 0.0015)), then refine.
    const step = Math.round(Math.log(width / (openWidth * 0.8)) / 0.0015);
    if (Math.abs(step) < 2) break;
    const before = await attr(viewport, 'data-camera-size');
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, Math.max(-150, Math.min(150, step)));
    await expect.poll(() => attr(viewport, 'data-camera-size')).not.toBe(before);
  }
  await settled(viewport);
  const frame = projectedFrame(await projector(viewport));
  const width = frame.maxX - frame.minX;
  const height = frame.maxY - frame.minY;
  const cx = (frame.minX + frame.maxX) / 2;
  const cy = (frame.minY + frame.maxY) / 2;
  console.log(
    `framing: open ${Math.round(space.left)}..${Math.round(space.right)} x ` +
      `${Math.round(space.top)}..${Math.round(space.bottom)}; box ${Math.round(width)}x${Math.round(height)} px ` +
      `(${((width / openWidth) * 100).toFixed(1)} % wide, ${((height / openHeight) * 100).toFixed(1)} % tall), ` +
      `centre offset ${Math.round(cx - mid.x)},${Math.round(cy - mid.y)}`,
  );
  expect(width).toBeGreaterThan(openWidth * 0.75);
  expect(width).toBeLessThan(openWidth * 0.85);
  expect(height).toBeLessThan(openHeight * 0.85);
  expect(Math.abs(cx - mid.x)).toBeLessThan(30);
  expect(Math.abs(cy - mid.y)).toBeLessThan(30);
  return projector(viewport);
}

/** Presses OK, waits for the recompute. */
async function ok(page: Page, dialog: ReturnType<Page['getByRole']>) {
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
}

/**
 * Sets a dialog's expression field to exactly `text` (clear, then fill, so
 * nothing is appended to what the field held) and asserts the input and its
 * `= value` line.
 */
async function setField(field: ReturnType<Page['getByRole']>, text: string, valueLine?: string) {
  await field.fill('');
  await field.fill(text);
  await expect(field).toHaveValue(text);
  if (valueLine !== undefined) {
    await expect(field.locator('xpath=../..').locator('.expr-message')).toHaveText(valueLine);
  }
}

test("walkthrough: the landing page's steps", async ({ page }) => {
  test.setTimeout(600_000);
  // A locator that never appears should fail, not wait forever.
  page.setDefaultTimeout(30_000);
  // Info toasts ("Sketch1 is hidden…") and their bell would clutter a still frame.
  const quiet =
    '[role="status"]:has(button[aria-label="Dismiss"]), button[aria-label^="Notification history"] { display: none !important; }';
  await page.addInitScript(
    `document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(quiet)}; document.head.append(s); });`,
  );
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
  // Keep the tour's card out of the first picture: the walkthrough shows the plain flow.
  await page.getByRole('button', { name: 'Dismiss the tour' }).click();

  // Step 1: a new, empty design.
  await page.getByRole('button', { name: 'New design' }).click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  const viewport = viewportOf(page);
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await kernelReady(page);
  await page.waitForTimeout(400);
  await shot(page, '01-empty');

  // The user parameters (not pictured): width, depth, height.
  await openParameters(page);
  await addParameter(page, 'width', '80 mm');
  await addParameter(page, 'depth', '60 mm');
  await addParameter(page, 'height', '30 mm');
  await closeParameters(page);

  // Step 2: a sketch on XY, a centre rectangle dimensioned `width` × `depth`.
  const viewport2 = viewportOf(page);
  await newSketchOnXY(page);
  await settled(viewport2);
  // Clicks land where the model needs them: turn the grid snap off.
  const palette = page.getByRole('region', { name: 'Sketch palette' });
  const snap = palette.getByRole('checkbox', { name: 'Snap to grid' });
  await snap.uncheck();
  await snap.blur();
  const showConstraints = palette.getByRole('checkbox', { name: 'Show constraints' });
  await showConstraints.uncheck();
  await showConstraints.blur();
  const at2 = await mapping(viewport2);
  const click2 = async (x: number, y: number) => {
    const q = at2(x, y);
    await page.mouse.move(q.x, q.y);
    await page.mouse.click(q.x, q.y);
  };
  await pickTool(page, 'Center Rectangle');
  await expect(toolPrompt(page)).toBeVisible();
  await click2(0, 0);
  await click2(40, 30);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  const dimension2 = async (picks: readonly (readonly [number, number])[], expr: string) => {
    await page.keyboard.press('d');
    for (const [x, y] of picks) await click2(x, y);
    const value = page.getByRole('textbox', { name: /^Value of d\d+$/ });
    await expect(value).toBeFocused();
    await value.fill(expr);
    await value.press('Enter');
    await expect(page.locator('[data-dimension-editor]')).toHaveCount(0);
  };
  await dimension2(
    [
      [0, -30],
      [0, -44],
    ],
    'width',
  );
  await dimension2(
    [
      [40, 0],
      [54, 0],
    ],
    'depth',
  );
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await expect(page.locator('[data-dimension]')).toHaveText(['fx: 80.00', 'fx: 60.00']);
  await shot(page, '02-sketch');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);

  // Step 3: extrude the rectangle `height` into a block, the camera framed once here.
  let home = await frameTight(page);
  const homeDirection = await attr(viewport, 'data-camera-direction');
  await clickWhere(page, home, [20, 10, 0], /^profile:/);
  await page.keyboard.press('e');
  const extrude = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(extrude).toBeVisible();
  await expect(extrude.getByRole('combobox', { name: 'Operation' })).toHaveValue('new-body');
  await setField(extrude.getByRole('textbox', { name: 'Distance', exact: true }), 'height');
  await expect(extrude).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await shot(page, '03-extrude');
  await ok(page, extrude);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:80,60,30');

  // Step 4: shell it 2 mm inside, the top face removed: the tray.
  await clickWhere(page, home, [0, 0, 30], /^face:/);
  await expect(viewport).toHaveAttribute('data-model-selection', /^face:/);
  await pickTool(page, 'Shell');
  const shell = page.getByRole('region', { name: 'Shell dialog' });
  await expect(shell).toBeVisible();
  await expect(shell.getByRole('button', { name: 'Faces to remove', exact: true })).toHaveText(
    '1 face',
  );
  await setField(shell.getByRole('textbox', { name: 'Thickness', exact: true }), '2');
  await expect(shell).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await shot(page, '04-shell');
  await ok(page, shell);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:11:80,60,30');

  // Step 5: a sketch on the front wall's outside face (y = -depth/2), a USB slot.
  const front = await frameTight(page);
  await pickTool(page, 'Create Sketch');
  await expect(page.getByRole('region', { name: 'Create Sketch' })).toContainText('flat face');
  const frontPoint = front([20, -30, 15]);
  await page.mouse.move(frontPoint.x, frontPoint.y);
  await page.mouse.click(frontPoint.x, frontPoint.y);
  await expect(chip(page, 'Sketch2')).toBeVisible();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,1,0');
  await settled(viewport);
  const flatFront = await projector(viewport);
  const onFront = (x: number, y: number) => flatFront([x, -30, y]);
  const clickFront = async (x: number, y: number) => {
    const q = onFront(x, y);
    await page.mouse.move(q.x, q.y);
    await page.mouse.click(q.x, q.y);
  };
  await pickTool(page, 'Center to Center Slot');
  await expect(toolPrompt(page)).toBeVisible();
  await clickFront(-6, 10);
  await clickFront(6, 10);
  await clickFront(0, 13);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  const dimension5 = async (picks: readonly (readonly [number, number])[], expr: string) => {
    await page.keyboard.press('d');
    for (const [x, y] of picks) await clickFront(x, y);
    const value = page.getByRole('textbox', { name: /^Value of d\d+$/ });
    await expect(value).toBeFocused();
    await value.fill(expr);
    await value.press('Enter');
    await expect(page.locator('[data-dimension-editor]')).toHaveCount(0);
  };
  // The centreline's length, then the distance between the slot's two sides.
  await dimension5(
    [
      [0, 13],
      [0, 20],
    ],
    '12 mm',
  );
  await dimension5(
    [
      [0, 13],
      [0, 7],
      [12, 10],
    ],
    '6 mm',
  );
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await shot(page, '05-slot-sketch');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);

  // Step 6: extrude the slot as a cut 5 mm into the wall.
  await page.mouse.move(onFront(0, 11.5).x, onFront(0, 11.5).y);
  await page.mouse.click(onFront(0, 11.5).x, onFront(0, 11.5).y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  // Home view for the picture, set before the dialog opens so no view key reaches a field.
  home = await frameTight(page);
  await page.keyboard.press('e');
  const cut = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(cut).toBeVisible();
  await cut.getByRole('combobox', { name: 'Operation' }).selectOption('cut');
  await setField(cut.getByRole('textbox', { name: 'Distance', exact: true }), '-5', '= -5.00 mm');
  await expect(cut).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await expect(viewport).toHaveAttribute('data-camera-direction', homeDirection);
  await shot(page, '06-slot-cut');
  await ok(page, cut);
  // The shell left 11 faces; a cut through the one 2 mm wall adds the slot's four.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:15:80,60,30');

  // Step 7: a circle on XY at (-(width/2-7), -(depth/2-7)), joined up, then a 2×2 pattern.
  await newSketchOnXY(page);
  await settled(viewport);
  const floorAt = await projector(viewport);
  const clickFloor = async (x: number, y: number) => {
    const q = floorAt([x, y, 0]);
    await page.mouse.move(q.x, q.y);
    await page.mouse.click(q.x, q.y);
  };
  // A fixed point at the origin first, then the circle, so the inference is the debug's.
  await pickTool(page, 'Point');
  await clickFloor(0, 0);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  // The circle tool's key, since its menu item carries the shortcut in its name.
  await page.keyboard.press('c');
  await expect(toolPrompt(page)).toBeVisible();
  await clickFloor(-33, -23);
  await clickFloor(-30, -23);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  const dimension7 = async (picks: readonly (readonly [number, number])[], expr: string) => {
    for (const [x, y] of picks) await clickFloor(x, y);
    const value = page.getByRole('textbox', { name: /^Value of d\d+$/ });
    await expect(value).toBeFocused();
    await value.fill(expr);
    await value.press('Enter');
    await expect(page.locator('[data-dimension-editor]')).toHaveCount(0);
  };
  await page.keyboard.press('d');
  await dimension7(
    [
      [0, 0],
      [-33, -23],
      [6, -11],
    ],
    'depth / 2 - 7 mm',
  );
  await dimension7(
    [
      [0, 0],
      [-33, -23],
      [-16, 4],
    ],
    'width / 2 - 7 mm',
  );
  await dimension7(
    [
      [-33, -20],
      [-25, -20],
    ],
    '6 mm',
  );
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);

  // Extrude the circle up 8 mm, joined to the tray. The profile lies on the
  // bottom face: from below, coplanar with it, the profile is what the pointer finds.
  const bottom = await turnView(page, 'Shift+3');
  // The circle's own curve and center point come first in the pick: filter them out.
  const filter = page.getByRole('button', { name: 'Selection filter' });
  await filter.click();
  await page.getByRole('menuitemcheckbox', { name: 'Sketches' }).click();
  await page.keyboard.press('Escape');
  const onBottom = bottom([-31, -21, 0]);
  await page.mouse.move(onBottom.x, onBottom.y);
  await page.mouse.click(onBottom.x, onBottom.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await filter.click();
  await page.getByRole('menuitem', { name: 'Select everything' }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('e');
  const post = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(post).toBeVisible();
  await post.getByRole('combobox', { name: 'Operation' }).selectOption('join');
  await setField(post.getByRole('textbox', { name: 'Distance', exact: true }), '8');
  await expect(post).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await ok(page, post);

  // A 2 × 2 rectangular pattern of that extrude: a grid placed from width and depth.
  home = await frameTight(page);
  await pickTool(page, 'Rectangular Pattern');
  const pattern = page.getByRole('region', { name: 'Rectangular Pattern dialog' });
  await expect(pattern).toBeVisible();
  await pattern.getByRole('combobox', { name: 'Pattern' }).selectOption('features');
  await pattern.getByRole('checkbox', { name: /^Extrude3/ }).check();
  await pattern.getByRole('button', { name: 'Direction', exact: true }).click();
  await clickEdge(page, home, [0, -30, 30]);
  await expect(pattern.getByRole('button', { name: 'Direction', exact: true })).toHaveText(
    '1 edge',
  );
  await setField(pattern.getByRole('textbox', { name: 'Count', exact: true }), '2');
  await setField(pattern.getByRole('textbox', { name: 'Distance', exact: true }), 'width - 14 mm');
  await pattern.getByRole('button', { name: 'Direction 2', exact: true }).click();
  await clickEdge(page, home, [40, 0, 30]);
  await expect(pattern.getByRole('button', { name: 'Direction 2', exact: true })).toHaveText(
    '1 edge',
  );
  await setField(pattern.getByRole('textbox', { name: 'Count 2', exact: true }), '2');
  await setField(
    pattern.getByRole('textbox', { name: 'Distance 2', exact: true }),
    'depth - 14 mm',
  );
  await expect(pattern).toHaveAttribute('data-preview-status', 'ok', { timeout: 20_000 });
  await shot(page, '07-posts');
  await ok(page, pattern);

  // Step 8: round the four outer vertical edges, radius 3 mm.
  home = await frameTight(page);
  await clickEdge(page, home, [40, -30, 15]);
  await page.keyboard.press('f');
  const fillet = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(fillet).toBeVisible();
  const edgesButton = () => fillet.getByRole('button', { name: 'Edges', exact: true });
  const edgeCount = async () =>
    Number((await edgesButton().textContent())?.match(/(\d+)/)?.[1] ?? 0);
  await clickEdge(page, home, [-40, -30, 15]);
  await clickEdge(page, home, [40, 30, 15]);
  // The back-left corner is hidden in the home view: its top shows through the open tray.
  await clickEdge(page, home, [-40, 30, 30]).catch(() => undefined);
  if ((await edgeCount()) < 4) {
    const back = await turnView(page, 'Shift+5');
    await clickEdge(page, back, [-40, 30, 15]);
  }
  home = await frameTight(page);
  await expect.poll(edgeCount).toBe(4);
  await setField(fillet.getByRole('textbox', { name: 'Radius', exact: true }), '3');
  await expect(fillet).toHaveAttribute('data-preview-status', /^(ok|error)$/, { timeout: 20_000 });
  if ((await attr(fillet, 'data-preview-status')) === 'error') {
    // A 2 mm shell wall can't take a 3 mm round: the kernel says how far it can go.
    console.log(
      'fillet 3 mm refused:',
      await fillet.getByRole('status', { name: 'Feature status' }).textContent(),
    );
    await setField(fillet.getByRole('textbox', { name: 'Radius', exact: true }), '1.9');
    await expect(fillet).toHaveAttribute('data-preview-status', 'ok', { timeout: 20_000 });
  }
  await shot(page, '08-fillet');
  await ok(page, fillet);

  // Step 9: change one number, and the whole part follows.
  await openParameters(page);
  const params = page.getByRole('dialog', { name: 'Parameters' });
  await params.getByRole('button', { name: 'Show width in customizer' }).click();
  await closeParameters(page);
  await pickTool(page, 'Customizer');
  const customizer = page.getByRole('region', { name: 'Customizer' });
  await expect(customizer).toHaveAttribute('data-customizer-state', 'parameters');
  const widthValue = customizer.getByRole('textbox', { name: 'Expression of width', exact: true });
  await widthValue.fill('');
  await widthValue.fill('100 mm');
  await expect(widthValue).toHaveValue('100 mm');
  await widthValue.press('Enter');
  await expect
    .poll(() => attr(viewport, 'data-bodies'), { timeout: 20_000 })
    .toMatch(/:\d+:10[0-9.],60,30/);
  await expect(page.locator('[data-feature-status]')).toHaveCount(0);
  // Make the tray see-through so the posts inside it show in the wider box.
  const browser = page.getByRole('complementary', { name: 'Browser' });
  await browser.getByRole('button', { name: 'Body1', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Appearance…' }).click();
  const appearance = page.getByRole('dialog', { name: 'Body1 appearance' });
  await appearance.getByRole('radio', { name: '50 %' }).check();
  await expect(viewport).toHaveAttribute('data-body-appearance', /Body1:.*:0\.5$/);
  await appearance.getByRole('radio', { name: '50 %' }).focus();
  await page.keyboard.press('Escape');
  await expect(appearance).toBeHidden();
  await shot(page, '09-width');
  console.log(`walkthrough done: bodies ${await attr(viewport, 'data-bodies')}`);
});
