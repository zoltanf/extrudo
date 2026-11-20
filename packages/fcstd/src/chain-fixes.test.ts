/**
 * What loose chains must leave alone and report truly (P6-25 S12a, ADR-0144): a body keeps what a
 * loose feature shares with it, a chain's stop is its own feature's, only loose chains are planned,
 * and the face a sketch stays on is tried on every path that adds a sketch.
 */
import type { ExtrudoDocument } from '@extrudo/core';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { asOldFile, type ChainExtraObject, chainBrep, chainCase, chainFile } from './chain-parts';
import { finalShapes } from './final-shapes';
import { documentXml, fcstd, guiXml } from './fixtures';
import { type FcstdImportOptions, type FcstdImportResult, importFcstd } from './import';
import type { ImportKernel, RebuildResult } from './import-kernel';
import { looseChains } from './loose-chains';
import { readFcstd } from './model';
import { nodeImportKernel } from './node-kernel-test-support';
import {
  P,
  PATTERN_FIXTURES,
  type PartChange,
  partObjects,
  partFile as patternFile,
} from './pattern-parts';
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

/** A fixture body's features with the body taken away: loose features of a 1.1 file. */
function loose(name: string, change: PartChange = {}): Uint8Array {
  const fixtures = name.startsWith('hole') ? PATTERN_FIXTURES : REF_FIXTURES;
  const { objects, entries } = partObjects(name, change, { fixtures });
  const kept = objects.filter((o) => o.type !== 'PartDesign::Body' && !o.type.startsWith('App::'));
  return fcstd({
    'Document.xml': documentXml(kept, { label: 'Parts', version: '1.1.4R20260101 (Git)' }),
    'GuiDocument.xml': guiXml([]),
    ...entries,
  });
}

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

  it('a face try and its fixed-plane try that both fail are no fallback', {
    timeout: 60_000,
  }, async () => {
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
    expect([c?.faceFallbacks, c?.secondAttempts]).toEqual([undefined, 0]);
    expect(c?.steps.map((s) => s.shape)).toEqual(['Hole']);
  });
});

/** The sketch named `name` in a document sent to the kernel, when it sits on a face. */
function sketchOnFace(sent: ExtrudoDocument, name: string) {
  const f = sent.features.find((x) => x.type === 'sketch' && x.name === name);
  const refs = (f?.inputs as { plane?: { refs?: readonly { kind: string }[] } } | undefined)?.plane
    ?.refs;
  return f && refs?.[0]?.kind === 'face' ? f : undefined;
}

/** The node kernel with its `rebuild` wrapped: `wrap` may answer in its place. */
function kernelWith(
  wrap: (
    sent: ExtrudoDocument,
    real: () => Promise<RebuildResult>,
  ) => Promise<RebuildResult> | undefined,
) {
  const node = nodeImportKernel();
  const k: ImportKernel = {
    ...node,
    rebuild: (...args) => wrap(args[0], () => node.rebuild(...args)) ?? node.rebuild(...args),
  };
  return k;
}
const has = (sent: ExtrudoDocument, name: string) => sent.features.some((x) => x.name === name);

