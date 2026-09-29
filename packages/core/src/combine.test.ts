import { describe, expect, it } from 'vitest';
import { CombineInputsSchema, combineInputs, combineSettings } from './combine';

describe('combine inputs', () => {
  it('builds valid inputs and reads them with their defaults', () => {
    const inputs = combineInputs('B:0', ['C:0', 'D:0']);
    expect(CombineInputsSchema.safeParse(inputs).success).toBe(true);
    expect(combineSettings(inputs)).toEqual({
      target: { kind: 'body', id: 'B:0' },
      tools: [
        { kind: 'body', id: 'C:0' },
        { kind: 'body', id: 'D:0' },
      ],
      operation: 'join',
      keepTools: false,
    });
  });

  it('reads the operation and keepTools, and drops a tool listed twice', () => {
    const inputs = combineInputs('B:0', ['C:0', 'C:0'], { operation: 'cut', keepTools: true });
    const settings = combineSettings(inputs);
    expect(settings.operation).toBe('cut');
    expect(settings.keepTools).toBe(true);
    expect(settings.tools).toHaveLength(1);
  });

  it('accepts body references only, one target and the three operations', () => {
    const base = combineInputs('a', ['b']);
    const face = { kind: 'face', id: 'f' };
    const body = (id: string) => ({ kind: 'body', id });
    expect(
      CombineInputsSchema.safeParse({ ...base, tools: { kind: 'ref', refs: [face] } }).success,
    ).toBe(false);
    expect(
      CombineInputsSchema.safeParse({
        ...base,
        target: { kind: 'ref', refs: [body('a'), body('c')] },
      }).success,
    ).toBe(false);
    expect(
      CombineInputsSchema.safeParse({ ...base, operation: { kind: 'enum', value: 'fuse' } })
        .success,
    ).toBe(false);
  });
});
