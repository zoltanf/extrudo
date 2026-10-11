import { describe, expect, it } from 'vitest';
import { canTogglePin, PIN_LIMIT, PINS_FULL, shownPins } from './searchPins';

const commands = Array.from({ length: 14 }, (_, i) => ({ id: `c${i}` }));

describe('shownPins', () => {
  it('keeps the stored order and leaves out what this mode does not offer', () => {
    expect(shownPins(['c3', 'gone', 'c1'], commands).map((c) => c.id)).toEqual(['c3', 'c1']);
  });

  it('shows the first ten of a longer stored list', () => {
    const pinned = commands.map((c) => c.id);
    const shown = shownPins(pinned, commands);
    expect(shown).toHaveLength(PIN_LIMIT);
    expect(shown.at(-1)?.id).toBe('c9');
  });
});

describe('canTogglePin', () => {
  it('refuses an eleventh pin and always allows an unpin', () => {
    const pinned = commands.slice(0, 10).map((c) => c.id);
    expect(canTogglePin('c12', pinned, 10)).toBe(false);
    expect(canTogglePin('c3', pinned, 10)).toBe(true);
    expect(canTogglePin('c12', pinned.slice(1), 9)).toBe(true);
  });

  it('says why', () => {
    expect(PINS_FULL).toBe('Up to 10 pins: unpin one first.');
  });
});
