import { describe, expect, it } from 'vitest';
import { edgeFaces, type FaceRef } from './edges';

const face = (token: string, design: number): FaceRef => ({ tags: [{ token, designs: [design] }] });

describe('edgeFaces', () => {
  it('takes the first two faces as the edge’s own and the rest as its bounds', () => {
    const [a, b, c, d] = [face('3', 301), face('2', 301), face('4', 301), face('5', 301)];
    expect(edgeFaces([a, b, c, d])).toEqual({ support: [a, b], bounds: [c, d] });
  });

  it('runs a closed edge whose first face has a negative token between the next two', () => {
    // A circle where a cylinder (3@301) meets its end cap (2@301).
    const [a, b, c] = [face('-1', 301), face('3', 301), face('2', 301)];
    expect(edgeFaces([a, b, c])).toEqual({ support: [b, c], bounds: [] });
    const [p, q, r] = [face('-143', 304), face('5', 301), face('4', 304)];
    expect(edgeFaces([p, q, r])).toEqual({ support: [q, r], bounds: [] });
  });

  it('keeps the usual reading where a negative token has no single face after the second', () => {
    const [a, b, c, d] = [face('-1', 301), face('3', 301), face('2', 301), face('1', 301)];
    expect(edgeFaces([a, b, c, d])).toEqual({ support: [a, b], bounds: [c, d] });
    expect(edgeFaces([a, b])).toEqual({ support: [a, b], bounds: [] });
  });

  it('gives nothing for a recipe of fewer than two faces', () => {
    expect(edgeFaces([face('1', 301)])).toBeUndefined();
    expect(edgeFaces([])).toBeUndefined();
  });
});
