import { readFileSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
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
} from './benchmark-helpers';
import { type Clip, CURSOR_SCRIPT, DEMO_STYLE, Recorder } from './demo-recorder';
import {
  kernelReady,
  mapping,
  newSketchOnXY,
  openProject,
  pickTool,
  projector,
  selectParameter,
  startFromTemplate,
} from './helpers';

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
/** A clip's size limit while recording, a margin under `demos.test.ts`'s 150 kB. */
const CLIP_BYTES = 140_000;

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
    await startFromTemplate(page, name);
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
//
// A tool's tooltip plays its clip 236 px wide (onboarding/ToolDemo.tsx), so a clip is not the
// window but a FRAME of the page round the action (the owner's UI review 3, R3-16): the
// geometry the tool changes and the handle or pick that changes it fill most of it, the drawn
// cursor shows, and no toolbar, dialog or browser is in it. Nothing in a clip needs reading.
// A scene imports the small design it starts from (`demoDesign`),
// zooms the view until that fills the frame (`frameWorld`), and runs a tool with a click that
// doesn't move the pointer (`runTool`), so the cursor stays where the action is.

/** The part of the page a clip shows, 8:5; encoded at 480 × 300 and played at 236 × 148. */
const FRAME = { width: 400, height: 250 } as const;

type Vec3 = readonly [number, number, number];

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** A pointer that glides: the page's own mouse jumps, and a clip wants to see it travel. */
function pointer(page: Page) {
  let pos = { x: 760, y: 430 };
  const jump = async (to: { x: number; y: number }) => {
    await page.mouse.move(to.x, to.y);
    pos = to;
  };
  // A step per 70 ms at most: the view renders in software at a few frames a second, so more
  // steps only make each move wait longer.
  const moveTo = async (to: { x: number; y: number }, ms = 350) => {
    const n = Math.max(3, Math.round(ms / 70));
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
  /** Presses at `from`, glides to `to` and lets go: a handle's drag. */
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }, ms = 700) => {
    await moveTo(from, 350);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await moveTo(to, ms);
    await page.waitForTimeout(160);
    await page.mouse.up();
    await page.waitForTimeout(100);
  };
  return { jump, moveTo, click, drag };
}

type Glide = ReturnType<typeof pointer>;

/** The drawn pointer, and the onboarding card kept out of frame; set before the page loads. */
async function demoScripts(page: Page) {
  await page.addInitScript(CURSOR_SCRIPT);
  await page.addInitScript(
    `document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(DEMO_STYLE)}; document.head.append(s); });`,
  );
}

/** A new design with the drawn pointer. */
async function demoProject(page: Page, from: 'blank' | 'wall-bracket' = 'blank') {
  await demoScripts(page);
  const viewport = await openProject(page, from);
  await kernelReady(page);
  return viewport;
}

/**
 * A scene's starting design, `fixtures/demos/<name>.extrudo`, imported on the home screen. The
 * designs are built through the public API in `packages/cli/src/demo-designs.test.ts`, which
 * checks they compute and rewrites the files with `WRITE_FIXTURES=1`.
 */
async function demoDesign(page: Page, name: string) {
  await demoScripts(page);
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…', exact: true }).click(),
  ]);
  await chooser.setFiles(join(process.cwd(), 'fixtures', 'demos', `${name}.extrudo`));
  await expect(page).toHaveURL(/#\/p\/.+$/);
  const viewport = viewportOf(page);
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await kernelReady(page);
  return viewport;
}

/** Starts a tool from its toolbar tile without moving the pointer, so the cursor stays put. */
async function runTool(page: Page, id: string, tab: string) {
  await page.locator(`[role="tab"][data-tab="${tab}"]`).dispatchEvent('click');
  await page.locator(`[data-tool="${id}"]`).first().dispatchEvent('click');
}

/**
 * Where a frame may go: right of the browser, left of the column a feature dialog opens in,
 * above the nav bar. The view's own edges bound it too.
 */
async function safeArea(page: Page, right = 1160) {
  const box = await viewportOf(page).boundingBox();
  if (!box) throw new Error('no viewport');
  return {
    left: Math.max(box.x, 256),
    right: Math.min(box.x + box.width, right),
    top: box.y + 8,
    bottom: Math.min(box.y + box.height, 790),
  };
}

/** A FRAME round a page point, kept inside the safe area. */
async function frameAt(
  page: Page,
  centre: { x: number; y: number },
  right?: number,
): Promise<Clip> {
  const area = await safeArea(page, right);
  return {
    x: Math.round(clamp(centre.x - FRAME.width / 2, area.left, area.right - FRAME.width)),
    y: Math.round(clamp(centre.y - FRAME.height / 2, area.top, area.bottom - FRAME.height)),
    width: FRAME.width,
    height: FRAME.height,
  };
}

/** Pans the view so the page point `from` moves to `to` (a right-button drag pans). */
async function panView(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  // The nav bar's Pan tool and a left drag: a right-button drag would open the marking menu
  // (Chromium on Linux fires contextmenu on the button going down). The tool is toggled with a
  // synthetic click, so the drawn pointer doesn't visit the nav bar.
  const pan = page
    .locator('[aria-label="View navigation"]')
    .getByRole('button', { name: 'Pan', exact: true });
  await pan.dispatchEvent('click');
  await expect(pan).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  }
  await page.mouse.up();
  await pan.dispatchEvent('click');
  await expect(pan).toHaveAttribute('aria-pressed', 'false');
  await settled(viewportOf(page));
}

/**
 * Zooms the view at the points' middle, a wheel step at a time, until their projected box
 * fills `fill` of a FRAME (within a tenth), and gives the frame round them with a settled
 * projector. The wheel zooms by exp(0.0015 · delta), so each step asks for what is missing.
 */
