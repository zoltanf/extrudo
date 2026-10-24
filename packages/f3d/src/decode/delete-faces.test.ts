/**
 * Delete faces on hand-built records: a feature's scope names its faces through
 * an operand group of face operands, each recipe listing its face first, as
 * Offset faces does (FORMAT.md). The records are synthetic; no real file's bytes.
 */
import { describe, expect, it } from 'vitest';
import type { AsmFace } from '../asm';
import { readSegment } from '../model';
import { EDGE_OPERAND, EDGE_RECIPE, OPERAND_GROUP } from './edges';
import { Bytes, segment } from './test-segment';
import { TIMELINE } from './timeline';

const DELETE_FACES = '29EF07D3-7BAF-4FA1-A28A-43A36279EA6D';

/** u32 length + UTF-16LE units, as the file writes a `wstr`. */
function wstr(b: Bytes, s: string): Bytes {
  b.u32(s.length);
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    b.out.push(c & 0xff, (c >> 8) & 0xff);
  }
  return b;
}

/** A scope's bytes: some feature-specific data and the tail the reader scans for. */
function scopeBody(refs: number[], kind: string, ordinal: number): number[] {
  const b = new Bytes().u8(0).u8(0).raw([0xab, 0xcd, 0xef, 0x01]);
  b.u32(refs.length);
  for (const r of refs) b.ref(r);
  b.u32(0); // history state
  wstr(b, kind);
  b.u32(ordinal);
  return b.out;
}

/** A face recipe: `n` faces, each with one tag naming a design record. */
function recipeBody(faces: { token: string; designs: number[] }[]): number[] {
  const b = new Bytes().u8(0).u8(0).u32(1).u32(3).u32(faces.length);
  for (const f of faces) {
    b.u32(1); // tags
    b.str8(f.token).u32(0).u32(f.designs.length);
    for (const d of f.designs) b.u32(d);
    b.u32(0); // trailing zero per tag
  }
  return b.out;
}

/** A segment with one Delete faces feature; each operand's recipe names one face. */
function deleteSegment(recipes: number[][]) {
  const operands = recipes.map((_, i) => 30 + i);
  const body = new Bytes().u8(0).u8(0);
  for (const op of operands) body.ref(op);
  const records = [
    { guid: TIMELINE, id: 1, body: new Bytes().u8(0).u8(0).ref(2).u32(1).ref(10).out },
    { guid: DELETE_FACES, id: 10, body: scopeBody([20], 'DeleteFace', 1) },
    { guid: OPERAND_GROUP, id: 20, body: body.out },
  ];
  recipes.forEach((r, i) => {
    records.push({
      guid: EDGE_OPERAND,
      id: 30 + i,
      body: new Bytes()
        .u8(0)
        .u8(0)
        .ref(40 + i).out,
    });
    records.push({ guid: EDGE_RECIPE, id: 40 + i, body: r });
  });
  return segment(records);
}

describe('Delete faces', () => {
  it('decodes a deletion of two faces, each named by its recipe', () => {
    const design = readSegment(
      deleteSegment([
        recipeBody([{ token: '3', designs: [318] }]),
        recipeBody([{ token: '2', designs: [318] }]),
      ]),
    );
    expect(design.problems).toEqual([]);
    const feature = design.features.find((f) => f.type === 'delete-faces');
    expect(feature).toMatchObject({
      type: 'delete-faces',
      id: 10,
      kind: 'DeleteFace',
      name: 'DeleteFace1',
    });
    expect(feature && feature.type === 'delete-faces' ? feature.faces : []).toEqual([
      { tags: [{ token: '3', designs: [318] }] },
      { tags: [{ token: '2', designs: [318] }] },
    ]);
  });

  it('takes the state of the face the recipe names, keeping the others', () => {
    // The B-rep streams keep three states of face 3@318: as made (x = 5 cm),
    // after operation 324 moved it, and solved, after 324 and 325 (x = 4.9).
    const state = (x: number, designs: number[], index: number): AsmFace => ({
      index,
      surface: { kind: 'plane', point: [x, 0, 0], normal: [-1, 0, 0] },
      tags: designs.map((design) => ({ token: '3', design })),
      edges: [],
    });
    const final = state(4.9, [318, -324, -325], 1);
    const moved = state(4.95, [318, -324], 2);
    const made = state(5, [318], 3);
    const faces = new Map([['3@318', [final, moved, made]]]);
    const faceOf = (designs: number[]) => {
      const design = readSegment(deleteSegment([recipeBody([{ token: '3', designs }])]), faces);
      const feature = design.features.find((f) => f.type === 'delete-faces');
      return (feature && feature.type === 'delete-faces' ? feature.faces : [])[0];
    };
    const solved = (designs: number[]) => {
      const s = faceOf(designs)?.solved;
      return s?.kind === 'plane' ? s.point[0] : s;
    };
    const surfaces = (designs: number[]) => {
      const face = faceOf(designs);
      return [face?.surface, ...(face?.states ?? [])].map((s) =>
        s?.kind === 'plane' ? s.point[0] : s,
      );
    };
    // Picked before any move, after the first, after both: that state is
    // the face's surface, the others follow, nearest first.
    expect(surfaces([318])).toEqual([5, 4.95, 4.9]);
    expect(surfaces([318, -324])).toEqual([4.95, 4.9, 5]);
    expect(surfaces([318, -324, -325])).toEqual([4.9, 4.95, 5]);
    // A state no stream kept: the nearest (as made, one tag apart).
    expect(surfaces([318, -330])).toEqual([5, 4.95, 4.9]);
    // The solved state is kept apart where it is not the face's surface.
    expect(solved([318])).toBe(4.9);
    expect(solved([318, -324, -325])).toBeUndefined();
  });

  it('treats a truncated recipe as a decoding problem, not a crash', () => {
    // The recipe says two faces but holds one: the second read runs off the end.
    const good = recipeBody([{ token: '3', designs: [318] }]);
    const truncated = [...good];
    truncated[10] = 2; // face count → 2
    const design = readSegment(deleteSegment([truncated]));
    expect(design.problems).toEqual([expect.stringContaining('face #40:')]);
    const feature = design.features.find((f) => f.type === 'delete-faces');
    expect(feature && feature.type === 'delete-faces' ? feature.faces : null).toEqual([]);
  });

  it('bounds a recipe whose face count is absurd', () => {
    const b = new Bytes().u8(0).u8(0).u32(1).u32(3).u32(0xffffffff);
    const t = performance.now();
    const design = readSegment(deleteSegment([b.out]));
    expect(performance.now() - t).toBeLessThan(1000);
    expect(design.problems).toEqual([expect.stringContaining('face #40:')]);
  });
});
