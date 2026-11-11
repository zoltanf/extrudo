import { readFile, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { type Download, expect, type Page, test } from '@playwright/test';
import { type SheetId, type SheetViewId, sheetStandardFrom } from '../packages/core/src/index';
import { readArchive, writeArchive } from '../packages/storage/src/archive';
import {
  kernelReady,
  openProject,
  parameterExpression,
  parametersDialog,
  pickTool,
  selectTab,
} from './helpers';

// P6-24 S2, the view tools (ADR-0143's S2 view-tools amendment): the open sheet's views
// are drawn from the model (quick lines, then exact ones, one view at a time, cancellable
// between views), Base View places one with the pointer, a selected view has its card, and
// the export draws the same exact lines.

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 180_000 });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const sheet = (page: Page) => page.getByRole('region', { name: 'Sheet', exact: true });
const card = (page: Page) => page.getByRole('region', { name: 'View', exact: true });

/** The screen point of sheet point (`x`, `y`) mm on an A3 landscape sheet. */
async function onSheet(page: Page, x: number, y: number) {
  const box = await sheet(page).locator('[data-sheet-paper]').boundingBox();
  if (!box) throw new Error('No paper');
  return { x: box.x + (x / 420) * box.width, y: box.y + (y / 297) * box.height };
}

/**
 * A view's drawn lines (its stroked paths: its label is a filled outline): each one's stroke
 * width, dash and state, and their box in sheet mm.
 */
async function lines(page: Page, id: string) {
  return sheet(page)
    .locator(`[data-sheet-paper] > svg path[data-key="view:${id}"][stroke-width]`)
    .evaluateAll((paths) => {
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      const drawn = paths.map((p) => {
        const b = (
          p as unknown as { getBBox(): { x: number; y: number; width: number; height: number } }
        ).getBBox();
        x0 = Math.min(x0, b.x);
        y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.width);
        y1 = Math.max(y1, b.y + b.height);
        return {
          width: p.getAttribute('stroke-width'),
          dash: p.getAttribute('stroke-dasharray'),
          state: p.getAttribute('data-state'),
        };
      });
      const r = (n: number) => Math.round(n * 10) / 10;
      const box: [number, number, number, number] = [r(x0), r(y0), r(x1), r(y1)];
      const size: [number, number] = [r(x1 - x0), r(y1 - y0)];
      return { drawn, box, size };
    });
}

/** The selected targets of the sheet. */
const selected = (page: Page) => sheet(page).getAttribute('data-selected');

