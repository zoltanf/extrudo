import type { SelectionItem } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { isRightClick, menuSelection } from './annotationMenu';

describe('annotation menu', () => {
  const c1: SelectionItem = { kind: 'constraint', id: 'c1' };
  const d1: SelectionItem = { kind: 'dimension', id: 'd1' };

  it('keeps a selection the right-clicked annotation is in, else selects just it', () => {
    expect(menuSelection([c1, d1], d1)).toBeUndefined();
    expect(menuSelection([c1], d1)).toEqual([d1]);
    expect(menuSelection([], c1)).toEqual([c1]);
    // Same ID, other kind: not the same item.
    expect(menuSelection([{ kind: 'dimension', id: 'c1' }], c1)).toEqual([c1]);
  });

  it('opens on a right click that stays within the slop, not after a drag', () => {
    expect(isRightClick({ x: 10, y: 10 }, { clientX: 13, clientY: 14 })).toBe(true);
    expect(isRightClick({ x: 10, y: 10 }, { clientX: 20, clientY: 10 })).toBe(false);
  });
});
