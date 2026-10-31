import { describe, expect, it } from 'vitest';
import { WIDGETS } from './index';
import { LAYERS, type PaletteState, paletteMarkup, START } from './palette-switches-model';

const count = (markup: string, pattern: RegExp) => markup.match(pattern)?.length ?? 0;
const without = (layer: (typeof LAYERS)[number]): PaletteState => ({ ...START, [layer]: false });

describe('the palette-switches model', () => {
  const all = paletteMarkup(START);

  it('draws every layer at the start', () => {
    expect(count(all, /class="sk-profile"/g)).toBe(2);
    expect(count(all, /class="sk-point"/g)).toBe(5);
    expect(count(all, /class="sk-dim"/g)).toBe(3);
    expect(count(all, /class="sk-dim-text"/g)).toBe(3);
    expect(count(all, /class="sk-glyph"/g)).toBe(4);
    expect(count(all, /class="widget-grid"/g)).toBe(20 + 11);
    expect(count(all, /class="sk-free"/g)).toBe(2);
  });

  it('hides exactly the layer a switch turns off, and keeps the curves', () => {
    const marks: Record<(typeof LAYERS)[number], RegExp> = {
      points: /sk-point"/g,
      dimensions: /sk-dim(-text)?"/g,
      constraints: /sk-glyph(-text)?"/g,
      profiles: /sk-profile"/g,
      grid: /widget-grid"/g,
    };
    for (const layer of LAYERS) {
      const markup = paletteMarkup(without(layer));
      expect(count(markup, marks[layer]), layer).toBe(0);
      expect(count(markup, /class="sk-free"/g), layer).toBe(2);
      for (const other of LAYERS.filter((name) => name !== layer)) {
        expect(count(markup, marks[other]), `${layer} off, ${other}`).toBe(
          count(all, marks[other]),
        );
      }
    }
  });

  it('draws only the curves with everything off, and never a style', () => {
    const none = Object.fromEntries(LAYERS.map((layer) => [layer, false])) as PaletteState;
    expect(paletteMarkup(none)).toBe(
      '<rect class="sk-free" x="100" y="50" width="220" height="130" stroke-width="2.2"/><circle class="sk-free" cx="250" cy="115" r="30" stroke-width="2.2"/>',
    );
    expect(all).not.toMatch(/style|fill="#|stroke="#/);
  });

  it('renders the figure with its switches disabled and on', () => {
    const html = WIDGETS['palette-switches']?.render('Flip <one>.') ?? '';
    expect(html).toContain(all);
    for (const label of [
      'Show points',
      'Show dimensions',
      'Show constraints',
      'Show profiles',
      'Sketch grid',
    ]) {
      expect(html).toContain(`<span>${label}</span>`);
    }
    expect(count(html, /<input type="checkbox" data-key="[a-z]+" checked disabled \/>/g)).toBe(5);
    expect(html).toContain('<figcaption>Flip &lt;one&gt;.</figcaption>');
  });
});
