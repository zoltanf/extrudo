import { expect, type Page, test } from '@playwright/test';
import {
  DRESSUP_CASES,
  type DressUpFixtureFeature,
  dressUpSpec,
} from '../packages/fcstd/src/dressup-fixtures';
import { type FixtureObject, label, links, prop } from '../packages/fcstd/src/fixtures';
import {
  choice,
  historyFile,
  linkSub,
  num,
  rectangle,
} from '../packages/fcstd/src/history-fixtures';
import { BREP, PATTERN_CASES } from '../packages/fcstd/src/pattern-fixtures';
import { partObjects } from '../packages/fcstd/src/pattern-parts';
import { shapesFile } from '../packages/fcstd/src/shape-fixtures';
import { circle } from '../packages/fcstd/src/sketch-fixtures';
import { STEP_FIXTURES } from '../packages/fcstd/src/step-parts';
import { boxBrep } from '../packages/kernel/src/read-brep-test-support';

// The FreeCAD import (P6-25 S3, S5, S6, S7 and S8, ADR-0144): its worker reads
// the file and its own kernel worker turns each stored shape into STEP, and
// rebuilds each PartDesign body's features against the shapes the file
// stores, finding a fillet's edges on the rebuilt body, stepping a
// pattern along a sketch's axis and carrying a body on from the stored
// shape of a feature it doesn't rebuild. The files are the
// package's authored fixtures (hand-written XML, the kernel's own test
// shapes, small parts we made with FreeCAD), never a sample.

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function importFile(page: Page, name: string, buffer: Buffer) {
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…', exact: true }).click(),
  ]);
  await chooser.setFiles({ name, mimeType: 'application/octet-stream', buffer });
}

const browserOf = (page: Page) => page.getByRole('complementary', { name: 'Browser' });
const bodyLeaf = (page: Page, name: string) =>
  browserOf(page)
    .locator('[data-body]')
    .filter({ has: page.getByRole('button', { name, exact: true }) });

