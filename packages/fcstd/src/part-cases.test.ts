/**
 * Every S11 fixture document in full (P6-25, ADR-0144): each tree's outcome, each object's
 * outcome, the timeline's features in order, the bodies left with their names and visibility,
 * and each top measured against FreeCAD's own numbers for that object. Then what S11 rests on
 * from outside the package: core's limits on expressions, and the STEP the leaves are written as.
 */
import { evaluateParameters } from '@extrudo/core';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { strFromU8 } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { importFcstd } from './import';
import { nodeImportKernel } from './node-kernel-test-support';
import { PART_DOCUMENTS, type PartFileOptions, partCase, partFile } from './part-parts';

let planegcs: PlanegcsModule;
let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  kernel = nodeImportKernel();
});

const run = (name: string, file: PartFileOptions = {}) =>
  importFcstd(partFile(name, file), 'Parts', { kernel, solver: new SketchSolver(planegcs) });

interface Expected {
  readonly trees: Readonly<Record<string, string>>;
  readonly outcomes: Readonly<Record<string, string>>;
  readonly features: readonly string[];
  readonly bodies: readonly string[];
}

const EXPECTED: Readonly<Record<string, Expected>> = {
  box_cyl_cut: {
    trees: {
      Cut: 'history',
    },
    outcomes: {
      Box: 'feature',
      Cylinder: 'feature',
      Cut: 'feature',
    },
    features: ['box Box', 'cylinder Cylinder', 'combine Cut'],
    bodies: ['Cut'],
  },
  fuse_common: {
    trees: {
      Fusion: 'history',
      Common: 'history',
    },
    outcomes: {
      Box: 'feature',
      Box001: 'feature',
      Fusion: 'feature',
      Box002: 'feature',
      Sphere: 'feature',
      Common: 'feature',
    },
    features: [
      'box Box',
      'box Box001',
      'combine Fusion',
      'box Box002',
      'sphere Sphere',
      'combine Common',
    ],
    bodies: ['Fusion', 'Common'],
  },
  multi: {
    trees: {
      Fusion: 'history',
      Common: 'history',
    },
    outcomes: {
      Box: 'feature',
      Cylinder: 'feature',
      Box001: 'feature',
      Fusion: 'feature',
      Box002: 'feature',
      Box003: 'feature',
      Cylinder001: 'feature',
      Common: 'feature',
    },
    features: [
      'box Box',
      'cylinder Cylinder',
      'box Box001',
      'combine Fusion',
      'box Box002',
      'box Box003',
      'cylinder Cylinder001',
      'combine Common',
      'combine Common 2',
    ],
    bodies: ['Fusion', 'Common'],
  },
  nested: {
    trees: {
      Common: 'history',
    },
    outcomes: {
      Box: 'feature',
      Cylinder: 'feature',
      Fusion: 'feature',
      Cylinder001: 'feature',
      Cylinder002: 'feature',
      Holes: 'feature',
      Cut: 'feature',
      Box001: 'feature',
      Common: 'feature',
    },
    features: [
      'box Box',
      'cylinder Cylinder',
      'combine Fusion',
      'cylinder Cylinder001',
      'cylinder Cylinder002',
      'combine Cut',
      'box Box001',
      'combine Common',
    ],
    bodies: ['Common'],
  },
  placed_primitives: {
    trees: {
      BoxMoved: 'history',
      BoxTurnedZ: 'history',
      BoxQuarterX: 'history',
      BoxTilted: 'history',
      CylMoved: 'history',
      CylAlongX: 'history',
      CylAlongMinusY: 'history',
      CylDown: 'history',
      CylTilted: 'history',
      SphereMoved: 'history',
      SphereTilted: 'history',
    },
    outcomes: {
      BoxMoved: 'feature',
      BoxTurnedZ: 'feature',
      BoxQuarterX: 'feature',
      BoxTilted: 'feature',
      CylMoved: 'feature',
      CylAlongX: 'feature',
      CylAlongMinusY: 'feature',
      CylDown: 'feature',
      CylTilted: 'feature',
      SphereMoved: 'feature',
      SphereTilted: 'feature',
    },
    features: [
      'box BoxMoved',
      'box BoxTurnedZ',
      'box BoxQuarterX',
      'box BoxTilted',
      'move Place BoxTilted',
      'cylinder CylMoved',
      'cylinder CylAlongX',
      'cylinder CylAlongMinusY',
      'cylinder CylDown',
      'cylinder CylTilted',
      'move Place CylTilted',
      'sphere SphereMoved',
      'sphere SphereTilted',
    ],
    bodies: [
      'BoxMoved',
      'BoxTurnedZ',
      'BoxQuarterX',
      'BoxTilted',
      'CylMoved',
      'CylAlongX',
      'CylAlongMinusY',
      'CylDown',
      'CylTilted',
      'SphereMoved',
      'SphereTilted',
    ],
  },
  torus_cone: {
    trees: {
      Torus: 'history',
      TorusTilted: 'history',
    },
    outcomes: {
      Torus: 'feature',
      TorusTilted: 'feature',
    },
    features: [
      'torus Torus',
      'torus TorusTilted',
      'move Place TorusTilted',
      'import Import Cone',
      'import Import ConePointed',
    ],
    bodies: ['Torus', 'TorusTilted', 'Cone', 'ConePointed'],
  },
  other_primitives: {
    trees: {
      CylQuarter: 'shape:partial',
      SphereCap: 'shape:partial',
      SphereWedge: 'shape:partial',
      TorusPart: 'shape:partial',
      CylSkewed: 'shape:partial',
      Cut: 'leaves',
    },
    outcomes: {
      Box: 'feature',
      Prism001: 'leaf:type',
      Cut: 'feature',
    },
    features: [
      'import Import Prism001',
      'box Box',
      'combine Cut',
      'import Import CylQuarter',
      'import Import SphereCap',
      'import Import SphereWedge',
      'import Import TorusPart',
      'import Import Prism',
      'import Import Wedge',
      'import Import CylSkewed',
    ],
    bodies: [
      'Cut',
      'CylQuarter',
      'SphereCap',
      'SphereWedge',
      'TorusPart',
      'Prism',
      'Wedge',
      'CylSkewed',
    ],
  },
  placed_booleans: {
    trees: {
      CutMoved: 'history',
      FusionTilted: 'history',
      Outer: 'history',
      MultiMoved: 'history',
    },
    outcomes: {
      Box: 'feature',
      Cylinder: 'feature',
      CutMoved: 'feature',
      Box001: 'feature',
      Cylinder001: 'feature',
      FusionTilted: 'feature',
      Box002: 'feature',
      Cylinder002: 'feature',
      Inner: 'feature',
      Cylinder003: 'feature',
      Outer: 'feature',
      Box003: 'feature',
      Box004: 'feature',
      MultiMoved: 'feature',
    },
    features: [
      'box Box',
      'cylinder Cylinder',
      'combine CutMoved',
      'move Place CutMoved',
      'box Box001',
      'cylinder Cylinder001',
      'combine FusionTilted',
      'move Place FusionTilted',
      'box Box002',
      'cylinder Cylinder002',
      'combine Inner',
      'move Place Inner',
      'cylinder Cylinder003',
      'combine Outer',
      'box Box003',
      'box Box004',
      'combine MultiMoved',
      'move Place MultiMoved',
    ],
    bodies: ['CutMoved', 'FusionTilted', 'Outer', 'MultiMoved'],
  },
  shared_operand: {
    trees: {
      Cut: 'history',
      Cut001: 'history',
      Cut002: 'history',
      Fusion: 'history',
    },
    outcomes: {
      Box: 'feature',
      Cylinder: 'feature',
      Cut: 'feature',
      Box001: 'feature',
      Cut001: 'feature',
      Box002: 'feature',
      Cylinder001: 'feature',
      Cut002: 'feature',
      Box003: 'feature',
      Fusion: 'feature',
    },
    features: [
      'box Box',
      'cylinder Cylinder',
      'move Copy Cylinder',
      'combine Cut',
      'box Box001',
      'combine Cut001',
      'box Box002',
      'cylinder Cylinder001',
      'move Copy Box002',
      'combine Cut002',
      'box Box003',
      'combine Fusion',
    ],
    bodies: ['Cut', 'Cut001', 'Cut002', 'Fusion'],
  },
  visible_operand: {
    trees: {
      Cut: 'history',
    },
    outcomes: {
      Box: 'feature',
      Cylinder: 'feature',
      Cut: 'feature',
    },
    features: ['box Box', 'cylinder Cylinder', 'combine Cut'],
    bodies: ['Cut'],
  },
  hidden_root: {
    trees: {
      Cut: 'history',
      Box001: 'history',
    },
    outcomes: {
      Box: 'feature',
      Cylinder: 'feature',
      Cut: 'feature',
      Box001: 'feature',
    },
    features: ['box Box', 'cylinder Cylinder', 'combine Cut', 'box Box001'],
    bodies: ['Cut (hidden)', 'Box001'],
  },
  stored_leaf: {
    trees: {
      Cut: 'leaves',
      Cut001: 'leaves',
    },
    outcomes: {
      Imported: 'leaf:type',
      Cylinder: 'feature',
      Cut: 'feature',
      Box: 'feature',
      Tool: 'leaf:type',
      Cut001: 'feature',
    },
    features: [
      'import Import Imported',
      'cylinder Cylinder',
      'combine Cut',
      'import Import Tool',
      'box Box',
      'combine Cut001',
    ],
    bodies: ['Cut', 'Cut001'],
  },
  extrusion_leaf: {
    trees: {
      Cut: 'leaves',
    },
    outcomes: {
      Extrude: 'leaf:type',
      Cylinder: 'feature',
      Cut: 'feature',
    },
    features: ['import Import Extrude', 'cylinder Cylinder', 'combine Cut'],
    bodies: ['Cut'],
  },
  body_operand: {
    trees: {
      Fusion: 'history',
    },
    outcomes: {
      Body: 'body',
      Cylinder: 'feature',
      Cut: 'feature',
      Box: 'feature',
      Fusion: 'feature',
    },
    features: [
      'sketch Sketch',
      'extrude Pad',
      'offsetPlane PocketSketch plane',
      'sketch PocketSketch',
      'extrude Pocket',
      'cylinder Cylinder',
      'combine Cut',
      'box Box',
      'combine Fusion',
    ],
    bodies: ['Fusion'],
  },
  compounds: {
    // The compound at the top comes in as its members (S12b): two trees of one primitive each.
    trees: {
      Cut: 'history',
      Cut001: 'leaves',
      Box: 'history',
      Cylinder: 'history',
    },
    outcomes: {
      Box001: 'feature',
      Cylinder001: 'feature',
      Cylinder002: 'feature',
      Holes: 'members',
      Cut: 'feature',
      Blocks: 'leaf:compound',
      Box004: 'feature',
      Cut001: 'feature',
      Box: 'feature',
      Cylinder: 'feature',
    },
    features: [
      'box Box001',
      'cylinder Cylinder001',
      'cylinder Cylinder002',
      'combine Cut',
      'import Import Blocks',
      'box Box004',
      'combine Cut001',
      'combine Cut001 2',
      // The compound at the top's members, after the rest of the file (S12b).
      'box Box',
      'cylinder Cylinder',
    ],
    bodies: ['Cut', 'Cut001', 'Cut001 2', 'Box', 'Cylinder'],
  },
  in_containers: {
    trees: {
      Cut: 'history',
      Fusion: 'history',
      Cut001: 'history',
    },
    outcomes: {
      Box: 'feature',
      Cylinder: 'feature',
      Cut: 'feature',
      Box001: 'feature',
      Box002: 'feature',
      Fusion: 'feature',
      Box003: 'feature',
      Cylinder001: 'feature',
      Cut001: 'feature',
    },
    features: [
      'box Box',
      'cylinder Cylinder',
      'combine Cut',
      'move Place Cut',
      'box Box001',
      'box Box002',
      'combine Fusion',
      'box Box003',
      'cylinder Cylinder001',
      'combine Cut001',
      'move Place Cut001',
    ],
    bodies: ['Cut', 'Fusion', 'Cut001'],
  },
  refine: {
    trees: {
      Fusion: 'history',
      FusionRefined: 'history',
      CutRefined: 'history',
    },
    outcomes: {
      Box: 'feature',
      Box001: 'feature',
      Fusion: 'feature',
      Box002: 'feature',
      Box003: 'feature',
      FusionRefined: 'feature',
      Box004: 'feature',
      Box005: 'feature',
      Step: 'feature',
      Box006: 'feature',
      CutRefined: 'feature',
    },
    features: [
      'box Box',
      'box Box001',
      'combine Fusion',
      'box Box002',
      'box Box003',
      'combine FusionRefined',
      'box Box004',
      'box Box005',
      'combine Step',
      'box Box006',
      'combine CutRefined',
    ],
    bodies: ['Fusion', 'FusionRefined', 'CutRefined'],
  },
  split: {
    trees: {
      Cut: 'history',
    },
    outcomes: {
      Box: 'feature',
      Box001: 'feature',
      Cut: 'feature',
    },
    features: ['box Box', 'box Box001', 'combine Cut'],
    bodies: ['Cut', 'Cut 2'],
  },
  fillets_chamfers: {
    trees: {
      Chamfer: 'history',
      ChamferRim: 'history',
      ChamferTwoSizes: 'history',
      FilletVariable: 'shape:edges',
      FilletTwoRadii: 'shape:edges',
      CutAbove: 'history',
    },
    outcomes: {
      Box001: 'feature',
      Chamfer: 'feature',
      Cylinder001: 'feature',
      ChamferRim: 'feature',
      Box002: 'feature',
      ChamferTwoSizes: 'feature',
      Box: 'feature',
      Cylinder: 'feature',
      Cut: 'feature',
      Fillet: 'feature',
      Cylinder002: 'feature',
      CutAbove: 'feature',
    },
    features: [
      'box Box001',
      'chamfer Chamfer',
      'cylinder Cylinder001',
      'chamfer ChamferRim',
      'box Box002',
      'chamfer ChamferTwoSizes',
      'box Box',
      'cylinder Cylinder',
      'combine Cut',
      'fillet Fillet',
      'cylinder Cylinder002',
      'combine CutAbove',
      'import Import FilletVariable',
      'import Import FilletTwoRadii',
    ],
    bodies: [
      'Chamfer',
      'ChamferRim',
      'ChamferTwoSizes',
      'CutAbove',
      'FilletVariable',
      'FilletTwoRadii',
    ],
  },
  mirrors: {
    trees: {
      Common: 'leaves',
    },
    outcomes: {
      MirrorTilted: 'leaf:type',
      Box002: 'feature',
      Common: 'feature',
    },
    features: [
      'import Import MirrorTilted',
      'box Box002',
      'combine Common',
      'import Import Mirror',
    ],
    bodies: ['Common', 'Mirror'],
  },
  bound: {
    trees: {
      Cut: 'history',
      Sphere: 'history',
      Torus: 'history',
    },
    outcomes: {
      Box: 'feature',
      Cylinder: 'feature',
      Cut: 'feature',
      Sphere: 'feature',
      Torus: 'feature',
    },
    features: [
      'box Box',
      'cylinder Cylinder',
      'combine Cut',
      'move Place Cut',
      'sphere Sphere',
      'torus Torus',
    ],
    bodies: ['Cut', 'Sphere', 'Torus'],
  },
  deep_chain: {
    trees: {
      Cut011: 'history',
    },
    outcomes: {
      Box: 'feature',
      Cylinder: 'feature',
      Cut: 'feature',
      Cylinder001: 'feature',
      Cut001: 'feature',
      Cylinder002: 'feature',
      Cut002: 'feature',
      Cylinder003: 'feature',
      Cut003: 'feature',
      Cylinder004: 'feature',
      Cut004: 'feature',
      Cylinder005: 'feature',
      Cut005: 'feature',
      Cylinder006: 'feature',
      Cut006: 'feature',
      Cylinder007: 'feature',
      Cut007: 'feature',
      Cylinder008: 'feature',
      Cut008: 'feature',
      Cylinder009: 'feature',
      Cut009: 'feature',
      Cylinder010: 'feature',
      Cut010: 'feature',
      Cylinder011: 'feature',
      Cut011: 'feature',
    },
    features: [
      'box Box',
      'cylinder Cylinder',
      'combine Cut',
      'cylinder Cylinder001',
      'combine Cut001',
      'cylinder Cylinder002',
      'combine Cut002',
      'cylinder Cylinder003',
      'combine Cut003',
      'cylinder Cylinder004',
      'combine Cut004',
      'cylinder Cylinder005',
      'combine Cut005',
      'cylinder Cylinder006',
      'combine Cut006',
      'cylinder Cylinder007',
      'combine Cut007',
      'cylinder Cylinder008',
      'combine Cut008',
      'cylinder Cylinder009',
      'combine Cut009',
      'cylinder Cylinder010',
      'combine Cut010',
      'cylinder Cylinder011',
      'combine Cut011',
    ],
    bodies: ['Cut011'],
  },
};