async function frameWorld(
  page: Page,
  points: readonly Vec3[],
  fill = 0.7,
  options: { right?: number; place?: { x: number; y: number } } = {},
) {
  const viewport = viewportOf(page);
  const size = async () => Number(await viewport.getAttribute('data-camera-size'));
  for (let step = 0; step < 40; step++) {
    await settled(viewport);
    const at = await projector(viewport);
    const ps = points.map((p) => at(p));
    const xs = ps.map((p) => p.x);
    const ys = ps.map((p) => p.y);
    const centre = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
    const share = Math.max(
      (Math.max(...xs) - Math.min(...xs)) / FRAME.width,
      (Math.max(...ys) - Math.min(...ys)) / FRAME.height,
    );
    if (Math.abs(share / fill - 1) <= 0.1) {
      // Framed: pan the scene into the safe area if a frame round it would leave it.
      const area = await safeArea(page, options.right);
      const want = options.place ?? {
        x: clamp(centre.x, area.left + FRAME.width / 2, area.right - FRAME.width / 2),
        y: clamp(centre.y, area.top + FRAME.height / 2, area.bottom - FRAME.height / 2),
      };
      if (Math.hypot(want.x - centre.x, want.y - centre.y) < 2) {
        return { at, clip: await frameAt(page, centre, options.right) };
      }
      await panView(page, centre, want);
      continue;
    }
    // Zoom where the scene is, or at the view's middle while it is out of sight.
    const box = await viewport.boundingBox();
    if (!box) throw new Error('no viewport');
    const inside =
      centre.x > box.x + 60 &&
      centre.x < box.x + box.width - 60 &&
      centre.y > box.y + 60 &&
      centre.y < box.y + box.height - 60;
    const pivot = inside ? centre : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(pivot.x, pivot.y);
    const before = await size();
    await page.mouse.wheel(0, clamp(Math.log(share / fill) / 0.0015, -400, 400));
    await expect.poll(size).not.toBe(before);
  }
  throw new Error('the scene would not fit the frame');
}

/** Records `flow` in `clip` and writes `<tool>.webm`. */
async function record(page: Page, tool: string, clip: Clip, flow: () => Promise<void>) {
  // The drawn pointer's ring from a click made while setting up fades first (380 ms).
  await page.waitForTimeout(420);
  const recorder = new Recorder(page, clip);
  recorder.start();
  try {
    await flow();
    await page.waitForTimeout(250);
  } finally {
    await recorder.stop();
  }
  // Under the tooltip's budget (`demos.test.ts`: 150 kB a clip, kept to 140 here, and 2 MB for
  // all of them): 200 kbit/s looks the same as more at the tooltip's 236 px, and a long clip is
  // encoded again at a lower rate rather than cut short.
  const file = join(DEMOS, `${tool}.webm`);
  let seconds = 0;
  let bytes = 0;
  for (const bitrate of ['200k', '150k', '110k']) {
    seconds = await recorder.encode(file, { bitrate });
    bytes = (await stat(file)).size;
    if (bytes <= CLIP_BYTES) break;
  }
  if (bytes > CLIP_BYTES) throw new Error(`${tool}.webm is ${bytes} bytes, over ${CLIP_BYTES}`);
  console.log(
    `${tool}: ${recorder.frames.length} screenshots, ${seconds.toFixed(1)} s, ${bytes} B`,
  );
}

/** Where a dialog's handle is drawn on the page (its `cx`/`cy` are view px). */
async function handleAt(page: Page, field: string) {
  const handle = page.locator(`[data-manipulator-handle="${field}"]`).first();
  await expect(handle).toBeAttached({ timeout: 15_000 });
  const box = await viewportOf(page).boundingBox();
  if (!box) throw new Error('no viewport');
  return {
    x: box.x + Number(await handle.getAttribute('cx')),
    y: box.y + Number(await handle.getAttribute('cy')),
  };
}

/** Waits for a dialog's preview to be computed. */
async function previewed(dialog: ReturnType<Page['getByRole']>) {
  await expect(dialog).toHaveAttribute('data-preview-status', /^(ok|warning)$/, {
    timeout: 30_000,
  });
}

/** Commits a dialog with its key (the OK button is out of frame) and waits for the model. */
async function commit(page: Page, dialog: ReturnType<Page['getByRole']>) {
  await previewed(dialog);
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await page.waitForTimeout(250);
}

/** Glides to a world point until the view hovers `kind` there, then clicks (Shift adds). */
async function pickModel(
  page: Page,
  p: Glide,
  at: (w: Vec3) => { x: number; y: number },
  w: Vec3,
  kind: RegExp,
  options: { shift?: boolean; dy?: number } = {},
) {
  const target = at(w);
  const aim = { x: target.x, y: target.y + (options.dy ?? 0) };
  await p.moveTo(aim, 450);
  let nudge = 0;
  await expect
    .poll(async () => {
      await page.mouse.move(aim.x, aim.y + (nudge++ % 2));
      return attr(viewportOf(page), 'data-model-hover');
    })
    .toMatch(kind);
  await page.waitForTimeout(150);
  if (options.shift) await page.keyboard.down('Shift');
  await page.mouse.click(aim.x, aim.y);
  if (options.shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(160);
}

/** The points of a box between two corners, for `frameWorld`. */
function boxPoints(a: Vec3, b: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [a[0], b[0]])
    for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]]) out.push([x, y, z]);
  return out;
}

// ---- Solid › Create

test('demo: sketch', async ({ page }) => {
  const viewport = await demoProject(page);
  const p = pointer(page);
  // The origin planes' squares are a share of the view (0.16 of its height), so the frame
  // round the origin holds all three whatever the zoom.
  const at = await projector(viewport);
  const clip = await frameAt(page, at([0, 0, 0]));
  const s = Number(await attr(viewport, 'data-camera-size')) * 0.16;
  // Off the axes, which a hover would light up.
  await p.jump({ x: clip.x + clip.width - 60, y: clip.y + clip.height / 2 });
  await record(page, 'sketch', clip, async () => {
    await page.waitForTimeout(300);
    await runTool(page, 'sketch', 'solid');
    await page.waitForTimeout(400);
    await p.moveTo(at([s * 0.45, -s * 0.45, 0]), 500);
    await page.waitForTimeout(260);
    await p.click(at([s * 0.45, -s * 0.45, 0]), 80);
    await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
    await settled(viewport);
    await page.waitForTimeout(300);
  });
});

test('demo: extrude', async ({ page }) => {
  await demoDesign(page, 'extrude');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-20, -10, 0], [20, 10, 22]));
  const p = pointer(page);
  await p.jump({ x: clip.x + 40, y: clip.y + clip.height - 30 });
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await record(page, 'extrude', clip, async () => {
    await pickModel(page, p, at, [6, -4, 0], /^profile:/);
    await page.keyboard.press('e');
    await previewed(dialog);
    await page.waitForTimeout(300);
    await p.drag(await handleAt(page, 'distance'), at([0, 0, 18]));
    await commit(page, dialog);
  });
});

