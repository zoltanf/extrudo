import { expect, test } from '@playwright/test';
import {
  addParameter,
  attr,
  bodies,
  chip,
  clickWhere,
  closeParameters,
  dimension,
  expectBody,
  expectNoProblems,
  hideConstraints,
  homeView,
  ok,
  openParameters,
  pickAxis,
  renameBody,
  renameProject,
  setParameters,
  settled,
  toolPrompt,
  turnView,
  viewportOf,
  zoomOutTo,
} from '../benchmark-helpers';
import { clicker, kernelReady, openProject, pickTool, projector } from '../helpers';
import { tutorial } from './step';

// Tutorial 4, docs/guide/tutorials/bottle-cap.md: a threaded bottle cap and the adapter that
// screws into it. It is benchmark B9's flow (e2e/benchmark-b9.spec.ts, same helpers) with
// the fixture and the 3MF checks left out, one `step` per heading of the page (ADR-0080 §4).

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 240_000 });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('Tutorial 4: a threaded bottle cap', async ({ page }) => {
  const { step } = tutorial(page, 'bottle-cap');
  const viewport = viewportOf(page);
  const palette = page.getByRole('region', { name: 'Sketch palette' });
  const createSketch = page.getByRole('region', { name: 'Create Sketch' });
  let clickXZ: (x: number, y: number) => Promise<void> = async () => {};
  let below: Awaited<ReturnType<typeof turnView>>;

  await step(
    'parameters',
    async () => {
      await openProject(page);
      await kernelReady(page);
      await renameProject(page, 'Bottle cap');
      await openParameters(page);
      await addParameter(page, 'capDia', '32 mm');
      await addParameter(page, 'capHeight', '14 mm');
      await addParameter(page, 'wall', '2 mm');
      await addParameter(page, 'adapterLow', '20 mm');
      await addParameter(page, 'stepHeight', '10 mm');
    },
    async () => {
      await expect(
        page
          .getByRole('dialog', { name: 'Parameters' })
          .getByRole('textbox', { name: 'Expression of stepHeight', exact: true }),
      ).toHaveAccessibleDescription('= 10.00 mm');
    },
  );

  await step(
    'cap-sketch',
    async () => {
      await closeParameters(page);
      await pickTool(page, 'Create Sketch');
      await createSketch.getByRole('button', { name: 'XZ' }).click();
      await settled(viewport);
      const xz = await projector(viewport);
      clickXZ = clicker(page, (x, y) => xz([x, 0, y]));
      await hideConstraints(page);
      await page.keyboard.press('r');
      await clickXZ(0, 0);
      await clickXZ(20, 20);
      await page.keyboard.press('Escape');
      await expect(toolPrompt(page)).toHaveCount(0);
    },
    async () => {
      await expect(viewport).toHaveAttribute('data-camera-direction', '0,1,0');
      await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
    },
  );

  await step(
    'cap-dimensions',
    async () => {
      await page.keyboard.press('d');
      await dimension(
        page,
        clickXZ,
        [
          [10, 20],
          [10, 27],
        ],
        'capDia / 2',
      );
      await dimension(
        page,
        clickXZ,
        [
          // The first dimension moved the right side to x = 16.
          [16, 10],
          [23, 10],
        ],
        'capHeight',
      );
      await page.keyboard.press('Escape');
      await expect(toolPrompt(page)).toHaveCount(0);
    },
    async () => {
      await expect(palette).toContainText('Fully constrained');
    },
  );

  const revolve = page.getByRole('region', { name: 'Revolve dialog' });
  await step(
    'revolve',
    async () => {
      await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
      await expect(chip(page, 'Sketch1')).toBeVisible();
      await kernelReady(page);
      const xz = await projector(viewport);
      const inside = xz([8, 0, 7]);
      await page.mouse.move(inside.x, inside.y);
      await page.mouse.click(inside.x, inside.y);
      await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
      await pickTool(page, 'Revolve');
      await pickAxis(page, xz, 'z', [25, 30, 35, 40, 45, -10, -15]);
    },
    async () => {
      await expect(revolve.getByRole('button', { name: 'Axis', exact: true })).toHaveText('Z axis');
      await expect(revolve).toHaveAttribute('data-preview-status', 'ok', { timeout: 30_000 });
    },
  );

  await step(
    'cap-body',
    async () => {
      await ok(page, revolve);
      await renameBody(page, 'Body1', 'Cap');
      await homeView(page);
    },
    async () => {
      await expectBody(page, 'Cap', [32, 32, 14], 3);
    },
  );

  await step(
    'shell',
    async () => {
      below = await turnView(page, 'Shift+3');
      await clickWhere(page, below, [0, 0, 0], /^face:/);
      await pickTool(page, 'Shell');
      const shell = page.getByRole('region', { name: 'Shell dialog' });
      await expect(shell.getByRole('button', { name: 'Faces to remove', exact: true })).toHaveText(
        '1 face',
      );
      await shell.getByRole('textbox', { name: 'Thickness', exact: true }).fill('wall');
      await ok(page, shell);
    },
    async () => {
      await expectBody(page, 'Cap', [32, 32, 14], 5);
    },
  );

  await step(
    'cap-thread',
    async () => {
      await clickWhere(page, below, [-13.5, 0, 6], /^face:/);
      await pickTool(page, 'Thread');
      const thread = page.getByRole('region', { name: 'Thread dialog' });
      await expect(thread.getByRole('button', { name: 'Faces', exact: true })).toHaveText('1 face');
      await expect(thread.getByRole('combobox', { name: 'Size' })).toHaveValue('auto');
      await expect(thread).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
      await ok(page, thread);
    },
    async () => {
      await expect(chip(page, 'Thread1')).toHaveAccessibleName('Thread1');
      await expectBody(page, 'Cap', [32, 32, 14]);
      expect((await bodies(page)).Cap?.faces).toBeGreaterThan(10);
    },
  );

  let clickBelow: (x: number, y: number) => Promise<void> = async () => {};
  await step(
    'adapter-sketch',
    async () => {
      await pickTool(page, 'Create Sketch');
      await createSketch.getByRole('button', { name: 'XZ' }).click();
      await settled(viewport);
      // The section reaches 30 mm below the cap: zoom out around the middle of the view.
      const box = await viewport.boundingBox();
      if (!box) throw new Error('no viewport');
      await zoomOutTo(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 100);
      const at = await projector(viewport);
      clickBelow = clicker(page, (x, y) => at([x, 0, y]));
      await hideConstraints(page);
      await pickTool(page, 'Point');
      await clickBelow(0, 0);
      await page.keyboard.press('Escape');
      await expect(toolPrompt(page)).toHaveCount(0);
      await page.keyboard.press('l');
      for (const [x, y] of [
        [0, -30],
        [10, -30],
        [10, -20],
        [20, -20],
        [20, -10],
        [0, -10],
        [0, -30],
      ] as const) {
        await clickBelow(x, y);
      }
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(toolPrompt(page)).toHaveCount(0);
    },
    async () => {
      await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
    },
  );

  await step(
    'adapter-dimensions',
    async () => {
      await page.keyboard.press('d');
      await dimension(
        page,
        clickBelow,
        [
          [0, 0],
          [10, -30],
          [15, -16],
        ],
        '3 * stepHeight',
      );
      await dimension(
        page,
        clickBelow,
        [
          [0, 0],
          [10, -30],
          [5, 8],
        ],
        'adapterLow / 2',
      );
      await dimension(
        page,
        clickBelow,
        [
          [10, -25],
          [26, -25],
        ],
        'stepHeight',
      );
      await dimension(
        page,
        clickBelow,
        [
          [20, -15],
          [26, -15],
        ],
        'stepHeight',
      );
      await dimension(
        page,
        clickBelow,
        [
          [10, -10],
          [10, -3],
        ],
        'capDia / 2 - wall',
      );
      await page.keyboard.press('Escape');
      await expect(toolPrompt(page)).toHaveCount(0);
    },
    async () => {
      await expect(palette).toContainText('Fully constrained');
    },
  );

  await step(
    'adapter-revolve',
    async () => {
      await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
      await expect(chip(page, 'Sketch2')).toBeVisible();
      const at = await projector(viewport);
      const inStep = at([5, 0, -25]);
      await page.mouse.move(inStep.x, inStep.y);
      await page.mouse.click(inStep.x, inStep.y);
      await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
      await pickTool(page, 'Revolve');
      const revolve = page.getByRole('region', { name: 'Revolve dialog' });
      await revolve.getByRole('combobox', { name: 'Operation' }).selectOption('new-body');
      await pickAxis(page, at, 'z', [-35, -40, -45, 35, 40, 45]);
      await expect(revolve.getByRole('button', { name: 'Axis', exact: true })).toHaveText('Z axis');
      await ok(page, revolve);
      await renameBody(page, 'Body1', 'Adapter');
    },
    async () => {
      await expectBody(page, 'Adapter', [28, 28, 20], 5);
    },
  );

  await step(
    'adapter-threads',
    async () => {
      const front = await turnView(page, 'Shift+4');
      await clickWhere(page, front, [0, -10, -25], /^face:/);
      await pickTool(page, 'Thread');
      const thread = page.getByRole('region', { name: 'Thread dialog' });
      await expect(thread.getByRole('button', { name: 'Faces', exact: true })).toHaveText('1 face');
      await clickWhere(page, front, [0, -14, -15], /^face:/);
      await expect(thread.getByRole('button', { name: 'Faces', exact: true })).toHaveText(
        '2 faces',
      );
      await expect(thread).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
      await ok(page, thread);
    },
    async () => {
      await expect(chip(page, 'Thread2')).toHaveAccessibleName('Thread2');
      await expectBody(page, 'Cap', [32, 32, 14]);
      await expectBody(page, 'Adapter', [23.8, 23.8, 20]);
      await expectNoProblems(page);
    },
  );

  await step(
    'change-parameters',
    async () => {
      await setParameters(page, { capDia: '40 mm', adapterLow: '24 mm' });
      await kernelReady(page);
    },
    async () => {
      await expectNoProblems(page);
      await expectBody(page, 'Cap', [40, 40, 14]);
      await expectBody(page, 'Adapter', [35.8, 35.8, 20]);
    },
  );
});