describe('the second try on a face', () => {
  it('a sketch with no usable face is tried once', { timeout: 60_000 }, async () => {
    let boss = 0;
    const k = kernelWith((sent) => {
      if (has(sent, 'Boss')) boss++;
      return undefined;
    });
    const r = await run(
      chainFile('chain_five', {
        edit: (name, xml) =>
          name === 'Sketch002'
            ? xml.replace(/<Link obj="[^"]*" sub="[^"]*"\/>/, '')
            : name === 'Boss'
              ? setLength(7)(xml)
              : xml,
      }),
      { kernel: k },
    );
    const c = r.report.bodies[0];
    expect(c?.steps.map((s) => [s.reason, s.shape])).toEqual([['differs', 'Boss']]);
    expect(c?.faceFallbacks).toBeUndefined();
    // The try of the boss itself, then the rebuilds of what comes after it never name it.
    expect(boss).toBe(1);
  });

  it('a fixed-plane try that held after its face try is the fallback counted', {
    timeout: 60_000,
  }, async () => {
    const k = kernelWith((sent, real) => {
      const f = sketchOnFace(sent, 'Sketch001');
      if (!f) return undefined;
      return real().then((r) => ({
        ...r,
        failed: [...r.failed, { feature: f.id, message: 'not on this face' }],
      }));
    });
    const r = await run(chainFile('pad_pocket'), { kernel: k });
    const c = r.report.bodies[0];
    expect(c?.outcome).toBe('history');
    expect(c?.sketches.map((s) => s.plane)).toEqual(['origin', 'offset']);
    expect([c?.faceFallbacks, c?.secondAttempts]).toEqual([1, 0]);
    expect(c?.mapped.at(-1)?.secondAttempt).toBeUndefined();
  });

  it('a face try that ran out of time has no second try', { timeout: 60_000 }, async () => {
    let pocket = 0;
    const k = kernelWith((sent) => {
      if (has(sent, 'Pocket')) pocket++;
      return sketchOnFace(sent, 'Sketch001') ? new Promise(() => undefined) : undefined;
    });
    const r = await run(chainFile('pad_pocket'), { kernel: k, shapeTimeoutMs: 5_000 });
    const c = r.report.bodies[0];
    expect([c?.outcome, c?.stop?.reason, c?.faceFallbacks]).toEqual(['shape', 'time', undefined]);
    expect(pocket).toBe(1);
    expect(r.report.restarts).toBe(1);
  });

  it('a kernel that fails on the face try has no second try either', {
    timeout: 60_000,
  }, async () => {
    let pocket = 0;
    const k = kernelWith((sent) => {
      if (has(sent, 'Pocket')) pocket++;
      return sketchOnFace(sent, 'Sketch001') ? Promise.reject(new Error('trap')) : undefined;
    });
    const r = await run(chainFile('pad_pocket'), { kernel: k });
    expect([r.report.bodies[0]?.stop?.reason, pocket]).toEqual(['kernel', 1]);
  });

  it('a later target’s fixed-plane try is that target’s first attempt no more than its face try', {
    timeout: 120_000,
  }, async () => {
    // Attached to the first wall's outer face, up to the first face it meets: two targets.
    let found: FcstdImportResult | undefined;
    for (let n = 1; n <= 16 && !found; n++) {
      let tries = 0;
      const k = kernelWith((sent, real) => {
        const f = sent.features.find((x) => x.name === 'Bridge');
        if (!f) return undefined;
        tries++;
        // The first target fails on its face and its plane, the second on its face.
        return tries > 3
          ? undefined
          : real().then((r) => ({
              ...r,
              failed: [...r.failed, { feature: f.id, message: 'it goes nowhere' }],
            }));
      });
      const r = await run(
        loose('pad_up_to_first', { BridgeSketch: { support: [['Walls', `Face${n}`]] } }),
        { kernel: k },
      );
      const c = r.report.bodies.find((b) => b.object === 'Bridge');
      if (c?.faceFallbacks === 1) found = r;
    }
    const c = found?.report.bodies.find((b) => b.object === 'Bridge');
    expect(c?.outcome).toBe('history');
    expect(c?.secondAttempts).toBe(1);
    expect(c?.mapped.at(-1)?.secondAttempt).toBe(true);
    expect(c?.mapped.at(-1)?.upTo?.tries).toBe(2);
  });
});

describe('a body’s hole', () => {
  it('a first cut the rebuild reports as failed is a step, as it always was', {
    timeout: 60_000,
  }, async () => {
    let tries = 0;
    const k = kernelWith((sent, real) => {
      const f = sent.features.find((x) => x.type === 'hole');
      if (!f) return undefined;
      tries++;
      return real().then((r) => ({
        ...r,
        failed: [...r.failed, { feature: f.id, message: 'it cuts nothing' }],
      }));
    });
    // A cut the file names by index only: two cuts to try, a counterbore and a countersink.
    const cut = P.raw('<Integer value="5"/>');
    const r = await run(
      patternFile('hole_countersink', { Hole: { props: { HoleCutType: cut } } }),
      {
        kernel: k,
      },
    );
    const body = r.report.bodies[0];
    expect([tries, body?.secondAttempts]).toEqual([1, 0]);
    expect(body?.stop?.reason).toBe('failed');
  });
});

