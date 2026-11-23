/**
 * Every S12b fixture document (P6-25, ADR-0144): the timeline in order, the bodies with their
 * names, visibility and components, every body measured against FreeCAD's own numbers, and each
 * outcome; then the wrong cases made by editing a fixture.
 */
import type { Design } from '@extrudo/api';
import { type AttachmentId, updateFeatureInputs } from '@extrudo/core';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { rotate } from './final-shapes';
import { importFcstd } from './import';
import type { ShapeMeasure } from './import-kernel';
import { nodeImportKernel } from './node-kernel-test-support';
import {
  type StructureFileOptions,
  type StructureMeasure,
  structureBrep as structureBrepOf,
  structureDocuments,
  structureFile,
  structureObject,
} from './structure-parts';

let planegcs: PlanegcsModule;
let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  kernel = nodeImportKernel();
});

export async function run(
  name: string,
  options: StructureFileOptions = {},
  more: Partial<Parameters<typeof importFcstd>[2]> = {},
) {
  const result = await importFcstd(structureFile(name, options), name, {
    kernel,
    solver: new SketchSolver(planegcs),
    ...more,
  });
  return { ...result, measures: await measure(result.design, result.files) };
}

/** Every live body measured by a fresh rebuild of the finished design. */
async function measure(design: Design, files: ReadonlyMap<AttachmentId, Uint8Array>) {
  const r = await nodeImportKernel().rebuild(design.toJSON(), files);
  expect(r.failed).toEqual([]);
  return r;
}

const features = (d: Design) => d.doc.features.map((f) => `${f.type} ${f.name}`);
/** The live bodies: name, and `(hidden)` where hidden. */
const bodies = (d: Design, ids: readonly string[]) =>
  ids.map((id) => {
    const b = d.doc.bodies[id as never];
    return `${b?.name ?? id}${b?.visible === false ? ' (hidden)' : ''}`;
  });

/** Combined measures of some bodies. */
function together(ms: readonly ShapeMeasure[]) {
  const min = [0, 1, 2].map((i) => Math.min(...ms.map((m) => m.box.min[i] as number)));
  const max = [0, 1, 2].map((i) => Math.max(...ms.map((m) => m.box.max[i] as number)));
  return { solids: ms.length, volume: ms.reduce((t, m) => t + m.volume, 0), box: [...min, ...max] };
}

/** That bodies measure as FreeCAD's truth: solids, volume (relative) and box (mm). */
export function expectMeasures(
  ms: readonly (ShapeMeasure | undefined)[],
  truth: { solids?: number; volume: number; box: readonly number[] },
  volume = 1e-6,
  box = 1e-4,
) {
  expect(ms.every((m) => m !== undefined)).toBe(true);
  const got = together(ms as ShapeMeasure[]);
  if (truth.solids !== undefined) expect(got.solids).toBe(truth.solids);
  expect(Math.abs(got.volume - truth.volume) / Math.abs(truth.volume)).toBeLessThan(volume);
  for (const [i, v] of got.box.entries())
    expect(Math.abs(v - (truth.box[i] as number))).toBeLessThan(box);
}

/** A box (min then max) turned by a quaternion and moved: the box of its eight corners. */
function placeBox(
  box: readonly number[],
  q: [number, number, number, number],
  t: readonly number[],
) {
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((k) =>
    rotate(q, [
      box[k & 1 ? 3 : 0] as number,
      box[k & 2 ? 4 : 1] as number,
      box[k & 4 ? 5 : 2] as number,
    ]),
  );
  const min = [0, 1, 2].map(
    (i) => Math.min(...corners.map((c) => c[i] as number)) + (t[i] as number),
  );
  const max = [0, 1, 2].map(
    (i) => Math.max(...corners.map((c) => c[i] as number)) + (t[i] as number),
  );
  return [...min, ...max];
}

const world = (doc: string, object: string): StructureMeasure => {
  const w = structureObject(doc, object).world;
  if (!w) throw new Error(`${doc}: ${object} has no world measure`);
  return w;
};
const meshTruth = (doc: string, object: string) => {
  const m = structureObject(doc, object).mesh;
  if (!m) throw new Error(`${doc}: ${object} has no mesh`);
  return m;
};
const measuresOf = (r: Awaited<ReturnType<typeof run>>, ids: readonly string[]) =>
  ids.map((id) => r.measures.bodies[id]);

