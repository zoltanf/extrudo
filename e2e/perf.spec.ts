import { expect, type Page, test } from '@playwright/test';
import { parameterExpression, parametersDialog, pickTool, projector } from './helpers';

// P6-13, ADR-0100 §1: the main-thread budgets for what a CAD user feels —
// opening a project, orbiting, a parameter edit and its undo, the first hover
// and click on the body. The budgets (ADR-0100 §1) are set against the
// baseline's laptop numbers (docs/plans/perf-baseline-2026-10-23.md §1.4) and
// are deliberately loose: they catch a step change, not noise. The raw numbers
// are attached to the report as `perf.json` so the trend is readable.
//
// Measured with a `PerformanceObserver` for `longtask` and `event` entries and
// a `requestAnimationFrame` counter, installed before the app loads. Chromium
// only: the numbers only mean something where `longtask` exists.
//
// Traps are in docs/agent/e2e-notes.md (`e2e/perf.spec.ts`).

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(180_000);
test.describe.configure({ mode: 'serial' });

/** The observers and the frame counter, on every document this page loads. */
const INSTRUMENT = `(() => {
  window.__perf = { long: [], events: [], frames: [] };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        window.__perf.long.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        window.__perf.events.push({ name: e.name, start: e.startTime, dur: e.duration });
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  } catch {}
  const tick = (t) => { window.__perf.frames.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})()`;

/**
 * Arms the round-trip observer and returns at once: it stores the Promise on
 * `window.__perf.roundTrip` (`page.evaluate` awaits a Promise at read time,
 * and `evaluateHandle` would wait at arm time too — the edit must happen
 * between arming and reading). One MutationObserver watches both attributes
 * anywhere in the document, re-querying the elements on every callback: React
 * may replace the nodes. It marks "changed" when the status is anything but
 * `ready` or `data-bodies` mutates (a fast round trip can flip ready → busy →
 * ready between two callbacks), and resolves with the elapsed ms once changed
 * and the status is `ready` again, or -1 after 30 s.
 */
const ROUND_TRIP = `(() => {
  window.__perf.roundTrip = new Promise((resolve) => {
    const t0 = performance.now();
    let changed = false;
    let bodies = document.querySelector('[data-bodies]')?.getAttribute('data-bodies') ?? '';
    const check = () => {
      const status = document.querySelector('[data-model-status]')?.getAttribute('data-model-status') ?? '';
      const next = document.querySelector('[data-bodies]')?.getAttribute('data-bodies') ?? '';
      if (status !== 'ready' || next !== bodies) changed = true;
      bodies = next;
      if (changed && status === 'ready') resolve(performance.now() - t0);
    };
    new MutationObserver(check).observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-model-status', 'data-bodies'],
    });
    check();
    setTimeout(() => resolve(-1), 30000);
  });
})()`;

interface Sample {
  /** Long tasks (over 50 ms) that started in the window. */
  longCount: number;
  longTotal: number;
  longMax: number;
  /** The window's long tasks, start and duration (ms) each. */
  long: { start: number; dur: number }[];
  /** The slowest input event (an `event` entry, 16 ms threshold or more). */
  worstEvent: { name: string; dur: number } | null;
  /** requestAnimationFrame ticks per second in the window. */
  fps: number;
}

const nowOf = async (page: Page) => (await page.evaluate('performance.now()')) as number;

/** The instrumentation's numbers for the window [from, to] (page `performance.now()` values). */
const sample = (page: Page, from: number, to: number) =>
  page.evaluate(`((f, t) => {
    const inWindow = (start) => start >= f && start < t;
    const long = window.__perf.long.filter((e) => inWindow(e.start));
    const events = window.__perf.events.filter((e) => inWindow(e.start));
    let worstEvent = null;
    for (const e of events) {
      if (!worstEvent || e.dur > worstEvent.dur) worstEvent = { name: e.name, dur: e.dur };
    }
    const frames = window.__perf.frames.filter((at) => inWindow(at));
    const seconds = Math.max((t - f) / 1000, 0.001);
    return {
      longCount: long.length,
      longTotal: Math.round(long.reduce((sum, e) => sum + e.dur, 0)),
      longMax: Math.round(Math.max(0, ...long.map((e) => e.dur))),
      long: long.map((e) => ({ start: Math.round(e.start), dur: Math.round(e.dur) })),
      worstEvent: worstEvent && { name: worstEvent.name, dur: Math.round(worstEvent.dur) },
      fps: Math.round(frames.length / seconds),
    };
  })(${from}, ${to})`) as Promise<Sample>;

