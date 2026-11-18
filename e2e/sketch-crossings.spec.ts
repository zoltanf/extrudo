import { expect, type Page, test } from '@playwright/test';
import {
  createDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  originPlaneRef,
  profileRefId,
  sketchInputs,
} from '../packages/core/src/index';
import { SketchBuilder } from '../packages/sketch/src/fixtures';
import {
  detectProfiles,
  TOO_MANY_CROSSINGS,
  TOO_MANY_CURVES,
} from '../packages/sketch/src/profiles/index';
import { writeArchive } from '../packages/storage/src/archive';
import { kernelReady, mapping } from './helpers';

// A sketch whose curves cross too often for its profiles to be found
// (ADR-0020's amendment of 2026-11-15) shows its curves without fills and
// says so in the palette; the extrude of one of its profiles fails with the
// reason. Deleting the crossing curves brings the profile and the extrude
// back. A sketch of too many curves (the amendment's second) says so too.
// The designs are built here, then imported.

const viewportOf = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });

/** The chords' circle: centre (100, 10), radius 30, beside the 40 × 20 rectangle at the origin. */
const CHORDS = { x: 100, y: 10, r: 30, n: 330 };

/** A 40 × 20 rectangle, then `chords` chords of a circle beside it that all cross: about chords²/2 crossings. */
function sketchOf(chords: number) {
  const b = new SketchBuilder();
  b.line(0, 0, 40, 0);
  b.line(40, 0, 40, 20);
  b.line(40, 20, 0, 20);
  b.line(0, 20, 0, 0);
  for (let i = 0; i < chords; i++) {
    const a = (Math.PI * i) / chords;
    b.line(
      CHORDS.x + CHORDS.r * Math.cos(a),
      CHORDS.y + CHORDS.r * Math.sin(a),
      CHORDS.x - CHORDS.r * Math.cos(a + 0.3),
      CHORDS.y - CHORDS.r * Math.sin(a + 0.3),
    );
  }
  return b.sketch;
}

/** Sketch1 (330 chords: about 54,000 crossings) and Extrude1 of its rectangle. */
function crossingsFile(chords = CHORDS.n): Buffer {
  return designFile(sketchOf(chords));
}

/** The rectangle, and a thousand circles of 1 m beside it, apart: two million points. */
function curvesFile(): Buffer {
  const data = sketchOf(0);
  const b = new SketchBuilder();
  for (let i = 0; i < 1000; i++) b.circle(5000 + (i % 40) * 2100, Math.floor(i / 40) * 2100, 1000);
  for (const [id, e] of Object.entries(b.sketch.entities))
    (data.entities as Record<string, unknown>)[`many-${id}`] =
      e.type === 'circle' ? { ...e, center: `many-${e.center}` } : e;
  return designFile(data);
}

function designFile(data: ReturnType<typeof sketchOf>): Buffer {
  // The rectangle's region: the same ID with or without the chords (they come after it).
  const region = detectProfiles(sketchOf(0))[0]?.id ?? '';
  const sketch = 's1' as FeatureId;
  const doc = createDocument({ name: 'Crossings' });
  const features: Feature[] = [
    {
      id: sketch,
      type: 'sketch',
      name: 'Sketch1',
      suppressed: false,
      inputs: sketchInputs(originPlaneRef('origin:xy'), data),
    },
    {
      id: 'e1' as FeatureId,
      type: 'extrude',
      name: 'Extrude1',
      suppressed: false,
      inputs: extrudeInputs([{ kind: 'profile', id: profileRefId(sketch, region) }], {
        distance: '5 mm',
      }),
    },
  ] as Feature[];
  return Buffer.from(writeArchive({ ...doc, features, timelineMarker: features.length }));
}

async function importDesign(page: Page, buffer: Buffer): Promise<void> {
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…', exact: true }).click(),
  ]);
  await chooser.setFiles({
    name: 'Crossings.extrudo',
    mimeType: 'application/octet-stream',
    buffer,
  });
  await expect(page).toHaveURL(/#\/p\/[^/]+$/);
}

test('a sketch with too many crossings says so, and gets its profiles back without them', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await importDesign(page, crossingsFile());
  await kernelReady(page);
  await expect(chip(page, 'Sketch1')).toHaveAttribute('data-feature-status', 'warning');
  await expect(chip(page, 'Extrude1')).toHaveAttribute('data-feature-status', 'error');

  // The sketch opens and shows its curves, no profiles, and why.
  await chip(page, 'Sketch1').dblclick();
  const palette = page.getByRole('region', { name: 'Sketch palette' });
  const problem = palette.locator('[data-sketch-problem]');
  await expect(problem).toHaveText(TOO_MANY_CROSSINGS);
  const viewport = viewportOf(page);
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=0 holes=0');

  // A window box around the chords (left to right) takes them, not the rectangle.
  await palette.getByRole('button', { name: 'Look at' }).click();
  await page.keyboard.press('F6');
  await page.waitForTimeout(500);
  const at = await mapping(viewport);
  const from = at(CHORDS.x - CHORDS.r - 3, CHORDS.y + CHORDS.r + 3);
  const to = at(CHORDS.x + CHORDS.r + 3, CHORDS.y - CHORDS.r - 3);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let k = 1; k <= 4; k++)
    await page.mouse.move(from.x + ((to.x - from.x) * k) / 4, from.y + ((to.y - from.y) * k) / 4);
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (
          (await page.locator('[data-selected-entities]').getAttribute('data-selected-entities')) ??
          ''
        )
          .split(' ')
          .filter(Boolean).length,
    )
    .toBeGreaterThanOrEqual(CHORDS.n);
  await page.keyboard.press('Delete');

  // The rectangle's profile is back, and with it the extrude.
  await expect(problem).toHaveCount(0);
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
  await palette.getByRole('button', { name: 'Finish Sketch' }).click();
  await expect(chip(page, 'Sketch1')).not.toHaveAttribute('data-feature-status', /./);
  await expect(chip(page, 'Extrude1')).not.toHaveAttribute('data-feature-status', /./);
  await expect(viewport).toHaveAttribute('data-bodies', /:40,20,5(\s|$)/);
});

test('a sketch with too many curves says so', async ({ page }) => {
  test.setTimeout(90_000);
  await importDesign(page, curvesFile());
  await kernelReady(page);
  await expect(chip(page, 'Sketch1')).toHaveAttribute('data-feature-status', 'warning');
  await expect(chip(page, 'Extrude1')).toHaveAttribute('data-feature-status', 'error');
  await chip(page, 'Sketch1').dblclick();
  const palette = page.getByRole('region', { name: 'Sketch palette' });
  await expect(palette.locator('[data-sketch-problem]')).toHaveText(TOO_MANY_CURVES);
  await expect(viewportOf(page)).toHaveAttribute('data-sketch-profiles', 'profiles=0 holes=0');
});
