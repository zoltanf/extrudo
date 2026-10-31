import { describe, expect, it } from 'vitest';
import { anchorFor, clearHelpTarget, helpTarget, setHelpTarget } from './helpTarget';

describe('the help target (ADR-0116 §4)', () => {
  it('remembers one target until another is set or it is cleared', () => {
    clearHelpTarget();
    expect(helpTarget()).toBeUndefined();
    setHelpTarget({ tool: 'extrude' });
    expect(helpTarget()).toEqual({ tool: 'extrude' });
    setHelpTarget({ guide: 'sketching', anchor: 'snap-to-grid' });
    expect(helpTarget()).toEqual({ guide: 'sketching', anchor: 'snap-to-grid' });
    clearHelpTarget();
    expect(helpTarget()).toBeUndefined();
  });

  it('makes a heading anchor of a palette row label (ADR-0116 §3)', () => {
    expect(anchorFor('Auto-project')).toBe('auto-project');
    expect(anchorFor('Show points')).toBe('show-points');
    expect(anchorFor('Sketch grid')).toBe('sketch-grid');
    expect(anchorFor('Face outline')).toBe('face-outline');
    expect(anchorFor('Slice')).toBe('slice');
  });
});
