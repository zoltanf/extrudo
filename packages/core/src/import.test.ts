/**
 * The `import` feature's OpenSCAD overrides (ADR-0071 §5): how they are
 * stored and read back.
 */
import { describe, expect, it } from 'vitest';
import type { AttachmentId } from './ids';
import { ImportInputsSchema, importInputs, scadOverrides } from './import';

const file = 'att' as AttachmentId;

describe('OpenSCAD overrides', () => {
  it('store every value with its unit, unitless by default', () => {
    const inputs = importInputs({
      file,
      overrides: [
        { name: 'teeth', value: '24' },
        { name: 'width', value: 'width', unit: 'length' },
      ],
    });
    expect(inputs.scadValue).toEqual({ kind: 'expr', expr: '24', unit: 'unitless' });
    expect(inputs.scadValue2).toEqual({ kind: 'expr', expr: 'width', unit: 'length' });
    expect(ImportInputsSchema.safeParse(inputs).success).toBe(true);
    expect(scadOverrides(inputs).map((o) => [o.n, o.name, o.value])).toEqual([
      [1, 'teeth', 'scadValue'],
      [2, 'width', 'scadValue2'],
    ]);
  });

  it('refuse a value without a unit, where any other expression would be a length', () => {
    const parsed = ImportInputsSchema.safeParse({
      file: { kind: 'file', id: file },
      scadName: { kind: 'enum', value: 'teeth' },
      scadValue: { kind: 'expr', expr: '24' },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(/must say its unit/);
  });
});
