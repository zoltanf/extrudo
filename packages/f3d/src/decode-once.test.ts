/**
 * Each record a feature references is decoded once, and one budget bounds what an import's
 * features keep (ADR-0083 "Hostile files"): a scope table, an operand group or a geometry
 * operand that names the same record many times costs what naming it once costs. Hand-built
 * records, no real file's bytes.
 */
import { MAX_HOLES } from '@extrudo/kernel';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EDGE_OPERAND, EDGE_RECIPE, OPERAND_GROUP } from './decode/edges';
import { SKETCH_PROFILE_OPERAND } from './decode/extrude';
import { MODEL_POINT } from './decode/hole';
import { GEOMETRY_OPERAND } from './decode/revolve';
import { Bytes, segment } from './decode/test-segment';
import { TIMELINE } from './decode/timeline';
import { f3dToDesign } from './map';
import {
  type F3dFeature,
  KEEP_BUDGET,
  MAX_HOLE_CENTRES,
  OPERATION_TABLE,
  OVER_BUDGET,
  readSegment,
} from './model';

const decodes = vi.hoisted(() => ({ recipes: 0, profiles: 0 }));
vi.mock('./decode/edges', async (original) => {
  const edges = await original<typeof import('./decode/edges')>();
  return {
    ...edges,
    readEdgeRecipe: (...args: Parameters<typeof edges.readEdgeRecipe>) => {
      decodes.recipes++;
      return edges.readEdgeRecipe(...args);
    },
  };
});
vi.mock('./decode/extrude', async (original) => {
  const extrude = await original<typeof import('./decode/extrude')>();
  return {
    ...extrude,
    readProfileOperand: (...args: Parameters<typeof extrude.readProfileOperand>) => {
      decodes.profiles++;
      return extrude.readProfileOperand(...args);
    },
  };
});
beforeEach(() => {
  decodes.recipes = 0;
  decodes.profiles = 0;
});

const FILLET = 'A07D5F17-68CB-464D-9935-BF68E98A865F';
const OFFSET_FACES = 'D087EFE5-2D28-42E6-BB45-61739E7D0204';
const DELETE_FACES = '29EF07D3-7BAF-4FA1-A28A-43A36279EA6D';
const THREAD = '584D9526-EF22-4F6F-9FE1-5FCF1F3CE575';
const EXTRUDE = 'DD405BC2-D673-44F0-8833-5CB2A1C186C7';
const HOLE = '1C037A07-4A15-43F6-ABFC-BBF61B9038D4';
const FILLER = '0A0B0C0D-0000-4000-8000-000000000001';

type Rec = { guid: string; id: number; body: number[] };

/** A scope: `head` (an extrude's operation block), then the tail the reader scans for. */
function scope(refs: number[], kind: string, head = [0xab, 0xcd, 0xef, 0x01], ordinal = 1) {
  const b = new Bytes().u8(0).u8(0).raw(head);
  b.u32(refs.length);
  for (const r of refs) b.ref(r);
  b.u32(0).u32(kind.length);
  for (const c of kind) b.u8(c.charCodeAt(0)).u8(0);
  return b.u32(ordinal).out;
}
/** An extrude's operation block where the reader looks first: join, one side, solid. */
const EXTRUDE_HEAD = [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0];

/** A recipe of `faces` faces, each `tags` tags of `designs` design references. */
function recipe(faces = 2, tags = 1, designs = 1, token = (f: number) => String(f + 1)): number[] {
  const b = new Bytes().u8(0).u8(0).u32(1).u32(3).u32(faces);
  for (let f = 0; f < faces; f++) {
    b.u32(tags);
    for (let t = 0; t < tags; t++) {
      b.str8(token(f)).u32(0).u32(designs);
      for (let d = 0; d < designs; d++) b.u32(300 + d);
      b.u32(0);
    }
  }
  return b.out;
}
const refs = (ids: number[]) => {
  const b = new Bytes().u8(0).u8(0);
  for (const id of ids) b.ref(id);
  return b.out;
};

/** Timeline items with their records. */
function design(items: number[], records: Rec[]) {
  const t = new Bytes().u8(0).u8(0).ref(2).u32(items.length);
  for (const id of items) t.ref(id);
  return readSegment(
    segment([
      { guid: TIMELINE, id: 1, body: t.out },
      { guid: FILLER, id: 2, body: [0] },
      ...records,
    ]),
  );
}

/**
 * A feature (record 10) whose table names `table`, groups 20 and 21 naming operands, operands
 * 30 + i naming recipe 40 + i.
 */
