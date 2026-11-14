/**
 * The references slice (P6-25 S9, ADR-0144): the parts FreeCAD made
 * (`reference-fixtures.ts`) through `importFcstd` with a kernel in Node and
 * the real solver. Up-to extents, an edge or a datum as an axis, datums as
 * a pattern's or mirror's reference; each feature is rebuilt and checked
 * against the shape the file stores for it.
 */
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeFeature } from './features';
import { label, prop } from './fixtures';
import { type FcstdImportOptions, importFcstd } from './import';
import type { ImportKernel } from './import-kernel';
import { type FcObject, readFcstd } from './model';
import { nodeImportKernel } from './node-kernel-test-support';
import { P, type PartChange, type PartOptions } from './pattern-parts';
import { REF_BREP, REF_CASES } from './reference-fixtures';
import { REF_PARTS, refFile } from './reference-parts';

let planegcs: PlanegcsModule;
let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  kernel = nodeImportKernel();
});

export async function runRef(
  name: string,
  change: PartChange = {},
  options: Partial<FcstdImportOptions> = {},
  part: PartOptions = {},
) {
  const result = await importFcstd(refFile(name, change, part), 'Parts', {
    kernel,
    solver: new SketchSolver(planegcs),
    ...options,
  });
  const [body] = result.report.bodies;
  return {
    ...result,
    body,
    features: result.design.doc.features.map((f) => `${f.type} ${f.name}`),
    /** A feature's inputs by its name in the design. */
    inputs: (name: string) =>
      result.design.doc.features.find((f) => f.name === name)?.inputs as Record<
        string,
        { kind: string; value?: unknown; expr?: string; refs?: { kind: string; id: string }[] }
      >,
  };
}

/** Kind of the first reference an input holds. */
const refKind = (i: { refs?: { kind: string }[] } | undefined) => i?.refs?.[0]?.kind;

/** What the interesting feature of each part became. */
const BECAME: Record<
  string,
  { feature: string; extent?: string; to?: string; offset?: string; axis?: string; datum?: string }
> = {
  pad_up_to_first: { feature: 'Bridge', extent: 'to-object', to: 'body' },
  pad_up_to_last: { feature: 'Bridge', extent: 'to-object', to: 'face' },
  pad_up_to_face: { feature: 'Bridge', extent: 'to-object', to: 'face' },
  pad_up_to_face_offset: { feature: 'Bridge', extent: 'to-object', to: 'face', offset: '1.5 mm' },
  pad_up_to_curved: { feature: 'Beam', extent: 'to-object', to: 'face' },
  pocket_up_to_first: { feature: 'Bore', extent: 'to-object', to: 'face' },
  pocket_up_to_face: { feature: 'Bore', extent: 'to-object', to: 'face' },
  pocket_up_to_face_offset: { feature: 'Bore', extent: 'to-object', to: 'face', offset: '1.5 mm' },
  pad_up_to_shape: { feature: 'Bridge', extent: 'to-object', to: 'face' },
  pad_up_to_datum_plane: { feature: 'Boss', extent: 'to-object', to: 'plane', datum: 'offset' },
  pocket_up_to_datum_plane: {
    feature: 'Pocket',
    extent: 'to-object',
    to: 'plane',
    datum: 'offset',
  },
  groove_about_edge: { feature: 'Groove', axis: 'edge' },
  revolution_about_edge: { feature: 'Revolution', axis: 'edge' },
  groove_about_datum_line: { feature: 'Groove', axis: 'axis', datum: 'fixed' },
  revolution_about_datum_line: { feature: 'Revolution', axis: 'axis', datum: 'fixed' },
  groove_about_sketch_line: { feature: 'Groove', axis: 'axis', datum: 'sketch-line' },
  pattern_along_datum_line: { feature: 'LinearPattern', axis: 'axis', datum: 'fixed' },
  polar_about_datum_line: { feature: 'PolarPattern', axis: 'axis', datum: 'fixed' },
  mirror_about_datum_plane: { feature: 'Mirrored', axis: 'plane', datum: 'offset' },
};

