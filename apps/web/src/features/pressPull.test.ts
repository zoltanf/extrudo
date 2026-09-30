import type { SelectionItem } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { PRESS_PULL, PRESS_PULL_PROMPT, pressPullTarget } from './pressPull';

const face: SelectionItem = { kind: 'face', id: 'B:0:3' };
const edge: SelectionItem = { kind: 'edge', id: 'B:0:5' };
const profile: SelectionItem = { kind: 'profile', id: 'S/r1' };

describe('what Press Pull does with the selection', () => {
  it('extrudes a profile, moves a face, rounds an edge', () => {
    expect(pressPullTarget([profile])).toBe('extrude');
    expect(pressPullTarget([face])).toBe('offsetFace');
    expect(pressPullTarget([face, { kind: 'face', id: 'B:0:4' }])).toBe('offsetFace');
    expect(pressPullTarget([edge])).toBe('fillet');
  });

  it('prefers a profile over a face over an edge when several kinds are selected', () => {
    expect(pressPullTarget([edge, face])).toBe('offsetFace');
    expect(pressPullTarget([edge, face, profile])).toBe('extrude');
    expect(pressPullTarget([edge, profile])).toBe('extrude');
  });

  it('does nothing with a selection of other things, and says what to select', () => {
    expect(pressPullTarget([])).toBeUndefined();
    expect(pressPullTarget([{ kind: 'body', id: 'B:0' }])).toBeUndefined();
    expect(pressPullTarget([{ kind: 'vertex', id: 'B:0:1' }])).toBeUndefined();
    expect(PRESS_PULL_PROMPT).toMatch(/face.*edge.*profile/);
    expect(PRESS_PULL).toBe('pressPull');
  });
});
