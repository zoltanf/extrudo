// Text in the kernel (P4-03, ADR-0058 §5): the sketch evaluator stages a
// text's placed sub-curves, its profiles mark the ink (`SketchProfileInfo.text`),
// a whole-text reference (`sketchEntity` to `<sketch>/<text>`) takes every ink
// face, and the evaluator warns about fonts it lacks. Real OCCT in Node,
// `strictLeaks` like the other feature tests. The font is loaded the way the
// benchmark fixtures are read (`?url&inline`, `packages/kernel/src/
// benchmarks.test.ts`); the kernel tsconfig has no Node types.
import {
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  type GeomRef,
  originPlaneRef,
  type SketchData,
  type SketchEntity,
  type SketchEntityId,
  sketchInputs,
} from '@extrudo/core';
import { BUNDLED_FONTS, DEFAULT_FONT } from '@extrudo/fonts';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { loadFont } from '@extrudo/sketch/text';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import interRegular from '../../../fonts/fonts/inter-regular.ttf?url&inline';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { FeatureOutput, KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import type { SketchOutputData } from './sketch';

/** The bytes of a `data:` URL (Vite's `?url&inline` import of a binary file). */
function bytesOf(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** `BENCH=1` times the recompute (the kernel tsconfig has no Node types). */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;

let kernel: Kernel;
let engine: RecomputeEngine;
let registry: FeatureRegistry<KernelFeatureDefinition>;
/** The output of each feature's latest evaluation (see the beforeEach wrap). */
const seen = new Map<string, FeatureOutput>();

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  // The manifest's default font is the file the test inlines.
  expect(BUNDLED_FONTS.find((f) => f.id === DEFAULT_FONT)?.file).toBe('inter-regular.ttf');
  loadFont(DEFAULT_FONT, bytesOf(interRegular));
});

beforeEach(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  registry = new FeatureRegistry<KernelFeatureDefinition>();
  for (const definition of testFeatures().registry.list()) {
    registry.register({
      ...definition,
      evaluate(ctx) {
        const output = definition.evaluate(ctx);
        seen.set(ctx.feature.id, output);
        return output;
      },
    });
  }
  engine = new RecomputeEngine(kernel, registry, { strictLeaks: true });
});

afterAll(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;
type XY = readonly [number, number];

// ------------------------------------------------------------------ helpers

interface TextOptions {
  font?: string;
  align?: 'left' | 'center' | 'right';
  construction?: boolean;
}

/** A text entity with its two points, as the Text tool would make them. */
function addText(
  b: SketchBuilder,
  anchor: XY,
  top: XY,
  text: string,
  options: TextOptions = {},
): SketchEntityId {
  const a = b.point(...anchor);
  const t = b.point(...top);
  const id = b.id('t');
  const entity: SketchEntity = {
    type: 'text',
    anchor: a as SketchEntityId,
    top: t as SketchEntityId,
    text,
    font: options.font ?? DEFAULT_FONT,
    align: options.align ?? 'left',
    construction: options.construction ?? false,
  };
  b.entities[id] = entity;
  return id as SketchEntityId;
}

function rect(b: SketchBuilder, x0: number, y0: number, x1: number, y1: number): void {
  b.line(x0, y0, x1, y0);
  b.line(x1, y0, x1, y1);
  b.line(x1, y1, x0, y1);
  b.line(x0, y1, x0, y0);
}

function sketchFeature(id: string, data: SketchData): Feature {
  return {
    ...testFeature(id, 'sketch'),
    inputs: sketchInputs(originPlaneRef('origin:xy'), data),
  };
}

function extrude(id: string, refs: GeomRef[], distance = '2 mm'): Feature {
  return { ...testFeature(id, 'extrude'), inputs: extrudeInputs(refs, { distance }) };
}

/** The whole-text reference: the sketch feature and the text entity within it. */
const textRef = (sketchId: string, textId: SketchEntityId): GeomRef => ({
  kind: 'sketchEntity',
  id: `${sketchId}/${textId}`,
});

async function run(doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

function ok(result: Done): Done {
  for (const [id, s] of Object.entries(result.features)) {
    if (s.status !== 'ok') throw new Error(`${id}: ${s.status} ${s.message ?? ''}`);
  }
  return result;
}

const status = (result: Done, id: string): FeatureStatus =>
  result.features[id as FeatureId] ?? { status: 'ok' };

/** Total volume of the bodies the last recompute returned. */
function volumeOf(result: Done): number {
  let total = 0;
  for (const { id } of result.bodies) {
    const shape = engine.latestBody(id);
    if (!shape) throw new Error(`no body ${id}`);
    total += kernel.measure(shape).volume;
  }
  return total;
}

/** The mesh bbox of all bodies, exact at the vertices (the measure box is loose). */
function bboxOf(result: Done): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const body of result.bodies) {
    const p = body.mesh?.positions;
    if (!p) throw new Error(`no mesh for ${body.id}`);
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k] as number, p[i + k] as number);
        max[k] = Math.max(max[k] as number, p[i + k] as number);
      }
    }
  }
  return { min, max };
}