/** Make › Drawing, then New drawing's Create Drawing: the mode with one A3 sheet. */
async function newDrawing(page: Page) {
  await selectTab(page, 'Make');
  await pickTool(page, 'Drawing');
  const dialog = page.getByRole('dialog', { name: 'New drawing' });
  await dialog.getByRole('button', { name: 'Create Drawing' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sheet(page)).toHaveAttribute('data-paper', '420x297');
}

/** Base View from `looking` at `scale`, placed with its middle at sheet point (x, y). Returns its ID. */
async function baseView(page: Page, looking: string, scale: string, x: number, y: number) {
  await page.locator('#toolbar-groups [data-label="Base View"]').click();
  const panel = page.getByRole('region', { name: 'Base view' });
  await panel.getByRole('combobox', { name: 'Looking from' }).selectOption({ label: looking });
  await panel.getByRole('combobox', { name: 'Scale' }).selectOption(scale);
  const at = await onSheet(page, x, y);
  await page.mouse.move(at.x - 20, at.y - 20);
  await page.mouse.move(at.x, at.y, { steps: 4 });
  // The frame follows the pointer once the quick lines are in.
  await expect(panel).toContainText('Click on the sheet to place the view.');
  await expect(sheet(page).locator('[data-sheet-placing]')).toBeVisible();
  await page.mouse.click(at.x, at.y);
  await expect(panel).toHaveCount(0);
  await expect.poll(() => selected(page)).toMatch(/^view:/);
  return ((await selected(page)) ?? '').slice(5);
}

/** Runs `click` and returns the download it starts, with its bytes. */
async function downloaded(page: Page, click: () => Promise<unknown>) {
  const [download] = (await Promise.all([page.waitForEvent('download'), click()])) as [
    Download,
    unknown,
  ];
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

/** A PDF's page content, its streams inflated. */
function pdfContent(bytes: Buffer): string {
  const text = bytes.toString('latin1');
  const out: string[] = [];
  const re = /\/FlateDecode >>\nstream\n/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index + m[0].length;
    const end = text.indexOf('\nendstream', start);
    out.push(inflateSync(bytes.subarray(start, end)).toString('latin1'));
  }
  return out.join('\n');
}

test('Base View draws the wall bracket from the model; a parameter change redraws it; the card; export', async ({
  page,
}) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await newDrawing(page);

  // Front at 1:2: exact lines (visible 0.5, hidden dashed 0.25; the fillets' tangent edges
  // are seen end-on), its middle where the click was: it does not jump when its lines arrive.
  const front = await baseView(page, 'Front', '1:2', 150, 100);
  await expect
    .poll(async () => (await lines(page, front)).drawn.every((p) => p.state === null))
    .toBe(true);
  const f = await lines(page, front);
  expect(f.drawn.map((p) => p.width).sort()).toEqual(['0.25', '0.5']);
  expect(f.drawn.find((p) => p.width === '0.25')?.dash).toBe('3 1.5');
  // The L's profile: 40 × 60 mm at 1:2 (`getBBox` leaves strokes out).
  expect(f.size[0]).toBeCloseTo(20, 0);
  expect(f.size[1]).toBeCloseTo(30, 0);
  expect((f.box[0] + f.box[2]) / 2).toBeCloseTo(150, 0);
  expect((f.box[1] + f.box[3]) / 2).toBeCloseTo(100, 0);
  await expect(card(page)).toContainText('Front');

  const top = await baseView(page, 'Top', '1:2', 150, 200);
  await expect.poll(async () => (await lines(page, top)).size[1]).toBeCloseTo(40, 0);

  // width 80 → 140 mm: the top view grows to 70 mm down the sheet (y is the model's Y).
  await selectTab(page, 'Home');
  await pickTool(page, 'Parameters');
  const expr = await parameterExpression(page, 'width');
  await expr.fill('140 mm');
  await expr.press('Enter');
  await expect(expr).toHaveAccessibleDescription('= 140.00 mm');
  await page.keyboard.press('Escape');
  await expect(parametersDialog(page)).toHaveCount(0);
  await expect
    .poll(async () => (await lines(page, top)).size[1], { timeout: 30_000 })
    .toBeCloseTo(70, 0);
  await expect
    .poll(async () => (await lines(page, top)).drawn.every((p) => p.state === null))
    .toBe(true);

  // The card: each change is one undo step. The top view shows the fillets' tangent edges.
  const above = await onSheet(page, 150, 200);
  await page.mouse.click(above.x, above.y);
  await expect.poll(() => selected(page)).toBe(`view:${top}`);
  expect((await lines(page, top)).drawn.some((p) => p.width === '0.18')).toBe(true);
  await card(page).getByRole('switch', { name: 'Tangent edges' }).click();
  await expect
    .poll(async () => (await lines(page, top)).drawn.some((p) => p.width === '0.18'))
    .toBe(false);
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await lines(page, top)).drawn.some((p) => p.width === '0.18'))
    .toBe(true);
  const at = await onSheet(page, 150, 100);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => selected(page)).toBe(`view:${front}`);
  await card(page).getByRole('radio', { name: 'Visible edges' }).click();
  await expect
    .poll(async () => (await lines(page, front)).drawn.some((p) => p.width === '0.25'))
    .toBe(false);
  await card(page).getByRole('switch', { name: 'View label' }).click();
  await expect(sheet(page).locator(`[data-sheet-text] [data-key="view:${front}"]`)).toHaveText(
    'Front (1:2)',
  );
  await card(page).getByRole('combobox', { name: 'Scale' }).selectOption('1:1');
  await expect.poll(async () => (await lines(page, front)).size[1]).toBeCloseTo(60, 0);
  // A new scale keeps the view's middle where it was.
  const big = await lines(page, front);
  expect((big.box[1] + big.box[3]) / 2).toBeCloseTo(100, 0);
  await card(page).getByRole('combobox', { name: 'Looking from' }).selectOption({ label: 'Back' });
  await expect(card(page).getByRole('textbox', { name: 'View name' })).toHaveValue('Back');
  await card(page).getByRole('checkbox', { name: 'All shown' }).uncheck();
  await expect(card(page).getByRole('checkbox', { name: 'Bracket' })).toBeChecked();
  await expect(card(page).getByRole('checkbox', { name: 'Bracket' })).toBeDisabled();
  for (let i = 0; i < 5; i++) await page.keyboard.press('Control+z');
  await expect(card(page).getByRole('textbox', { name: 'View name' })).toHaveValue('Front');
  await expect(card(page).getByRole('checkbox', { name: 'All shown' })).toBeChecked();
  await expect.poll(async () => (await lines(page, front)).size[1]).toBeCloseTo(30, 0);
  const back = await lines(page, front);
  expect(back.drawn.map((p) => p.width).sort()).toEqual(['0.25', '0.5']);
  await expect(sheet(page).locator(`[data-sheet-text] [data-key="view:${front}"]`)).toHaveCount(0);

  // Export PDF: the page has the views' exact lines (hidden ones dashed), no placeholder.
  await selectTab(page, 'Drawing');
  await page.locator('#toolbar-groups [data-label="Export PDF"]').click();
  const dialog = page.getByRole('dialog', { name: 'Export drawing' });
  const pdf = await downloaded(page, () => dialog.getByRole('button', { name: 'Export' }).click());
  const content = pdfContent(pdf.bytes);
  expect(content).toContain('[3 1.5] 0 d');
  expect(content.match(/0\.5 w/g)?.length).toBeGreaterThan(3);
});