/** Picks the shown sketch's text in the view: the first point of its ink the view hovers as one. */
async function pickText(
  page: Page,
  p: Glide,
  at: (w: Vec3) => { x: number; y: number },
  z: number,
  shift = false,
) {
  const bounds = (await attr(viewportOf(page), 'data-text-bounds')) ?? '';
  const m = /x=(-?[\d.]+)\.\.(-?[\d.]+):y=(-?[\d.]+)\.\.(-?[\d.]+)/.exec(bounds);
  if (!m) throw new Error(`no text bounds: ${bounds}`);
  const [x0, x1, y0, y1] = m.slice(1).map(Number) as [number, number, number, number];
  for (let i = 1; i < 12; i++) {
    for (let j = 1; j < 6; j++) {
      const q = at([x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * j) / 6, z]);
      await page.mouse.move(q.x, q.y);
      await page.waitForTimeout(60);
      if (/^sketchEntity:/.test((await attr(viewportOf(page), 'data-model-hover')) ?? '')) {
        await p.jump(q);
        if (shift) await page.keyboard.down('Shift');
        await page.mouse.click(q.x, q.y);
        if (shift) await page.keyboard.up('Shift');
        return q;
      }
    }
  }
  throw new Error('no letter could be picked');
}

/** The first of `candidates` where the view hovers `kind`, found before a scene records. */
async function spot(
  page: Page,
  at: (w: Vec3) => { x: number; y: number },
  candidates: readonly Vec3[],
  kind: RegExp,
) {
  return findHover(
    page,
    candidates.map((w) => at(w)),
    kind,
  );
}

/** Glides to a spot `spot` found and clicks it (Shift adds to the selection). */
async function clickSpot(page: Page, p: Glide, q: { x: number; y: number }, shift = false) {
  await p.moveTo(q, 450);
  await page.waitForTimeout(150);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(q.x, q.y);
  if (shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(160);
}

/** Selects bodies by their browser rows (not recorded: the browser is out of frame). */
async function selectBodyRows(page: Page, names: readonly string[]) {
  await selectBodies(page, [...names]);
}

/** The first point along `points` where the view hovers `kind` (an axis, a curve). */
async function findHover(page: Page, points: readonly { x: number; y: number }[], kind: RegExp) {
  const seen: string[] = [];
  for (const q of points) {
    // The view picks on a frame of its own, which a busy machine draws late: give it a second.
    let hover = '';
    for (let tries = 0; tries < 8; tries++) {
      await page.mouse.move(q.x, q.y + (tries % 2));
      await page.waitForTimeout(130);
      hover = (await attr(viewportOf(page), 'data-model-hover')) ?? '';
      if (kind.test(hover)) return q;
    }
    seen.push(hover || '(nothing)');
  }
  throw new Error(`nothing to hover as ${kind}: ${seen.join(', ')}`);
}

test('demo: revolve', async ({ page }) => {
  await demoDesign(page, 'revolve');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-16, -16, 0], [16, 16, 26]));
  const axis = await findHover(
    page,
    [24, 22, 25, 23].map((z) => at([0, 0, z])),
    /^axis:origin:z$/,
  );
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + clip.height - 30 });
  const dialog = page.getByRole('region', { name: 'Revolve dialog' });
  await record(page, 'revolve', clip, async () => {
    await pickModel(page, p, at, [12, 0, 8], /^profile:/);
    await p.moveTo(axis, 450);
    await page.keyboard.down('Shift');
    await page.mouse.click(axis.x, axis.y);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(200);
    await runTool(page, 'revolve', 'solid');
    await commit(page, dialog);
  });
});

test('demo: sweep', async ({ page }) => {
  await demoDesign(page, 'sweep');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([5, -5, -5], [45, 5, 35]));
  // The section is a circle round the path's start, whose first line rises from its middle:
  // the region is picked in front of the middle, each path piece where nothing else is.
  const section = await spot(
    page,
    at,
    [
      [10, -2.5, 0],
      [12, -2, 0],
      [8, -2.5, 0],
    ],
    /^profile:/,
  );
  const along = (t: number): Vec3 => [10, 0, t];
  const up = await spot(page, at, [along(8), along(10), along(6), along(12)], /^sketchEntity:/);
  const bend = await spot(
    page,
    at,
    [0.5, 0.4, 0.6, 0.3].map(
      (t): Vec3 => [
        25 - 15 * Math.cos((t * Math.PI) / 2),
        0,
        15 + 15 * Math.sin((t * Math.PI) / 2),
      ],
    ),
    /^sketchEntity:/,
  );
  const top = await spot(
    page,
    at,
    [
      [36, 0, 30],
      [40, 0, 30],
      [32, 0, 30],
    ],
    /^sketchEntity:/,
  );
  const p = pointer(page);
  await p.jump({ x: clip.x + 40, y: clip.y + 40 });
  const dialog = page.getByRole('region', { name: 'Sweep dialog' });
  await record(page, 'sweep', clip, async () => {
    await clickSpot(page, p, section);
    await clickSpot(page, p, up, true);
    await clickSpot(page, p, bend, true);
    await clickSpot(page, p, top, true);
    await runTool(page, 'sweep', 'solid');
    await commit(page, dialog);
  });
});

test('demo: loft', async ({ page }) => {
  await demoDesign(page, 'loft');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-12, -12, 0], [12, 12, 25]));
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + 40 });
  const dialog = page.getByRole('region', { name: 'Loft dialog' });
  await record(page, 'loft', clip, async () => {
    await pickModel(page, p, at, [6, -8, 0], /^profile:/);
    await pickModel(page, p, at, [3, -3, 25], /^profile:/, { shift: true });
    await runTool(page, 'loft', 'solid');
    await commit(page, dialog);
  });
});

test('demo: coil', async ({ page }) => {
  await demoProject(page);
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-12, -12, -1], [12, 12, 34]));
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + 40 });
  const dialog = page.getByRole('region', { name: 'Coil dialog' });
  await record(page, 'coil', clip, async () => {
    await runTool(page, 'coil', 'solid');
    await previewed(dialog);
    await page.waitForTimeout(300);
    await p.drag(await handleAt(page, 'height'), at([0, 0, 32]));
    await commit(page, dialog);
  });
});

/** A primitive's scene: the tool's default shape on XY, one size handle dragged to `to`. */
function primitiveScene(tool: string, label: string, field: string, points: Vec3[], to: Vec3) {
  test(`demo: ${tool}`, async ({ page }) => {
    await demoProject(page);
    await turnView(page, 'Shift+1');
    const { at, clip } = await frameWorld(page, points);
    const p = pointer(page);
    await p.jump({ x: clip.x + clip.width - 50, y: clip.y + 40 });
    const dialog = page.getByRole('region', { name: `${label} dialog` });
    await record(page, tool, clip, async () => {
      await runTool(page, tool, 'solid');
      await previewed(dialog);
      await page.waitForTimeout(300);
      await p.drag(await handleAt(page, field), at(to));
      await commit(page, dialog);
    });
  });
}