describe('the fixtures come in with their whole history', () => {
  it.each(Object.entries(BECAME))(
    '%s',
    async (name, want) => {
      const r = await runRef(name);
      const { body } = r;
      expect(body?.stop).toBeUndefined();
      expect(body?.steps).toEqual([]);
      expect(body?.outcome).toBe('history');
      expect(body?.mapped.map((m) => m.object)).toEqual(
        r.report.bodies[0]?.mapped.map((m) => m.object),
      );
      expect(body?.mapped.length).toBe(body?.features);
      const inputs = r.inputs(want.feature);
      if (want.extent) {
        expect(inputs.extent?.value).toBe(want.extent);
        expect(refKind(inputs.toObject)).toBe(want.to);
        expect(inputs.offset?.expr).toBe(want.offset);
      }
      if (want.axis) {
        const axis = inputs.axis ?? inputs.direction1 ?? inputs.plane;
        expect(refKind(axis)).toBe(want.axis);
      }
      const mapped = body?.mapped.find((m) => m.object === want.feature);
      expect(mapped?.datums?.[0]?.how).toBe(want.datum);
    },
    60_000,
  );

  it('covers every fixture part but the tilted and projected ones (sections 4 and 5)', () => {
    const rest = REF_PARTS.filter((n) => !(n in BECAME));
    expect(rest.every((n) => /tilted|external|face_sketch/.test(n))).toBe(true);
  });
});

describe('timelines', () => {
  it('pad_up_to_face_offset: the bridge goes to the matched face, 1.5 mm past it', async () => {
    const r = await runRef('pad_up_to_face_offset');
    expect(r.features).toEqual([
      'sketch Sketch',
      'extrude Pad',
      'offsetPlane WallsSketch plane',
      'sketch WallsSketch',
      'extrude Walls',
      'offsetPlane BridgeSketch plane',
      'sketch BridgeSketch',
      'extrude Bridge',
    ]);
    const bridge = r.body?.mapped.find((m) => m.object === 'Bridge');
    expect(bridge?.upTo).toEqual({ method: 'face', target: 'face', tries: 1 });
    expect(bridge?.references).toMatchObject({ found: 1, none: 0, several: 0 });
    expect(bridge?.sources).toMatchObject({ toObject: 'UpToFace', offset: 'Offset' });
  });

  it('groove_about_datum_line: the datum is an axis through two points, made before the groove', async () => {
    const r = await runRef('groove_about_datum_line');
    expect(r.features).toEqual([
      'sketch Sketch',
      'extrude Pad',
      'constructionPoint DatumLine point 1',
      'constructionPoint DatumLine point 2',
      'axisThroughPoints DatumLine',
      'offsetPlane GrooveSketch plane',
      'sketch GrooveSketch',
      'revolve Groove',
    ]);
    const groove = r.body?.mapped.find((m) => m.object === 'Groove');
    expect(groove?.datums).toEqual([{ object: 'DatumLine', mode: 'TwoPointLine', how: 'fixed' }]);
    // The datum line through two of the plate's vertices: its stored placement's numbers.
    expect(r.inputs('DatumLine point 1')).toMatchObject({
      x: { expr: '0 mm' },
      y: { expr: '-10 mm' },
      z: { expr: '10 mm' },
    });
  });
});

describe('up to: the first and the last face', () => {
  it('a pad up to the first face is to-object on the body; a pocket picks the face', async () => {
    const pad = await runRef('pad_up_to_first');
    expect(pad.body?.mapped.at(-1)?.upTo).toEqual({ method: 'first', target: 'body', tries: 1 });
    const pocket = await runRef('pocket_up_to_first');
    expect(pocket.body?.mapped.at(-1)?.upTo).toEqual({ method: 'first', target: 'face', tries: 1 });
    expect(pocket.body?.upToTries).toBe(1);
  });

  it('up to the last face takes the farthest face the sweep meets', async () => {
    const r = await runRef('pad_up_to_last');
    expect(r.body?.mapped.at(-1)?.upTo).toEqual({ method: 'last', target: 'face', tries: 1 });
  });

  it('the faces are tried nearest first until one holds, at most four tries', async () => {
    // Read as up to the first face, the last fixture holds at the third wall's near face: the
    // solid up to it is the solid up to the far side, as the walls fill the rest.
    const r = await runRef('pad_up_to_last', { Bridge: { props: { Type: 2 } } });
    expect(r.body?.stop).toBeUndefined();
    expect(r.body?.mapped.at(-1)?.upTo).toEqual({ method: 'first', target: 'face', tries: 4 });
    expect(r.body?.upToTries).toBe(4);
  });

  it('when no try holds the body takes the file shape after four tries', async () => {
    const walls = REF_CASES.pad_up_to_first?.objects.find((o) => o.object === 'Walls')?.stored;
    const r = await runRef('pad_up_to_first', {
      Bridge: { stored: REF_BREP[walls as number] as string },
    });
    expect(r.body?.stop).toMatchObject({ object: 'Bridge', reason: 'differs' });
    expect(r.body?.upToTries).toBe(4);
    expect(r.body?.outcome).toBe('shape');
  });
});

