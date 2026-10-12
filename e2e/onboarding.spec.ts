import { expect, type Page, test } from '@playwright/test';
import { viewportOf } from './benchmark-helpers';
import {
  kernelReady,
  newSketchOnXY,
  openProject,
  pickTool,
  selectTab,
  startFromTemplate,
} from './helpers';

// P3-12: the rest of the onboarding (ADR-0052): the template gallery, the
// hint over an empty design, and the tool tooltips with their demo clips.
// The tutorial itself is in tutorial.spec.ts.

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

// The page's types aren't available here (e2e/ has no DOM library): a video's two facts.
type Playback = { readyState: number; paused: boolean };
const readyState = (v: unknown) => (v as Playback).readyState;
const paused = (v: unknown) => (v as Playback).paused;

const projectName = (page: Page, name: string) =>
  page.getByRole('button', { name: `Project name: ${name}. Rename` });

test('the gallery offers four templates, each opens as a copy with its name and picture', async ({
  page,
}) => {
  await page.goto('./');
  const gallery = page.getByRole('list', { name: 'Templates' });
  await expect(gallery.getByRole('button')).toHaveCount(4);
  for (const [name, text] of [
    ['Wall bracket', /Parameters, fillets/],
    ['Storage box', /open box cut from a solid/],
    ['Box with a lid', /Two bodies that fit/],
    ['PCB enclosure', /Screw posts/],
  ] as const) {
    const card = gallery.getByRole('button', { name: `Start from the ${name} template` });
    await expect(card).toHaveAccessibleDescription(text);
    // A picture that loaded.
    await expect(card.locator('img')).toHaveJSProperty('complete', true);
  }

  // A file template (B4): two bodies, named like its parts.
  await gallery.getByRole('button', { name: 'Start from the Box with a lid template' }).click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  const viewport = viewportOf(page);
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await kernelReady(page);
  await expect(projectName(page, 'Box with a lid')).toBeVisible();
  await expect(viewport).toHaveAttribute('data-bodies', /Box:\d+:.* Lid:\d+:/);

  // Opening the same template again makes a second design, not the first one again.
  await page.goto('./');
  await startFromTemplate(page, 'Box with a lid');
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await kernelReady(page);
  await page.goto('./');
  const designs = page.getByRole('list', { name: 'Designs' });
  await expect(designs.getByRole('listitem')).toHaveCount(2);
  await expect(designs.getByRole('link', { name: 'Box with a lid' })).toHaveCount(2);
  // Each card has the template's picture.
  await expect(designs.locator('img')).toHaveCount(2);

  // The others open too: the wall bracket (code) and the enclosure (file).
  await startFromTemplate(page, 'PCB enclosure');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', /Enclosure:\d+:.* Lid:\d+:/);
});

// R3-15 (the owner's UI review 3): the hint that pointed an empty design at Create Sketch
// is gone; the tutorial stays.
test('an empty design shows no hint', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await expect(page.getByRole('note', { name: 'How to start' })).toHaveCount(0);
  await expect(page.getByText('Start with a sketch')).toHaveCount(0);
  await pickTool(page, 'Create Sketch');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Start with a sketch')).toHaveCount(0);
});

test('a toolbar tooltip has the name, the key, a sentence and a looping demo', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  const tooltip = page.getByRole('tooltip');

  await page.getByRole('button', { name: 'Extrude' }).hover();
  await expect(tooltip).toContainText('Extrude');
  await expect(tooltip.locator('kbd')).toHaveText('E');
  await expect(tooltip).toContainText('Pull a profile into a solid, or push and pull a flat face.');
  const video = tooltip.locator('video[data-tool-demo="extrude"]');
  await expect(video).toHaveAttribute('src', /demos\/extrude\.webm$/);
  // Muted and looping, so the browser lets it play by itself; hidden from assistive tech.
  await expect(video).toHaveJSProperty('muted', true);
  await expect(video).toHaveJSProperty('loop', true);
  await expect(video).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(() => video.evaluate(readyState)).toBeGreaterThan(1);
  await expect.poll(() => video.evaluate(paused)).toBe(false);

  // A tool without a clip has the words alone.
  // (The pointer travels: a single jump leaves the tooltip's grace area open.)
  await page.mouse.move(700, 500, { steps: 5 });
  await expect(tooltip).toHaveCount(0);
  await selectTab(page, 'Modify');
  await page.mouse.move(700, 500, { steps: 5 });
  await expect(tooltip).toHaveCount(0);
  await page.getByRole('button', { name: 'Chamfer' }).hover();
  await expect(tooltip).toContainText('Bevel the selected edges.');
  await expect(tooltip.locator('video[data-tool-demo="chamfer"]')).toHaveAttribute(
    'src',
    /demos\/chamfer\.webm$/,
  );
  await page.mouse.move(700, 500, { steps: 5 });
  await expect(tooltip).toHaveCount(0);
  // Construct's tools get their clips in a later batch (R3-16).
  await selectTab(page, 'Construct');
  await page.mouse.move(700, 500, { steps: 5 });
  await expect(tooltip).toHaveCount(0);
  await page.getByRole('button', { name: 'Offset Plane', exact: true }).hover();
  await expect(tooltip).toContainText('Offset Plane');
  await expect(tooltip.locator('video')).toHaveCount(0);
});

// R3-16: the owner saw an empty box where the Sketch Dimension tile's clip plays (on edge, in
// the light theme, where the box before the first frame is white). Here it loads and plays.
test('the Dimension tile’s clip loads and plays in a sketch, in the light theme', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openProject(page);
  await kernelReady(page);
  await newSketchOnXY(page);
  await page.locator('[data-tool="dimension"]').first().hover();
  const video = page.getByRole('tooltip').locator('video[data-tool-demo="dimension"]');
  await expect(video).toHaveAttribute('src', /demos\/dimension\.webm$/);
  await expect.poll(() => video.evaluate(readyState)).toBeGreaterThan(1);
  await expect.poll(() => video.evaluate(paused)).toBe(false);
  expect(await video.evaluate((v) => (v as { videoWidth: number }).videoWidth)).toBe(480);
});

test('with reduced motion a demo is a still, and it loads only when its tooltip opens', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requested: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/demos/')) requested.push(request.url());
  });
  await openProject(page);
  await kernelReady(page);
  // No clip is fetched until a tooltip asks for it.
  expect(requested).toEqual([]);

  await selectTab(page, 'Modify');
  await page.getByRole('button', { name: 'Fillet' }).hover();
  const video = page.getByRole('tooltip').locator('video[data-tool-demo="fillet"]');
  await expect(video).toHaveAttribute('data-playing', 'false');
  await expect(video).toHaveJSProperty('autoplay', false);
  await expect.poll(() => requested.length).toBeGreaterThan(0);
  await expect.poll(() => video.evaluate(readyState)).toBeGreaterThan(0);
  expect(await video.evaluate(paused)).toBe(true);
});

test('a demo that can’t be loaded leaves the words', async ({ page }) => {
  await page.route('**/demos/**', (route) => route.abort());
  await openProject(page);
  await page.getByRole('button', { name: 'Create Sketch' }).hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('Draw a 2D profile on a plane or a flat face.');
  await expect(tooltip.locator('video')).toHaveCount(0);
});