primitiveScene('box', 'Box', 'height', boxPoints([-10, -10, 0], [10, 10, 32]), [0, 0, 30]);
primitiveScene(
  'cylinder',
  'Cylinder',
  'diameter',
  boxPoints([-16, -16, 0], [16, 16, 22]),
  [16, 0, 0],
);
primitiveScene(
  'sphere',
  'Sphere',
  'diameter',
  boxPoints([-16, -16, -16], [16, 16, 16]),
  [16, 0, 0],
);
// The default torus is a 40 mm ring of a 10 mm tube; the tube's arrow starts at the ring.
primitiveScene('torus', 'Torus', 'tube', boxPoints([-30, -30, -8], [30, 30, 8]), [28, 0, 0]);

// ---- Solid › Features

test('demo: hole', async ({ page }) => {
  await demoDesign(page, 'hole');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-20, -20, 0], [20, 20, 16]));
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + clip.height - 30 });
  const dialog = page.getByRole('region', { name: 'Hole dialog' });
  await record(page, 'hole', clip, async () => {
    await page.keyboard.press('h');
    await expect(dialog).toBeVisible();
    await p.click(at([4, -4, 16]), 450);
    await expect(dialog.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
    await previewed(dialog);
    await page.waitForTimeout(300);
    await p.drag(await handleAt(page, 'diameter'), at([10, -4, 16]));
    await commit(page, dialog);
  });
});

test('demo: emboss', async ({ page }) => {
  await demoDesign(page, 'emboss');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-25, -12, 0], [25, 12, 14]));
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + 40 });
  const dialog = page.getByRole('region', { name: 'Emboss dialog' });
  await record(page, 'emboss', clip, async () => {
    const letter = await pickText(page, p, at, 14);
    await p.jump(letter);
    await pickModel(page, p, at, [18, -8, 8], /^face:/, { shift: true });
    await runTool(page, 'emboss', 'solid');
    await commit(page, dialog);
  });
});

test('demo: rib', async ({ page }) => {
  await demoDesign(page, 'rib');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([0, -12, 0], [40, 12, 40]));
  const line = await spot(
    page,
    at,
    [0.5, 0.4, 0.6, 0.3, 0.7].map((t): Vec3 => [4 + 26 * t, 0, 30 - 26 * t]),
    /^sketchEntity:/,
  );
  const p = pointer(page);
  // Between the axes: a pointer on one would light it up.
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + clip.height / 2 });
  const dialog = page.getByRole('region', { name: 'Rib dialog' });
  await record(page, 'rib', clip, async () => {
    await clickSpot(page, p, line);
    await runTool(page, 'rib', 'solid');
    await commit(page, dialog);
  });
});

// ---- Solid › Pattern

test('demo: rectangularPattern', async ({ page }) => {
  await demoDesign(page, 'rectangularPattern');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-5, -5, 0], [65, 5, 10]));
  await selectBodyRows(page, ['Body1']);
  const axis = await findHover(
    page,
    [20, 24, 28, 32, 36].map((x) => at([x, 0, 0])),
    /^axis:origin:x$/,
  );
  await page.keyboard.down('Shift');
  await page.mouse.click(axis.x, axis.y);
  await page.keyboard.up('Shift');
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + 40 });
  const dialog = page.getByRole('region', { name: 'Rectangular Pattern dialog' });
  await record(page, 'rectangularPattern', clip, async () => {
    await runTool(page, 'rectangularPattern', 'solid');
    await previewed(dialog);
    await page.waitForTimeout(300);
    // The spacing's arrow: the heads-up box sits over the count's handle.
    await p.drag(await handleAt(page, 'distance1'), at([30, 0, 5]), 900);
    await commit(page, dialog);
  });
});

test('demo: circularPattern', async ({ page }) => {
  await demoDesign(page, 'circularPattern');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-24, -24, 0], [24, 24, 12]));
  await selectBodyRows(page, ['Body1']);
  const axis = await findHover(
    page,
    [16, 20, 24, 28].map((z) => at([0, 0, z])),
    /^axis:origin:z$/,
  );
  await page.keyboard.down('Shift');
  await page.mouse.click(axis.x, axis.y);
  await page.keyboard.up('Shift');
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + 40 });
  const dialog = page.getByRole('region', { name: 'Circular Pattern dialog' });
  await record(page, 'circularPattern', clip, async () => {
    await runTool(page, 'circularPattern', 'solid');
    await previewed(dialog);
    await page.waitForTimeout(300);
    // The count handle is on the last of three copies (240°): further round adds copies.
    const from = await handleAt(page, 'count');
    const turn = (deg: number): Vec3 => [
      20 * Math.cos((deg * Math.PI) / 180),
      20 * Math.sin((deg * Math.PI) / 180),
      6,
    ];
    await p.moveTo(from, 350);
    await page.mouse.down();
    for (const deg of [255, 270, 285, 300, 315]) await p.moveTo(at(turn(deg)), 200);
    await page.waitForTimeout(160);
    await page.mouse.up();
    await commit(page, dialog);
  });
});

test('demo: pathPattern', async ({ page }) => {
  await demoDesign(page, 'pathPattern');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-4, -20, 0], [54, 4, 6]));
  await selectBodyRows(page, ['Body1']);
  // The arc under the block: its circle's centre and radius, and a point `s` mm along it.
  const centre = [25, 8.36] as const;
  const radius = Math.hypot(25, 8.36);
  const start = Math.atan2(-8.36, -25);
  const along = (s: number): Vec3 => [
    centre[0] + radius * Math.cos(start + s / radius),
    centre[1] + radius * Math.sin(start + s / radius),
    0,
  ];
  const path = await spot(page, at, [along(30), along(26), along(34), along(22)], /^sketchEntity:/);
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + 40 });
  const dialog = page.getByRole('region', { name: 'Path Pattern dialog' });
  await record(page, 'pathPattern', clip, async () => {
    await clickSpot(page, p, path, true);
    await runTool(page, 'pathPattern', 'solid');
    await commit(page, dialog);
  });
});

// ---- Solid › Program and Component

