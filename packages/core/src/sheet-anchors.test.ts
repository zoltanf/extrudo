import { describe, expect, it } from 'vitest';
import type { SheetItemId } from './ids';
import { keepLastAnchors, type SheetAnchors } from './sheet-anchors';

describe('keepLastAnchors', () => {
  const id = 'd1' as SheetItemId;
  const before: SheetAnchors = {
    [id]: [
      {
        status: 'ok',
        geometry: { type: 'point', point: [1, 2, 3] },
        resolved: { kind: 'vertex', id: 'v[a|b|c]' },
      },
    ],
  };

  it("keeps the last geometry of a detached anchor, and the kernel's reason it is detached", () => {
    const message = 'The feature this was measured on is deleted.';
    expect(keepLastAnchors(before, { [id]: [{ status: 'detached', message }] })).toEqual({
      [id]: [{ ...before[id]?.[0], status: 'detached', message }],
    });
    expect(keepLastAnchors(before, { [id]: [{ status: 'detached' }] })).toEqual({
      [id]: [{ ...before[id]?.[0], status: 'detached' }],
    });
  });
});
