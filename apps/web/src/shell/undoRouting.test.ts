// Ctrl+Z during a long update (ADR-0161).
import { describe, expect, it } from 'vitest';
import { undoRoute } from './undoRouting';

describe('undoRoute', () => {
  it('runs Cancel while the notice offers it and Cancel would only undo', () => {
    expect(undoRoute({ notice: 'cancel', cancelUndoes: true, editing: false })).toBe('cancel');
  });

  it('is a plain undo when Cancel would redo (the long update came from an undo)', () => {
    expect(undoRoute({ notice: 'cancel', cancelUndoes: false, editing: false })).toBe('undo');
  });

  it('undoes nothing more while a pressed Cancel waits', () => {
    expect(undoRoute({ notice: 'cancelling', cancelUndoes: false, editing: false })).toBe(
      'nothing',
    );
  });

  it('is the plain undo without the notice, and always in a sketch, dialog or transaction', () => {
    expect(undoRoute({ notice: undefined, cancelUndoes: true, editing: false })).toBe('undo');
    for (const notice of ['cancel', 'cancelling', undefined] as const) {
      expect(undoRoute({ notice, cancelUndoes: true, editing: true })).toBe('undo');
    }
  });
});