describe('meshes', () => {
  it('meshes: three mesh bodies where FreeCAD shows them, the sphere hidden', async () => {
    const r = await run('meshes');
    expect(features(r.design)).toEqual([
      'import Import Cube',
      'import Import Turned',
      'import Import Ball',
    ]);
    expect(bodies(r.design, r.measures.ids)).toEqual(['Cube', 'Turned', 'Ball (hidden)']);
    expect(r.report.meshes.map((m) => [m.object, m.outcome, m.pieces])).toEqual([
      ['Mesh', 'in', 1],
      ['Mesh001', 'in', 1],
      ['Mesh002', 'in', 1],
    ]);
    r.report.meshes.forEach((m) => {
      const t = meshTruth('meshes', m.object);
      // FreeCAD measures single-precision points before its placement: 1e-4.
      expectMeasures(
        measuresOf(r, m.bodies),
        { solids: 1, volume: t.volume, box: t.box },
        1e-4,
        1e-3,
      );
    });
    const attachments = Object.values(r.design.doc.attachments ?? {});
    expect(attachments.map((a) => a.mediaType)).toEqual(['model/stl', 'model/stl', 'model/stl']);
    expect(attachments.map((a) => a.fileName)).toEqual(['Cube.stl', 'Turned.stl', 'Ball.stl']);
    expect(r.report.leftOut).toEqual([]);
  });

  it('mesh_in_part: the mesh lands where its moved and turned part shows it', async () => {
    const r = await run('mesh_in_part');
    const mesh = r.report.meshes[0];
    expect(mesh?.outcome).toBe('in');
    const t = meshTruth('mesh_in_part', 'Mesh');
    // FreeCAD's mesh box is in the part's frame: the part moves it by 100 along X and turns it a quarter about Z.
    const box = placeBox(t.box, [0, 0, Math.SQRT1_2, Math.SQRT1_2], [100, 0, 0]);
    expectMeasures(
      measuresOf(r, mesh?.bodies ?? []),
      { solids: 1, volume: t.volume, box },
      1e-6,
      1e-3,
    );
  });

  it('mesh_odd: two pieces are two bodies; the open box, the sheet and the empty mesh are left out', async () => {
    const r = await run('mesh_odd');
    expect(features(r.design)).toEqual(['import Import Two pieces']);
    expect(bodies(r.design, r.measures.ids)).toEqual(['Two pieces', 'Two pieces 2']);
    const t = meshTruth('mesh_odd', 'Mesh');
    expectMeasures(measuresOf(r, r.measures.ids), { solids: 2, volume: t.volume, box: t.box });
    expect(r.report.leftOut.map((l) => [l.object, l.reason, l.detail])).toEqual([
      ['Mesh001', 'not-closed', '4 edges not closed'],
      ['Mesh002', 'not-closed', '4 edges not closed'],
      ['Mesh003', 'empty', undefined],
    ]);
  });

  it('mesh_and_solid: the body with its history, the mesh beside it', async () => {
    const r = await run('mesh_and_solid');
    expect(features(r.design).at(-1)).toBe('import Import Scanned');
    expect(r.report.bodies.map((b) => b.outcome)).toEqual(['history']);
    const t = meshTruth('mesh_and_solid', 'Mesh');
    expectMeasures(measuresOf(r, r.report.meshes[0]?.bodies ?? []), {
      solids: 1,
      volume: t.volume,
      box: t.box,
    });
  });

  it('a mesh with one facet dropped is left out as not closed', async () => {
    const r = await run('meshes', {
      files: (object, _file, bytes) => {
        if (object !== 'Mesh') return bytes;
        // 12 facets to 11: the count and the entry shrink together.
        const out = new Uint8Array(bytes.length - 24);
        out.set(bytes.subarray(0, bytes.length - 48));
        out.set(bytes.subarray(bytes.length - 24), bytes.length - 48);
        const view = new DataView(out.buffer);
        view.setUint32(268, 11, true);
        // Its neighbours no longer name the facet that went.
        for (let f = 0; f < 11; f++)
          for (let k = 3; k < 6; k++) view.setUint32(272 + 96 + 24 * f + 4 * k, 0xffffffff, true);
        return out;
      },
    });
    expect(r.report.meshes[0]).toMatchObject({ outcome: 'left-out', reason: 'not-closed' });
    expect(r.report.meshes.slice(1).map((m) => m.outcome)).toEqual(['in', 'in']);
  });

  it('a missing entry, and an entry that lies, leave the mesh out with the reason', async () => {
    const missing = await run('meshes', { files: (o, _f, b) => (o === 'Mesh' ? undefined : b) });
    expect(missing.report.meshes[0]).toMatchObject({ reason: 'unreadable' });
    const short = await run('meshes', {
      files: (o, _f, b) => (o === 'Mesh' ? b.subarray(0, b.length - 1) : b),
    });
    expect(short.report.meshes[0]).toMatchObject({ reason: 'unreadable' });
    expect(short.report.meshes[0]?.detail).toMatch(/bytes where its counts say/);
  });

  it('two meshes of the same triangles share one STL attachment', async () => {
    const xml = structureObject('meshes', 'Mesh').xml.replace('name="Mesh"', 'name="MeshCopy"');
    const r = await run('meshes', { extra: [{ name: 'MeshCopy', type: 'Mesh::Feature', xml }] });
    expect(r.report.meshes.map((m) => m.outcome)).toEqual(['in', 'in', 'in', 'in']);
    expect(Object.keys(r.design.doc.attachments ?? {})).toHaveLength(3);
  });
});

