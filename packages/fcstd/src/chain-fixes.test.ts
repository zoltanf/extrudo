/**
 * What loose chains must leave alone and report truly (P6-25 S12a, ADR-0144): a body keeps what a
 * loose feature shares with it, a chain's stop is its own feature's, only loose chains are planned,
 * and the face a sketch stays on is tried on every path that adds a sketch.
 */
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { asOldFile, type ChainExtraObject, chainBrep, chainCase, chainFile } from './chain-parts';
import { documentXml, fcstd, guiXml } from './fixtures';
import { type FcstdImportOptions, importFcstd } from './import';
import { nodeImportKernel } from './node-kernel-test-support';
import { PATTERN_FIXTURES, type PartChange, partObjects } from './pattern-parts';
import { REF_FIXTURES } from './reference-parts';

let planegcs: PlanegcsModule;
let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  kernel = nodeImportKernel();
});

const run = (bytes: Uint8Array, limits: Partial<FcstdImportOptions> = {}) =>
  importFcstd(bytes, 'Chains', { kernel, solver: new SketchSolver(planegcs), ...limits });

const setLength = (value: number) => (xml: string) =>
  xml.replace(/(<Property name="Length"[^>]*><Float value=")[^"]*/, `$1${value}`);

/** A copy of a fixture's feature under another name, and its stored shape under that name. */
function copyOf(doc: string, object: string, name: string): ChainExtraObject {
  const o = chainCase(doc).objects.find((x) => x.object === object);
  if (!o) throw new Error(`no ${object}`);
  return {
    name,
    type: o.type,
    xml: o.xml
      .replace(`<Object name="${object}"`, `<Object name="${name}"`)
      .replaceAll(`${object}.Shape.brp`, `${name}.Shape.brp`),
  };
}

/** A PartDesign body holding `member`, its shape the member's. */
const bodyOf = (name: string, member: string): ChainExtraObject => ({
  name,
  type: 'PartDesign::Body',
  xml: `<Object name="${name}"><Properties Count="3" TransientCount="0"><Property name="Group" type="App::PropertyLinkList"><LinkList count="1"><Link value="${member}"/></LinkList></Property><Property name="Tip" type="App::PropertyLink"><Link value="${member}"/></Property><Property name="Shape" type="Part::PropertyPartShape"><Part file="${name}.Shape.brp"/></Property></Properties></Object>`,
});

/** An object of a type of its own that stores `file`, built on `base`. */
const stored = (name: string, type: string, base?: string): ChainExtraObject => ({
  name,
  type,
  xml: `<Object name="${name}"><Properties Count="2" TransientCount="0"><Property name="BaseFeature" type="App::PropertyLink"><Link value="${base ?? ''}"/></Property><Property name="Shape" type="Part::PropertyPartShape"><Part file="${name}.Shape.brp"/></Property></Properties></Object>`,
});

describe('a body and a loose feature that share a sketch', () => {
  const text = () => chainBrep('pad_only', 'Pad');
  const inBody = [copyOf('pad_only', 'Pad', 'BodyPad'), bodyOf('Body', 'BodyPad')];
  const entries = () => ({ 'BodyPad.Shape.brp': text(), 'Body.Shape.brp': text() });

  it('the loose pad first: the body keeps its history', { timeout: 60_000 }, async () => {
    const r = await run(chainFile('pad_only', { extra: inBody, entries: entries() }));
    const body = r.report.bodies.find((b) => b.object === 'Body');
    expect([body?.outcome, body?.stop?.detail]).toEqual(['history', undefined]);
    expect(r.report.bodies.find((b) => b.object === 'Pad')?.outcome).toBe('history');
  });

  it('the body first: both keep their history', { timeout: 60_000 }, async () => {
    const r = await run(chainFile('pad_only', { before: inBody, entries: entries() }));
    expect(r.report.bodies.map((b) => [b.object, b.outcome])).toEqual([
      ['Body', 'history'],
      ['Pad', 'history'],
    ]);
  });

  it('the body as a tree’s operand keeps its history', { timeout: 120_000 }, async () => {
    const slab = chainBrep('tip_in_tree', 'Slab');
    const r = await run(
      chainFile('tip_in_tree', {
        // The fuse now uses a body that shares the loose slab's sketch.
        edit: (name, xml) =>
          name === 'Fusion' ? xml.replace('<Link value="Slab"', '<Link value="Body"') : xml,
        extra: [copyOf('tip_in_tree', 'Slab', 'BodySlab'), bodyOf('Body', 'BodySlab')],
        entries: { 'BodySlab.Shape.brp': slab, 'Body.Shape.brp': slab },
      }),
    );
    const fusion = r.report.trees.find((t) => t.object === 'Fusion');
    const node = fusion?.nodes.find((n) => n.object === 'Body');
    expect([node?.outcome, node?.body?.stop?.reason]).toEqual(['body', undefined]);
    expect(fusion?.outcome).toBe('history');
  });
});