function withOperands(
  guid: string,
  kind: string,
  table: number[],
  groups: number[][],
  head?: number[],
) {
  const records: Rec[] = [{ guid, id: 10, body: scope(table, kind, head) }];
  for (const [i, members] of groups.entries())
    records.push({ guid: OPERAND_GROUP, id: 20 + i, body: refs(members) });
  for (const op of new Set(groups.flat())) {
    records.push({ guid: EDGE_OPERAND, id: op, body: refs([op + 10]) });
    records.push({ guid: EDGE_RECIPE, id: op + 10, body: recipe() });
  }
  return design([10], records);
}
const feature = (d: { features: F3dFeature[] }) => d.features.find((f) => f.id === 10);

describe('each referenced record decoded once', () => {
  it('decodes a fillet’s recipe once however often its table and group name it', () => {
    const d = withOperands(FILLET, 'Fillet', [20, 20, 20, 20], [[30, 30, 30, 30, 30]]);
    const f = feature(d);
    expect(f?.type).toBe('fillet');
    if (f?.type !== 'fillet') return;
    expect(f.sets).toHaveLength(1);
    expect(f.sets[0]?.edges).toHaveLength(1);
    expect(decodes.recipes).toBe(1);
  });

  it.each([
    ['offset faces', OFFSET_FACES, 'OffsetFaces', undefined],
    ['delete faces', DELETE_FACES, 'DeleteFace', undefined],
    ['an extrude’s named faces', EXTRUDE, 'Extrude', EXTRUDE_HEAD],
    ['thread faces', THREAD, 'Thread', undefined],
  ])('decodes the recipe of %s once and keeps the face once', (_, guid, kind, head) => {
    const d = withOperands(guid, kind, [20, 20, 20], [[30, 30, 30, 30]], head);
    const f = feature(d) as { faces?: unknown[] } | undefined;
    if (guid !== THREAD) expect(f?.faces).toHaveLength(1);
    expect(decodes.recipes).toBe(1);
  });

  it('finds the faces of a recipe once however many edge sets name it, and the sets share them', () => {
    const d = withOperands(FILLET, 'Fillet', [20, 21], [[30], [30]]);
    const f = feature(d);
    expect(f?.type).toBe('fillet');
    if (f?.type !== 'fillet') return;
    expect(f.sets).toHaveLength(2);
    const [a, b] = f.sets.map((s) => s.edges[0]);
    expect(a?.faces[0]).toBeDefined();
    expect(b?.faces[0]).toBe(a?.faces[0]);
    expect(b?.faces[1]).toBe(a?.faces[1]);
    expect(decodes.recipes).toBe(1);
  });

  it('keeps each of a hole’s centre points once', () => {
    const point = (x: number) => {
      const b = new Bytes().u8(0).u8(0);
      const v = new DataView(new ArrayBuffer(24));
      v.setFloat64(0, x, true);
      return b.raw([...new Uint8Array(v.buffer)]).out;
    };
    const d = design(
      [10],
      [
        { guid: HOLE, id: 10, body: scope([20, 20, 20], 'Hole') },
        { guid: GEOMETRY_OPERAND, id: 20, body: refs([30, 31, 30, 30, 31]) },
        { guid: MODEL_POINT, id: 30, body: point(1) },
        { guid: MODEL_POINT, id: 31, body: point(2) },
      ],
    );
    const f = feature(d);
    expect(f?.type === 'hole' && f.centres).toEqual([
      [1, 0, 0],
      [2, 0, 0],
    ]);
  });

  it('decodes a profile operand once however many extrudes name it', () => {
    // The operand names its sketch (record 60) by number, as decimal UTF-16 text.
    const operand = new Bytes().u8(0).u8(0).u32(2).u8(0x36).u8(0).u8(0x30).u8(0).out;
    const records: Rec[] = [
      { guid: SKETCH_PROFILE_OPERAND, id: 50, body: operand },
      { guid: FILLER, id: 60, body: [0] },
    ];
    for (const i of [0, 1, 2])
      records.push({
        guid: EXTRUDE,
        id: 10 + i,
        body: scope([50], 'Extrude', EXTRUDE_HEAD, 1 + i),
      });
    const d = design([10, 11, 12], records);
    const profiles = d.features.map((f) => (f.type === 'extrude' ? f.profiles[0] : undefined));
    expect(profiles[0]).toEqual({ id: 50, sketch: 60 });
    expect(profiles[1]).toBe(profiles[0]);
    expect(profiles[2]).toBe(profiles[0]);
    expect(decodes.profiles).toBe(1);
  });

  it('imports an ordinary feature that names a record twice as if it named it once', () => {
    const twice = withOperands(DELETE_FACES, 'DeleteFace', [20, 21, 20], [[30, 31, 30], [32]]);
    const once = withOperands(DELETE_FACES, 'DeleteFace', [20, 21], [[30, 31], [32]]);
    expect(twice.features).toEqual(once.features);
    expect(feature(twice)).toMatchObject({ type: 'delete-faces', faces: { length: 3 } });
    const fillet = withOperands(FILLET, 'Fillet', [20, 21, 20], [[30, 31, 30], [32]]);
    const plain = withOperands(FILLET, 'Fillet', [20, 21], [[30, 31], [32]]);
    expect(fillet.features).toEqual(plain.features);
    expect(feature(fillet)).toMatchObject({ type: 'fillet', sets: { length: 2 } });
  });
});

