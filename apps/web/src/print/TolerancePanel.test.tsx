import { createDocument, formatQuantity, LENGTH, TOLERANCE_PRESETS } from '@extrudo/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TolerancePanel } from './TolerancePanel';
import { type Tolerance, tolerancePresetExpression, toleranceState } from './useTolerance';

const settings = { units: 'mm' as const, precision: 2 };

/** The panel's data for a document with a tolerance of `expression`, if any. */
function tolerance(expression?: string): Tolerance {
  const doc = createDocument();
  const withIt = expression
    ? {
        ...doc,
        parameters: [{ id: 'p1' as never, name: 'tolerance', expression, unit: 'length' as const }],
      }
    : doc;
  return {
    ...toleranceState(withIt),
    settings,
    evaluate: () => ({ ok: true, value: 0.2, dim: LENGTH }),
    set: () => {},
    error: undefined,
  };
}

const html = (t: Tolerance) =>
  renderToStaticMarkup(<TolerancePanel tolerance={t} onClose={() => {}} />);

describe('the Tolerance panel', () => {
  it('is a labelled region with the field, the three allowances and the way out', () => {
    const out = html(tolerance());
    expect(out).toContain('aria-label="Print tolerance"');
    expect(out).toContain('data-tolerance="unset"');
    expect(out).toContain('aria-label="Print tolerance"');
    // Nothing set yet: the field says so, and nothing is pressed.
    expect(out).toContain('placeholder="Not set (threads use 0.1 mm)"');
    expect(out).toContain('>Not used yet<');
    expect(out).not.toContain('aria-pressed="true"');
    expect(out).toContain('Tight 0.1 mm');
    expect(out).toContain('Normal 0.2 mm');
    expect(out).toContain('Loose 0.3 mm');
    expect(out).toContain('Done');
  });

  it('shows the value, presses its preset and says what reaches it', () => {
    const out = html(tolerance(tolerancePresetExpression(0.2)));
    expect(out).toContain('data-tolerance="set"');
    expect(out).toContain('value="0.2 mm"');
    expect(out).toMatch(/aria-pressed="true"[^>]*>Normal 0\.2 mm/);
    expect(out).not.toMatch(/aria-pressed="true"[^>]*>Tight/);
    const two = html({
      ...tolerance('0.3 mm'),
      usageText: 'Used by 2 holes and 1 thread',
      usage: { holes: 2, threads: 1, other: 0 },
    });
    expect(two).toContain('Used by 2 holes and 1 thread');
    expect(two).toMatch(/aria-pressed="true"[^>]*>Loose 0\.3 mm/);
  });

  it('says what a refused write was, and formats values in the document’s units', () => {
    const out = html({ ...tolerance('0.2 mm'), error: 'tolerance is used by Hole1.' });
    expect(out).toContain('tolerance is used by Hole1.');
    expect(out).toContain('= ');
    expect(formatQuantity(0.2, LENGTH, settings)).toBe('0.20 mm');
    expect(TOLERANCE_PRESETS.map((p) => p.label)).toEqual(['Tight', 'Normal', 'Loose']);
  });
});