describe('how a file may name a datum', () => {
  it("a datum plane named with its own sub-element 'Plane' is the datum plane", async () => {
    const r = await runRef('pad_up_to_datum_plane', {
      Boss: { props: { UpToFace: P.sub('DatumPlane', ['Plane']) } },
    });
    expect(r.body?.stop).toBeUndefined();
    expect(r.body?.mapped.at(-1)?.datums?.[0]?.how).toBe('offset');
  });

  it('a type that only begins like a datum is not one: an edge of a linear pattern', () => {
    const doc = readFcstd(refFile('pattern_along_datum_line'));
    const lp = doc.byName.get('LinearPattern') as FcObject;
    const decoded = decodeFeature(
      doc,
      {
        ...lp,
        properties: {
          ...lp.properties,
          Direction: {
            type: 'App::PropertyLinkSub',
            value: { kind: 'linkSub', object: 'LinearPattern', subs: [{ name: 'Edge18' }] },
          },
        },
      } as unknown as FcObject,
      { body: doc.byName.get('Body') as FcObject, moved: false },
    );
    expect(decoded).toMatchObject({
      ok: true,
      feature: { first: { reference: { kind: 'element', object: 'LinearPattern' } } },
    });
  });
});

describe('the wrong cases', () => {
  it("a face that isn't the file's: the bridge doesn't hold, the body takes the file's shape", async () => {
    // Face4 is the middle wall's far face; the stored bridge goes to the third wall.
    const r = await runRef('pad_up_to_face', {
      Bridge: { props: { UpToFace: P.sub('Walls', ['Face4']) } },
    });
    expect(r.body?.stop).toMatchObject({ object: 'Bridge', reason: 'differs' });
    expect(r.body?.mapped.map((m) => m.object)).toEqual(['Pad', 'Walls']);
  });

  it.each([
    ['the sign turned', -1.5, 'differs'],
    ['no offset', 0, 'differs'],
    // From the sketch at x = −16 to the face at x = 2 is 18 mm: an offset of −18 leaves nothing.
    ['no length left', -18, 'failed'],
  ])('an offset with %s does not hold (%s)', async (_, offset, reason) => {
    const r = await runRef('pad_up_to_face_offset', { Bridge: { props: { Offset: offset } } });
    expect(r.body?.stop).toMatchObject({ object: 'Bridge', reason });
    expect(r.body?.outcome).toBe('shape');
  });

  it("a pocket's offset is past the face too: turned, it doesn't hold", async () => {
    const r = await runRef('pocket_up_to_face_offset', { Bore: { props: { Offset: -1.5 } } });
    expect(r.body?.stop).toMatchObject({ object: 'Bore', reason: 'differs' });
  });

  it('a half turn about a datum line pointing the other way does not hold', async () => {
    // The same line, its local Z turned round (a half turn about the datum's x).
    const r = await runRef('revolution_about_datum_line', {
      DatumLine: { at: [0, 10, 10, 0, -Math.SQRT1_2, 0, Math.SQRT1_2] },
    });
    expect(r.body?.stop).toMatchObject({ object: 'Revolution', reason: 'differs' });
  });

  it("a datum's placement wins over its attachment", async () => {
    // The attachment says 7 mm from the YZ plane; the stored placement (3 mm) is what FreeCAD shows.
    const r = await runRef('mirror_about_datum_plane', {
      DatumPlane: {
        props: {
          AttachmentOffset: P.raw(
            '<PropertyPlacement Px="0" Py="0" Pz="7" Q0="0" Q1="0" Q2="0" Q3="1" A="0" Ox="0" Oy="0" Oz="1"/>',
          ),
        },
      },
    });
    expect(r.body?.stop).toBeUndefined();
    expect(r.inputs('DatumPlane')).toMatchObject({ distance: { expr: '3 mm' } });
  });

  it('a datum placed elsewhere than the stored shapes say: the mirror does not hold', async () => {
    const r = await runRef('mirror_about_datum_plane', {
      DatumPlane: { at: [5, 0, 0, 0.5, 0.5, 0.5, 0.5] },
    });
    expect(r.body?.stop).toMatchObject({ object: 'Mirrored', reason: 'differs' });
  });

  it("a kernel whose construction report isn't the datum's: the feature stops with datum", async () => {
    const lying: ImportKernel = {
      ...kernel,
      rebuild: async (...args) => {
        const r = await kernel.rebuild(...args);
        if (!r.reports) return r;
        const reports = Object.fromEntries(
          Object.entries(r.reports).map(([id, rep]) => [
            id,
            { ...(rep as object), origin: [0, 0, 99] },
          ]),
        );
        return { ...r, reports };
      },
    };
    const r = await runRef('groove_about_datum_line', {}, { kernel: lying });
    expect(r.body?.stop).toMatchObject({ object: 'Groove', reason: 'datum' });
    expect(r.body?.stop?.detail).toMatch(/DatumLine came in at another place/);
  });
});

