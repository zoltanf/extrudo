import { describe, expect, it } from 'vitest';
import { WIDGETS } from './index';
import {
  infer,
  moveTo,
  nudge,
  result,
  resultMarkup,
  type SnapState,
  START,
  snapMarkup,
} from './snap-explorer-model';

const at = (x: number, y: number, more: Partial<SnapState> = {}): SnapState => ({
  ...START,
  cursor: [x, y],
  ...more,
});
const round = (p: readonly number[]) => p.map((c) => Math.round(c * 10) / 10);

describe('the snap explorer model', () => {
  it('snaps to a point first: an end, a centre, a lone point, the origin', () => {
    expect(infer(at(236, 74))).toMatchObject({
      p: [240, 70],
      glyph: 'endpoint',
      name: 'End point',
      adds: 'coincident',
    });
    expect(infer(at(371, 133))).toMatchObject({ p: [375, 130], glyph: 'center', name: 'Centre' });
    expect(infer(at(433, 247))).toMatchObject({ p: [430, 250], glyph: 'point', name: 'Point' });
    expect(infer(at(44, 296))).toMatchObject({ p: [40, 300], glyph: 'origin', adds: 'fix' });
  });

  it('then to a midpoint or a crossing', () => {
    expect(infer(at(150, 73))).toMatchObject({ p: [150, 70], glyph: 'midpoint', adds: 'midpoint' });
    const crossing = infer(at(366, 186));
    expect(crossing).toMatchObject({ glyph: 'intersection', adds: 'point on curve, twice' });
    expect(Math.hypot(crossing.p[0] - 375, crossing.p[1] - 130)).toBeCloseTo(55, 6);
  });

  it('then to where a level line through a point crosses a curve', () => {
    const snap = infer(at(303, 266));
    expect(snap).toMatchObject({
      glyph: 'onCurve',
      name: 'On the slanted line, level',
      adds: 'point on curve and horizontal on the new line',
    });
    expect(round(snap.p)).toEqual([302.7, 262]);
    expect(snap.guides).toHaveLength(1);
  });

  it('then onto a curve', () => {
    expect(infer(at(62, 160))).toMatchObject({
      p: [60, 160],
      glyph: 'onCurve',
      name: 'On the left edge',
      adds: 'point on curve',
    });
  });

  it('then level with the start or a point, rounded to the grid along the guide', () => {
    expect(infer(at(330, 264))).toMatchObject({
      p: [340, 262],
      name: 'Horizontal from the start',
      adds: 'horizontal on the new line',
    });
    expect(infer(at(330, 264, { grid: false })).p).toEqual([330, 262]);
    const point = infer(at(455, 247));
    expect(point).toMatchObject({
      p: [460, 250],
      name: 'Level with a point',
      adds: 'horizontal between the two points',
    });
    expect(point.glyph).toBeUndefined();
    expect(infer(at(468, 252))).toMatchObject({ p: [470, 250], name: 'Level both ways' });
  });

  it('then to the grid, and with Snap to grid off, nowhere', () => {
    expect(infer(at(300, 210))).toMatchObject({ p: [300, 220], name: 'Grid', adds: 'nothing' });
    expect(infer(at(300, 210)).glyph).toBeUndefined();
    expect(infer(at(300, 210, { grid: false }))).toMatchObject({ p: [300, 210], name: 'Nothing' });
  });

  it('snaps to nothing while Ctrl is held', () => {
    expect(infer(at(236, 74, { ctrl: true }))).toMatchObject({
      p: [236, 74],
      name: 'Nothing (Ctrl)',
    });
  });

  it('says what the click adds and why', () => {
    expect(result(START)).toEqual({
      word: 'End point',
      rest: 'The click adds coincident. The new end and that point become one.',
    });
    expect(resultMarkup(START)).toBe(
      '<strong>End point</strong><br>The click adds coincident. The new end and that point become one.',
    );
  });

  it('keeps the pointer on the stage', () => {
    expect(nudge(at(2, 318), -1, 1, 20).cursor).toEqual([0, 320]);
    expect(moveTo(START, 600.4, -3).cursor).toEqual([520, 0]);
    expect(nudge(START, 1, 0, 4).cursor).toEqual([240, 74]);
  });

  it('draws the glyph, the guides and a slider only when live', () => {
    const still = snapMarkup(START, false);
    expect(still).toContain(
      '<rect class="sk-accent" stroke-width="1.5" x="235" y="65" width="10" height="10"/>',
    );
    expect(still).not.toMatch(/role=|tabindex|style/);
    expect(snapMarkup(at(330, 264), false).match(/class="sk-guide"/g)).toHaveLength(1);
    expect(snapMarkup(at(330, 264, { grid: false }), false)).not.toContain('widget-grid');
    expect(snapMarkup(START, true)).toContain('role="slider" aria-label="Pointer"');
  });

  it('renders the figure with the switches disabled', () => {
    const html = WIDGETS['snap-explorer']?.render('Move.') ?? '';
    expect(html).toContain(snapMarkup(START, false));
    expect(html).toContain('data-key="ctrl" disabled');
    expect(html).toContain('data-key="grid" checked disabled');
    expect(html).toContain(resultMarkup(START));
    expect(html).toContain('<figcaption>Move.</figcaption>');
  });
});
