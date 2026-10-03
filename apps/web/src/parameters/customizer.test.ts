import {
  applyCommand,
  type Customizer,
  createDocument,
  createDocumentStore,
  customizerRows,
  type EvaluateResult,
  ExprError,
  type ExtrudoDocument,
  evaluateParameters,
  type ParameterId,
  setParameterCustomizer,
  type UnitKind,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import {
  rangeText,
  rangeValue,
  sliderStep,
  valueExpression,
  withoutRangeField,
  withRangeField,
} from './customizer';
import { starCommand } from './ParametersDialog';

/**
 * P4-07, ADR-0059 §1: the Parameters dialog's star and the range it then shows.
 * The dialog itself draws in a portal (Radix `Dialog`), which a static render
 * leaves empty, so what is tested here is what the star and the fields write.
 */
const pid = (id: string) => id as ParameterId;
const MM = { units: 'mm', precision: 2 } as const;
const INCH = { units: 'in', precision: 2 } as const;

function withParameter(extra: Partial<{ customizer: Customizer }> = {}): ExtrudoDocument {
  return {
    ...createDocument(),
    parameters: [{ id: pid('p1'), name: 'width', expression: '40 mm', unit: 'length', ...extra }],
  };
}

const evaluate = (doc: ExtrudoDocument, unit: UnitKind = 'length') => {
  const result: EvaluateResult = evaluateParameters(doc).evaluate('1 in', unit);
  if (!result.ok) throw new Error(result.error.message);
  return result;
};

describe('the customizer star', () => {
  it('exposes the parameter with an empty customizer, and takes it out again', () => {
    const doc = withParameter();
    const starred = applyCommand(doc, starCommand(pid('p1'), false)).doc;
    expect(starred.parameters[0]?.customizer).toEqual({});
    // One undo step each way.
    const unstarred = applyCommand(starred, starCommand(pid('p1'), true)).doc;
    expect(unstarred.parameters[0]?.customizer).toBeUndefined();
    expect(applyCommand(doc, starCommand(pid('p1'), false)).doc.parameters[0]?.customizer).toEqual(
      {},
    );
  });

  it('refuses a parameter that is not there', () => {
    expect(() => applyCommand(withParameter(), starCommand(pid('nope'), false))).toThrow(
      "Parameter nope doesn't exist.",
    );
  });
});

describe('valueExpression', () => {
  it("writes a plain value in the parameter's unit, with the document's length unit", () => {
    expect(valueExpression('length', 12.5, MM)).toBe('12.50 mm');
    expect(valueExpression('length', 25.4, INCH)).toBe('1.00 in');
    expect(valueExpression('angle', 30, MM)).toBe('30 deg');
    expect(valueExpression('unitless', 2, MM)).toBe('2.00');
  });

  it('leaves no floating point tails in a slider step', () => {
    expect(valueExpression('length', 0.1 + 0.2, MM)).toBe('0.30 mm');
  });
});

describe('rangeText', () => {
  it("is empty while a range end is unset, and reads in the document's unit", () => {
    expect(rangeText('length', undefined, MM)).toBe('');
    expect(rangeText('length', 10, MM)).toBe('10.00 mm');
    expect(rangeText('length', 25.4, INCH)).toBe('1.00 in');
    expect(rangeText('angle', undefined, MM)).toBe('');
  });
});

describe('withRangeField', () => {
  const evaluateIn = (doc: ExtrudoDocument, expression: string, unit: UnitKind = 'length') =>
    evaluateParameters(doc).evaluate(expression, unit);

  it('stores the evaluated base-unit number, whichever unit the field is written in', () => {
    const doc = withParameter();
    expect(withRangeField({}, 'min', '1 in', (t) => evaluateIn(doc, t))).toEqual({ min: 25.4 });
    expect(withRangeField({}, 'max', '80 mm', (t) => evaluateIn(doc, t))).toEqual({ max: 80 });
  });

  it('keeps the other settings, and an empty field takes its range end away', () => {
    const current: Customizer = { min: 10, max: 80, group: 'Size' };
    expect(
      withRangeField(current, 'step', '0.5 mm', () => ({
        ok: true,
        value: 0.5,
        dim: { length: 1, angle: 0 },
      })),
    ).toEqual({ min: 10, max: 80, step: 0.5, group: 'Size' });
    expect(
      withRangeField(current, 'min', '', () => ({
        ok: true,
        value: 0,
        dim: { length: 1, angle: 0 },
      })),
    ).toEqual({
      max: 80,
      group: 'Size',
    });
  });

  it("leaves the range as it was when the text doesn't evaluate", () => {
    const bad: EvaluateResult = {
      ok: false,
      error: new ExprError('That is not a length.', { start: 0, end: 3 }),
    };
    expect(withRangeField({ min: 10 }, 'min', 'ten mm', () => bad)).toEqual({ min: 10 });
  });
});

describe('withoutRangeField', () => {
  /** What a "Clear Min/Max/Step" button writes through the command. */
  const clear = (doc: ExtrudoDocument, field: 'min' | 'max' | 'step') =>
    applyCommand(
      doc,
      setParameterCustomizer({
        id: pid('p1'),
        customizer: withoutRangeField(doc.parameters[0]?.customizer, field),
      }),
    ).doc;

  it('takes away that one value and leaves the others', () => {
    const doc = withParameter({ customizer: { min: 10, max: 80, step: 5, group: 'Size' } });
    expect(clear(doc, 'max').parameters[0]?.customizer).toEqual({
      min: 10,
      step: 5,
      group: 'Size',
    });
    expect(clear(doc, 'step').parameters[0]?.customizer).toEqual({
      min: 10,
      max: 80,
      group: 'Size',
    });
    // One undo step each.
    const store = createDocumentStore(doc);
    store.getState().dispatch(
      setParameterCustomizer({
        id: pid('p1'),
        customizer: withoutRangeField({ min: 10, max: 80 }, 'min'),
      }),
    );
    expect(store.getState().doc.parameters[0]?.customizer).toEqual({ max: 80 });
    // One undo step brings the whole range back.
    store.getState().undo();
    expect(store.getState().doc.parameters[0]?.customizer).toEqual({
      min: 10,
      max: 80,
      step: 5,
      group: 'Size',
    });
  });

  it('leaves the parameter exposed with no range when all three are gone', () => {
    let doc = withParameter({ customizer: { min: 10, max: 80, step: 5 } });
    for (const field of ['min', 'max', 'step'] as const) doc = clear(doc, field);
    expect(doc.parameters[0]?.customizer).toEqual({});
    // Exposed, so the panel still lists it (it just has no slider).
    expect(customizerRows(doc, evaluateParameters(doc).parameters)).toHaveLength(1);
  });
});

describe('the slider', () => {
  it("takes the row's own step, or a hundredth of the range", () => {
    expect(sliderStep(0, 100, 5)).toBe(5);
    expect(sliderStep(10, 60, undefined)).toBe(0.5);
    // A range that can't be divided still moves.
    expect(sliderStep(0, 0, undefined)).toBe(1);
    expect(sliderStep(0, 10, 0)).toBe(0.1);
  });

  it('shows the value inside the range, or the minimum when there is none', () => {
    expect(rangeValue(10, 80, 40)).toBe(40);
    expect(rangeValue(10, 80, undefined)).toBe(10);
    expect(rangeValue(10, 80, 90)).toBe(80);
    expect(rangeValue(10, 80, Number.NaN)).toBe(10);
  });
});

describe('the settings the dialog reads', () => {
  it("come from the store, and the evaluation is the document's", () => {
    const store = createDocumentStore(withParameter({ customizer: { min: 10, max: 80 } }));
    expect(store.getState().doc.parameters[0]?.customizer).toEqual({ min: 10, max: 80 });
    store.getState().dispatch(starCommand(pid('p1'), true));
    expect(store.getState().doc.parameters[0]?.customizer).toBeUndefined();
    expect(evaluate(withParameter()).value).toBe(25.4);
  });
});