describe('sketches on tilted planes', () => {
  it('pad_on_tilted_plane: the sketch sits on its datum plane, a plane through three points', async () => {
    const r = await runRef('pad_on_tilted_plane');
    expect(r.body?.stop).toBeUndefined();
    expect(r.features).toEqual([
      'sketch Sketch',
      'extrude Pad',
      'constructionPoint DatumPlane point 1',
      'constructionPoint DatumPlane point 2',
      'constructionPoint DatumPlane point 3',
      'planeThroughPoints DatumPlane',
      'sketch TiltedSketch',
      'extrude Tilted',
    ]);
    const tilted = r.body?.sketches.find((s) => s.sketch === 'TiltedSketch');
    expect(tilted).toMatchObject({ plane: 'datum', mirrored: false });
    expect(tilted?.constraints.mapped).toBe(tilted?.constraints.total);
  });

  it('pocket_on_tilted_face: the sketch on the tilted face sits on a plane through three points of its frame', async () => {
    const r = await runRef('pocket_on_tilted_face');
    expect(r.body?.stop).toBeUndefined();
    expect(r.body?.mapped.map((m) => m.object)).toEqual(['Pad', 'Tilted', 'Pocket']);
    expect(r.body?.sketches.find((s) => s.sketch === 'FaceSketch')?.plane).toBe('points');
    expect(r.features).toContain('planeThroughPoints FaceSketch plane');
  });

  it("a tilted sketch moved in its plane: the profile lands elsewhere and the pad doesn't hold", async () => {
    const at = REF_CASES.pad_on_tilted_plane?.objects.find((o) => o.object === 'TiltedSketch')
      ?.sketch?.at as number[];
    const r = await runRef('pad_on_tilted_plane', {
      TiltedSketch: { at: [(at[0] as number) + 1, ...at.slice(1)] },
    });
    expect(r.body?.stop).toMatchObject({ object: 'Tilted', reason: 'differs' });
  });
});

