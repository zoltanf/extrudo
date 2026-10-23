import type { FeatureId } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import type { SketchDrawing } from '../viewport/sketchGeometry';
import { sketchesWithHover } from './hoverDrawings';

const sketch = (id: string, active = false): SketchDrawing =>
  ({ id, active, frame: {}, data: { entities: [] } }) as unknown as SketchDrawing;

describe('sketchesWithHover (ADR-0102 §3)', () => {
  const a = sketch('A');
  const b = sketch('B');
  const list = [a, b];

  it('returns the same array when nothing is hovered or marked', () => {
    expect(sketchesWithHover(list, undefined, new Set())).toBe(list);
    expect(sketchesWithHover(list, { kind: 'body', id: 'x' }, new Set())).toBe(list);
  });

  it('highlights a hovered feature and keeps the other sketch object', () => {
    const out = sketchesWithHover(list, { kind: 'feature', id: 'B' }, new Set(['B' as FeatureId]));
    expect(out).not.toBe(list);
    expect(out[0]).toBe(a);
    expect(out[1]).toEqual({ ...b, highlight: true });
  });

  it('marks the curve under the pointer on a shown sketch, not on the one being edited', () => {
    const edited = sketch('A', true);
    const out = sketchesWithHover([edited, b], { kind: 'sketchEntity', id: 'B/l1' }, new Set());
    expect(out[0]).toBe(edited);
    expect(out[1]?.hoverEntity).toBe('l1');
  });
});
