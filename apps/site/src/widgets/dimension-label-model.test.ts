import { describe, expect, it } from 'vitest';
import {
  clampLabel,
  kindAt,
  labelMarkup,
  measureOf,
  moveLabel,
  type Point,
  result,
  resultMarkup,
  START,
} from './dimension-label-model';
import { WIDGETS } from './index';

// The points are (180, 170) and (340, 90): columns 180–340, rows 90–170.
describe('the dimension-label model', () => {
  it('reads the kind from where the label sits', () => {
    expect(kindAt([260, 210])).toBe('horizontal'); // below
    expect(kindAt([260, 40])).toBe('horizontal'); // above
    expect(kindAt([440, 130])).toBe('vertical'); // beside, right
    expect(kindAt([60, 130])).toBe('vertical'); // beside, left
    expect(kindAt([260, 130])).toBe('aligned'); // between
    expect(kindAt([440, 230])).toBe('horizontal'); // outside both: the longer way out wins
    expect(kindAt([500, 130])).toBe('vertical');
  });

  it('measures each kind', () => {
    expect(measureOf('horizontal')).toBeCloseTo(40);
    expect(measureOf('vertical')).toBeCloseTo(20);
    expect(measureOf('aligned')).toBeCloseTo(Math.hypot(160, 80) * 0.25);
  });

  it('words the result line as the mock does', () => {
    expect(result(START).text).toBe(
      'Horizontal: label above or below the points measures across, 40.0 mm.',
    );
    expect(result([440, 130]).text).toBe(
      'Vertical: label beside the points measures up and down, 20.0 mm.',
    );
    expect(result([260, 130]).text).toBe(
      'Aligned: label between the points measures the straight distance, 44.7 mm.',
    );
    expect(resultMarkup(START)).toBe(
      '<strong>Horizontal</strong>: label above or below the points measures across, 40.0 mm.',
    );
  });

  it('redraws the dimension line for the kind', () => {
    const line = (label: Point) =>
      labelMarkup(label, false)
        .match(/<line class="sk-dim-line" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/)
        ?.slice(1)
        .map(Number);
    expect(line([260, 210])).toEqual([180, 210, 340, 210]);
    expect(line([440, 130])).toEqual([440, 170, 440, 90]);
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = line([260, 130]) ?? [];
    expect(x2 - x1).toBeCloseTo(160);
    expect(y2 - y1).toBeCloseTo(-80);
  });

  it('shows the value on the label and the active band', () => {
    const markup = labelMarkup(START, false);
    expect(markup).toContain('>40.0<');
    expect(markup.match(/sk-region sk-region-on/g)).toHaveLength(1);
    expect(markup).not.toMatch(/role=|tabindex|style/);
    expect(labelMarkup(START, true)).toContain('role="slider"');
  });

  it('keeps the label on the stage', () => {
    expect(clampLabel(-5, 999)).toEqual([30, 244]);
    expect(moveLabel([490, 16], 12, -12)).toEqual([490, 16]);
    expect(moveLabel(START, 12, 0)).toEqual([272, 210]);
  });

  it('renders the figure with the bold kind word and no controls', () => {
    const html = WIDGETS['dimension-label']?.render('Drag it.') ?? '';
    expect(html).toContain(labelMarkup(START, false));
    expect(html).toContain('aria-live="polite"><strong>Horizontal</strong>: label above');
    expect(html).not.toContain('<input');
  });
});
