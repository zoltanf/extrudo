import { expect, test } from '@playwright/test';
import {
  type At,
  addParameter,
  bodies,
  chip,
  clickAt,
  clickEdge,
  closeParameters,
  expectNoProblems,
  fill,
  type Ink,
  ink,
  ok,
  openParameters,
  pickText,
  primitive,
  renameProject,
  settled,
  toolPrompt,
  turnView,
  viewportOf,
  zoomOutTo,
} from '../benchmark-helpers';
import {
  clicker,
  kernelReady,
  mapping,
  openProject,
  pickTool,
  projector,
  selectTab,
} from '../helpers';
import { tutorial } from './step';

// Tutorial 2, docs/guide/tutorials/name-tag.md: a name tag with raised letters. It is
// benchmark B8's flow (e2e/benchmark-b8.spec.ts) as a beginner follows it, one `step` per
// heading of the page (ADR-0080 §4): the plate, four fillets (the fourth from the back
// view), a hole for the ring, a sketch text, an emboss and a 3MF export.

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

test('Tutorial 2: a name tag', async ({ page }) => {
  const { step } = tutorial(page, 'name-tag');
  const viewport = viewportOf(page);
  const palette = page.getByRole('region', { name: 'Sketch palette' });
  const fillet = page.getByRole('region', { name: 'Fillet dialog' });
  const edges = fillet.getByRole('button', { name: 'Edges', exact: true });
  const text = page.getByRole('region', { name: 'Text' });
  let at: At;
  let drawnInk: Ink;

  await step(
    'parameters',
    async () => {
      await openProject(page);
      await kernelReady(page);
      await renameProject(page, 'Name tag');
      await openParameters(page);
      await addParameter(page, 'length', '60 mm');
      await addParameter(page, 'width', '20 mm');
      await addParameter(page, 'thick', '3 mm');
      await addParameter(page, 'corner', '5 mm');
      await addParameter(page, 'letters', '1 mm');
    },
    async () => {
      await expect(
        page
          .getByRole('dialog', { name: 'Parameters' })
          .getByRole('textbox', { name: 'Expression of letters', exact: true }),
      ).toHaveValue('1 mm');
    },
  );

  await step(
    'box',
    async () => {
      await closeParameters(page);
      await primitive(page, 'Box', { Length: 'length', Width: 'width', Height: 'thick' });
    },
    async () => {
      await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:60,20,3');
    },
  );

  await step(
    'fillet-three',
    async () => {
      at = await turnView(page, 'Shift+1');
      await clickEdge(page, at, [30, -10, 1.5]);
      await page.keyboard.press('f');
      await expect(fillet).toBeVisible();
      await expect(edges).toHaveText('1 edge');
      // Zoom out so the corners clear the dialog on the right.
      await zoomOutTo(page, at([0, 0, 1.5]), 110);
      await settled(viewport);
      at = await projector(viewport);
      for (const [k, p] of (
        [
          [30, 10, 1.5],
          [-30, -10, 1.5],
        ] as const
      ).entries()) {
        await clickEdge(page, at, p);
        await expect(edges).toHaveText(`${k + 2} edges`);
      }
    },
    async () => {
      await expect(edges).toHaveText('3 edges');
    },
  );

  await step(
    'fillet-back',
    async () => {
      // The fourth corner is hidden in the home view: turn to the back to reach it.
      at = await turnView(page, 'Shift+5');
      await zoomOutTo(page, at([0, 0, 1.5]), 110);
      await settled(viewport);
      at = await projector(viewport);
      await clickEdge(page, at, [-30, 10, 1.5]);
      await expect(edges).toHaveText('4 edges');
      await fill(fillet, { Radius: 'corner' });
      await ok(page, fillet);
    },
    async () => {
      await expect(viewport).toHaveAttribute('data-bodies', 'Body1:10:60,20,3');
    },
  );

  await step(
    'hole',
    async () => {
      at = await turnView(page, 'Shift+1');
      await page.keyboard.press('h');
      const hole = page.getByRole('region', { name: 'Hole dialog' });
      await expect(hole).toBeVisible();
      await expect(hole.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
      // The click takes the top face and places the hole where it landed.
      await clickAt(page, at, [-24, 0, 3]);
      await expect(hole.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
      await fill(hole, { X: '-length / 2 + 6 mm', Y: '0 mm', Diameter: '4 mm' });
      await hole.getByRole('combobox', { name: 'Extent', exact: true }).selectOption('through');
      await ok(page, hole);
    },
    async () => {
      await expect(chip(page, 'Hole1')).toHaveAccessibleName('Hole1');
      await expect(viewport).toHaveAttribute('data-bodies', 'Body1:11:60,20,3');
    },
  );

  await step(
    'sketch-face',
    async () => {
      await pickTool(page, 'Create Sketch');
      await expect(page.getByRole('region', { name: 'Create Sketch' })).toContainText('flat face');
      await clickAt(page, at, [15, 0, 3]);
      await expect(chip(page, 'Sketch1')).toBeVisible();
      await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
      // The letters are drawn where they are put, so the grid would snap their anchor:
      // switch it off. "Show profiles" lets a click in a letter's ink take its text.
      const snap = palette.getByRole('checkbox', { name: 'Snap to grid' });
      await snap.uncheck();
      await snap.blur();
      const showProfiles = palette.getByRole('checkbox', { name: 'Show profiles' });
      if (!(await showProfiles.isChecked())) await showProfiles.check();
      await showProfiles.blur();
    },
    async () => {
      await expect(chip(page, 'Sketch1')).toBeVisible();
      await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
    },
  );

  await step(
    'text',
    async () => {
      const sketch = await mapping(viewport);
      await page.keyboard.press('Shift+T');
      await expect(toolPrompt(page)).toHaveText('Click where the first line’s baseline starts.');
      await clicker(page, sketch)(4, -4);
      await expect(text).toBeVisible();
      await text.getByRole('textbox', { name: 'Text' }).fill('EXTRUDO');
      await text.getByRole('button', { name: 'Center' }).click();
      await text.getByRole('textbox', { name: 'Height' }).fill('8 mm');
    },
    async () => {
      await expect(text).toBeVisible();
      await expect(text.getByRole('textbox', { name: 'Height' })).toHaveValue('8 mm');
      await expect(text.getByRole('button', { name: 'Center' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    },
  );

  await step(
    'finish-sketch',
    async () => {
      await text.getByRole('button', { name: 'OK' }).click();
      await expect(text).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(toolPrompt(page)).toHaveCount(0);
      drawnInk = await ink(page);
      await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
      await expect(chip(page, 'Sketch1')).toBeVisible();
      await kernelReady(page);
    },
    async () => {
      // Eight millimetres of cap height, centred on the anchor at (4, -4).
      expect(drawnInk.y[1] - drawnInk.y[0]).toBeCloseTo(8, 0);
      expect((drawnInk.x[0] + drawnInk.x[1]) / 2).toBeCloseTo(4, 0);
      expect(drawnInk.x[0]).toBeGreaterThan(-22);
      expect(drawnInk.x[1]).toBeLessThan(30);
      await expect(chip(page, 'Sketch1')).toBeVisible();
    },
  );

  await step(
    'emboss',
    async () => {
      at = await turnView(page, 'Shift+1');
      await pickText(page, at, drawnInk, ([u, v]) => [u, v, 3]);
      await pickTool(page, 'Emboss');
      const emboss = page.getByRole('region', { name: 'Emboss dialog' });
      await expect(emboss).toBeVisible();
      await expect(emboss.getByRole('button', { name: 'Profiles', exact: true })).toHaveText(
        '1 text',
      );
      // The top face itself, clear of the letters and the hole.
      await clickAt(page, at, [-15, -6, 3]);
      await expect(emboss.getByRole('button', { name: 'Face', exact: true })).toHaveText('1 face');
      await fill(emboss, { Depth: 'letters' });
    },
    async () => {
      const emboss = page.getByRole('region', { name: 'Emboss dialog' });
      await expect(emboss).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
      await expect(emboss.getByRole('button', { name: 'Profiles', exact: true })).toHaveText(
        '1 text',
      );
      await expect(emboss.getByRole('button', { name: 'Face', exact: true })).toHaveText('1 face');
    },
  );

  await step(
    'result',
    async () => {
      const emboss = page.getByRole('region', { name: 'Emboss dialog' });
      await ok(page, emboss);
      await expectNoProblems(page);
    },
    async () => {
      await expect(chip(page, 'Emboss1')).toHaveAccessibleName('Emboss1');
      // One body: the letters stand on the plate, they don't float beside it.
      const drawn = await bodies(page);
      expect(Object.keys(drawn)).toEqual(['Body1']);
      const tag = drawn.Body1;
      expect(tag?.size[0]).toBeCloseTo(60, 1);
      expect(tag?.size[1]).toBeCloseTo(20, 1);
      expect(tag?.size[2]).toBeCloseTo(4, 1);
      expect(tag?.faces).toBeGreaterThan(40);
    },
  );

  const exportDialog = page.getByRole('dialog', { name: 'Export model' });
  await step(
    'export-3mf',
    async () => {
      await selectTab(page, '3D Print');
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await exportDialog.getByRole('radio', { name: /^3MF/ }).check();
    },
    async () => {
      await expect(exportDialog.locator('[data-export-summary]')).toHaveAttribute(
        'data-export-summary',
        /1 body, [\d,]+ triangles.*watertight/,
        { timeout: 20_000 },
      );
    },
  );

  // What the button then writes: one closed solid, a file a slicer can print.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportDialog.getByRole('button', { name: 'Export 3MF' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.3mf$/);
});