describe('projected geometry', () => {
  /** Per part: the sketch whose constraints name external geometry, and the projections it gets. */
  const PROJECTED: Record<string, { sketch: string; projected: number; kinds: string[] }> = {
    external_edge_distance: { sketch: 'PocketSketch', projected: 1, kinds: ['edge'] },
    external_projected_edge: { sketch: 'PocketSketch', projected: 1, kinds: ['edge'] },
    external_corner: { sketch: 'NotchSketch', projected: 2, kinds: ['edge', 'edge'] },
    external_circle: { sketch: 'CounterboreSketch', projected: 1, kinds: ['edge'] },
    external_sketch: { sketch: 'PocketSketch', projected: 1, kinds: ['sketchEntity'] },
    face_sketch_external: { sketch: 'FaceSketch', projected: 2, kinds: ['edge', 'edge'] },
    external_arc_concentric: { sketch: 'PocketSketch', projected: 1, kinds: ['edge'] },
    external_arc_below: { sketch: 'PocketSketch', projected: 1, kinds: ['edge'] },
    external_arc_ends: { sketch: 'NotchSketch', projected: 1, kinds: ['edge'] },
    external_arc_tangent: { sketch: 'PocketSketch', projected: 1, kinds: ['edge'] },
    external_arc_edge_on: { sketch: 'SideSketch', projected: 1, kinds: ['edge'] },
  };

  const projectionsOf = (r: Awaited<ReturnType<typeof runRef>>, sketch: string) => {
    const f = r.design.doc.features.find((x) => x.name === sketch);
    const data = (f?.inputs as { sketch?: { sketch?: { projections?: Record<string, unknown> } } })
      ?.sketch?.sketch;
    return Object.values(data?.projections ?? {}) as {
      ref: { kind: string };
      curves: Record<string, string>;
    }[];
  };

  it.each(Object.entries(PROJECTED))(
    '%s: every constraint comes in, through the projections',
    async (name, want) => {
      const r = await runRef(name);
      expect(r.body?.stop).toBeUndefined();
      const outcome = r.body?.sketches.find((s) => s.sketch === want.sketch);
      expect(outcome?.constraints.mapped).toBe(outcome?.constraints.total);
      expect(outcome?.constraints.leftOut).toEqual({});
      expect(outcome?.external).toMatchObject({ projected: want.projected });
      expect(outcome?.external?.constraints).toBeGreaterThan(0);
      expect(projectionsOf(r, want.sketch).map((p) => p.ref.kind)).toEqual(want.kinds);
      // The projected curves are construction: they never make a profile of their own.
      const f = r.design.doc.features.find((x) => x.name === want.sketch);
      const inputs = f?.inputs as unknown as
        | { sketch: { sketch: { entities: Record<string, { construction?: boolean }> } } }
        | undefined;
      const entities = inputs?.sketch.sketch.entities ?? {};
      for (const p of projectionsOf(r, want.sketch))
        for (const id of Object.values(p.curves)) expect(entities[id]?.construction).toBe(true);
    },
    60_000,
  );

  it('external_unused: a projected edge no constraint names makes no projection', async () => {
    const r = await runRef('external_unused');
    expect(r.body?.stop).toBeUndefined();
    expect(projectionsOf(r, 'PocketSketch')).toEqual([]);
    expect(r.body?.sketches.find((s) => s.sketch === 'PocketSketch')?.external).toEqual({
      named: 0,
      projected: 0,
      constraints: 0,
      out: {},
    });
  });

  it('a timeline with projected geometry: external_corner', async () => {
    const r = await runRef('external_corner');
    expect(r.features).toEqual([
      'sketch Sketch',
      'extrude Pad',
      'offsetPlane NotchSketch plane',
      'sketch NotchSketch',
      'extrude Notch',
    ]);
    expect(r.body?.sketches.find((s) => s.sketch === 'NotchSketch')?.external).toEqual({
      named: 2,
      projected: 2,
      constraints: 2,
      out: {},
    });
  });

  it('a stored projection that lands elsewhere: the constraint stays out, the sketch stays', async () => {
    // The file says the projected top edge is 1 mm further out than the pad's edge.
    const r = await runRef('external_edge_distance', {
      PocketSketch: { externalGeo: [['line', 20, 11, -20, 11, 'Pad.;#16:3;:U;XTR;:H6f6:7,E']] },
    });
    expect(r.body?.stop).toBeUndefined();
    const outcome = r.body?.sketches.find((s) => s.sketch === 'PocketSketch');
    expect(outcome?.external?.projected).toBe(0);
    expect(outcome?.constraints.leftOut).toMatchObject({ external: 1 });
    expect(projectionsOf(r, 'PocketSketch')).toEqual([]);
  });

  it('an edge that is not the projected one: the projection stays out, the pocket holds', async () => {
    // Edge3 is the bottom front edge; the stored projection is the top back one.
    const sketch = REF_CASES.external_edge_distance?.objects.find(
      (o) => o.object === 'PocketSketch',
    )?.sketch;
    const link = sketch?.external?.[0] as string[];
    const r = await runRef('external_edge_distance', {
      PocketSketch: { external: [[link[0] as string, 'Edge3', link[2] as string]] },
    });
    expect(r.body?.stop).toBeUndefined();
    expect(r.body?.sketches.find((s) => s.sketch === 'PocketSketch')?.external?.projected).toBe(0);
  });
});

