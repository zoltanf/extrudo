import { createSessionStore } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { clearPickedHover, createModelSelect } from './useModelSelection';

const face = (i: number) => ({ kind: 'face' as const, id: `b:${i}` });

describe('createModelSelect', () => {
  it('selects on click, toggles with a modifier, clears on empty space', () => {
    const session = createSessionStore();
    const select = createModelSelect(session);
    select.onClick(face(1), false);
    select.onClick(face(2), true);
    expect(session.getState().selection).toEqual([face(1), face(2)]);
    select.onClick(face(1), true);
    expect(session.getState().selection).toEqual([face(2)]);
    select.onClick(face(3), false);
    expect(session.getState().selection).toEqual([face(3)]);
    // Empty space: a modifier keeps the selection.
    select.onClick(undefined, true);
    expect(session.getState().selection).toEqual([face(3)]);
    select.onClick(undefined, false);
    expect(session.getState().selection).toEqual([]);
  });

  it('replaces with a box, or adds with a modifier', () => {
    const session = createSessionStore();
    const select = createModelSelect(session);
    select.onBox([face(1), face(2)], false);
    select.onBox([face(2), face(3)], true);
    expect(session.getState().selection).toEqual([face(1), face(2), face(3)]);
    select.onBox([], false);
    expect(session.getState().selection).toEqual([]);
  });

  it('sets the hover, and clears only a hover it set', () => {
    const session = createSessionStore();
    const select = createModelSelect(session);
    select.onHover(face(1));
    expect(session.getState().hover).toEqual(face(1));
    select.onHover(undefined);
    expect(session.getState().hover).toBeUndefined();
    session.getState().setHover({ kind: 'feature', id: 'f1' });
    select.onHover(undefined);
    expect(session.getState().hover).toEqual({ kind: 'feature', id: 'f1' });
    clearPickedHover(session);
    expect(session.getState().hover).toEqual({ kind: 'feature', id: 'f1' });
    session.getState().setHover(face(2));
    clearPickedHover(session);
    expect(session.getState().hover).toBeUndefined();
  });
});