/** A body's component name, or `-` when it is loose. */
const componentOf = (d: Design, id: string) => {
  const c = d.doc.bodies[id as never]?.component;
  return c ? (d.doc.components ?? []).find((x) => x.id === c)?.name : '-';
};
const ofComponents = (r: Awaited<ReturnType<typeof run>>) =>
  r.measures.ids.map(
    (id) => `${r.design.doc.bodies[id as never]?.name}: ${componentOf(r.design, id)}`,
  );
/** The live bodies named `name` (and "name 2" …). */
const named = (r: Awaited<ReturnType<typeof run>>, name: string) =>
  r.measures.ids.filter((id) => {
    const n = r.design.doc.bodies[id as never]?.name ?? '';
    return n === name || new RegExp(`^${name} \\d+$`).test(n);
  });
const expectWorld = (
  r: Awaited<ReturnType<typeof run>>,
  doc: string,
  object: string,
  body: string,
) => expectMeasures(measuresOf(r, named(r, body)), world(doc, object));
const featureNamed = (d: Design, name: string) => {
  const f = d.doc.features.find((x) => x.name === name);
  if (!f) throw new Error(`no feature ${name}`);
  return f;
};

describe('part containers as components', () => {
  it('part_basic: the body and the cut in "Bracket", the box outside it loose', async () => {
    const r = await run('part_basic');
    expect(ofComponents(r)).toEqual(['Body: Bracket', 'Cut: Bracket', 'Spacer: -']);
    expect(r.report.components).toMatchObject({ parts: 1, partsWithout: 0, overLimit: 0 });
    expect(r.report.components.made.map((c) => [c.name, c.kind, c.bodies])).toEqual([
      ['Bracket', 'part', 2],
    ]);
    // The features that make the bodies carry the component, so a body they make again joins it.
    const id = r.design.doc.components?.[0]?.id;
    expect(featureNamed(r.design, 'BodyPad').component).toBe(id);
    expect(featureNamed(r.design, 'Box').component).toBe(id);
    expect(featureNamed(r.design, 'Spacer').component).toBeUndefined();
    expectWorld(r, 'part_basic', 'Body', 'Body');
    expectWorld(r, 'part_basic', 'Cut', 'Cut');
    expectWorld(r, 'part_basic', 'Box001', 'Spacer');
  });

  it('part_placed: nested parts stand alone, each body in its innermost part, placed as FreeCAD shows it', async () => {
    const r = await run('part_placed');
    expect(ofComponents(r)).toEqual(['Body: Frame', 'Box: Frame', 'Cylinder: Axle']);
    expect(features(r.design)).toContain('move Place Cylinder');
    for (const [o, b] of [
      ['Body', 'Body'],
      ['Box', 'Box'],
      ['Cylinder', 'Cylinder'],
    ] as const)
      expectWorld(r, 'part_placed', o, b);
  });

  it('part_odd: names cleaned and unique ignoring case; none for the empty part; a hidden part as before', async () => {
    const r = await run('part_odd');
    expect(r.report.components.made.map((c) => c.name)).toEqual([
      'In a folder',
      'in a FOLDER (2)',
      'Hidden part',
    ]);
    expect(r.report.components).toMatchObject({ parts: 4, partsWithout: 1 });
    // A hidden part hid nothing before this slice and hides nothing now: its bodies' own state stands.
    expect(bodies(r.design, r.measures.ids)).toEqual(['Box', 'Cylinder', 'Box001']);
    expect(r.design.doc.components?.every((c) => c.visible)).toBe(true);
  });

  it('a body in the folder of a part, and labels empty, long, alike and with control characters', async () => {
    const label = (text: string) => (_o: string, xml: string) =>
      xml.replace(/(<Property name="Label"[^>]*><String value=")[^"]*/, `$1${text}`);
    const r = await run('part_odd', {
      edit: (o, xml) =>
        o === 'Part001'
          ? label('')(o, xml)
          : o === 'Part002'
            ? label(`${'x'.repeat(150)}`)(o, xml)
            : o === 'Part003'
              ? label('A&#9;B&#1;C')(o, xml)
              : xml,
    });
    const names = r.report.components.made.map((c) => c.name);
    expect(names[0]).toBe('Part001');
    expect(names[1]).toBe('x'.repeat(90));
    expect(names[2]).toBe('A B C');
  });
});

