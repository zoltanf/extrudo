import { describe, expect, it } from 'vitest';
import { F3dFormatError } from '../bytes';
import { PARAMETER_VALUE, parameterValue } from './parameters';
import { segment } from './test-segment';

const HEX = `00 00 00 00 00 05 00 00 00 00 00 00 00 00 03 00 00 00 01 5c 01 00 00 00 00 00
00 00 00 07 00 00 00 33 00 2e 00 30 00 30 00 20 00 6d 00 6d 00 00 00 00 00 00
00 00 00 00 00 0d 00 00 00 41 00 6c 00 6f 00 6e 00 67 00 44 00 69 00 73 00 74
00 61 00 6e 00 63 00 65 00 00 00 00 00 02 00 00 00 6d 00 6d 00 02 00 00 00 64
00 33 00 34 33 33 33 33 33 d3 3f 00 01 10 00 00 00 00 00 00 00 00 00`;
const body = [0, 0, ...HEX.split(/\s+/).map((h) => Number.parseInt(h, 16))];
const seg = (version: number) => segment([{ guid: PARAMETER_VALUE, version, id: 347, body }]);

describe('parameter value record', () => {
  it('reads class version 9', () => {
    expect(body.length).toBe(129);
    const p = parameterValue.decode(seg(9), 347);
    expect(p).toMatchObject({
      id: 347,
      number: 3,
      owner: 348,
      name: 'd3',
      expression: '3.00 mm',
      kind: 'AlongDistance',
      user: false,
      comment: '',
      unit: 'mm',
      table: 16,
    });
    expect(p.value).toBeCloseTo(0.3);
  });
  it('does not read the same bytes as version 7', () => {
    expect(() => parameterValue.decode(seg(7), 347)).toThrow(F3dFormatError);
  });
  it('rejects version 8', () => {
    expect(() => parameterValue.decode(seg(8), 347)).toThrow(/not supported/);
  });
});