describe('a cap that ends a chain on a foreign base', () => {
  it('a step the cap refuses names the chain’s first feature', { timeout: 60_000 }, async () => {
    const r = await run(chainFile('on_part_box'), { maxSteps: 0 });
    const stop = r.report.bodies[0]?.stop;
    expect([stop?.object, stop?.reason]).toEqual(['Pad', 'limit']);
    expect(stop?.run?.map((x) => x.object)).not.toContain('Box');
  });

  it('the time running out before the first feature leaves the base out of the run', {
    timeout: 60_000,
  }, async () => {
    const r = await run(chainFile('on_part_box'), { importTimeoutMs: 0 });
    const stop = r.report.bodies[0]?.stop;
    expect([stop?.object, stop?.reason]).toEqual(['Pad', 'import-time']);
    expect(stop?.run?.map((x) => x.object) ?? []).not.toContain('Box');
  });

  it('a base that can’t come in is still named', { timeout: 60_000 }, async () => {
    const r = await run(
      chainFile('on_part_cut', { brep: (o, t) => (o === 'Cut' ? undefined : t) }),
    );
    expect(r.report.bodies[0]?.stop?.object).toBe('Cut');
  });
});

describe('a large stored shape many objects name', () => {
  it('is read once, and the import’s time stays bounded', { timeout: 120_000 }, async () => {
    const n = 200;
    // Noise, so the archive's limit on how far an entry may inflate lets it through.
    const big = new Uint8Array(30 * 1024 * 1024);
    let seed = 1;
    for (let i = 0; i < big.length; i++) {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      big[i] = 33 + (seed % 90);
    }
    big.set(new TextEncoder().encode('CASCADE\nTShapes 1\nSo\n'));
    const extra = Array.from({ length: n }, (_, i): ChainExtraObject[] => [
      {
        name: `F${i}`,
        type: 'Part::Feature',
        xml: `<Object name="F${i}"><Properties Count="1" TransientCount="0"><Property name="Shape" type="Part::PropertyPartShape"><Part file="big.brp"/></Property></Properties></Object>`,
      },
      {
        name: `S${i}`,
        type: 'Sketcher::SketchObject',
        xml: `<Object name="S${i}"><Properties Count="1" TransientCount="0"><Property name="Support" type="App::PropertyLinkSub"><LinkSub value="F${i}" count="1"><Sub value="Face1"/></LinkSub></Property></Properties></Object>`,
      },
      {
        name: `K${i}`,
        type: 'PartDesign::Pocket',
        xml: `<Object name="K${i}"><Properties Count="1" TransientCount="0"><Property name="Sketch" type="App::PropertyLink"><Link value="S${i}"/></Property></Properties></Object>`,
      },
    ]).flat();
    const bytes = chainFile('pad_only', { extra, entries: { 'big.brp': big } });
    const t = performance.now();
    const r = await run(bytes);
    const ms = performance.now() - t;
    expect(r.report.bodies.filter((b) => b.loose?.foreignBase).length).toBe(n);
    expect(ms).toBeLessThan(60_000);
    // The plan alone, on the same file: the entry is inflated once for all of them.
    const doc = readFcstd(bytes);
    const reads = vi.spyOn(doc.entries, 'get');
    const tips = finalShapes(doc).filter((s) => s.kind === 'chain-tip');
    looseChains(doc, tips, { maxFeatures: 500, maxFile: 2_000 });
    expect(reads.mock.calls.filter(([entry]) => entry === 'big.brp').length).toBe(1);
    if (process.env.BENCH) console.log(`${n} objects on one 30 MB entry: ${Math.round(ms)} ms`);
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