describe('links as copies', () => {
  it('links_basic: each link is a copy of what its target became, where FreeCAD shows it', async () => {
    const r = await run('links_basic');
    expect(features(r.design).slice(-3)).toEqual(['move Link', 'move Link001', 'move Link002']);
    expect(r.report.links.map((l) => [l.object, l.outcome, l.target])).toEqual([
      ['Link', 'copy', 'Box'],
      ['Link001', 'copy', 'Cut'],
      ['Link002', 'copy', 'Body'],
    ]);
    for (const o of ['Box', 'Cut', 'Body', 'Link', 'Link001', 'Link002'])
      expectWorld(r, 'links_basic', o, o);
    expect(r.report.shapes).toEqual([]);
  });

  it('a copy follows its target: a longer pad makes a longer copy', async () => {
    const r = await run('links_basic');
    const pad = featureNamed(r.design, 'BodyPad');
    r.design.state.dispatch(
      updateFeatureInputs({
        id: pad.id,
        inputs: { distance: { kind: 'expr', expr: '20 mm', unit: 'length' } },
      }),
    );
    const after = await measure(r.design, r.files);
    const [body] = named({ ...r, measures: after }, 'Body');
    const [copy] = named({ ...r, measures: after }, 'Link002');
    const b = after.bodies[body as string] as ShapeMeasure;
    const c = after.bodies[copy as string] as ShapeMeasure;
    expect(b.volume).toBeGreaterThan((world('links_basic', 'Body').volume as number) * 1.5);
    expect(Math.abs(c.volume - b.volume) / b.volume).toBeLessThan(1e-9);
    // The copy is twice as high as before, as its target is.
    expect(c.box.max[2] - c.box.min[2]).toBeCloseTo(20, 6);
  });

  it('link_transform: LinkTransform off replaces the box’s placement, on keeps it', async () => {
    const r = await run('link_transform');
    for (const o of ['Box', 'Link', 'Link001']) expectWorld(r, 'link_transform', o, o);
  });

  it('link_hidden_target: the copies show, the hidden box stays hidden', async () => {
    const r = await run('link_hidden_target');
    expect(bodies(r.design, r.measures.ids)).toEqual(['Master (hidden)', 'Link', 'Link001']);
    for (const o of ['Link', 'Link001']) expectWorld(r, 'link_hidden_target', o, o);
  });

  it('link_chain: a link to a link copies the box once more', async () => {
    const r = await run('link_chain');
    expect(r.report.links.map((l) => [l.object, l.outcome, l.target])).toEqual([
      ['Link', 'copy', 'Box'],
      ['Link001', 'copy', 'Box'],
    ]);
    for (const o of ['Link', 'Link001']) expectWorld(r, 'link_chain', o, o);
  });

  it('link_to_part: the part’s bodies copied into a component named by the link', async () => {
    const r = await run('link_to_part');
    // The copies keep their sources' names (body names needn't be unique); the component names the link.
    expect(ofComponents(r)).toEqual([
      'Box: Wheel',
      'Cylinder: Wheel',
      'Box: Wheel 2',
      'Cylinder: Wheel 2',
    ]);
    expect(r.report.links[0]).toMatchObject({ outcome: 'copy', part: true, target: 'Part' });
    expectMeasures(measuresOf(r, r.report.links[0]?.bodies ?? []), world('link_to_part', 'Link'));
    // Each copy carries its source's name on its source's geometry: the box's 20 × 20 × 5, the cylinder's.
    for (const [name, source] of [
      ['Box', 'Box'],
      ['Cylinder', 'Cylinder'],
    ] as const) {
      const copy = (r.report.links[0]?.bodies ?? []).find(
        (id) => r.design.doc.bodies[id as never]?.name === name,
      );
      expect(
        Math.abs(
          (r.measures.bodies[copy as string]?.volume ?? 0) / world('link_to_part', source).volume -
            1,
        ),
      ).toBeLessThan(1e-6);
    }
    expect(r.report.leftOut).toEqual([]);
  });

  it('link_array: one copy an element, from the placement list and from the link elements', async () => {
    const r = await run('link_array');
    expect(features(r.design).slice(2)).toEqual([
      'move Link',
      'move Link 2',
      'move Link 3',
      'move Link001',
      'move Link001 2',
      'move Link001 3',
    ]);
    expect(r.report.links.map((l) => [l.object, l.array])).toEqual([
      ['Link', { elements: 3, expanded: true }],
      ['Link001', { elements: 3, expanded: true }],
    ]);
    expect(r.report.linkArrays).toEqual([]);
    expectWorld(r, 'link_array', 'Link', 'Link');
    expectWorld(r, 'link_array', 'Link001', 'Link001');
  });

  it('link_scaled: left out with its reason (S3 brought it in at the wrong size)', async () => {
    const r = await run('link_scaled');
    expect(r.report.links[0]).toMatchObject({ outcome: 'left-out', reason: 'scaled' });
    expect(r.report.leftOut).toEqual([
      { object: 'Link', name: 'Link', reason: 'scaled', detail: 'Link scales what it shows' },
    ]);
    expect(bodies(r.design, r.measures.ids)).toEqual(['Box']);
  });

  it('a link whose target didn’t come in comes in as today', async () => {
    // The box's stored shape is gone: the box is left out, and the link has nothing to copy.
    const r = await run('links_basic', { brep: (o, t) => (o === 'Box' ? undefined : t) });
    expect(r.report.links[0]).toMatchObject({ outcome: 'today', reason: 'target' });
  });
});

