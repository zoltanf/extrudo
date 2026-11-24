// @vitest-environment jsdom
import type { BodyId } from '@extrudo/core';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { OverhangView } from '../print/overhang';
import type { SectionClip } from '../section/clip';
import { useBodyProps } from './bodyProps';
import { readSceneColors } from './colors';

describe('useBodyProps', () => {
  it('gives the same objects on every render while their parts stay (ADR-0159 §5)', () => {
    const colors = readSceneColors();
    const overhang = {} as OverhangView;
    const thin = { b1: new Float32Array(3) } as Record<BodyId, Float32Array>;
    const collisions = { b1: [0] } as Record<BodyId, readonly number[]>;
    const sectionClip: readonly SectionClip[] = [{ origin: [0, 0, 0], normal: [0, 0, 1] }];
    const { result, rerender } = renderHook((props) => useBodyProps(props), {
      initialProps: { colors, overhang, thin, collisions, sectionClip },
    });
    const first = result.current;
    expect(first.accent).toEqual({ ...colors.preselect, a: 1 });
    rerender({ colors, overhang, thin, collisions, sectionClip });
    for (const key of ['accent', 'overhang', 'thickness', 'collisions', 'section'] as const) {
      expect(result.current[key]).toBe(first[key]);
    }
    // A theme change (a new accent colour) gives a new accent; no analysis gives none.
    rerender({
      colors: { ...colors, preselect: { ...colors.preselect } },
      overhang: undefined as unknown as OverhangView,
      thin: undefined as unknown as Record<BodyId, Float32Array>,
      collisions: undefined as unknown as Record<BodyId, readonly number[]>,
      sectionClip: undefined as unknown as readonly SectionClip[],
    });
    expect(result.current.accent).not.toBe(first.accent);
    expect(result.current.section).toBeUndefined();
    expect(result.current.thickness).toBeUndefined();
  });
});
