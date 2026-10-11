import { createDocument, evaluateParameters } from '@extrudo/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  checkPrintField,
  DEFAULT_MATERIAL,
  type MaterialChoice,
  type PrintField,
  presetDensity,
  printEstimate,
  resolveMaterialChoice,
} from './material';
import { PrintInfoPanel } from './PrintInfoPanel';
import type { PrintInfo } from './usePrintAids';

const evaluation = evaluateParameters(createDocument());

/** The panel's data for a 20 mm cube (8 cm³, 2400 mm²), as the kernel measured it. */
function printInfo(choice?: Partial<MaterialChoice>, state?: PrintInfo['state']): PrintInfo {
  const full = resolveMaterialChoice(choice);
  const evaluate = (field: PrintField, expression: string) =>
    checkPrintField(field, expression, evaluation.evaluate(expression, 'unitless'));
  const bodies = [{ id: 'Body1' as never, name: 'Body1', volume: 8000, area: 2400 }];
  const number = (field: 'lineWidth' | 'infill' | 'price', fallback: number) => {
    const result = evaluate(field, full[field]);
    return result.ok ? result.value : fallback;
  };
  const density = full.material === 'custom' ? 1.3 : presetDensity(full.material);
  return {
    scope: 'shown',
    choice: full,
    setChoice: () => {},
    evaluate,
    density,
    state: state ?? 'ready',
    bodies,
    volume: 8000,
    components: [],
    estimate: printEstimate(bodies, {
      density,
      diameter: full.diameter,
      walls: full.walls,
      lineWidth: number('lineWidth', 0.45),
      infill: number('infill', 15),
      price: number('price', 25),
    }),
  };
}

const html = (info: PrintInfo = printInfo()) =>
  renderToStaticMarkup(<PrintInfoPanel info={info} onClose={() => {}} />);

describe('the Print Info panel', () => {
  it('is a labelled region with the numbers of the print and the way out', () => {
    const out = html();
    expect(out).toContain('aria-label="Print Info"');
    expect(out).toContain('data-print-state="ready"');
    // The solid part, what a print of it takes, and what that costs.
    expect(out).toContain('data-print-row="volume"');
    expect(out).toContain('data-print-row="printed"');
    expect(out).toContain('data-print-row="weight"');
    expect(out).toContain('data-print-row="filament"');
    expect(out).toContain('data-print-row="cost"');
    expect(out).toContain('Printed (est.)');
    expect(out).toContain('8.00 cm³');
    expect(out).toContain('3.04 cm³');
    expect(out).toContain('3.8 g');
    expect(out).toContain('0.09');
    expect(out).toContain('1.26 m');
    expect(out).toContain('An estimate: walls and infill as set, no supports.');
    expect(out).toContain('Done');
    // Every print setting has a field.
    expect(out).toContain('aria-label="Material"');
    expect(out).toContain('aria-label="Walls"');
    expect(out).toContain('aria-label="Line width"');
    expect(out).toContain('aria-label="Infill"');
    expect(out).toContain('aria-label="Price per kg"');
    expect(out).toContain('aria-label="1.75 mm"');
    expect(out).toContain('aria-label="2.85 mm"');
  });

  it('shows the defaults, and 100 % infill brings back the solid part', () => {
    expect(html()).toContain('value="2"');
    expect(html()).toContain('value="0.45"');
    expect(html()).toContain('value="15"');
    expect(html()).toContain('value="25"');
    const full = html(printInfo({ infill: '100' }));
    expect(full).toContain('= 100 %');
    expect(full).toMatch(/data-print-row="volume"[^>]*>8\.00 cm³/);
    expect(full).toMatch(/data-print-row="printed"[^>]*>8\.00 cm³/);
    // Walls in the width: 4 walls of 0.6 mm cover 5760 mm³, and 15 % of the rest is 336.
    const walls = html(printInfo({ walls: 4, lineWidth: '0.6' }));
    expect(walls).toMatch(/data-print-row="printed"[^>]*>6\.10 cm³/);
  });

  it('lists a component and the loose bodies under unchanged totals (P6-05 S9)', () => {
    const info = printInfo();
    const half = printEstimate([{ volume: 4000, area: 1200 }], {
      density: info.density as number,
      diameter: info.choice.diameter,
      walls: 2,
      lineWidth: 0.45,
      infill: 15,
      price: 25,
    });
    const rows = [
      { id: 'cmp1' as never, name: 'Lid', count: 1, estimate: half },
      { id: undefined, name: 'Loose bodies', count: 1, estimate: half },
    ];
    const out = html({ ...info, components: rows });
    expect(out).toContain('data-print-component="Lid"');
    expect(out).toContain('data-print-component="Loose bodies"');
    expect(out).toMatch(/data-print-row="volume"[^>]*>8\.00 cm³/);
    expect(html(info)).not.toContain('data-print-component');
  });

  it('says what it cannot do, and asks for a density it can weigh', () => {
    expect(html(printInfo(undefined, 'empty'))).toContain('the model has no body');
    expect(html({ ...printInfo(), estimate: undefined })).toContain('>…<');
    const failed = { ...printInfo(), state: 'error' as const, error: 'Kernel stopped.' };
    expect(html(failed)).toContain('Kernel stopped.');
    const custom = printInfo({ material: 'custom', density: '1.3', walls: 1 });
    expect(html(custom)).toMatch(/data-print-row="weight"[^>]*>2\.8 g/);
    expect(html({ ...custom, density: undefined })).toContain(
      'Enter a density above 0 to see the weight.',
    );
    // A preference written before walls, infill and price reads at their defaults.
    const old = resolveMaterialChoice({ material: 'petg', density: '1.3', diameter: 2.85 });
    expect(html(printInfo(old))).toContain('value="15"');
    expect(DEFAULT_MATERIAL.walls).toBe(2);
  });
});
