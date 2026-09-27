import { describe, expect, it } from 'vitest';
import {
  createdName,
  edgeName,
  faceRelation,
  indexedName,
  nameRelation,
  parseCompound,
  parseFace,
  splitName,
  vertexName,
} from './topo-id';

describe('TopoId grammar', () => {
  it('builds created names, nesting sources that are not plain tokens', () => {
    expect(createdName('extrude', 'F1', 'cap:end')).toBe('extrude:F1:cap:end');
    expect(createdName('extrude', 'F1', 'side', 'l3')).toBe('extrude:F1:side:l3');
    expect(createdName('extrude', 'F1', 'side', '9b2c-44aa')).toBe('extrude:F1:side:9b2c-44aa');
    const edge = edgeName(['extrude:F1:side:l3', 'extrude:F1:cap:end']);
    expect(edge).toBe('e[extrude:F1:cap:end|extrude:F1:side:l3]');
    expect(createdName('fillet', 'F2', 'from', edge)).toBe(
      'fillet:F2:from:(e[extrude:F1:cap:end|extrude:F1:side:l3])',
    );
  });

  it('sorts and dedupes the faces of edges and vertices', () => {
    expect(edgeName(['b', 'a', 'b'])).toBe('e[a|b]');
    expect(vertexName(['c', 'a', 'b'])).toBe('v[a|b|c]');
    expect(indexedName(edgeName(['a']), 2)).toBe('e[a]@2');
  });

  it('parses split suffixes, only after the last closing parenthesis', () => {
    expect(parseFace('extrude:F1:cap:end')).toEqual({ stem: 'extrude:F1:cap:end', splits: [] });
    expect(parseFace(splitName(splitName('a:b:c', 2), 1))).toEqual({
      stem: 'a:b:c',
      splits: [2, 1],
    });
    expect(parseFace('fillet:F:from:(e[x#1|y])')).toEqual({
      stem: 'fillet:F:from:(e[x#1|y])',
      splits: [],
    });
    expect(parseFace('fillet:F:from:(e[x#1|y])#3')).toEqual({
      stem: 'fillet:F:from:(e[x#1|y])',
      splits: [3],
    });
  });

  it('parses edges and vertices, with nested names and @n', () => {
    expect(parseCompound('e[a|b#2]')).toEqual({ kind: 'edge', faces: ['a', 'b#2'] });
    expect(parseCompound('v[a|b|c]@3')).toEqual({
      kind: 'vertex',
      faces: ['a', 'b', 'c'],
      index: 3,
    });
    expect(parseCompound('e[f:(e[a|b])|g]')).toEqual({ kind: 'edge', faces: ['f:(e[a|b])', 'g'] });
    expect(parseCompound('e[]')).toEqual({ kind: 'edge', faces: [] });
    expect(parseCompound('extrude:F:cap:end')).toBeUndefined();
    expect(parseCompound('e[a|b]x')).toBeUndefined();
  });

  it('relates a face to its pieces and to the face it is a piece of', () => {
    expect(faceRelation('a', 'a')).toBe(2);
    expect(faceRelation('a', 'a#1')).toBe(1);
    expect(faceRelation('a#2', 'a')).toBe(1);
    expect(faceRelation('a#2', 'a#2#1')).toBe(1);
    expect(faceRelation('a#2', 'a#1')).toBe(0);
    expect(faceRelation('a', 'b')).toBe(0);
    expect(faceRelation('a:(x#1)', 'a:(x#2)')).toBe(0);
  });

  it('relates edges whose faces pair up, preferring more equal faces', () => {
    expect(nameRelation('e[a|b]', 'e[a|b]')).toBe(Number.POSITIVE_INFINITY);
    expect(nameRelation('e[a|b]', 'e[a#1|b]')).toBe(3); // 1 + one equal face + same (no) index
    expect(nameRelation('e[a|b]', 'e[a#1|b#2]')).toBe(2);
    expect(nameRelation('e[a|b]', 'e[a|b]@2')).toBe(3); // both faces equal, the index not
    expect(nameRelation('e[a|b]', 'e[a|c]')).toBe(0);
    expect(nameRelation('e[a|b]', 'e[a|b|c]')).toBe(0);
    expect(nameRelation('e[a|b]', 'v[a|b]')).toBe(0);
    expect(nameRelation('e[a|b]', 'a')).toBe(0);
    // Equal names first would leave a#1 unpaired; the other pairing works.
    expect(nameRelation('e[a|a#1]', 'e[a|a#2]')).toBeGreaterThan(0);
  });
});