describe('projected arcs', () => {
  const ARCS: Record<string, { sketch: string; constraints: number; through: number }> = {
    external_arc_concentric: { sketch: 'PocketSketch', constraints: 2, through: 1 },
    external_arc_below: { sketch: 'PocketSketch', constraints: 2, through: 1 },
    external_arc_ends: { sketch: 'NotchSketch', constraints: 6, through: 3 },
    external_arc_tangent: { sketch: 'PocketSketch', constraints: 3, through: 1 },
  };
  /** The projected curve of a sketch, its points where the design has them. */
  const arcOf = (r: Awaited<ReturnType<typeof runRef>>, sketch: string) => {
    const f = r.design.doc.features.find((x) => x.name === sketch);
    const data = (
      f?.inputs as unknown as {
        sketch: {
          sketch: {
            entities: Record<string, Record<string, unknown>>;
            projections: Record<string, { curves: Record<string, string> }>;
          };
        };
      }
    ).sketch.sketch;
    const [p] = Object.values(data.projections);
    const e = data.entities[p?.curves.edge as string] as Record<string, string>;
    const at = (id = '') => [data.entities[id]?.x, data.entities[id]?.y] as number[];
    return { type: e.type, start: at(e.start), end: at(e.end), center: at(e.center) };
  };
  const close = (a: number[], b: number[]) =>
    expect(Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0))).toBeLessThan(1e-9);

  // Before 1.0 a file stores no projection: the arc comes from the edge's centre, radius, ends and middle.
  it.each(
    Object.entries(ARCS).flatMap(([name, want]) => [
      [name, 'stored', want] as const,
      [name, 'from the edge', want] as const,
    ]),
  )(
    '%s, %s: the arc comes in and every constraint through it',
    async (name, how, want) => {
      const r = await runRef(
        name,
        how === 'stored' ? {} : { [want.sketch]: { externalGeo: undefined } },
      );
      expect(r.body?.stop).toBeUndefined();
      expect(r.body?.outcome).toBe('history');
      expect(r.body?.mapped.length).toBe(r.body?.features);
      const s = r.body?.sketches.find((x) => x.sketch === want.sketch);
      expect(s?.constraints).toMatchObject({ total: want.constraints, mapped: want.constraints });
      expect(s?.external).toEqual({ named: 1, projected: 1, constraints: want.through, out: {} });
      // The rounded corner's arc: counter-clockwise from (20, 4) to (14, 10) about (14, 4).
      const a = arcOf(r, want.sketch);
      expect(a.type).toBe('arc');
      close(a.start, [20, 4]);
      close(a.end, [14, 10]);
      close(a.center, [14, 4]);
    },
    60_000,
  );

  it('external_arc_edge_on: the stored projection is a line and comes in; without it the arc seen edge-on stays out', async () => {
    const stored = await runRef('external_arc_edge_on');
    expect(stored.body?.sketches.find((x) => x.sketch === 'SideSketch')?.external).toEqual({
      named: 1,
      projected: 1,
      constraints: 1,
      out: {},
    });
    const before = await runRef('external_arc_edge_on', { SideSketch: { externalGeo: undefined } });
    expect(before.body?.stop).toBeUndefined();
    expect(before.body?.outcome).toBe('history');
    const s = before.body?.sketches.find((x) => x.sketch === 'SideSketch');
    expect(s?.external).toEqual({ named: 1, projected: 0, constraints: 0, out: { kind: 1 } });
    expect(s?.constraints).toMatchObject({ total: 2, mapped: 1, leftOut: { external: 1 } });
  }, 60_000);
});