const EXAMPLES = [
  {
    id: 'pcb-enclosure',
    label: 'pcb-enclosure (B5)',
    parameter: 'length',
    value: '110 mm',
    openBudgetMs: 8_000,
    roundTripBudgetMs: 1_500,
  },
  {
    id: 'knurled-knob',
    label: 'knurled-knob (B7)',
    parameter: 'grooves',
    value: '32',
    openBudgetMs: 10_000,
    roundTripBudgetMs: 5_000,
  },
];

async function runExample(page: Page, ex: (typeof EXAMPLES)[number]) {
  const viewport = page.getByRole('region', { name: 'Viewport' });
  const kernel = page.getByRole('status', { name: 'Kernel' });
  const windows: Record<string, Sample & { elapsedMs: number; roundTripMs?: number }> = {};

  await page.addInitScript(INSTRUMENT);
  await page.goto('./');
  await page.getByRole('button', { name: 'New design' }).waitFor({ timeout: 60_000 });

  // 1. open: the home screen is already up, so the window is the example being
  // opened — the copy, the kernel's first recompute and the first frames.
  let openFrom = await nowOf(page);
  await page.goto(`./#/example/${ex.id}`);
  // A same-document hash navigation keeps the clock; a full one would reset
  // `performance.now()` to 0 — fall back to the new document's start.
  if ((await nowOf(page)) < openFrom) openFrom = 0;
  await expect(kernel).toHaveAttribute('data-model-status', 'ready', { timeout: 60_000 });
  await expect(viewport).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await page.waitForTimeout(500); // let the first frames settle
  const openTo = await nowOf(page);
  windows.open = {
    ...(await sample(page, openFrom, openTo)),
    elapsedMs: Math.round(openTo - openFrom),
  };

  // The model's centre on screen: the camera target (fit centres the bounds
  // there, in the part of the view the browser panel doesn't cover).
  const project = await projector(viewport);
  const target = ((await viewport.getAttribute('data-camera-target')) ?? '')
    .split(',')
    .map(Number) as [number, number, number];
  const centre = project(target);

  // 2. orbit: a middle-button drag of 60 pointer moves around an ellipse.
  const orbitFrom = await nowOf(page);
  await page.mouse.down({ button: 'middle' });
  for (let i = 1; i <= 60; i++) {
    const angle = (i / 60) * Math.PI * 2;
    await page.mouse.move(centre.x + Math.cos(angle) * 160, centre.y + Math.sin(angle) * 90);
    await page.waitForTimeout(16);
  }
  await page.mouse.up({ button: 'middle' });
  const orbitTo = await nowOf(page);
  windows.orbit = {
    ...(await sample(page, orbitFrom, orbitTo)),
    elapsedMs: Math.round(orbitTo - orbitFrom),
  };

  // 3. edit: the observer is armed BEFORE the dialog opens — the expression
  // field applies while typing, so an observer armed after `fill` sees nothing.
  const editFrom = await nowOf(page);
  await page.evaluate(ROUND_TRIP);
  await pickTool(page, 'Parameters');
  const field = await parameterExpression(page, ex.parameter);
  await field.fill(ex.value);
  await field.press('Enter');
  const editRoundTrip = (await page.evaluate('window.__perf.roundTrip')) as number;
  await page.keyboard.press('Escape');
  await expect(parametersDialog(page)).toHaveCount(0);
  const editTo = await nowOf(page);
  windows.edit = {
    ...(await sample(page, editFrom, editTo)),
    elapsedMs: Math.round(editTo - editFrom),
    roundTripMs: Math.round(editRoundTrip),
  };
  if (editRoundTrip < 0) {
    throw new Error(
      `the round-trip observer saw no recompute within 30 s while editing ${ex.parameter} — the observer is wrong, not the app (docs/agent/e2e-notes.md)`,
    );
  }

  // 4. undo: the same round trip, back to the stored value.
  const undoFrom = await nowOf(page);
  await page.evaluate(ROUND_TRIP);
  await page.keyboard.press('Control+z');
  const undoRoundTrip = (await page.evaluate('window.__perf.roundTrip')) as number;
  const undoTo = await nowOf(page);
  windows.undo = {
    ...(await sample(page, undoFrom, undoTo)),
    elapsedMs: Math.round(undoTo - undoFrom),
    roundTripMs: Math.round(undoRoundTrip),
  };

  // 5. hover and click on the body: the event entries' durations.
  const hoverFrom = await nowOf(page);
  await page.mouse.move(centre.x, centre.y);
  await page.waitForTimeout(300);
  await page.mouse.click(centre.x, centre.y);
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  const hoverTo = await nowOf(page);
  windows.hover = {
    ...(await sample(page, hoverFrom, hoverTo)),
    elapsedMs: Math.round(hoverTo - hoverFrom),
  };

  // The raw numbers land in the report even when an assertion below fails.
  await test.info().attach('perf.json', {
    body: JSON.stringify({ example: ex.id, windows }, null, 2),
    contentType: 'application/json',
  });

  // The hover has to land on the model, or the window measures empty space
  // (the knurled knob's centre projects onto its bevel edge).
  await expect(
    viewport,
    `the hover at the view's centre must land on the model (${ex.label})`,
  ).toHaveAttribute('data-model-hover', /^(face|edge):/);

  const show = (w: Sample & { elapsedMs?: number; roundTripMs?: number }) => {
    const { long, ...rest } = w;
    return JSON.stringify({ ...rest, longTasks: long.length });
  };
  expect(
    windows.open.longMax,
    `longest task while opening ${ex.label} (ms, budget 400): ${show(windows.open)}`,
  ).toBeLessThan(400);
  expect(
    windows.open.longTotal,
    `long tasks total while opening ${ex.label} (ms, budget 1200): ${show(windows.open)}`,
  ).toBeLessThan(1200);
  expect(
    windows.open.elapsedMs,
    `${ex.label} open → model ready (ms, budget ${ex.openBudgetMs}): ${show(windows.open)}`,
  ).toBeLessThan(ex.openBudgetMs);

  expect(
    windows.orbit.longMax,
    `longest task while orbiting ${ex.label} (ms, budget 100): ${show(windows.orbit)}`,
  ).toBeLessThan(100);
  expect(
    windows.orbit.fps,
    `animation frames per second while orbiting ${ex.label} (floor 20): ${show(windows.orbit)}`,
  ).toBeGreaterThanOrEqual(20);

  expect(
    windows.edit.longMax,
    `longest task while editing ${ex.parameter} in ${ex.label} (ms, budget 150): ${show(windows.edit)}`,
  ).toBeLessThan(150);
  expect(
    windows.edit.roundTripMs,
    `parameter round trip for ${ex.label} (ms): ${show(windows.edit)}`,
  ).toBeGreaterThan(0);
  expect(
    windows.edit.roundTripMs,
    `parameter round trip for ${ex.label} (ms, budget ${ex.roundTripBudgetMs}): ${show(windows.edit)}`,
  ).toBeLessThan(ex.roundTripBudgetMs);

  expect(
    windows.undo.longMax,
    `longest task while undoing in ${ex.label} (ms, budget 150): ${show(windows.undo)}`,
  ).toBeLessThan(150);
  expect(
    windows.undo.roundTripMs,
    `undo round trip for ${ex.label} (ms): ${show(windows.undo)}`,
  ).toBeGreaterThan(0);
  expect(
    windows.undo.roundTripMs,
    `undo round trip for ${ex.label} (ms, budget ${ex.roundTripBudgetMs}): ${show(windows.undo)}`,
  ).toBeLessThan(ex.roundTripBudgetMs);

  expect(
    windows.hover.worstEvent?.dur ?? 0,
    `worst input event while hovering and clicking in ${ex.label} (ms, budget 250): ${show(windows.hover)}`,
  ).toBeLessThan(250);
}

for (const ex of EXAMPLES) {
  test(`perf: ${ex.label} stays inside the main-thread budgets`, async ({ page }) => {
    await runExample(page, ex);
  });
}