describe('compounds at the top', () => {
  it('compound_top: each compound as its members, placed as the compound places them', async () => {
    const r = await run('compound_top');
    expect(r.report.compounds.map((c) => [c.object, c.outcome, c.members, c.nested])).toEqual([
      ['Compound', 'members', ['Box', 'Cylinder'], 0],
      ['Compound001', 'members', ['Body', 'Cut'], 0],
      ['Compound003', 'members', ['Box002', 'Box003', 'Cylinder002'], 1],
    ]);
    // Each compound's members come in together, after the rest of the file, its move with them.
    expect(features(r.design).indexOf('move Place Compound001')).toBe(
      features(r.design).indexOf('combine Cut') + 1,
    );
    expect(r.report.bodies.map((b) => [b.object, b.outcome])).toEqual([['Body', 'history']]);
    expect(r.report.trees.map((t) => [t.object, t.outcome])).toEqual([
      ['Box', 'history'],
      ['Cylinder', 'history'],
      ['Cut', 'history'],
      ['Box002', 'history'],
      ['Box003', 'history'],
      ['Cylinder002', 'history'],
    ]);
    expect(ofComponents(r)).toEqual([
      'Box: Compound',
      'Cylinder: Compound',
      'Body: Compound001',
      'Cut: Compound001',
      'Box002: Compound003',
      'Box003: Compound003',
      'Cylinder002: Compound003',
    ]);
    for (const c of r.report.compounds)
      expectMeasures(measuresOf(r, c.bodies), world('compound_top', c.object));
    expect(r.report.shapes).toEqual([]);
  });

  it('compound_touching: two overlapping boxes come in as two bodies, never fused', async () => {
    const r = await run('compound_touching');
    expect(bodies(r.design, r.measures.ids)).toEqual(['Box', 'Box001']);
    expectMeasures(measuresOf(r, r.measures.ids), world('compound_touching', 'Compound'));
  });

  it('a compound’s member is editable: a longer box', async () => {
    const r = await run('compound_top');
    const box = featureNamed(r.design, 'Box');
    r.design.state.dispatch(
      updateFeatureInputs({
        id: box.id,
        inputs: { length: { kind: 'expr', expr: '20 mm', unit: 'length' } },
      }),
    );
    const after = await measure(r.design, r.files);
    expect(after.bodies[box.id.concat(':0')]?.volume).toBeCloseTo(2000, 6);
  });

  it('a compound whose member is missing comes in as today', async () => {
    const r = await run('compound_top', {
      edit: (o, xml) => (o === 'Box' ? undefined : xml),
    });
    expect(r.report.compounds[0]).toMatchObject({ outcome: 'today', reason: 'missing' });
    expect(r.report.shapes.map((s) => s.object)).toEqual(['Compound']);
  });

  it('a compound whose members don’t add up to its stored shape comes in as today, leaving nothing behind', async () => {
    // The cylinder's stored shape is gone: it holds no solid, so the box alone is one solid short.
    const r = await run('compound_top', { brep: (o, t) => (o === 'Cylinder' ? undefined : t) });
    expect(r.report.compounds[0]).toMatchObject({
      outcome: 'today',
      reason: 'check',
      detail: '2 solids stored, 1 from the members',
    });
    expect(r.report.shapes.map((s) => s.object)).toEqual(['Compound']);
    expect(features(r.design)).not.toContain('box Box');
    expect(named(r, 'Box')).toEqual([]);
  });

  it('a placed compound that falls back leaves what came in before: features, attachments, parameters', async () => {
    // The cut's stored shape is another shape's: the members together no longer measure as the compound.
    const edit: StructureFileOptions = {
      brep: (o, t) => (o === 'Cut' ? structureBrepOf('compound_top', 'Box001') : t),
    };
    const r = await run('compound_top', edit);
    expect(r.report.compounds[1]).toMatchObject({ object: 'Compound001', outcome: 'today' });
    // The same file with no compound tried: everything as before this slice.
    const before = await run('compound_top', edit, { maxCompoundObjects: 0 });
    const kept = (d: Design) =>
      d.doc.features
        .map((f) => `${f.type} ${f.name}`)
        .filter((f) => !/Box00[23]|Cylinder002|Box$|Cylinder$|Import Compound(003)?$/.test(f));
    expect(kept(r.design)).toEqual(kept(before.design));
    const stored = (d: Design) =>
      Object.values(d.doc.attachments ?? {})
        .map((a) => a.name)
        .filter((n) => !/^Compound(003)?$/.test(n))
        .sort();
    expect(stored(r.design)).toEqual(stored(before.design));
    expect(r.report.parameters).toEqual(before.report.parameters);
    expect(r.report.bodies).toEqual([]);
    expect(r.report.leftOut).toEqual([]);
  });

  it('a member that came in as an import and was taken back is neither a shape nor left out', async () => {
    const r = await run('compound_top', {
      types: { Box: 'Part::Feature' },
      brep: (o, t) => (o === 'Cylinder' ? undefined : t),
    });
    expect(features(r.design)).not.toContain('import Import Box');
    expect(r.report.compounds[0]).toMatchObject({ outcome: 'today', reason: 'check' });
    expect(r.report.shapes.map((s) => s.object)).toEqual(['Compound']);
    expect(r.report.leftOut.map((l) => l.object)).not.toContain('Cylinder');
    expect(named(r, 'Box')).toEqual([]);
  });
});