describe('the fix round', () => {
  it.each([
    ['pad_up_to_datum_plane', 'Boss'],
    ['pocket_up_to_datum_plane', 'Pocket'],
  ])(
    "%s whose feature doesn't hold leaves no construction of its datum behind",
    async (name, feature) => {
      const r = await runRef(name, { [feature]: { props: { Offset: 3 } } });
      expect(r.body?.stop).toMatchObject({ object: feature, reason: 'differs' });
      expect(r.design.doc.features.some((f) => f.name.startsWith('DatumPlane'))).toBe(false);
      expect(r.body?.mapped.some((m) => m.datums)).toBe(false);
    },
  );

  it('an up-to datum plane is reported as a datum target', async () => {
    const r = await runRef('pad_up_to_datum_plane');
    expect(r.body?.mapped.at(-1)?.upTo).toEqual({ method: 'face', target: 'datum', tries: 1 });
  });

  it('a tilted pad read as up to the first face: each try has its own checks, no kernel stop', async () => {
    const before = kernel.restarts;
    const r = await runRef('pad_on_tilted_plane', { Tilted: { props: { Type: 2 } } });
    // Its stored shape is the pad of 10 mm, so no target holds; what matters is why it stops.
    expect(r.body?.stop).toMatchObject({ object: 'Tilted', reason: 'differs' });
    expect(kernel.restarts).toBe(before);
    expect(r.body?.upToTries).toBeGreaterThan(1);
    expect(r.design.doc.features.some((f) => f.name.startsWith('DatumPlane'))).toBe(false);
  });

  it("a sketch moved off its datum plane comes in on its own frame's plane", async () => {
    const at = REF_CASES.pad_on_tilted_plane?.objects.find((o) => o.object === 'TiltedSketch')
      ?.sketch?.at as number[];
    const n = [0.36496738964685843, -0.3169036940775681, 0.875426098065593];
    const moved = at.map((v, k) => (k < 3 ? v + 2 * (n[k] as number) : v));
    const sent: string[][] = [];
    const watching: ImportKernel = {
      ...kernel,
      rebuild: (doc, ...rest) => {
        sent.push(doc.features.map((f) => `${f.type} ${f.name}`));
        return kernel.rebuild(doc, ...rest);
      },
    };
    const r = await runRef(
      'pad_on_tilted_plane',
      { TiltedSketch: { at: moved } },
      { kernel: watching },
    );
    // Moved 2 mm, the pad no longer fits its stored shape: it doesn't hold. The try put the
    // sketch on a plane through its own frame, and made no construction of the datum.
    expect(r.body?.stop).toMatchObject({ object: 'Tilted', reason: 'differs' });
    const tried = sent.find((x) => x.includes('extrude Tilted')) ?? [];
    expect(tried).toContain('planeThroughPoints TiltedSketch plane');
    expect(tried.some((x) => x.includes('DatumPlane'))).toBe(false);
  });

  it("a sketch on a datum outside the body comes in on its own frame's plane, the pad holds", async () => {
    const datum = REF_CASES.pad_on_tilted_plane?.objects.find((o) => o.object === 'DatumPlane');
    const q = datum?.at as number[];
    const loose = {
      name: 'Loose',
      type: 'PartDesign::Plane',
      props: [
        label('Loose'),
        prop(
          'Placement',
          'App::PropertyPlacement',
          `<PropertyPlacement Px="${q[0]}" Py="${q[1]}" Pz="${q[2]}" Q0="${q[3]}" Q1="${q[4]}" Q2="${q[5]}" Q3="${q[6]}"/>`,
        ),
      ],
    };
    const r = await runRef(
      'pad_on_tilted_plane',
      { TiltedSketch: { support: [['Loose', '']] } },
      {},
      { extra: [loose] },
    );
    expect(r.body?.stop).toBeUndefined();
    expect(r.body?.sketches.find((s) => s.sketch === 'TiltedSketch')?.plane).toBe('points');
  });

  it("a datum on another body's origin plane comes in fixed, not as an offset plane", async () => {
    const other = {
      name: 'OtherYZ',
      type: 'App::Plane',
      props: [label('OtherYZ'), prop('Role', 'App::PropertyString', '<String value="YZ_Plane"/>')],
    };
    const r = await runRef(
      'mirror_about_datum_plane',
      { DatumPlane: { props: { AttachmentSupport: { subList: [['OtherYZ', '']] } } } },
      {},
      { extra: [other] },
    );
    expect(r.body?.stop).toBeUndefined();
    expect(r.body?.mapped.at(-1)?.datums?.[0]?.how).toBe('fixed');
  });
});
