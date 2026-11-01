import { describe, expect, it } from 'vitest';
import { WIDGETS } from './index';
import { PIECES, result, START, trimMarkup, trimPiece } from './trim-model';

const visible = (markup: string) =>
  [...markup.matchAll(/data-vis="(\w+)"/g)].map((match) => match[1]);

describe('the trim model', () => {
  it('draws the five pieces and the two crossings at the start', () => {
    const markup = trimMarkup(START, false);
    expect(visible(markup)).toEqual(['l1', 'l2', 'l3', 'a1', 'a2']);
    expect(markup.match(/class="sk-free"/g)).toHaveLength(5);
    expect(markup.match(/class="sk-point sk-point-muted"/g)).toHaveLength(2);
    expect(markup).not.toMatch(/role=|tabindex|widget-hit|style/);
  });

  it('removes exactly the piece that was trimmed', () => {
    const gone = trimPiece(START, 'l2');
    expect(visible(trimMarkup(gone, true))).toEqual(['l1', 'l3', 'a1', 'a2']);
    const more = trimPiece(gone, 'a1');
    expect(visible(trimMarkup(more, true))).toEqual(['l1', 'l3', 'a2']);
    expect(trimPiece(more, 'a1')).toBe(more);
    expect(trimPiece(more, 'nope')).toBe(more);
  });

  it('gives each live piece a focusable button over it', () => {
    const markup = trimMarkup(START, true);
    for (const piece of PIECES) {
      expect(markup).toContain(
        `class="widget-hit" d="${piece.d}" data-piece="${piece.id}" stroke-width="16" tabindex="0" role="button" aria-label="Trim ${piece.name}"`,
      );
    }
  });

  it('says what was trimmed', () => {
    expect(result(undefined)).toBe('');
    expect(result('l2')).toBe('Trimmed the line inside the circle.');
    expect(result('a2')).toBe('Trimmed the circle below the line.');
  });

  it('renders the figure with Reset disabled', () => {
    const html = WIDGETS.trim?.render('Click.') ?? '';
    expect(html).toContain(trimMarkup(START, false));
    expect(html).toContain('data-key="reset" disabled>Reset</button>');
    expect(html).toContain('<figcaption>Click.</figcaption>');
  });
});
