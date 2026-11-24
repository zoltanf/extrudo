// @vitest-environment jsdom
import type { BodyId } from '@extrudo/core';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ViewRegions } from '../features/preview';
import type { OverhangView } from '../print/overhang';
import type { SectionClip } from '../section/clip';
import { useBodyProps } from './bodyProps';
import { readSceneColors } from './colors';

const KEYS = ['accent', 'overhang', 'thickness', 'collisions', 'section', 'regions'] as const;

describe('useBodyProps', () => {
  it('gives the same objects on every render while their parts stay (ADR-0159 §5)', () => {
    const colors = readSceneColors();
    const overhang = {} as OverhangView;
    const thin = { b1: new Float32Array(3) } as Record<BodyId, Float32Array>;
    const collisions = { b1: [0] } as Record<BodyId, readonly number[]>;
    const sectionClip: readonly SectionClip[] = [{ origin: [0, 0, 0], normal: [0, 0, 1] }];
    const regions = { body: 'b1' } as ViewRegions;
    const props = { colors, overhang, thin, collisions, sectionClip, regions };
    const { result, rerender } = renderHook((p) => useBodyProps(p), { initialProps: props });
    const first = result.current;
    expect(first.accent).toEqual({ ...colors.preselect, a: 1 });
    rerender({ ...props });
    for (const key of KEYS) expect(result.current[key]).toBe(first[key]);
    // A new part gives a new object for that part alone.
    const changes = {
      overhang: { overhang: {} as OverhangView },
      thickness: { thin: { ...thin } },
      collisions: { collisions: { ...collisions } },
      section: { sectionClip: [...sectionClip] },
      regions: { regions: { ...regions } },
    };
    for (const [changed, change] of Object.entries(changes)) {
      const before = result.current;
      rerender({ ...props, ...change });
      for (const key of KEYS) {
        if (key === changed) expect(result.current[key]).not.toBe(before[key]);
        else expect(result.current[key]).toBe(before[key]);
      }
      rerender({ ...props });
    }
    const kept = result.current;
    // A theme change (a new accent colour) gives a new accent; no analysis gives none.
    rerender({
      colors: { ...colors, preselect: { ...colors.preselect } },
      overhang: undefined as unknown as OverhangView,
      thin: undefined as unknown as Record<BodyId, Float32Array>,
      collisions: undefined as unknown as Record<BodyId, readonly number[]>,
      sectionClip: undefined as unknown as readonly SectionClip[],
      regions: undefined as unknown as ViewRegions,
    });
    expect(result.current.accent).not.toBe(kept.accent);
    expect(result.current.section).toBeUndefined();
    expect(result.current.thickness).toBeUndefined();
    expect(result.current.regions).toBeUndefined();
  });
});
