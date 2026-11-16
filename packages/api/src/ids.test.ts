/** The IDs a stored document already uses, for the factory to skip past. */
import type { ExtrudoDocument } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { storedIds } from './ids';

describe('storedIds', () => {
  it('collects the IDs of a sketch with more entities than a call takes arguments', () => {
    const n = 500_000;
    const entities: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) entities[`e${i}`] = { type: 'point', x: i, y: 0 };
    const doc = {
      parameters: [],
      features: [
        {
          id: 'f1',
          inputs: {
            sketch: { kind: 'sketchData', sketch: { entities, constraints: {}, dimensions: {} } },
          },
        },
      ],
    } as unknown as ExtrudoDocument;
    const ids = storedIds(doc);
    expect(ids.length).toBe(n + 1);
    expect(ids[1]).toBe('e0');
  });
});
