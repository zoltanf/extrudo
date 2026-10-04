import {
  CommandError,
  createDocument,
  createDocumentStore,
  type DocumentStore,
  evaluateParameters,
  type FeatureId,
  HOLE_TYPE,
  holeInputs,
  insertFeature,
  newId,
  THREAD_TYPE,
  TOLERANCE_PARAMETER,
  TOLERANCE_PRESETS,
  type ToleranceUsage,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import {
  applyTolerance,
  TOLERANCE_TOOL,
  type Tolerance,
  tolerancePresetExpression,
  toleranceState,
  toleranceUsageText,
} from './useTolerance';

const store = () => createDocumentStore(createDocument());

/** What the panel's buttons and field do: a write through the store's dispatch. */
function set(s: DocumentStore, expression: string): string | undefined {
  return applyTolerance(s.getState().doc, expression, (command) => s.getState().dispatch(command));
}

/** The panel's data, as its hook would hand it to the panel. */
const panel = (s: DocumentStore): Tolerance => {
  const doc = s.getState().doc;
  return {
    ...toleranceState(doc),
    settings: doc.settings,
    evaluate: (expression) => evaluateParameters(doc).evaluate(expression, 'length'),
    set: (expression) => {
      set(s, expression);
    },
    error: undefined,
  };
};

/** A hole whose diameter carries the tolerance. */
function holeWithTolerance() {
  return {
    id: newId<FeatureId>(),
    type: HOLE_TYPE,
    name: 'Hole1',
    suppressed: false,
    inputs: holeInputs({ numbers: { diameter: '3.4 mm + 2 * tolerance' } }),
  };
}

function threadWithTolerance() {
  return {
    id: newId<FeatureId>(),
    type: THREAD_TYPE,
    name: 'Thread1',
    suppressed: false,
    inputs: { tolerance: { kind: 'expr' as const, expr: TOLERANCE_PARAMETER } },
  };
}

describe('the tolerance state of a document', () => {
  it('an empty design has no tolerance and uses nothing', () => {
    const s = store();
    expect(toleranceState(s.getState().doc)).toEqual({
      expression: '',
      value: undefined,
      preset: undefined,
      usage: { holes: 0, threads: 0, other: 0 },
      usageText: 'Not used yet',
    });
  });

  it('reads the parameter, its value in mm and the preset that value is', () => {
    const s = store();
    for (const [expression, value, preset] of [
      ['0.2 mm', 0.2, 'normal'],
      ['0.1 mm', 0.1, 'tight'],
      ['0.3 mm', 0.3, 'loose'],
      ['0.15 mm', 0.15, undefined],
      // A parameter that needs another one this document doesn't have has no value.
      ['wall / 2', undefined, undefined],
    ] as const) {
      set(s, expression);
      expect(toleranceState(s.getState().doc), expression).toMatchObject({
        expression,
        value,
        preset,
      });
      s.getState().undo();
    }
  });

  it('says who uses it: holes, threads and anything else', () => {
    const s = store();
    set(s, '0.2 mm');
    s.getState().dispatch(insertFeature({ feature: holeWithTolerance() }));
    s.getState().dispatch(insertFeature({ feature: threadWithTolerance() }));
    const state = toleranceState(s.getState().doc);
    expect(state.usage).toEqual({ holes: 1, threads: 1, other: 0 });
    expect(state.usageText).toBe('Used by 1 hole and 1 thread');
  });

  it('says who uses it, in words', () => {
    const none: ToleranceUsage = { holes: 0, threads: 0, other: 0 };
    expect(toleranceUsageText(none)).toBe('Not used yet');
    expect(toleranceUsageText({ holes: 2, threads: 1, other: 0 })).toBe(
      'Used by 2 holes and 1 thread',
    );
    expect(toleranceUsageText({ holes: 0, threads: 0, other: 3 })).toBe(
      'Used by 3 other expressions',
    );
  });
});

describe('the tolerance panel’s writes', () => {
  it('the first one creates the parameter, and every one undoes on its own', () => {
    const s = store();
    expect(set(s, '0.2 mm')).toBeUndefined();
    expect(s.getState().doc.parameters).toMatchObject([
      { name: TOLERANCE_PARAMETER, expression: '0.2 mm', unit: 'length' },
    ]);
    expect(s.getState().undoLabel).toBe('Add parameter');
    // From a value none of the buttons offers, each one changes it, one undo step.
    set(s, '0.15 mm');
    for (const preset of TOLERANCE_PRESETS) {
      set(s, tolerancePresetExpression(preset.value));
      expect(toleranceState(s.getState().doc), preset.id).toMatchObject({
        value: preset.value,
        preset: preset.id,
      });
      // The same parameter, edited: no second one.
      expect(s.getState().doc.parameters).toHaveLength(1);
      expect(s.getState().undoLabel).toBe('Edit parameter');
      s.getState().undo();
      expect(toleranceState(s.getState().doc)).toMatchObject({ value: 0.15 });
    }
    s.getState().undo();
    expect(toleranceState(s.getState().doc).expression).toBe('0.2 mm');
    s.getState().undo();
    expect(s.getState().doc.parameters).toEqual([]);
  });

  it('a typed value edits the same parameter, so one undo takes it back', () => {
    const s = store();
    set(s, '0.2 mm');
    set(s, '0.35 mm');
    expect(s.getState().doc.parameters).toHaveLength(1);
    s.getState().undo();
    expect(toleranceState(s.getState().doc).value).toBe(0.2);
  });

  it('gives the panel its document, its field and its buttons', () => {
    const s = store();
    const p = panel(s);
    expect(p.expression).toBe('');
    expect(p.usageText).toBe('Not used yet');
    p.set(tolerancePresetExpression(0.3));
    // The panel reads the document it is given, so the next one has the parameter.
    const after = panel(s);
    expect(after).toMatchObject({ expression: '0.3 mm', value: 0.3, preset: 'loose' });
    expect(after.evaluate('0.3 mm + 0.1 mm')).toMatchObject({ ok: true, value: 0.4 });
    // The tolerance itself is in scope once it exists.
    expect(after.evaluate('tolerance * 2')).toMatchObject({ ok: true, value: 0.6 });
    expect(p.evaluate('tolerance')).toMatchObject({ ok: false });
  });

  it('reports what a refused command said', () => {
    const s = store();
    // The shell's apply refuses (like the sketch host does for a refused command).
    const message = applyTolerance(s.getState().doc, '0.2 mm', () => {
      throw new CommandError('Nothing changes here.');
    });
    expect(message).toBe('Nothing changes here.');
    expect(s.getState().doc.parameters).toEqual([]);
  });

  it('is the session tool the Tolerance tile runs', () => {
    expect(TOLERANCE_TOOL).toBe('tolerance');
  });
});