describe('every fixture document, in full', () => {
  it('has an expectation for each document', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...PART_DOCUMENTS].sort());
  });

  it.each(PART_DOCUMENTS)('%s', { timeout: 120_000 }, async (name) => {
    const r = await run(name);
    const want = EXPECTED[name] as Expected;
    const doc = r.design.doc;
    expect(
      Object.fromEntries(
        r.report.trees.map((t) => [
          t.object,
          t.outcome === 'shape' || t.outcome === 'left-out'
            ? `${t.outcome}:${t.reason}`
            : t.outcome,
        ]),
      ),
    ).toEqual(want.trees);
    expect(
      Object.fromEntries(
        r.report.trees.flatMap((t) =>
          t.nodes.map((n) => [n.object, n.outcome === 'leaf' ? `leaf:${n.reason}` : n.outcome]),
        ),
      ),
    ).toEqual(want.outcomes);
    expect(doc.features.map((f) => `${f.type} ${f.name}`)).toEqual(want.features);
    expect(
      Object.values(doc.bodies ?? {}).map(
        (b) => `${b.name}${b.visible === false ? ' (hidden)' : ''}`,
      ),
    ).toEqual(want.bodies);

    // Each top that came in as a tree measures as FreeCAD's own numbers say.
    const rebuilt = await kernel.rebuild(r.design.toJSON(), r.files);
    expect(rebuilt.failed).toEqual([]);
    for (const t of r.report.trees) {
      if (t.outcome !== 'history' && t.outcome !== 'leaves') continue;
      const fc = partCase(name).objects.find((o) => o.object === t.object)?.measure;
      if (!fc) throw new Error(`${t.object} has no measure`);
      const ms = t.bodies.map((b) => rebuilt.bodies[b]);
      const sum = (f: (m: NonNullable<(typeof ms)[number]>) => number) =>
        ms.reduce((v, m) => v + (m ? f(m) : 0), 0);
      expect(
        sum((m) => m.solids),
        t.object,
      ).toBe(fc.solids);
      expect(Math.abs(sum((m) => m.volume) / fc.volume - 1), t.object).toBeLessThan(1e-6);
      expect(Math.abs(sum((m) => m.area) / fc.area - 1), t.object).toBeLessThan(1e-6);
      // FreeCAD's numbers are in a container's frame; a top moved out of it has only its size.
      if (t.containerMove) continue;
      // FreeCAD's `BoundBox` can be looser than a tight box (a torus's): ours lies inside it, and
      // the centre of mass says where the body is.
      const volume = sum((m) => m.volume);
      const [x0, y0, z0, x1, y1, z1] = fc.box as [number, number, number, number, number, number];
      const diagonal = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      [0, 1, 2].forEach((k) => {
        const low = Math.min(...ms.map((m) => m?.box.min[k] ?? Infinity));
        const high = Math.max(...ms.map((m) => m?.box.max[k] ?? -Infinity));
        expect(low, `${t.object} box`).toBeGreaterThanOrEqual((fc.box[k] as number) - 1e-6);
        expect(high, `${t.object} box`).toBeLessThanOrEqual((fc.box[k + 3] as number) + 1e-6);
        const centre = sum((m) => (m.centre[k] as number) * m.volume) / volume;
        expect(Math.abs(centre - (fc.centre[k] as number)), `${t.object} centre`).toBeLessThan(
          1e-6 * diagonal,
        );
      });
    }
  });
});