test("a FreeCAD file opens as a new design with the file's shapes as bodies", async ({ page }) => {
  test.setTimeout(120_000);
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await importFile(page, 'Shapes.FCStd', Buffer.from(shapesFile()));
  await expect(page).toHaveURL(/#\/p\/[^/]+$/, { timeout: 60_000 });
  await expect(
    page.getByText('Imported from the FreeCAD file: 9 of 11 shapes, as bodies without history.'),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Not imported: Scan (a mesh, which Extrudo doesn't import from FreeCAD files yet); Empty body (no shape).",
    ),
  ).toBeVisible();
  for (const name of [
    'Bracket',
    'Holed box',
    'Red box',
    'Moved box',
    'Holed box copy',
    'Pair',
    'Pair 2',
  ])
    await expect(bodyLeaf(page, name)).toHaveAttribute('data-body-display', 'shown', {
      timeout: 60_000,
    });
  await expect(bodyLeaf(page, 'Hidden box')).toHaveAttribute('data-body-display', 'hidden');
  expect(workers.some((url) => /fcstdWorker/.test(url))).toBe(true);
});

test("a file that isn't a FreeCAD file says why, and the page stays", async ({ page }) => {
  await importFile(page, 'Broken.FCStd', Buffer.from('not a zip at all, just text'));
  await expect(page.getByRole('alert')).toContainText(
    "Import failed: This file can't be read as a FreeCAD file",
  );
  await expect(page.getByRole('button', { name: 'Import…', exact: true })).toBeEnabled();
});

/**
 * S8's `mid_draft` part (pad, pocket, Draft, pocket, fillet: FreeCAD's own
 * shapes) as a body labelled Bridge, moved 100 mm along -y so that it touches
 * no other body; its objects' names get `_s8` (not their labels) so they
 * don't clash with the other bodies'.
 */
function bridge(): { objects: FixtureObject[]; entries: Record<string, string> } {
  const { objects, entries } = partObjects(
    'mid_draft',
    {},
    {
      fixtures: STEP_FIXTURES,
      bodyAt: [0, -100, 0],
    },
  );
  const names = new Set(objects.map((o) => o.name));
  const rename = (xml: string) =>
    xml.replace(/(<Link value="|<LinkSub value="|obj="|file=")([^".]+)/g, (all, head, name) =>
      names.has(name) ? `${head}${name}_s8` : all,
    );
  return {
    objects: objects.map((o) => ({
      ...o,
      name: `${o.name}_s8`,
      props:
        o.name === 'Body'
          ? [label('Bridge'), ...o.props.slice(1).map(rename)]
          : o.props.map(rename),
    })),
    entries: Object.fromEntries(
      Object.entries(entries).map(([k, v]) => [k.replace(/^([^.]+)/, '$1_s8'), v as string]),
    ),
  };
}

/**
 * Five bodies: Bracket, a pad and a pocket that rebuild equal to what the
 * file stores; Lid, a pad with one edge filleted, FreeCAD's own shapes (S6);
 * Plate, a pad and then a thickness (not rebuilt yet); and Rail, the
 * `linear_h_axis` part FreeCAD made (S7: a plate, a pocket and a row of
 * three of it along the pocket sketch's H axis), its body moved 40 mm along
 * y so that it touches no other body; and Bridge (`bridge`, S8), which takes
 * a stored-shape step at its Draft and rebuilds the pocket and the fillet after it.
 */
function historyBytes(): Buffer {
  const at = (x: number, z: number) => boxBrep([x, 0, 0], [x + 10, 20, z]);
  const [pad, fillet] = DRESSUP_CASES.fillet_one_edge as [
    DressUpFixtureFeature,
    DressUpFixtureFeature,
  ];
  const rail = PATTERN_CASES.linear_h_axis;
  const stored = (object: string) =>
    BREP[rail?.objects.find((o) => o.object === object)?.stored as number] as string;
  const s8 = bridge();
  return Buffer.from(
    historyFile(
      [
        {
          name: 'Body',
          label: 'Bracket',
          sketches: [
            { name: 'Sketch', geometry: rectangle(40, 0, 50, 20) },
            { name: 'Sketch001', geometry: rectangle(39, -1, 51, 21), placement: [0, 0, 30] },
          ],
          features: [
            { name: 'Pad', type: 'Pad', length: 30, stored: at(40, 30) },
            { name: 'Pocket', type: 'Pocket', sketch: 'Sketch001', length: 10, stored: at(40, 20) },
          ],
        },
        {
          name: 'Body001',
          label: 'Lid',
          sketches: [{ name: 'Sketch002', geometry: rectangle(0, 0, 10, 20) }],
          features: [
            { name: 'Pad001', type: 'Pad', sketch: 'Sketch002', length: 30, stored: pad.stored },
            dressUpSpec(fillet, { base: 'Pad001' }),
          ],
        },
        {
          name: 'Body002',
          label: 'Plate',
          sketches: [{ name: 'Sketch003', geometry: rectangle(80, 0, 90, 20) }],
          features: [
            { name: 'Pad002', type: 'Pad', sketch: 'Sketch003', length: 5, stored: at(80, 5) },
            { name: 'Thickness', type: 'PartDesign::Thickness', stored: at(80, 5) },
          ],
        },
        {
          name: 'Body003',
          label: 'Rail',
          placement: [0, 40, 0],
          sketches: [
            { name: 'Sketch004', geometry: rectangle(0, 0, 40, 20) },
            { name: 'Sketch005', geometry: [circle(6, 10, 2)], placement: [0, 0, 10] },
          ],
          features: [
            { name: 'Pad003', type: 'Pad', sketch: 'Sketch004', length: 10, stored: stored('Pad') },
            {
              name: 'Pocket003',
              type: 'Pocket',
              sketch: 'Sketch005',
              length: 4,
              stored: stored('Pocket'),
            },
            {
              name: 'LinearPattern',
              type: 'PartDesign::LinearPattern',
              omit: ['Profile', 'Type', 'Reversed', 'Midplane', 'Length', 'Length2'],
              props: [
                links('Originals', ['Pocket003']),
                linkSub('Direction', 'Sketch005', ['H_Axis']),
                choice('Mode', 0),
                num('Length', 28),
                prop('Occurrences', 'App::PropertyIntegerConstraint', '<Integer value="3"/>'),
              ],
              stored: stored('LinearPattern'),
            },
          ],
        },
      ],
      { extra: s8.objects, entries: s8.entries },
    ),
  );
}

test('PartDesign bodies come in with their history, or as far as it rebuilds', async ({ page }) => {
  test.setTimeout(120_000);
  await importFile(page, 'History.FCStd', historyBytes());
  await expect(page).toHaveURL(/#\/p\/[^/]+$/, { timeout: 60_000 });
  await expect(
    page.getByText(
      'Imported from the FreeCAD file: 5 of 5 shapes, 3 with their history, 1 with part of its history and 1 as a body without history.',
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Rebuilt on the file's own shape part way through: Bridge, because it has a feature Extrudo doesn't rebuild from FreeCAD files yet. The features after that point come in with their history; the ones before it stay in the timeline but no longer shape the body.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Taken from the file's own shapes, without their whole history: Plate, because it has a feature Extrudo doesn't rebuild from FreeCAD files yet. The features rebuilt before that stay in the timeline, ahead of a Remove that takes out what they made.",
    ),
  ).toBeVisible();
  const chips = page.getByRole('list', { name: 'Features' }).locator('[data-timeline-item="chip"]');
  // Bracket: its two sketches (one on a plane at the pocket's height) and both features, no import.
  // Lid: its sketch, pad and fillet, no import. Plate: its sketch and pad, then the Remove of
  // what they made and the file's shape. Rail: its sketches, pad, pocket and the pattern, no import.
  // Bridge: its pad and pocket (its pocket sketch on Sketch005's plane, also at z = 10), the Remove
  // of what they made and the Draft's stored shape, then the pocket and the fillet rebuilt on that.
  await expect
    .poll(() => chips.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))), {
      timeout: 60_000,
    })
    .toEqual([
      'Sketch',
      'Pad',
      'Sketch001 plane',
      'Sketch001',
      'Pocket',
      'Sketch002',
      'Pad001',
      'Fillet',
      'Sketch003',
      'Pad002',
      'Sketch004',
      'Pad003',
      'Sketch005 plane',
      'Sketch005',
      'Pocket003',
      'LinearPattern',
      'Sketch',
      'Pad',
      'PocketSketch',
      'Pocket',
      'Remove Bridge',
      'Import Draft',
      'Pocket001Sketch',
      'Pocket001',
      'Fillet',
      'Remove Plate',
      'Import Plate',
    ]);
  for (const name of ['Bracket', 'Lid', 'Plate', 'Rail', 'Bridge'])
    await expect(bodyLeaf(page, name)).toHaveAttribute('data-body-display', 'shown', {
      timeout: 60_000,
    });
  // Every rebuilt feature recomputes in the project's kernel too.
  await expect(chips.and(page.locator('[data-feature-status="error"]'))).toHaveCount(0);
});