const BODY = (n: number) => [
  ...(n === 0 ? [] : ['offsetPlane BodySketch plane']),
  'sketch BodySketch',
  'extrude BodyPad',
  'offsetPlane BodyHoleSketch plane',
  'sketch BodyHoleSketch',
  'extrude BodyHole',
];

/** Every fixture's timeline in order, and its bodies (name, hidden, component), sorted. */
const TABLE: Readonly<Record<string, { features: readonly string[]; bodies: readonly string[] }>> =
  {
    part_basic: {
      features: [...BODY(0), 'box Box', 'cylinder Cylinder', 'combine Cut', 'box Spacer'],
      bodies: ['Body: Bracket', 'Cut: Bracket', 'Spacer: -'],
    },
    part_placed: {
      features: [
        ...BODY(1),
        'box Box',
        'move Place Box',
        'cylinder Cylinder',
        'move Place Cylinder',
      ],
      bodies: ['Body: Frame', 'Box: Frame', 'Cylinder: Axle'],
    },
    part_odd: {
      features: ['box Box', 'cylinder Cylinder', 'box Box001'],
      bodies: ['Box001: Hidden part', 'Box: In a folder', 'Cylinder: in a FOLDER (2)'],
    },
    links_basic: {
      features: [
        ...BODY(0),
        'box Box',
        'box Box001',
        'cylinder Cylinder',
        'combine Cut',
        'move Link',
        'move Link001',
        'move Link002',
      ],
      bodies: ['Body: -', 'Box: -', 'Cut: -', 'Link001: -', 'Link002: -', 'Link: -'],
    },
    link_transform: {
      features: ['box Box', 'move Link', 'move Link001'],
      bodies: ['Box: -', 'Link001: -', 'Link: -'],
    },
    link_hidden_target: {
      features: ['box Master', 'move Link', 'move Link001'],
      bodies: ['Link001: -', 'Link: -', 'Master (hidden): -'],
    },
    link_to_part: {
      features: ['box Box', 'cylinder Cylinder', 'move Wheel 2'],
      bodies: ['Box: Wheel', 'Box: Wheel 2', 'Cylinder: Wheel', 'Cylinder: Wheel 2'],
    },
    link_chain: {
      features: ['box Box', 'move Link', 'move Link001'],
      bodies: ['Box: -', 'Link001: -', 'Link: -'],
    },
    link_array: {
      features: [
        'box Box',
        'cylinder Cylinder',
        'move Link',
        'move Link 2',
        'move Link 3',
        'move Link001',
        'move Link001 2',
        'move Link001 3',
      ],
      bodies: [
        'Box: -',
        'Cylinder: -',
        'Link 2: -',
        'Link 3: -',
        'Link001 2: -',
        'Link001 3: -',
        'Link001: -',
        'Link: -',
      ],
    },
    link_scaled: { features: ['box Box'], bodies: ['Box: -'] },
    compound_top: {
      features: [
        'box Box',
        'cylinder Cylinder',
        ...BODY(0),
        'box Box001',
        'cylinder Cylinder001',
        'combine Cut',
        'move Place Compound001',
        'box Box002',
        'box Box003',
        'cylinder Cylinder002',
      ],
      bodies: [
        'Body: Compound001',
        'Box002: Compound003',
        'Box003: Compound003',
        'Box: Compound',
        'Cut: Compound001',
        'Cylinder002: Compound003',
        'Cylinder: Compound',
      ],
    },
    compound_touching: {
      features: ['box Box', 'box Box001'],
      bodies: ['Box001: Compound', 'Box: Compound'],
    },
    meshes: {
      features: ['import Import Cube', 'import Import Turned', 'import Import Ball'],
      bodies: ['Ball (hidden): -', 'Cube: -', 'Turned: -'],
    },
    mesh_in_part: {
      features: ['box Box', 'move Place Box', 'import Import Mesh'],
      bodies: ['Box: Scan', 'Mesh: Scan'],
    },
    mesh_odd: {
      features: ['import Import Two pieces'],
      bodies: ['Two pieces 2: -', 'Two pieces: -'],
    },
    mesh_and_solid: {
      features: [...BODY(0), 'import Import Scanned'],
      bodies: ['Body: -', 'Scanned: -'],
    },
  };

describe('every fixture document, in full', () => {
  it('has an expectation for each document', () => {
    expect(Object.keys(TABLE).sort()).toEqual(structureDocuments().sort());
  });

  it.each(structureDocuments())('%s', { timeout: 120_000 }, async (name) => {
    const r = await run(name);
    const want = TABLE[name] as (typeof TABLE)[string];
    expect(features(r.design)).toEqual(want.features);
    expect(
      r.measures.ids
        .map((id) => {
          const b = r.design.doc.bodies[id as never];
          return `${b?.name ?? id}${b?.visible === false ? ' (hidden)' : ''}: ${componentOf(r.design, id)}`;
        })
        .sort(),
    ).toEqual(want.bodies);
  });
});
