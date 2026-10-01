import { describe, expect, it } from 'vitest';
import type { GeomRef } from './schema';
import {
  SPLIT_BODY_TYPE,
  SplitBodyInputsSchema,
  splitBodyFeature,
  splitBodyInputs,
  splitBodySettings,
} from './split-body';

const XY: GeomRef = { kind: 'plane', id: 'origin:xy' };

describe('split body inputs', () => {
  it('builds inputs from plain values and reads them back with defaults', () => {
    const inputs = splitBodyInputs(['Body1', 'Body2', 'Body1'], XY);
    expect(SplitBodyInputsSchema.safeParse(inputs).success).toBe(true);
    expect(splitBodySettings(inputs)).toEqual({
      bodies: [
        { kind: 'body', id: 'Body1' },
        { kind: 'body', id: 'Body2' },
      ],
      plane: XY,
      keep: 'both',
    });
    expect(splitBodySettings(splitBodyInputs(['Body1'], XY, 'below')).keep).toBe('below');
  });

  it('takes a flat face as the splitting tool, but no edge, and one tool only', () => {
    const face: GeomRef = { kind: 'face', id: 'extrude:E1:cap:end' };
    expect(SplitBodyInputsSchema.safeParse(splitBodyInputs(['B'], face)).success).toBe(true);
    const ok = splitBodyInputs(['B'], XY);
    expect(
      SplitBodyInputsSchema.safeParse({
        ...ok,
        plane: { kind: 'ref', refs: [{ kind: 'edge', id: 'e' }] },
      }).success,
    ).toBe(false);
    expect(
      SplitBodyInputsSchema.safeParse({ ...ok, plane: { kind: 'ref', refs: [XY, face] } }).success,
    ).toBe(false);
    expect(
      SplitBodyInputsSchema.safeParse({ ...ok, keep: { kind: 'enum', value: 'left' } }).success,
    ).toBe(false);
    expect(SplitBodyInputsSchema.safeParse({ ...ok, stray: 1 }).success).toBe(false);
  });

  it('keeps empty picks valid for the schema (the kernel says what is missing)', () => {
    const inputs = splitBodyInputs([], undefined);
    expect(SplitBodyInputsSchema.safeParse(inputs).success).toBe(true);
    expect(splitBodySettings(inputs).plane).toBeUndefined();
  });

  it('is a modify feature with its own icon', () => {
    expect(SPLIT_BODY_TYPE).toBe('splitBody');
    expect(splitBodyFeature).toMatchObject({
      type: 'splitBody',
      label: 'Split Body',
      category: 'modify',
      icon: 'split-body',
    });
  });
});