test('demo: script', async ({ page }) => {
  await demoProject(page);
  await turnView(page, 'Shift+1');
  // The Script dialog is wide (560 px at the view's right): the frame stays left of it.
  const { clip } = await frameWorld(page, boxPoints([-30, -30, 0], [30, 30, 5]), 0.75, {
    right: 850,
  });
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 40, y: clip.y + 30 });
  const dialog = page.getByRole('region', { name: 'Script dialog' });
  const code = [
    '// A plate with a ring of holes.',
    'const count = 4;',
    'design.box({ length: 60, width: 60, height: 5 });',
    'for (let i = 0; i < count; i++) {',
    '  const angle = (i * Math.PI * 2) / count;',
    "  design.hole({ x: 20 * Math.cos(angle), y: 20 * Math.sin(angle), diameter: 6, extent: 'through', flip: true });",
    '}',
  ].join('\n');
  await record(page, 'script', clip, async () => {
    await runTool(page, 'script', 'solid');
    const editor = dialog.getByRole('textbox', { name: 'Script code' });
    await editor.focus();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(code);
    await previewed(dialog);
    await page.waitForTimeout(700);
    // The loop's count, 4 → 6, on the second line.
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('6', { delay: 120 });
    await page.waitForTimeout(800);
    await previewed(dialog);
    await page.waitForTimeout(600);
    await dialog.getByRole('button', { name: /^OK/ }).dispatchEvent('click');
    await expect(dialog).toBeHidden();
    await kernelReady(page);
    await page.waitForTimeout(300);
  });
});

test('demo: recordMacro', async ({ page }) => {
  await demoProject(page);
  await turnView(page, 'Shift+1');
  // The recording shows as a red dot in the status bar: start one (not recorded) to see where,
  // and stop it again.
  const indicator = page.locator('[data-macro-recording]');
  await runTool(page, 'recordMacro', 'solid');
  const dot = await indicator.boundingBox();
  if (!dot) throw new Error('no recording indicator');
  await runTool(page, 'stopMacro', 'solid');
  const macro = page.getByRole('region', { name: 'Macro', exact: true });
  await expect(macro).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(indicator).toHaveCount(0);
  const size = page.viewportSize();
  if (!size) throw new Error('no page size');
  // The frame: the dot near its bottom left, the view above it where the box lands.
  const clip: Clip = {
    x: Math.round(clamp(dot.x - 60, 0, size.width - FRAME.width)),
    y: size.height - FRAME.height,
    width: FRAME.width,
    height: FRAME.height,
  };
  await frameWorld(page, boxPoints([-10, -10, 0], [10, 10, 20]), 0.45, {
    place: { x: clip.x + clip.width / 2 + 40, y: clip.y + 105 },
  });
  // Then the nav bar, which sits between the view and the status bar: out of the clip (no chrome but the dot).
  await page.evaluate(
    `(() => { const nav = document.querySelector('[aria-label="View navigation"]'); if (nav) nav.style.visibility = 'hidden'; })()`,
  );
  const p = pointer(page);
  // Between the axes: a pointer on one would light it up.
  await p.jump({ x: clip.x + clip.width - 40, y: clip.y + 130 });
  const box = page.getByRole('region', { name: 'Box dialog' });
  await record(page, 'recordMacro', clip, async () => {
    await page.waitForTimeout(400);
    await runTool(page, 'recordMacro', 'solid');
    await expect(indicator).toHaveAttribute('data-macro-recording', '0');
    await page.waitForTimeout(600);
    await runTool(page, 'box', 'solid');
    await commit(page, box);
    await expect(indicator).toHaveAttribute('data-macro-recording', '1');
    await page.waitForTimeout(600);
  });
});

test('demo: stopMacro', async ({ page }) => {
  await demoProject(page);
  await runTool(page, 'recordMacro', 'solid');
  const box = page.getByRole('region', { name: 'Box dialog' });
  await runTool(page, 'box', 'solid');
  await commit(page, box);
  await runTool(page, 'cylinder', 'solid');
  const cylinder = page.getByRole('region', { name: 'Cylinder dialog' });
  await previewed(cylinder);
  await cylinder.getByRole('textbox', { name: 'X', exact: true }).fill('30 mm');
  await commit(page, cylinder);
  const macro = page.getByRole('region', { name: 'Macro', exact: true });
  // The code the recording became, in the Macro dialog: its top left, where the lines start.
  await runTool(page, 'stopMacro', 'solid');
  await expect(macro).toHaveAttribute('data-macro-dialog', 'ready');
  const code = await macro.getByRole('textbox', { name: 'Macro code' }).boundingBox();
  if (!code) throw new Error('no code');
  await page.keyboard.press('Escape');
  await expect(macro).toBeHidden();
  const clip: Clip = {
    // The dialog's left edge and title in frame, then the code's first lines.
    x: Math.round(code.x - 44),
    y: Math.round(code.y - 60),
    width: FRAME.width,
    height: FRAME.height,
  };
  // Record again: the macro starts where the first one did.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await kernelReady(page);
  await runTool(page, 'recordMacro', 'solid');
  await runTool(page, 'box', 'solid');
  await commit(page, box);
  await runTool(page, 'cylinder', 'solid');
  await previewed(cylinder);
  await cylinder.getByRole('textbox', { name: 'X', exact: true }).fill('30 mm');
  await commit(page, cylinder);
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 40, y: clip.y + clip.height - 30 });
  await record(page, 'stopMacro', clip, async () => {
    await page.waitForTimeout(300);
    await runTool(page, 'stopMacro', 'solid');
    await expect(macro).toHaveAttribute('data-macro-dialog', 'ready');
    await page.waitForTimeout(1500);
  });
});

test('demo: newComponent', async ({ page }) => {
  await demoDesign(page, 'newComponent');
  await turnView(page, 'Shift+1');
  // A component lives in the browser, so its clip shows the bodies' rows beside the two blocks:
  // the rows are picked, New Component puts them in Component1.
  const browser = page.getByRole('complementary', { name: 'Browser' });
  const rows = browser.locator('[data-body]');
  const first = await rows.first().boundingBox();
  if (!first) throw new Error('no body row');
  const clip: Clip = {
    x: 36,
    y: Math.round(clamp(first.y - 90, 140, 900 - FRAME.height - 60)),
    width: FRAME.width,
    height: FRAME.height,
  };
  await frameWorld(page, boxPoints([-24, -10, 0], [24, 10, 20]), 0.38, {
    place: { x: clip.x + 315, y: clip.y + 130 },
  });
  const name = (body: string) => browser.getByRole('button', { name: body, exact: true });
  const centre = async (body: string) => {
    const b = await name(body).boundingBox();
    if (!b) throw new Error(`no row ${body}`);
    return { x: b.x + Math.min(b.width / 2, 30), y: b.y + b.height / 2 };
  };
  const p = pointer(page);
  await p.jump({ x: clip.x + 330, y: clip.y + 30 });
  await record(page, 'newComponent', clip, async () => {
    await page.waitForTimeout(300);
    await clickSpot(page, p, await centre('Body1'));
    await clickSpot(page, p, await centre('Body2'), true);
    await page.waitForTimeout(300);
    await runTool(page, 'newComponent', 'solid');
    await expect(viewportOf(page)).toHaveAttribute('data-components', 'Component1:Body1,Body2');
    await page.waitForTimeout(1200);
  });
});