/** The total area of a text's ink profiles (holes already subtracted), mm². */
function inkArea(data: SketchData, textId: SketchEntityId): number {
  return detectProfiles(data)
    .filter((p) => p.text === textId)
    .reduce((s, p) => s + p.area, 0);
}

function outputOf(id: string): SketchOutputData {
  const data = seen.get(id)?.data as SketchOutputData | undefined;
  if (!data) throw new Error(`no output for ${id}`);
  return data;
}

/** Within `part` of the exact value. */
const within = (value: number, exact: number, part = 0.005) =>
  Math.abs(value - exact) <= part * exact;

// -------------------------------------------------------------------- tests

describe('text in the kernel', () => {
  it('extrudes "Ag" through the whole-text reference: one body per letter', async () => {
    const b = new SketchBuilder();
    const t = addText(b, [0, 0], [0, 10], 'Ag');
    const data = b.sketch;
    const doc = testDocument([sketchFeature('SK', data), extrude('E', [textRef('SK', t)])]);
    const result = ok(await run(doc));

    // The sketch marks the ink and lists the text.
    const output = outputOf('SK');
    expect(output.texts).toEqual([t]);
    const ink = output.profiles.filter((p) => p.text === t);
    expect(ink).toHaveLength(2);
    expect(ink.every((p) => p.edges.every((e) => e?.startsWith(`${t}.`)))).toBe(true);

    // One solid per letter.
    expect(result.bodies).toHaveLength(2);
    const area = inkArea(data, t);
    expect(within(volumeOf(result), area * 2)).toBe(true);
  });

  it('extrudes "O" with the counter empty: a body with a through hole', async () => {
    const b = new SketchBuilder();
    const t = addText(b, [0, 0], [0, 10], 'O');
    const data = b.sketch;
    const doc = testDocument([sketchFeature('SK', data), extrude('E', [textRef('SK', t)])]);
    const result = ok(await run(doc));

    expect(result.bodies).toHaveLength(1);
    const area = inkArea(data, t);
    expect(within(volumeOf(result), area * 2)).toBe(true);

    // The counter is a hole of the O, not an ink region of its own: the
    // sketch has exactly two regions (ring and counter) and only the ring is ink.
    const o = detectProfiles(data).find((p) => p.text === t);
    expect(o).toBeDefined();
    expect(o?.holes).toHaveLength(1);
    expect(detectProfiles(data)).toHaveLength(2);

    // Face count: 2 caps + one side face per curve of the outline (outer
    // ring and counter).
    const body = result.bodies[0];
    if (!body) throw new Error('no body');
    const shape = engine.latestBody(body.id) as ShapeHandle;
    const sides = (o?.outer.edges.length ?? 0) + (o?.holes[0]?.edges.length ?? 0);
    expect(kernel.count(shape, 'face')).toBe(2 + sides);
  });

  it('keeps the extrude through the reference when the string changes', async () => {
    const b = new SketchBuilder();
    const t = addText(b, [0, 0], [0, 10], 'Ag');
    const data = b.sketch;
    const doc = testDocument([sketchFeature('SK', data), extrude('E', [textRef('SK', t)])]);
    const before = ok(await run(doc));
    expect(before.bodies).toHaveLength(2);

    // Same features, same IDs, same ref: only the string changes.
    const edited: SketchData = {
      ...data,
      entities: {
        ...data.entities,
        [t]: { ...data.entities[t], text: 'Agx' } as SketchEntity,
      },
    };
    const result = ok(
      await run(testDocument([sketchFeature('SK', edited), extrude('E', [textRef('SK', t)])])),
    );
    expect(result.bodies).toHaveLength(3);
    expect(volumeOf(result)).toBeGreaterThan(volumeOf(before));
    // No reference was lost: the extrude recomputed ok.
    expect(status(result, 'E').status).toBe('ok');
  });

  it('extrudes a plate round "HI" with the letters as holes', async () => {
    const b = new SketchBuilder();
    rect(b, -5, -5, 30, 15);
    const t = addText(b, [0, 0], [0, 10], 'HI');
    const data = b.sketch;
    const detected = detectProfiles(data);
    const plate = detected.find((p) => p.holes.length === 2);
    expect(plate?.text).toBeUndefined();
    const letters = detected.filter((p) => p.text === t);
    expect(letters).toHaveLength(2);
    expect(plate).toBeDefined();
    expect(within(plate?.area ?? 0, 700 - letters.reduce((s, p) => s + p.area, 0), 1e-6)).toBe(
      true,
    );

    const doc = testDocument([
      sketchFeature('SK', data),
      extrude('E', [{ kind: 'profile', id: `SK/${plate?.id ?? ''}` }]),
    ]);
    const result = ok(await run(doc));
    expect(result.bodies).toHaveLength(1);
    expect(within(volumeOf(result), (plate?.area ?? 0) * 2)).toBe(true);
  });

  it('warns about a font the worker lacks, and refuses the extrude', async () => {
    const b = new SketchBuilder();
    const t = addText(b, [0, 0], [0, 10], 'Ag', { font: 'inter-regular@9' });
    const doc = testDocument([sketchFeature('SK', b.sketch), extrude('E', [textRef('SK', t)])]);
    const result = await run(doc);
    expect(status(result, 'SK')).toMatchObject({ status: 'warning' });
    expect(status(result, 'SK').message).toContain("isn't available");
    expect(result.bodies).toHaveLength(0);
    expect(status(result, 'E')).toMatchObject({ status: 'error' });
    expect(status(result, 'E').message).toBe('The text has no letters to extrude.');
  });

  it('shortens a long string in the warning only when it cuts it', async () => {
    const short = 'Ag';
    const b = new SketchBuilder();
    const t = addText(b, [0, 0], [0, 10], short, { font: 'inter-regular@9' });
    const result = await run(testDocument([sketchFeature('SK', b.sketch)]));
    expect(status(result, 'SK').message).toContain(`"${short}" uses font`);

    const long = 'Extrudo says hello there';
    const c = new SketchBuilder();
    const u = addText(c, [0, 0], [0, 10], long, { font: 'inter-regular@9' });
    const other = await run(testDocument([sketchFeature('SK2', c.sketch)]));
    expect(status(other, 'SK2').message).toContain(`"${long.slice(0, 20)}…" uses font`);
    expect(t).toBeTruthy();
    expect(u).toBeTruthy();
  });

  it('warns about letters the font lacks, and draws the rest', async () => {
    const b = new SketchBuilder();
    const t = addText(b, [0, 0], [0, 10], 'A漢');
    const doc = testDocument([sketchFeature('SK', b.sketch), extrude('E', [textRef('SK', t)])]);
    const result = await run(doc);
    expect(status(result, 'SK')).toMatchObject({ status: 'warning' });
    expect(status(result, 'SK').message).toContain('漢');
    // The missing 漢 draws as the font's .notdef box, which has ink of its
    // own (Inter's .notdef is several disjoint pieces, hence 4 bodies here).
    expect(result.bodies.length).toBeGreaterThan(1);
    expect(within(volumeOf(result), inkArea(b.sketch, t) * 2)).toBe(true);
  });

  it('extrudes rotated text: the long side along Y', async () => {
    const b = new SketchBuilder();
    const t = addText(b, [0, 0], [-10, 0], 'Ag');
    const doc = testDocument([sketchFeature('SK', b.sketch), extrude('E', [textRef('SK', t)])]);
    const result = ok(await run(doc));
    expect(result.bodies).toHaveLength(2);
    const { min, max } = bboxOf(result);
    const x = (max[0] as number) - (min[0] as number);
    const y = (max[1] as number) - (min[1] as number);
    // Up is −x: the 10 mm caps run along x, the line of letters along y.
    expect(y).toBeGreaterThan(x);
    expect(min[0]).toBeCloseTo(-10, 1);
    // The g's descender pokes past the anchor on the other side.
    expect(max[0]).toBeGreaterThan(0);
  });

  it('draws nothing for construction text, and the extrude says so', async () => {
    const b = new SketchBuilder();
    const t = addText(b, [0, 0], [0, 10], 'Ag', { construction: true });
    const doc = testDocument([sketchFeature('SK', b.sketch), extrude('E', [textRef('SK', t)])]);
    const result = await run(doc);
    const output = outputOf('SK');
    expect(output.texts).toEqual([t]);
    expect(output.profiles.every((p) => p.text !== t)).toBe(true);
    expect(result.bodies).toHaveLength(0);
    expect(status(result, 'E')).toMatchObject({ status: 'error' });
    expect(status(result, 'E').message).toBe('The text has no letters to extrude.');
  });

  it('names the extruded text faces uniquely, the same after a fresh engine', async () => {
    const b = new SketchBuilder();
    const t = addText(b, [0, 0], [0, 10], 'Ag');
    const doc = testDocument([sketchFeature('SK', b.sketch), extrude('E', [textRef('SK', t)])]);
    const first = faceNames(ok(await run(doc)));

    // A fresh engine: the old one's cache goes first, so nothing leaks.
    engine.clear();
    engine = new RecomputeEngine(kernel, registry, { strictLeaks: true });
    const second = faceNames(ok(await run(doc)));

    for (const [id, names] of first) {
      expect(names.length).toBeGreaterThan(0);
      expect(new Set(names).size).toBe(names.length);
      expect(second.get(id)).toEqual(names);
    }
  });

  // Recompute times for ADR-0058 (BENCH=1): a 20-character text, cold, then
  // an edited string in the same engine, then the same document again.
  it.runIf(env?.BENCH)('times a 20-character text', async () => {
    const b = new SketchBuilder();
    const t = addText(b, [0, 0], [0, 10], 'Extrudo text 0123456');
    const data = b.sketch;
    const doc = testDocument([sketchFeature('SK', data), extrude('E', [textRef('SK', t)])]);
    const cold = ok(await run(doc));
    const edited: SketchData = {
      ...data,
      entities: {
        ...data.entities,
        [t]: { ...data.entities[t], text: 'Extrudo text 0123456!' } as SketchEntity,
      },
    };
    const edit = ok(
      await run(testDocument([sketchFeature('SK', edited), extrude('E', [textRef('SK', t)])])),
    );
    const warm = await run(doc);
    const lines = [
      `cold: engine ${Math.round(cold.stats.ms)} ms, ${cold.bodies.length} bodies, ${cold.stats.evaluated.length} evaluated`,
      `edit: engine ${Math.round(edit.stats.ms)} ms, ${edit.stats.evaluated.length} evaluated`,
      `warm: engine ${Math.round(warm.stats.ms)} ms, ${warm.stats.reused} reused`,
    ];
    // Vitest swallows console output in some setups: the report is the failure message.
    expect(lines.join('\n')).toBe('');
  });
});

/** The persistent face names of every body of a recompute. */
function faceNames(result: Done): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const { id } of result.bodies) {
    const shape = engine.latestBody(id);
    if (!shape) throw new Error(`no body ${id}`);
    const names: string[] = [];
    for (let i = 0; i < kernel.count(shape, 'face'); i++) {
      const ref = engine.reference(id, 'face', i);
      if (!ref) throw new Error(`no name for a face of ${id}`);
      names.push(ref.id);
    }
    out.set(id, names);
  }
  return out;
}
