import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  addParameter,
  closeParameters,
  dimension,
  homeView,
  meshOfStl,
  openParameters,
  renameProject,
  setParameters,
  solidFacts,
  toolPrompt,
  viewportOf,
  zoomOutTo,
} from '../benchmark-helpers';
import {
  clicker,
  counts,
  kernelReady,
  mapping,
  newSketchOnXY,
  openProject,
  selectTab,
} from '../helpers';
import { tutorial } from './step';
import { panTo } from './view';

// Tutorial 1, docs/guide/tutorials/first-part.md: a plate with four holes. It is benchmark
// B1's flow (e2e/benchmark-b1.spec.ts) followed by an extrude and an STL export, one
// `step` per heading of the page (ADR-0080 §4).

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 120_000 });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('Tutorial 1: a plate with four holes', async ({ page }) => {
  const { step } = tutorial(page, 'first-part');
  const viewport = viewportOf(page);
  const palette = page.getByRole('region', { name: 'Sketch palette' });
  const dof = palette.locator('[data-constraint-state]');
  const extrudeDialog = page.getByRole('region', { name: 'Extrude dialog' });
  let click: (x: number, y: number) => Promise<void> = async () => {};

  await step(
    'parameters',
    async () => {
      await openProject(page);
      await renameProject(page, 'First part');
      await openParameters(page);
      await addParameter(page, 'width', '100 mm');
      await addParameter(page, 'depth', '80 mm');
      await addParameter(page, 'spacing', '60 mm');
      await addParameter(page, 'hole', '6 mm');
      await addParameter(page, 'margin', '(width - spacing) / 2');
      await addParameter(page, 'thickness', '5 mm');
    },
    async () => {
      await expect(
        page
          .getByRole('dialog', { name: 'Parameters' })
          .getByRole('textbox', { name: 'Expression of margin', exact: true }),
      ).toHaveAccessibleDescription('= 20.00 mm');
    },
  );

  await step(
    'create-sketch',
    async () => {
      await closeParameters(page);
      const home = await newSketchOnXY(page);
      // Zoom out around the plate's centre so that it clears the palette.
      const centre = home(50, 40);
      await zoomOutTo(page, centre, 240);
      // The plate sits in the middle of the free part of the view, clear of the palette.
      await panTo(page, centre);
      click = clicker(page, await mapping(viewport));
      const showConstraints = palette.getByRole('checkbox', { name: 'Show constraints' });
      await showConstraints.uncheck();
      await showConstraints.blur();
    },
    async () => {
      await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
      await expect(palette).toBeVisible();
    },
  );

  await step(
    'rectangle',
    async () => {
      await page.keyboard.press('r');
      await expect(toolPrompt(page)).toBeVisible();
      await click(0, 0);
      await click(100, 80);
      await page.keyboard.press('Escape');
    },
    async () => {
      expect(await counts(page)).toMatchObject({ lines: 4, circles: 0 });
    },
  );

  await step(
    'holes',
    async () => {
      await page.keyboard.press('c');
      await expect(toolPrompt(page)).toBeVisible();
      for (const [x, y] of [
        [20, 20],
        [80, 20],
        [20, 60],
        [80, 60],
      ] as const) {
        await click(x, y);
        await click(x + 10, y);
      }
      await page.keyboard.press('Escape');
      await expect(toolPrompt(page)).toHaveCount(0);
    },
    async () => {
      expect(await counts(page)).toMatchObject({ lines: 4, circles: 4, constraints: 13 });
      await expect(dof).toHaveText('10 DOF left');
    },
  );

  await step(
    'equal-holes',
    async () => {
      await page
        .getByRole('group', { name: 'Constraints' })
        .getByRole('button', { name: 'Equal', exact: true })
        .click();
      for (const [x, y] of [
        [90, 20],
        [30, 60],
        [90, 60],
      ] as const) {
        await expect(toolPrompt(page)).toHaveText('Pick a line, circle or arc.');
        await click(30, 20);
        await click(x, y);
      }
      await page.keyboard.press('Escape');
    },
    async () => {
      await expect(dof).toHaveText('7 DOF left');
    },
  );

  await step(
    'dimension-plate',
    async () => {
      await page.keyboard.press('d');
      await dimension(
        page,
        click,
        [
          [50, 0],
          [50, -10],
        ],
        'width',
      );
      await dimension(
        page,
        click,
        [
          [0, 40],
          [-10, 40],
        ],
        'depth',
      );
    },
    async () => {
      await expect(page.locator('[data-dimension]')).toHaveText(['fx: 100.00', 'fx: 80.00']);
      await expect(dof).toHaveText('5 DOF left');
    },
  );

  await step(
    'dimension-holes',
    async () => {
      await dimension(
        page,
        click,
        [
          [20, 20],
          [80, 20],
          [50, 12],
        ],
        'spacing',
      );
      await dimension(
        page,
        click,
        [
          [20, 20],
          [20, 60],
          [50, 40],
        ],
        'depth - 2 * margin',
      );
      await dimension(
        page,
        click,
        [
          [0, 0],
          [20, 20],
          [10, -5],
        ],
        'margin',
      );
      await dimension(
        page,
        click,
        [
          [0, 0],
          [20, 20],
          [-5, 10],
        ],
        'margin',
      );
      await dimension(
        page,
        click,
        [
          [30, 20],
          [75, 40],
        ],
        'hole',
      );
      await page.keyboard.press('Escape');
      await expect(toolPrompt(page)).toHaveCount(0);
    },
    async () => {
      await expect(dof).toHaveText('Fully constrained ✓');
      expect(await counts(page)).toMatchObject({ constraints: 16, dimensions: 7 });
      await expect(page.locator('[data-dimension]')).toHaveText([
        'fx: 100.00',
        'fx: 80.00',
        'fx: 60.00',
        'fx: 40.00',
        'fx: 20.00',
        'fx: 20.00',
        'fx: ⌀6.00',
      ]);
    },
  );

  await step(
    'finish-sketch',
    async () => {
      await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
    },
    async () => {
      await expect(
        page.getByRole('list', { name: 'Features' }).getByRole('button', { name: /^Sketch1/ }),
      ).toBeVisible();
    },
  );

  await step(
    'extrude',
    async () => {
      // Select the plate's profile (between the holes), look at it from the front corner, then E.
      await kernelReady(page);
      const plate = (await mapping(viewport))(50, 40);
      await page.mouse.move(plate.x, plate.y);
      await page.mouse.click(plate.x, plate.y);
      await expect(viewport).toHaveAttribute('data-model-selection', /^profile:/);
      await homeView(page);
      await page.keyboard.press('e');
      await extrudeDialog.getByRole('textbox', { name: 'Distance', exact: true }).fill('thickness');
    },
    async () => {
      await expect(extrudeDialog).toBeVisible();
      await expect(extrudeDialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
      await expect(viewport).toHaveAttribute('data-preview', 'new');
    },
  );

  await step(
    'result',
    async () => {
      await extrudeDialog.getByRole('button', { name: 'OK' }).click();
      await expect(extrudeDialog).toBeHidden();
      await kernelReady(page);
    },
    async () => {
      // The plate's six faces and the four holes' walls.
      await expect(viewport).toHaveAttribute('data-bodies', 'Body1:10:100,80,5');
    },
  );

  await step(
    'change-parameters',
    async () => {
      await setParameters(page, { width: '120 mm', spacing: '70 mm', thickness: '6 mm' });
      await kernelReady(page);
    },
    async () => {
      await expect(viewport).toHaveAttribute('data-bodies', 'Body1:10:120,80,6');
    },
  );

  const exportDialog = page.getByRole('dialog', { name: 'Export model' });
  await step(
    'export-stl',
    async () => {
      await selectTab(page, '3D Print');
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await exportDialog.getByRole('radio', { name: /^STL/ }).check();
    },
    async () => {
      await expect(exportDialog.locator('[data-export-summary]')).toHaveAttribute(
        'data-export-summary',
        /1 body, \d+ triangles.*watertight/,
        { timeout: 20_000 },
      );
    },
  );

  // What the button then writes: one closed solid, 120 × 80 × 6 mm less four Ø6 holes.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportDialog.getByRole('button', { name: 'Export STL' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.stl$/);
  const facts = solidFacts(meshOfStl({ name: '', bytes: await readFile(await download.path()) }));
  expect(facts.size.map((v) => Math.round(v * 10) / 10)).toEqual([120, 80, 6]);
  const exact = 120 * 80 * 6 - 4 * Math.PI * 3 * 3 * 6;
  expect(Math.abs(facts.volume - exact) / exact).toBeLessThan(0.005);
});
