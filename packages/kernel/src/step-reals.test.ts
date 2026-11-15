// Reals written without a decimal point, in the standard form before the
// reader sees them (ADR-0066, amendment of 2026-11-15); everything else as it was.
import { describe, expect, it } from 'vitest';
import b3 from '../../../fixtures/imports/b3.step?url&inline';
import namedParts from '../../../fixtures/imports/named-parts.step?url&inline';
import { standardStepReals } from './step-reals';

/** A fixture's text from its inlined data URL. */
const text = (url: string) => atob(url.slice(url.indexOf(',') + 1));

const point = (xs: string) => `#13=CARTESIAN_POINT('',(${xs}));`;

describe('standardStepReals', () => {
  it('writes a real without a decimal point in the standard form', () => {
    expect(standardStepReals(point('1e1,1E1,0e0'))).toBe(point('1.E1,1.E1,0.E0'));
    expect(standardStepReals(point('1e+1,-2e-7,+5E+21'))).toBe(point('1.E+1,-2.E-7,+5.E+21'));
    expect(standardStepReals(point('12e0, 1e01 ,\n99e5'))).toBe(point('12.E0, 1.E01 ,\n99.E5'));
    // A text that ends with one.
    expect(standardStepReals('(1,2e3')).toBe('(1,2.E3');
  });

  it('leaves reals with a point, integers and everything that is not a number as they are', () => {
    const same = [
      point('1.E1,1.5e-3,-0.25E+2,.5E1,10,10.,-3,+4.'),
      "#1=PRODUCT('M8x1e1 bolt','a 2e3 part','',(#3));",
      "#2=PRODUCT('it''s 1e1',' ''2e2'' ','',(#3));",
      '#3=DESCRIPTIVE_REPRESENTATION_ITEM("1E1",#4);',
      "/* written 1e1 times */ #4=VECTOR('',#17,1.);",
      '#5=(NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.)) #6=X1E5(#12E3,.A1E1.,B2E2);',
      "FILE_SCHEMA(('CONFIG_CONTROL_DESIGN { 1 0 10303 203 1 1 }'));",
      "#7=CARTESIAN_POINT('',(1e1x,2e,3e+));",
    ];
    for (const t of same) expect(standardStepReals(t), t).toBe(t);
  });

  it('gives back the same string for the STEP fixtures of the repository', () => {
    for (const [name, url] of [
      ['b3.step', b3],
      ['named-parts.step', namedParts],
    ] as const) {
      const t = text(url);
      expect(t.startsWith('ISO-10303-21;'), name).toBe(true);
      expect(standardStepReals(t) === t, name).toBe(true);
    }
  });

  it('rewrites a large text in one pass', () => {
    // 1.5 million reals, about 26 MB (timings: the ADR's amendment).
    const line = point('1e1,2E-3,-3e+4');
    const text = line.repeat(500_000);
    const out = standardStepReals(text);
    expect(out.length).toBe(text.length + 3 * 500_000);
    expect(out.slice(0, 2 * line.length + 6)).toBe(point('1.E1,2.E-3,-3.E+4').repeat(2));
  });
});