describe('what S11 rests on from outside the package', () => {
  it('every stored leaf is written with reals the STEP reader needs no help with', {
    timeout: 120_000,
  }, async () => {
    // ISO 10303-21 reals have a point; `step-reals.ts` rewrites those that don't. Ours never need it.
    let leaves = 0;
    for (const name of ['stored_leaf', 'extrusion_leaf', 'mirrors', 'compounds']) {
      const r = await run(name);
      for (const bytes of r.files.values()) {
        leaves++;
        const data = strFromU8(bytes).split('DATA;')[1] ?? '';
        expect(data.replace(/'[^']*'/g, "''")).not.toMatch(/[(,\s][-+]?\d+[eE][-+]?\d/);
      }
    }
    expect(leaves).toBeGreaterThan(3);
  });

  /** `BoxTurnedZ` (20 by 10) with its length bound to `expr` and its width to half of it. */
  const boundBox = (alias: string, value: string, expr: string): PartFileOptions => ({
    edit: (o, xml) =>
      o !== 'BoxTurnedZ'
        ? xml
        : xml.replace(
            /<ExpressionEngine count="0"><\/ExpressionEngine>/,
            `<ExpressionEngine count="2"><Expression path="Length" expression="${expr}"/><Expression path="Width" expression="(${expr}) / 2"/></ExpressionEngine>`,
          ),
    extra: [
      {
        name: 'Sheet',
        type: 'Spreadsheet::Sheet',
        xml: `<Object name="Sheet"><Properties Count="2" TransientCount="0"><Property name="Label" type="App::PropertyString"><String value="Sheet"/></Property><Property name="cells" type="Spreadsheet::PropertySheet"><Cells Count="1" xlink="1"><XLinks count="0"></XLinks><Cell address="A1" content="${value}" alias="${alias}"/></Cells></Property></Properties></Object>`,
      },
    ],
  });

  it('a turned box’s centre stays a number where twice its bound sizes pass core’s length limit', {
    timeout: 120_000,
  }, async () => {
    // Each size holds about 7,500 characters of Extrudo text: inside core's 10,000, its centre,
    // which reads both sizes, past it.
    const alias = `s${'a'.repeat(58)}`;
    const terms = 60;
    const sum = Array(terms).fill(`Sheet.${alias}`).join(' + ');
    const r = await run('placed_primitives', boundBox(alias, `=20 / ${terms}`, `(${sum}) % 1000`));
    const tree = r.report.trees.find((t) => t.object === 'BoxTurnedZ');
    expect(tree?.outcome).toBe('history');
    expect([...(tree?.nodes[0]?.bound ?? [])].sort()).toEqual(['length', 'width']);
    const f = r.design.doc.features.find((x) => x.name === 'BoxTurnedZ');
    const inputs = f?.inputs as Record<string, { expr: string }>;
    expect(inputs.length?.expr.length).toBeGreaterThan(5_000);
    expect(inputs.x?.expr).toMatch(/^-?[0-9.e-]+ mm$/);
    expect(inputs.y?.expr).toMatch(/^-?[0-9.e-]+ mm$/);
    const values = evaluateParameters(r.design.doc).inputs.get(f?.id as never);
    expect([...(values?.values() ?? [])].every((v) => v.ok)).toBe(true);
  });

  it('an expression whose Extrudo text passes core’s length limit is a number, for that reason', {
    timeout: 120_000,
  }, async () => {
    const alias = `s${'a'.repeat(58)}`;
    const terms = 45;
    const sum = Array(terms).fill(`Sheet.${alias}`).join(' + ');
    // `%` writes its operands twice; nested once more the text is past 10,000 characters.
    const r = await run(
      'placed_primitives',
      boundBox(alias, `=20 / ${terms}`, `((${sum}) % 1000) % 1000`),
    );
    expect(r.report.trees.find((t) => t.object === 'BoxTurnedZ')?.outcome).toBe('history');
    const out = r.report.parameters.expressions.filter((e) => e.object === 'BoxTurnedZ');
    expect(out.map((e) => [e.outcome, e.number])).toEqual([
      ['limit', true],
      ['limit', true],
    ]);
  });
});