test('demo: joint', async ({ page }) => {
  await demoScripts(page);
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…', exact: true }).click(),
  ]);
  await chooser.setFiles('fixtures/components/hinge.extrudo');
  await expect(page).toHaveURL(/#\/p\/.+$/);
  await kernelReady(page);
  // The fixture's own hinge goes first (not recorded): the clip makes it again.
  const browser = page.getByRole('complementary', { name: 'Browser' });
  await browser.locator('[data-joint]').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Delete Joint/ }).click();
  await expect(browser.locator('[data-joint]')).toHaveCount(0);
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-22, -22, 0], [22, 22, 10]), 0.75);
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 40, y: clip.y + 30 });
  const dialog = page.getByRole('region', { name: 'Joint dialog' });
  await record(page, 'joint', clip, async () => {
    await page.keyboard.press('j');
    await expect(dialog).toBeVisible();
    // The leaf's knuckle, then the base's: their walls share the pin's axis.
    await pickModel(page, p, at, [0, -3, 6], /^face:/);
    await pickModel(page, p, at, [13.5, -3, 6], /^face:/);
    await dialog.getByRole('combobox', { name: 'Type' }).selectOption('revolute');
    await expect(dialog).toHaveAttribute('data-dialog-valid', 'true');
    await page.waitForTimeout(500);
    // OK is beside the frame: a synthetic click keeps the drawn pointer on the model.
    await dialog.getByRole('button', { name: /^OK/ }).dispatchEvent('click');
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(300);
    // Posed through the turn the joint allows (view state: the design is unchanged).
    const row = browser.locator('[data-joint]').first();
    await row.dispatchEvent('contextmenu');
    await page.getByRole('menuitem', { name: /^Pose/ }).dispatchEvent('click');
    const angle = page.getByRole('region', { name: 'Joint', exact: true }).getByRole('textbox', {
      name: 'Angle',
      exact: true,
    });
    for (const deg of ['30', '60', '90']) {
      await angle.fill(deg);
      await angle.blur();
      await page.waitForTimeout(450);
    }
    await page.waitForTimeout(400);
  });
});

// ---- The Modify tab and the sketch tools (R3-16, the second part) ------------

/** Sketch mm → page px in a new sketch on XY, settled. */
async function sketchView(page: Page) {
  await newSketchOnXY(page);
  await settled(viewportOf(page));
  return mapping(viewportOf(page));
}

/** A frame round a sketch point, zoomed so `width` mm of the sketch fill most of it. */
async function sketchFrame(
  page: Page,
  at: Awaited<ReturnType<typeof mapping>>,
  width = 80,
): Promise<{ at: Awaited<ReturnType<typeof mapping>>; clip: Clip }> {
  const span = Math.hypot(at(width, 0).x - at(0, 0).x, at(width, 0).y - at(0, 0).y);
  const centre = at(0, 0);
  if (Math.abs(span / FRAME.width - 0.85) > 0.1) {
    const viewport = viewportOf(page);
    const size = async () => Number(await viewport.getAttribute('data-camera-size'));
    await page.mouse.move(centre.x, centre.y);
    const before = await size();
    await page.mouse.wheel(0, clamp(Math.log(span / (FRAME.width * 0.85)) / 0.0015, -400, 400));
    await expect.poll(size).not.toBe(before);
    await settled(viewport);
    return sketchFrame(page, await mapping(viewport), width);
  }
  return { at, clip: await frameAt(page, centre) };
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
    const q = at(x, y);
    await page.mouse.move(q.x, q.y);
    await page.mouse.click(q.x, q.y);
  }
  await page.keyboard.press('Escape');
}

/** Types into a dialog field the pointer doesn't visit (out of frame), key by key. */
async function typeQuietly(page: Page, field: ReturnType<Page['getByRole']>, text: string) {
  await field.focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(text, { delay: 220 });
  await field.blur();
}

/** A point of an origin plane's square where no body is in front (the home view). */
async function planeSquare(page: Page, plane: 'xy' | 'yz') {
  const s = Number(await attr(viewportOf(page), 'data-camera-size')) * 0.16;
  return plane === 'xy' ? ([s * 0.35, -s * 0.35, 0] as Vec3) : ([0, -s * 0.35, s * 0.35] as Vec3);
}

test('demo: line', async ({ page }) => {
  await demoProject(page);
  const { at, clip } = await sketchFrame(page, await sketchView(page), 70);
  const p = pointer(page);
  await p.jump(at(-34, 12));
  await record(page, 'line', clip, async () => {
    await page.waitForTimeout(300);
    await page.keyboard.press('l');
    await p.click(at(-30, -15), 420);
    await p.click(at(10, -15), 420);
    await p.click(at(10, 15), 420);
    await p.click(at(-30, -15), 480);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  });
});

test('demo: rectangle', async ({ page }) => {
  await demoProject(page);
  const { at, clip } = await sketchFrame(page, await sketchView(page), 70);
  const p = pointer(page);
  await p.jump(at(-34, 15));
  await record(page, 'rectangle', clip, async () => {
    await page.waitForTimeout(300);
    await page.keyboard.press('r');
    await p.click(at(-30, -15), 420);
    await p.click(at(30, 15), 650);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  });
});

test('demo: circle', async ({ page }) => {
  await demoProject(page);
  const { at, clip } = await sketchFrame(page, await sketchView(page), 60);
  const p = pointer(page);
  await p.jump(at(-26, 14));
  await record(page, 'circle', clip, async () => {
    await page.waitForTimeout(300);
    await page.keyboard.press('c');
    await p.click(at(0, 0), 420);
    await p.click(at(20, 0), 600);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  });
});

