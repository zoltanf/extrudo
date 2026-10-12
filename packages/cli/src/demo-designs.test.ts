// The designs the tooltip clips start from (the owner's UI review 3, R3-16): one small design
// per scene of `e2e/record-assets.spec.ts`, built through the public API (ADR-0068) so a scene
// only records the tool's own action. This test checks each one computes with no feature
// errors; with `WRITE_FIXTURES=1` it (re)writes `fixtures/demos/<name>.extrudo`, which the
// recorder imports on the home screen. Without it, it checks each file is there and holds the
// same timeline the code builds.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Design } from '@extrudo/api';
import type { GeomRef } from '@extrudo/core';
import { readArchive } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import { openDesign } from './headless';

const DEMOS = fileURLToPath(new URL('../../../fixtures/demos/', import.meta.url));
const FONT = 'inter-regular@1';

/** A construction plane's reference (`constructionRef()` is undefined for other features). */
function planeRef(feature: { constructionRef(): GeomRef | undefined }): GeomRef {
  const ref = feature.constructionRef();
  if (!ref) throw new Error('not a construction feature');
  return ref;
}

/** One builder per scene; the name is the fixture's. */
export const DEMO_DESIGNS: Record<string, (d: Design) => void> = {
  // A plate's outline on XY: the extrude scene pulls it up.
  extrude: (d) => {
    d.sketch(d.origin.xy, (k) => k.rectangle([-20, -10], [20, 10]));
  },
  // A ring's section on XZ beside the Z axis: the revolve scene turns it.
  revolve: (d) => {
    d.sketch(d.origin.xz, (k) => k.rectangle([8, 0], [16, 20]));
  },
  // A tube's section on XY and a bent path up from it on XZ, clear of the Z axis so a pick on
  // the path's first line isn't the axis's.
  sweep: (d) => {
    d.sketch(d.origin.xy, (k) => k.circle([10, 0], 5));
    d.sketch(d.origin.xz, (k) => {
      k.line([10, 0], [10, 15]);
      // An arc runs counter-clockwise from its first point: from the top line down to the first.
      k.arc([25, 30], [10, 15], [25 - 15 * Math.SQRT1_2, 15 + 15 * Math.SQRT1_2]);
      k.line([25, 30], [45, 30]);
    });
  },
  // A square on XY and a circle 25 mm above it, on an offset plane.
  loft: (d) => {
    d.sketch(d.origin.xy, (k) => k.rectangle([-12, -12], [12, 12]));
    const top = d.offsetPlane({ plane: d.origin.xy, distance: '25 mm' });
    d.sketch(planeRef(top), (k) => k.circle([0, 0], 8));
  },
  // A block to drill.
  hole: (d) => {
    d.box({ length: '40 mm', width: '40 mm', height: '16 mm' });
  },
  // A block and "AB" sketched on a plane above its top face.
  emboss: (d) => {
    d.box({ length: '50 mm', width: '24 mm', height: '8 mm' });
    const above = d.offsetPlane({ plane: d.origin.xy, distance: '14 mm' });
    d.sketch(planeRef(above), (k) => k.text([-14, -6], [-14, 6], { text: 'AB', font: FONT }));
  },
  // An L bracket and a diagonal line across its inside corner, on its middle plane.
  rib: (d) => {
    const side = d.sketch(d.origin.xz, (k) =>
      k.polyline([
        [0, 0],
        [40, 0],
        [40, 4],
        [4, 4],
        [4, 40],
        [0, 40],
        [0, 0],
      ]),
    );
    d.extrude({ profiles: side.profiles(), direction: 'symmetric', distance: '24 mm' });
    d.sketch(d.origin.xz, (k) => k.line([4, 30], [30, 4]));
  },
  // A small block to repeat along X.
  rectangularPattern: (d) => {
    d.box({ length: '10 mm', width: '10 mm', height: '10 mm' });
  },
  // A peg beside the Z axis to repeat round it.
  circularPattern: (d) => {
    d.cylinder({ x: '20 mm', diameter: '8 mm', height: '12 mm' });
  },
  // A small block and an arc on XY that starts at it, for its copies to follow.
  pathPattern: (d) => {
    d.box({ length: '6 mm', width: '6 mm', height: '6 mm' });
    // Counter-clockwise from its first point: from the block under through (25, -18).
    d.sketch(d.origin.xy, (k) => k.arc([0, 0], [50, 0], [25, -18]));
  },
  // Two blocks for one component.
  newComponent: (d) => {
    d.box({ x: '-14 mm', length: '20 mm', width: '20 mm', height: '12 mm' });
    d.box({ x: '14 mm', length: '20 mm', width: '20 mm', height: '20 mm' });
  },
  // The Modify tab's scenes start from one block, or a block with something to work on.
  pressPull: (d) => {
    d.box({ length: '30 mm', width: '20 mm', height: '10 mm' });
  },
  fillet: (d) => {
    d.box({ length: '30 mm', width: '20 mm', height: '14 mm' });
  },
  chamfer: (d) => {
    d.box({ length: '30 mm', width: '20 mm', height: '14 mm' });
  },
  shell: (d) => {
    d.box({ length: '30 mm', width: '24 mm', height: '16 mm' });
  },
  // A plate with a hole: the offset face scene closes the hole in.
  offsetFace: (d) => {
    d.box({ length: '36 mm', width: '24 mm', height: '10 mm' });
    d.cylinder({ diameter: '12 mm', height: '10 mm', operation: 'cut' });
  },
  draft: (d) => {
    d.box({ length: '20 mm', width: '20 mm', height: '20 mm' });
  },
  thread: (d) => {
    d.cylinder({ diameter: '20 mm', height: '16 mm' });
  },
  move: (d) => {
    d.box({ length: '16 mm', width: '16 mm', height: '16 mm' });
  },
  // A block off the YZ plane, for its mirror copy to land across it; behind the XZ plane, so the
  // YZ plane's square in front of it can be clicked.
  mirror: (d) => {
    d.box({ x: '16 mm', y: '10 mm', length: '16 mm', width: '16 mm', height: '16 mm' });
  },
  // A block and a peg through its end: Combine cuts the peg out of the block.
  combine: (d) => {
    d.box({ x: '-6 mm', length: '30 mm', width: '20 mm', height: '12 mm' });
    d.cylinder({ x: '9 mm', diameter: '12 mm', height: '24 mm' });
  },
  // Across the YZ plane and behind the XZ plane, so the YZ plane's square in front can be clicked.
  splitBody: (d) => {
    d.box({ y: '12 mm', length: '30 mm', width: '20 mm', height: '20 mm' });
  },
  scale: (d) => {
    d.box({ length: '14 mm', width: '14 mm', height: '14 mm' });
  },
};

/** A design's timeline, with nothing that changes from run to run. */
const timeline = (features: readonly { type: string; name: string; inputs: unknown }[]) =>
  features.map(({ type, name, inputs }) => ({ type, name, inputs }));

describe('the tooltip clips start from small designs (R3-16)', () => {
  for (const [name, build] of Object.entries(DEMO_DESIGNS)) {
    it(`${name} computes with no errors`, { timeout: 60_000 }, async () => {
      const d = Design.create({ name: 'Demo', units: 'mm' });
      build(d);
      const bytes = await d.toFile();
      const { job } = await openDesign(bytes);
      try {
        const result = await job.compute();
        expect(result.features.filter((f) => f.status === 'error')).toEqual([]);
      } finally {
        await job.dispose();
      }
      const file = `${DEMOS}${name}.extrudo`;
      if (process.env.WRITE_FIXTURES) await writeFile(file, bytes);
      const stored = await readArchive(new Uint8Array(await readFile(file)));
      expect(timeline(stored.doc.features)).toEqual(timeline(d.toJSON().features));
    });
  }
});