/** A copy of B7 (the knurled knob: its side views take seconds) with a sheet of four views. */
async function knobFixture(path: string) {
  const { doc } = readArchive(
    new Uint8Array(await readFile('fixtures/benchmarks/b7-knurled-knob.extrudo')),
  );
  const front = 'v-front' as SheetViewId;
  doc.sheets = [
    {
      id: 's1' as SheetId,
      name: 'Knob',
      size: 'A3',
      orientation: 'landscape',
      scale: [1, 1],
      projection: 'first',
      decimals: 1,
      views: [
        { id: front, name: 'Front', at: [120, 100], from: sheetStandardFrom('front') },
        {
          id: 'v-right' as SheetViewId,
          name: 'Right',
          at: [260, 100],
          from: { kind: 'projected', parent: front, side: 'left' },
        },
        {
          id: 'v-top' as SheetViewId,
          name: 'Top',
          at: [120, 220],
          from: { kind: 'projected', parent: front, side: 'below' },
        },
        {
          id: 'v-iso' as SheetViewId,
          name: 'Isometric',
          at: [300, 220],
          from: { kind: 'projected', parent: front, side: 'iso-above-right' },
        },
      ],
      items: [],
    },
  ];
  await writeFile(path, writeArchive(doc));
}

test('the views are drawn one at a time, and Cancel stops them between views', async ({
  page,
}, info) => {
  const file = info.outputPath('knob.extrudo');
  await knobFixture(file);
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…', exact: true }).click(),
  ]);
  await chooser.setFiles(file);
  await page
    .getByRole('complementary', { name: 'Browser' })
    .locator('[data-sheet-row]')
    .first()
    .dblclick();
  const notice = page.locator('[data-sheet-views-progress]');
  await expect(notice).toHaveAttribute('data-sheet-views-progress', 'running', { timeout: 60_000 });
  await expect(notice).toContainText(/View \d of 4/);
  await notice.getByRole('button', { name: 'Cancel drawing the views' }).click();
  // The view under way finishes; the rest keep their quick lines, dimmed.
  await expect(notice).toHaveAttribute('data-sheet-views-progress', 'cancelled', {
    timeout: 60_000,
  });
  await expect(notice).toContainText('Some views are out of date');
  const stale = sheet(page).locator('[data-sheet-paper] > svg path[data-state="stale"]');
  expect(await stale.count()).toBeGreaterThan(0);
  // Nothing runs again by itself; Draw does.
  await page.waitForTimeout(1000);
  await expect(notice).toHaveAttribute('data-sheet-views-progress', 'cancelled');
  await notice.getByRole('button', { name: 'Draw the views' }).click();
  await expect(notice).toHaveCount(0, { timeout: 90_000 });
  await expect(stale).toHaveCount(0);
  for (const id of ['v-front', 'v-right', 'v-top', 'v-iso']) {
    expect((await lines(page, id)).drawn.length).toBeGreaterThan(0);
  }
});
