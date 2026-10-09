import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  addParameter,
  attr,
  chip,
  closeParameters,
  dimension,
  homeView,
  meshOfStl,
  openParameters,
  renameProject,
  setParameters,
  settled,
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
  pickTool,
  projector,
  selectTab,
} from '../helpers';
import { tutorial } from './step';
import { MIDDLE, panTo } from './view';

// Tutorial 2, docs/guide/tutorials/storage-box.md: a parametric storage box cut from a
// solid. It is benchmark B2's flow (e2e/benchmark-b2.spec.ts) without the fixture, one
// `step` per heading of the page (ADR-0080 §4). Reuses the benchmark helpers as they are.

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

/** The box's volume: the block less the cavity (mm³). */
const boxVolume = (w: number, d: number, h: number, wall: number, bottom: number) =>
  w * d * h - (w - 2 * wall) * (d - 2 * wall) * (h - bottom);

test('Tutorial 2: a storage box', async ({ page }) => {
  const { step } = tutorial(page, 'storage-box');
  const viewport = viewportOf(page);
  const parameters = page.getByRole('dialog', { name: 'Parameters' });
  const palette = page.getByRole('region', { name: 'Sketch palette' });
  const extrudeDialog = page.getByRole('region', { name: 'Extrude dialog' });
  let click: (x: number, y: number) => Promise<void> = async () => {};
  let world: Awaited<ReturnType<typeof projector>>;
  let onFace: (x: number, y: number) => { x: number; y: number } = () => ({ x: 0, y: 0 });
  let clickFace: (x: number, y: number) => Promise<void> = async () => {};

  await step(
    'parameters',
    async () => {
      await openProject(page);
      await renameProject(page, 'Storage box');
      await openParameters(page);
      await addParameter(page, 'width', '80 mm');
      await addParameter(page, 'depth', '60 mm');
      await addParameter(page, 'height', '40 mm');
      await addParameter(page, 'wall', '3 mm');
      await addParameter(page, 'bottom', '4 mm');
    },
    async () => {
      await expect(
        parameters.getByRole('textbox', { name: 'Expression of wall', exact: true }),
      ).toHaveValue('3 mm');
      await expect(
        parameters.getByRole('textbox', { name: 'Expression of bottom', exact: true }),
      ).toHaveValue('4 mm');
    },
  );

  await step(
    'create-sketch',
    async () => {
      await closeParameters(page);
      const home = await newSketchOnXY(page);
      await zoomOutTo(page, home(40, 30), 200);
      // The block's footprint sits in the middle of the free part of the view, clear of the palette.
      await panTo(page, home(40, 30));
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
      await click(80, 60);
      await page.keyboard.press('Escape');
      await expect(toolPrompt(page)).toHaveCount(0);
    },
    async () => {
      expect(await counts(page)).toMatchObject({ lines: 4, circles: 0 });
    },
  );

  await step(
    'dimension',
    async () => {
      await page.keyboard.press('d');
      await dimension(
        page,
        click,
        [
          [40, 0],
          [40, -10],
        ],
        'width',
      );
      await dimension(
        page,
        click,
        [
          [0, 30],
          [-10, 30],
        ],
        'depth',
      );
      await page.keyboard.press('Escape');
      await expect(toolPrompt(page)).toHaveCount(0);
    },
    async () => {
      await expect(palette).toContainText('Fully constrained');
      await expect(page.locator('[data-dimension]')).toHaveText(['fx: 80.00', 'fx: 60.00']);
    },
  );

  await step(
    'extrude-base',
    async () => {
      await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
      await expect(chip(page, 'Sketch1')).toBeVisible();
      await kernelReady(page);
      const inside = (await mapping(viewport))(40, 30);
      await page.mouse.move(inside.x, inside.y);
      await page.mouse.click(inside.x, inside.y);
      await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
      // Look at it from the corner, so the preview shows a block and not a flat outline.
      await homeView(page);
      await page.keyboard.press('e');
      await expect(extrudeDialog).toBeVisible();
      await expect(extrudeDialog.getByRole('combobox', { name: 'Operation' })).toHaveValue(
        'new-body',
      );
      await extrudeDialog.getByRole('textbox', { name: 'Distance', exact: true }).fill('height');
      // The view was fitted to the flat outline: step back and centre, so the 40 mm block fits.
      await settled(viewport);
      const block = (await projector(viewport))([40, 30, 20]);
      await zoomOutTo(page, block, Number(await viewport.getAttribute('data-camera-size')) * 1.5);
      await panTo(page, (await projector(viewport))([40, 30, 20]));
    },
    async () => {
      await expect(extrudeDialog).toHaveAttribute('data-preview-status', 'ok', {
        timeout: 15_000,
      });
      await expect(viewport).toHaveAttribute('data-preview', 'new');
    },
  );

  await step(
    'result',
    async () => {
      await extrudeDialog.getByRole('button', { name: 'OK' }).click();
      await expect(extrudeDialog).toBeHidden();
      await kernelReady(page);
      await homeView(page);
    },
    async () => {
      await expect(chip(page, 'Extrude1')).toBeVisible();
      await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:80,60,40');
    },
  );

  await step(
    'sketch-on-face',
    async () => {
      await homeView(page);
      await pickTool(page, 'Create Sketch');
      await expect(page.getByRole('region', { name: 'Create Sketch' })).toContainText('flat face');
      const top = (await projector(viewport))([40, 30, 40]);
      await page.mouse.move(top.x, top.y);
      await page.mouse.click(top.x, top.y);
      await expect(chip(page, 'Sketch2')).toBeVisible();
      await settled(viewport);
      // The sketch opens fitted to the face, which then fills the view: centre it and zoom
      // out until it has margin round it.
      const faceCentre = (await projector(viewport))([40, 30, 40]);
      await panTo(page, faceCentre);
      await zoomOutTo(page, MIDDLE, 150);
      await settled(viewport);
    },
    async () => {
      await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
      await expect(chip(page, 'Sketch2')).toBeVisible();
    },
  );

  await step(
    'project',
    async () => {
      await page.keyboard.press('p');
      world = await projector(viewport);
      const face = world([40, 30, 40]);
      await page.mouse.move(face.x, face.y);
      await expect.poll(() => attr(viewport, 'data-model-hover')).toMatch(/^face:/);
      await page.mouse.click(face.x, face.y);
      await expect
        .poll(() => attr(viewport, 'data-sketch-projected'))
        .toMatch(/:curves=4:x=0\.\.80:y=0\.\.60$/);
      await page.keyboard.press('Escape');
      await expect(toolPrompt(page)).toHaveCount(0);
    },
    async () => {
      await expect(viewport).toHaveAttribute('data-sketch-projected', /:curves=4:/);
    },
  );

  await step(
    'offset',
    async () => {
      // The face is already in the middle with margin; this only guards the nav bar.
      await zoomOutTo(page, world([40, 30, 40]), 150);
      const flat = await projector(viewport);
      onFace = (x: number, y: number) => flat([x, y, 40]);
      clickFace = clicker(page, onFace);
      await page.keyboard.press('o');
      await expect(toolPrompt(page)).toBeVisible();
      await clickFace(40, 0);
      await expect(toolPrompt(page)).toContainText('Move to the side to offset to');
      const inner = onFace(40, 10);
      await page.mouse.move(inner.x, inner.y);
      await page.keyboard.type('3');
      await page.keyboard.press('Enter');
      await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=2 holes=1');
      await page.keyboard.press('Escape');
      await expect(toolPrompt(page)).toHaveCount(0);
      await expect(page.locator('[data-dimension]')).toHaveCount(4);
      await page.locator('[data-dimension]').first().dblclick();
      const distance = page.getByRole('textbox', { name: /^Value of d\d+$/ });
      await expect(distance).toBeFocused();
      await distance.fill('wall');
      await distance.press('Enter');
      await expect(page.locator('[data-dimension-editor]')).toHaveCount(0);
    },
    async () => {
      await expect(page.locator('[data-dimension]')).toHaveText(Array(4).fill('fx: 3.00'));
      await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=2 holes=1');
    },
  );

  await step(
    'cut',
    async () => {
      await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
      await expect(chip(page, 'Sketch2')).toBeVisible();
      await kernelReady(page);
      const middle = onFace(40, 30);
      await page.mouse.move(middle.x, middle.y);
      await page.mouse.click(middle.x, middle.y);
      await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
      await page.keyboard.press('e');
      const cut = page.getByRole('region', { name: 'Extrude dialog' });
      await expect(cut).toBeVisible();
      await cut.getByRole('combobox', { name: 'Operation' }).selectOption('cut');
      await cut.getByRole('textbox', { name: 'Distance', exact: true }).fill('-(height - bottom)');
      await expect(viewport).toHaveAttribute('data-preview', 'cut', { timeout: 15_000 });
      await expect(cut).toHaveAttribute('data-preview-status', 'ok');
      await cut.getByRole('button', { name: 'OK' }).click();
      await expect(cut).toBeHidden();
      await kernelReady(page);
      await homeView(page);
    },
    async () => {
      await expect(chip(page, 'Extrude2')).toBeVisible();
      // Outside four, inside four, the floor, the bottom and the rim: eleven faces.
      await expect(viewport).toHaveAttribute('data-bodies', 'Body1:11:80,60,40');
    },
  );

  await step(
    'change-parameters',
    async () => {
      await setParameters(page, { width: '100 mm', depth: '70 mm', wall: '4 mm' });
      await kernelReady(page);
      await homeView(page);
    },
    async () => {
      await expect(viewport).toHaveAttribute('data-bodies', 'Body1:11:100,70,40');
    },
  );

  const exportDialog = page.getByRole('dialog', { name: 'Export model' });
  await step(
    'export',
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

  // What the button then writes: one closed solid, 100 × 70 × 40 mm less the 4 mm-walled cavity.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportDialog.getByRole('button', { name: 'Export STL' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.stl$/);
  const facts = solidFacts(meshOfStl({ name: '', bytes: await readFile(await download.path()) }));
  expect(facts.size.map((v) => Math.round(v * 10) / 10)).toEqual([100, 70, 40]);
  const exact = boxVolume(100, 70, 40, 4, 4);
  expect(Math.abs(facts.volume - exact) / exact).toBeLessThan(0.005);
});
