import { describe, expect, it } from 'vitest';
import {
  canMove,
  type DofState,
  dofLeft,
  dofMarkup,
  dragTo,
  isConflict,
  nudge,
  result,
  START,
} from './dof-playground-model';
import { WIDGETS } from './index';

const on = (...keys: ('w' | 'h' | 'f' | 'x')[]): DofState => ({
  ...START,
  ...Object.fromEntries(keys.map((key) => [key, true])),
});
const count = (markup: string, pattern: RegExp) => markup.match(pattern)?.length ?? 0;

describe('the dof-playground model', () => {
  it('counts the degrees of freedom left', () => {
    expect(dofLeft(START)).toBe(4);
    expect(dofLeft(on('w'))).toBe(3);
    expect(dofLeft(on('w', 'h'))).toBe(2);
    expect(dofLeft(on('f'))).toBe(2);
    expect(dofLeft(on('w', 'h', 'f'))).toBe(0);
    expect(dofLeft(on('x'))).toBe(3);
  });

  it('says it word for word', () => {
    expect(result(START)).toEqual({ text: '4 DOF left', tone: 'free' });
    expect(result(on('w', 'h'))).toEqual({ text: '2 DOF left', tone: 'free' });
    expect(result(on('w', 'h', 'f'))).toEqual({ text: 'Fully constrained ✓', tone: 'ok' });
    expect(result(on('w', 'h', 'f', 'x'))).toEqual({
      text: 'Over-constrained: the red geometry has a constraint too many',
      tone: 'bad',
    });
  });

  it('colours free, fixed and conflicting sides', () => {
    expect(count(dofMarkup(START, false), /class="sk-free"/g)).toBe(4);
    const fixed = dofMarkup(on('w', 'h', 'f'), false);
    expect(count(fixed, /<line class="sk-fixed"/g)).toBe(4);
    const some = dofMarkup(on('f', 'w'), false);
    expect(count(some, /<line class="sk-fixed"/g)).toBe(1);
    const conflict = dofMarkup(on('w', 'h', 'f', 'x'), false);
    expect(isConflict(on('h', 'x'))).toBe(true);
    expect(count(conflict, /<line class="sk-conflict"/g)).toBe(2);
    expect(count(conflict, /sk-dim-conflict/g)).toBe(2);
  });

  it('draws a dimension for each switch, with live values', () => {
    expect(count(dofMarkup(START, false), /class="sk-dim"/g)).toBe(0);
    const all = dofMarkup(on('w', 'h', 'x'), false);
    expect(count(all, /<line class="sk-dim"/g)).toBe(3);
    expect(all).toContain('>40<');
    expect(all).toContain('>27<');
  });

  it('moves the corner only along the free DOF', () => {
    expect(canMove(START)).toBe(true);
    const free = dragTo(START, 330, 40);
    expect(free.rect).toEqual({ x: 110, y: 40, w: 220, h: 150 });
    // Width held: the corner can only change height, not width.
    const widthHeld = dragTo(on('w', 'f'), 330, 50);
    expect(widthHeld.rect.w).toBe(START.rect.w);
    expect(widthHeld.rect.y).toBe(50);
    // Fully constrained and conflicting: it does not move.
    expect(canMove(on('w', 'h', 'f'))).toBe(false);
    expect(dragTo(on('w', 'h', 'f'), 400, 20)).toEqual(on('w', 'h', 'f'));
    expect(dragTo(on('h', 'x'), 400, 20)).toEqual(on('h', 'x'));
  });

  it('nudges 2 units, or 10 with Shift, and clamps', () => {
    expect(nudge(START, 1, 0, 2).rect.w).toBe(180 + 9);
    expect(nudge(START, -1, 0, 10).rect.w).toBe(180 - 45);
    expect(nudge(START, 1, 0, 10).rect.w).toBe(225);
    expect(nudge(on('w', 'h', 'f'), 1, 0, 2)).toEqual(on('w', 'h', 'f'));
  });

  it('marks the handle a slider only in the live drawing', () => {
    expect(dofMarkup(START, false)).not.toMatch(/role=|tabindex|style/);
    const live = dofMarkup(START, true);
    expect(live).toContain('role="slider"');
    expect(live).toContain('aria-disabled="false"');
    expect(dofMarkup(on('w', 'h', 'f'), true)).toContain('aria-disabled="true"');
    expect(dofMarkup(on('w', 'h', 'f'), true)).toContain('sk-handle-locked');
  });

  it('renders the figure with disabled controls and the starting line', () => {
    const html = WIDGETS['dof-playground']?.render('Switch <it>.') ?? '';
    expect(html).toContain(dofMarkup(START, false));
    expect(count(html, /<input type="checkbox" data-key="[whfx]" disabled \/>/g)).toBe(4);
    expect(html).toContain(
      '<button class="widget-button" type="button" data-key="reset" disabled>Reset</button>',
    );
    expect(html).toContain('aria-live="polite">4 DOF left</p>');
    expect(html).toContain('<figcaption>Switch &lt;it&gt;.</figcaption>');
  });
});
