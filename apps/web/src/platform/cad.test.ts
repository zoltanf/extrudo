import { describe, expect, it } from 'vitest';
import { CAD_CONVERT_ACCEPT, CAD_CONVERT_EXTENSIONS, isConvertibleCad, stepNameFor } from './cad';

describe('other CAD files (P6-19, ADR-0115 §1)', () => {
  it('lists the converted extensions, lower case with the dot', () => {
    expect(CAD_CONVERT_EXTENSIONS).toContain('.sldprt');
    for (const ext of CAD_CONVERT_EXTENSIONS) expect(ext).toMatch(/^\.[a-z]+$/);
    expect(CAD_CONVERT_ACCEPT.split(',')).toEqual([...CAD_CONVERT_EXTENSIONS]);
  });

  it('tells a convertible file by its extension, in any case', () => {
    expect(isConvertibleCad('Bracket.SLDPRT')).toBe(true);
    expect(isConvertibleCad('gear.CATPart')).toBe(true);
    expect(isConvertibleCad('a.b.iges')).toBe(true);
    expect(isConvertibleCad('part.step')).toBe(false);
    expect(isConvertibleCad('sldprt')).toBe(false);
    expect(isConvertibleCad('dir.ipt/file')).toBe(false);
  });

  it('names the STEP after the file', () => {
    expect(stepNameFor('Bracket.SLDPRT')).toBe('Bracket.step');
    expect(stepNameFor('my.part.ipt')).toBe('my.part.step');
    expect(stepNameFor('.sat')).toBe('model.step');
  });
});