test('demo: dimension', async ({ page }) => {
  await demoProject(page);
  const view = await sketchView(page);
  await drawRectangle(page, view, [-30, -10], [30, 10]);
  const { at, clip } = await sketchFrame(page, await mapping(viewportOf(page)), 80);
  const p = pointer(page);
  await p.jump(at(-34, 18));
  await record(page, 'dimension', clip, async () => {
    await page.waitForTimeout(300);
    await page.keyboard.press('d');
    await p.click(at(0, -10), 450);
    await p.click(at(0, -20), 420);
    await page.keyboard.type('45', { delay: 220 });
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });
});

test('demo: pressPull', async ({ page }) => {
  await demoDesign(page, 'pressPull');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-15, -10, 0], [15, 10, 20]));
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + clip.height - 30 });
  const dialog = page.getByRole('region', { name: 'Offset Face dialog' });
  await record(page, 'pressPull', clip, async () => {
    await pickModel(page, p, at, [4, -3, 10], /^face:/);
    await page.keyboard.press('q');
    await previewed(dialog);
    await page.waitForTimeout(300);
    await p.drag(await handleAt(page, 'distance'), at([4, -3, 19]));
    await commit(page, dialog);
  });
});

test('demo: fillet', async ({ page }) => {
  await demoDesign(page, 'fillet');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-15, -10, 0], [15, 10, 14]));
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + clip.height - 30 });
  const dialog = page.getByRole('region', { name: 'Fillet dialog' });
  await record(page, 'fillet', clip, async () => {
    await pickModel(page, p, at, [-4, -10, 14], /^edge:/, { dy: 2 });
    await runTool(page, 'fillet', 'modify');
    await previewed(dialog);
    await page.waitForTimeout(300);
    // Away from the edge along the bisector of its two faces: the round grows.
    await p.drag(await handleAt(page, 'radius'), at([-4, -12.5, 16.5]));
    await commit(page, dialog);
  });
});

test('demo: chamfer', async ({ page }) => {
  await demoDesign(page, 'chamfer');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-15, -10, 0], [15, 10, 14]));
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + clip.height - 30 });
  const dialog = page.getByRole('region', { name: 'Chamfer dialog' });
  await record(page, 'chamfer', clip, async () => {
    await pickModel(page, p, at, [-4, -10, 14], /^edge:/, { dy: 2 });
    await runTool(page, 'chamfer', 'modify');
    await previewed(dialog);
    await page.waitForTimeout(300);
    await p.drag(await handleAt(page, 'distance'), at([-4, -12.5, 16.5]));
    await commit(page, dialog);
  });
});

test('demo: shell', async ({ page }) => {
  await demoDesign(page, 'shell');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-15, -12, 0], [15, 12, 16]));
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + clip.height - 30 });
  const dialog = page.getByRole('region', { name: 'Shell dialog' });
  await record(page, 'shell', clip, async () => {
    await pickModel(page, p, at, [3, -2, 16], /^face:/);
    await runTool(page, 'shell', 'modify');
    await previewed(dialog);
    await page.waitForTimeout(700);
    await commit(page, dialog);
    await page.waitForTimeout(500);
  });
});

test('demo: offsetFace', async ({ page }) => {
  await demoDesign(page, 'offsetFace');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-18, -12, 0], [18, 12, 10]));
  // The hole's far wall faces the camera.
  const wall = await spot(
    page,
    at,
    [
      [-4.2, 4.2, 6],
      [-2, 5.6, 6],
      [-5.6, 2, 6],
    ],
    /^face:/,
  );
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + clip.height - 30 });
  const dialog = page.getByRole('region', { name: 'Offset Face dialog' });
  await record(page, 'offsetFace', clip, async () => {
    await clickSpot(page, p, wall);
    await runTool(page, 'offsetFace', 'modify');
    await previewed(dialog);
    await page.waitForTimeout(300);
    // Positive is out of the material, into the hole: the hole closes in. The arrow is
    // foreshortened, so a short move on the screen is a long one along it.
    const from = await handleAt(page, 'distance');
    const centre = at([0, 0, 6]);
    await p.drag(from, {
      x: from.x + (centre.x - from.x) * 0.3,
      y: from.y + (centre.y - from.y) * 0.3,
    });
    await commit(page, dialog);
  });
});

test('demo: draft', async ({ page }) => {
  await demoDesign(page, 'draft');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-12, -12, 0], [12, 12, 20]));
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + clip.height - 30 });
  const dialog = page.getByRole('region', { name: 'Draft dialog' });
  await record(page, 'draft', clip, async () => {
    await page.waitForTimeout(300);
    await runTool(page, 'draft', 'modify');
    await expect(dialog).toBeVisible();
    await pickModel(page, p, at, [0, -10, 10], /^face:/);
    await pickModel(page, p, at, [10, 0, 10], /^face:/);
    // The neutral plane: the top face, which keeps its size while the sides tilt.
    await dialog.getByRole('button', { name: 'Plane', exact: true }).dispatchEvent('click');
    await p.click(at([2, -2, 20]), 450);
    await expect(dialog.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
    await previewed(dialog);
    await p.moveTo({ x: clip.x + clip.width - 60, y: clip.y + 50 }, 400);
    await typeQuietly(page, dialog.getByRole('textbox', { name: 'Angle', exact: true }), '10');
    await commit(page, dialog);
  });
});

test('demo: thread', async ({ page }) => {
  await demoDesign(page, 'thread');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-10, -10, 0], [10, 10, 16]));
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + clip.height - 30 });
  const dialog = page.getByRole('region', { name: 'Thread dialog' });
  await record(page, 'thread', clip, async () => {
    await pickModel(page, p, at, [7.07, -7.07, 8], /^face:/);
    await runTool(page, 'thread', 'modify');
    await expect(dialog).toHaveAttribute('data-preview-status', /^(ok|warning)$/, {
      timeout: 90_000,
    });
    await commit(page, dialog);
    await page.waitForTimeout(400);
  });
});

test('demo: move', async ({ page }) => {
  await demoDesign(page, 'move');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-8, -8, 0], [24, 8, 16]), 0.65);
  await selectBodyRows(page, ['Body1']);
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + clip.height - 30 });
  const dialog = page.getByRole('region', { name: 'Move dialog' });
  await record(page, 'move', clip, async () => {
    await page.waitForTimeout(300);
    await page.keyboard.press('m');
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(400);
    const from = await handleAt(page, 'dx');
    const step = { x: at([14, 0, 0]).x - at([0, 0, 0]).x, y: at([14, 0, 0]).y - at([0, 0, 0]).y };
    await p.drag(from, { x: from.x + step.x, y: from.y + step.y }, 900);
    await commit(page, dialog);
  });
});

