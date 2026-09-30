import { describe, expect, it } from 'vitest';
import { MirrorInputsSchema, mirrorInputs, mirrorSettings } from './mirror';
import { originPlaneRef } from './sketch/planes';

describe('mirror inputs', () => {
  const plane = originPlaneRef('origin:yz');

  it('copies by default and does not join', () => {
    const inputs = mirrorInputs(['B:0'], plane);
    expect(MirrorInputsSchema.safeParse(inputs).success).toBe(true);
    expect(mirrorSettings(inputs)).toEqual({
      bodies: [{ kind: 'body', id: 'B:0' }],
      plane,
      copy: true,
      join: false,
    });
  });

  it('join needs the copy', () => {
    expect(mirrorSettings(mirrorInputs(['B:0'], plane, { join: true })).join).toBe(true);
    expect(mirrorSettings(mirrorInputs(['B:0'], plane, { copy: false, join: true })).join).toBe(
      false,
    );
  });

  it('takes a plane or a face, and one of them', () => {
    const face = { kind: 'face', id: 'extrude:E:cap:end' } as const;
    expect(MirrorInputsSchema.safeParse(mirrorInputs(['B:0'], face)).success).toBe(true);
    expect(
      MirrorInputsSchema.safeParse({
        ...mirrorInputs(['B:0'], plane),
        plane: { kind: 'ref', refs: [{ kind: 'edge', id: 'e' }] },
      }).success,
    ).toBe(false);
  });
});