describe('one budget for what an import keeps', () => {
  it('leaves out, with a reason, the feature that would pass it', () => {
    // Two features, each naming one recipe of more than half the budget.
    const [faces, tags, designs] = [256, 64, 31];
    const size = faces * tags * (1 + designs);
    expect(size).toBeLessThan(KEEP_BUDGET);
    expect(2 * size).toBeGreaterThan(KEEP_BUDGET);
    const records: Rec[] = [];
    for (const i of [0, 1]) {
      records.push(
        { guid: DELETE_FACES, id: 10 + i, body: scope([20 + i], 'DeleteFace', undefined, 1 + i) },
        { guid: OPERAND_GROUP, id: 20 + i, body: refs([30 + i]) },
        { guid: EDGE_OPERAND, id: 30 + i, body: refs([40 + i]) },
        { guid: EDGE_RECIPE, id: 40 + i, body: recipe(faces, tags, designs) },
      );
    }
    const d = design([10, 11], records);
    expect(d.features.map((f) => [f.type, 'leftOut' in f ? f.leftOut : undefined])).toEqual([
      ['delete-faces', undefined],
      ['other', OVER_BUDGET],
    ]);
    const { report } = f3dToDesign(d, 'Budget');
    expect(report.skipped.find((s) => s.name === 'DeleteFace2')).toEqual({
      name: 'DeleteFace2',
      kind: 'DeleteFace',
      reason: OVER_BUDGET,
    });
  });

  it('leaves out a hole with more centre points than a hole may have', () => {
    expect(MAX_HOLE_CENTRES).toBeGreaterThan(MAX_HOLES);
    const records: Rec[] = [{ guid: HOLE, id: 10, body: scope([20], 'Hole') }];
    const points = Array.from({ length: MAX_HOLE_CENTRES + 1 }, (_, i) => 100 + i);
    records.push({ guid: GEOMETRY_OPERAND, id: 20, body: refs(points) });
    const zero = new Bytes().u8(0).u8(0).raw(new Array(24).fill(0)).out;
    for (const id of points) records.push({ guid: MODEL_POINT, id, body: zero });
    const f = feature(design([10], records));
    expect(f).toMatchObject({
      type: 'other',
      kind: 'Hole',
      leftOut: `it has more than ${MAX_HOLE_CENTRES} centres`,
    });
  });
});

describe('searches bounded by the work they do', () => {
  it('counts the records of the operation table’s lists form against its budget', () => {
    // At every 16th byte: one entry naming a list of a sixteenth of the record's records.
    const L = 64 * 1024;
    const m = L / 16;
    const word = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
    const body: number[] = [];
    while (body.length < L) body.push(...word(1), ...word(1), ...word(1), ...word(m));
    const d = readSegment(segment([{ guid: OPERATION_TABLE, id: 1, body }]));
    expect(d.problems).toEqual(['operation table #1: the operation table takes too long to find']);
  });

  it('shares one budget for finding feature tails across the segment’s records', () => {
    // Records full of name-like positions that end no tail: the first spends the budget,
    // the next gives up at once.
    const unit = [3, 0, 0, 0, 0x41, 0, 0x42, 0, 0x43, 0];
    const body: number[] = [];
    while (body.length < 64 * 1024) body.push(...unit);
    const d = design(
      [10, 11],
      [
        { guid: FILLET, id: 10, body },
        { guid: FILLET, id: 11, body },
      ],
    );
    expect(d.problems).toEqual([
      'feature #10: Record 10: no feature tail found.',
      'feature #11: the feature records take too long to read',
    ]);
  });
});