test('demo: mirror', async ({ page }) => {
  await demoDesign(page, 'mirror');
  await turnView(page, 'Shift+1');
  const { clip } = await frameWorld(page, boxPoints([-24, 2, 0], [24, 18, 16]), 0.7);
  const square = await planeSquare(page, 'yz');
  const at = await projector(viewportOf(page));
  await selectBodyRows(page, ['Body1']);
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + clip.height - 30 });
  const dialog = page.getByRole('region', { name: 'Mirror dialog' });
  await record(page, 'mirror', clip, async () => {
    await page.waitForTimeout(300);
    await runTool(page, 'mirror', 'modify');
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300);
    await p.click(at(square), 500);
    await expect(dialog.getByRole('button', { name: 'Plane', exact: true })).toHaveText('YZ plane');
    await commit(page, dialog);
  });
});

test('demo: combine', async ({ page }) => {
  await demoDesign(page, 'combine');
  await turnView(page, 'Shift+1');
  const { at, clip } = await frameWorld(page, boxPoints([-21, -10, 0], [15, 10, 24]));
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + clip.height - 30 });
  const dialog = page.getByRole('region', { name: 'Combine dialog' });
  await record(page, 'combine', clip, async () => {
    await page.waitForTimeout(300);
    await runTool(page, 'combine', 'modify');
    await expect(dialog).toBeVisible();
    // The block is the target, the peg the tool it loses.
    await pickModel(page, p, at, [-12, -4, 12], /^body:/);
    await dialog.getByRole('button', { name: 'Tools', exact: true }).dispatchEvent('click');
    await pickModel(page, p, at, [9, 0, 24], /^body:/);
    await dialog.getByRole('combobox', { name: 'Operation' }).selectOption('cut');
    await previewed(dialog);
    await page.waitForTimeout(500);
    await commit(page, dialog);
  });
});

test('demo: splitBody', async ({ page }) => {
  await demoDesign(page, 'splitBody');
  await turnView(page, 'Shift+1');
  const { clip } = await frameWorld(page, boxPoints([-15, -6, 0], [15, 22, 20]), 0.7);
  const square = await planeSquare(page, 'yz');
  const at = await projector(viewportOf(page));
  await selectBodyRows(page, ['Body1']);
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + clip.height - 30 });
  const dialog = page.getByRole('region', { name: 'Split Body dialog' });
  await record(page, 'splitBody', clip, async () => {
    await page.waitForTimeout(300);
    await runTool(page, 'splitBody', 'modify');
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300);
    await p.click(at(square), 500);
    await expect(dialog.getByRole('button', { name: 'Plane', exact: true })).toHaveText('YZ plane');
    await commit(page, dialog);
    // Two bodies now: a click on one half picks it alone.
    const half = await spot(
      page,
      at,
      [
        [8, 2, 20],
        [8, 8, 20],
      ],
      /^face:/,
    );
    await clickSpot(page, p, half);
    await page.waitForTimeout(700);
  });
});

test('demo: scale', async ({ page }) => {
  await demoDesign(page, 'scale');
  await turnView(page, 'Shift+1');
  const { clip } = await frameWorld(page, boxPoints([-12, -12, -4], [12, 12, 18]), 0.7);
  await selectBodyRows(page, ['Body1']);
  const p = pointer(page);
  await p.jump({ x: clip.x + clip.width - 50, y: clip.y + clip.height - 30 });
  const dialog = page.getByRole('region', { name: 'Scale dialog' });
  await record(page, 'scale', clip, async () => {
    await page.waitForTimeout(300);
    await runTool(page, 'scale', 'modify');
    await previewed(dialog);
    await page.waitForTimeout(300);
    await typeQuietly(
      page,
      dialog.getByRole('textbox', { name: 'Scale factor', exact: true }),
      '1.6',
    );
    await previewed(dialog);
    await page.waitForTimeout(500);
    await commit(page, dialog);
  });
});

// ---- The landing page's walkthrough (ADR-0057 amendment) ---------------------

const WALKTHROUGH = join(process.cwd(), 'apps', 'site', 'src', 'images', 'walkthrough');
/** WebP quality for the walkthrough stills; lower it (not below 0.7) if a file is over target. */
const WEBP_QUALITY = 0.82;

/** The landing page's other pictures (`apps/site/src/images/`): the home screen. */
const SITE_IMAGES = join(process.cwd(), 'apps', 'site', 'src', 'images');

/**
 * Encodes a full-page PNG to a 1440- and a 960-wide WebP in Chromium and writes both
 * into `dir` (only the 1440-wide one when `small` is false).
 */
async function saveWebp(
  page: Page,
  stem: string,
  png: Buffer,
  quality: number,
  dir = WALKTHROUGH,
  small = true,
) {
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
  const narrow = decode(encoded.small);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${stem}.webp`), wide);
  if (small) await writeFile(join(dir, `${stem}-960.webp`), narrow);
  console.log(
    `${stem}: ${(wide.length / 1024).toFixed(1)} kB at 1440` +
      (small ? `, ${(narrow.length / 1024).toFixed(1)} kB at 960` : ''),
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

test("walkthrough: the landing page's home screen", async ({ page }) => {
  // The templates section's picture (apps/site/src/images/home.webp): the home screen
  // a first visit sees, with the tour's card and the template gallery.
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        'Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0)',
      ),
    )
    .toBe(true);
  await page.evaluate('document.fonts.ready.then(() => true)');
  await page.mouse.move(1430, 890);
  await page.waitForTimeout(200);
  await saveWebp(page, 'home', await page.screenshot(), WEBP_QUALITY, SITE_IMAGES, false);
});

test("walkthrough: the landing page's steps", async ({ page }) => {
  test.setTimeout(600_000);
  // A locator that never appears should fail, not wait forever.
  page.setDefaultTimeout(30_000);
  // Info toasts ("Sketch1 is hidden…") and their bell would clutter a still frame, and
  // the status bar's renderer note and frame rate describe the headless browser's
  // software rendering, not what a visitor's GPU shows.
  const quiet =
    '[role="status"]:has(button[aria-label="Dismiss"]), button[aria-label^="Notification history"], [data-renderer], [data-render-stats] { display: none !important; }';
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
  // From its tile, so the picture shows the Modify tab with Fillet active.
  await pickTool(page, 'Fillet');
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
  await selectParameter(page, 'width');
  await params.getByRole('switch', { name: 'Show width in customizer' }).click();
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