describe('the stop of a chain on a foreign base', () => {
  it('is its own feature’s, not the base’s', { timeout: 60_000 }, async () => {
    const r = await run(
      chainFile('on_part_cut', {
        edit: (name, xml) => (name === 'Pad' ? setLength(5)(xml) : xml),
      }),
    );
    const c = r.report.bodies[0];
    expect([c?.outcome, c?.stop?.object, c?.stop?.reason]).toEqual(['shape', 'Pad', 'differs']);
    expect(c?.stop?.run).toBeUndefined();
  });

  it('a step that moved on past the base says why it did', { timeout: 60_000 }, async () => {
    const r = await run(
      chainFile('on_part_box', {
        edit: (name, xml) => (name === 'Pad' ? setLength(6)(xml) : xml),
      }),
    );
    const c = r.report.bodies[0];
    expect(c?.outcome).toBe('history');
    expect(c?.steps.map((s) => [s.reason, s.shape])).toEqual([['differs', 'Pad']]);
  });

  it('a base that can’t come in stays the reason', { timeout: 60_000 }, async () => {
    const r = await run(
      chainFile('on_part_cut', { brep: (o, t) => (o === 'Cut' ? undefined : t) }),
    );
    expect(r.report.bodies[0]?.stop?.reason).toBe('foreign-base');
  });
});

describe('what is planned as a loose chain', () => {
  it('a binder at the top is no loose chain', { timeout: 60_000 }, async () => {
    const r = await run(
      chainFile('pad_only', {
        extra: [stored('Binder', 'PartDesign::SubShapeBinder')],
        entries: { 'Binder.Shape.brp': chainBrep('pad_only', 'Pad') },
      }),
    );
    expect(r.report.bodies.map((b) => b.object)).toEqual(['Pad']);
    expect(r.report.shapes.map((s) => s.object)).toEqual(['Binder']);
  });

  it('a tip the walk can never rebuild walks nothing', { timeout: 60_000 }, async () => {
    const r = await run(
      chainFile('chain_five', {
        extra: [stored('Python', 'PartDesign::FeaturePython', 'Lug')],
        entries: { 'Python.Shape.brp': chainBrep('chain_five', 'Lug') },
      }),
    );
    expect(r.design.doc.features.map((f) => f.type)).toEqual(['import']);
    const c = r.report.bodies[0];
    expect([c?.object, c?.outcome, c?.stop?.reason, c?.mapped.length]).toEqual([
      'Python',
      'shape',
      'type',
      0,
    ]);
  });
});

describe('the face a sketch stays on', () => {
  /** A fixture body's features with the body taken away: loose features of a 1.1 file. */
  function loose(name: string, change: PartChange = {}): Uint8Array {
    const fixtures = name.startsWith('hole') ? PATTERN_FIXTURES : REF_FIXTURES;
    const { objects, entries } = partObjects(name, change, { fixtures });
    const kept = objects.filter(
      (o) => o.type !== 'PartDesign::Body' && !o.type.startsWith('App::'),
    );
    return fcstd({
      'Document.xml': documentXml(kept, { label: 'Parts', version: '1.1.4R20260101 (Git)' }),
      'GuiDocument.xml': guiXml([]),
      ...entries,
    });
  }

  it.each([
    ['a revolution about an edge', 'revolution_about_edge', 'Revolution', 'RevSketch', 'Pad'],
    ['a groove about an edge', 'groove_about_edge', 'Groove', 'GrooveSketch', 'Pad'],
    ['a pocket up to a face', 'pocket_up_to_face', 'Bore', 'BoreSketch', 'Walls'],
    ['a hole', 'hole_through', 'Hole', 'HoleSketch', 'Pad'],
  ])('%s', { timeout: 120_000 }, async (_, name, tip, sketch, base) => {
    // The fixture's sketch lies in a face of its base: attached to that face, it stays on it.
    let planes: unknown[] = [];
    for (let n = 1; n <= 16 && !planes.includes('face'); n++) {
      const r = await run(loose(name, { [sketch]: { support: [[base, `Face${n}`]] } }));
      const c = r.report.bodies.find((b) => b.object === tip);
      expect([c?.outcome, c?.steps.length]).toEqual(['history', 0]);
      planes = c?.sketches.map((x) => x.plane) ?? [];
    }
    expect(planes.at(-1)).toBe('face');
  });

  it('a try that falls back to the fixed plane is counted apart', { timeout: 60_000 }, async () => {
    const r = await run(
      chainFile('chain_five', {
        edit: (name, xml) =>
          name === 'Sketch001'
            ? xml.replace(/<Property name="Placement".*?<\/Property>/s, (p) =>
                p.replace(/ Px="[^"]*"/, ' Px="1"'),
              )
            : xml,
      }),
    );
    const c = r.report.bodies[0];
    expect([c?.faceFallbacks, c?.secondAttempts]).toEqual([1, 0]);
  });
});

describe('a sketch on no face in an old file', () => {
  it('a revolution on one comes in whole', { timeout: 60_000 }, async () => {
    const r = await run(
      asOldFile('revolved', '0.14', {
        edit: (name, xml) => (name === 'Groove' || name === 'Sketch001' ? undefined : xml),
      }),
    );
    expect(r.report.bodies.map((b) => [b.object, b.outcome])).toEqual([['Revolution', 'history']]);
  });

  it('a groove on one says nothing of what it cuts: as today', { timeout: 60_000 }, async () => {
    const r = await run(asOldFile('revolved', '0.14'));
    expect(r.report.bodies.map((b) => [b.object, b.outcome, b.stop?.reason])).toEqual([
      ['Revolution', 'history', undefined],
      ['Groove', 'shape', 'no-base'],
    ]);
  });
});
