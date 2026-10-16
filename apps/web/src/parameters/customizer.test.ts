import {
  applyCommand,
  type Customizer,
  createDocument,
  createDocumentStore,
  customizerRows,
  type EvaluateResult,
  type ExtrudoDocument,
  evaluateParameters,
  type ParameterId,
  setParameterCustomizer,
  type UnitKind,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { rangeValue, sliderStep, valueExpression, withRangeField } from './customizer';
import { starCommand } from './ParametersDialog';

/**
 * P4-07, ADR-0059 §1, ADR-0086 §2: the Parameters dialog's Customizer switch and
 * the range it then shows.
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

describe('withRangeField', () => {
  /** What a Min, Max or Step field writes through the command. */
  const write = (doc: ExtrudoDocument, field: 'min' | 'max' | 'step', text: string) =>
    applyCommand(
      doc,
      setParameterCustomizer({
        id: pid('p1'),
        customizer: withRangeField(doc.parameters[0]?.customizer, field, text),
      }),
    ).doc;

  it('keeps the text as typed, formulas included, and leaves the other fields', () => {
    const doc = withParameter({ customizer: { min: '10 mm', max: '80 mm' } });
    expect(withRangeField({ min: '10 mm' }, 'max', 'width * 2')).toEqual({
      min: '10 mm',
      max: 'width * 2',
    });
    expect(write(doc, 'step', '0.5 mm').parameters[0]?.customizer).toEqual({
      min: '10 mm',
      max: '80 mm',
      step: '0.5 mm',
    });
  });

  it('takes an end away when its field is emptied, one undo step each', () => {
    const doc = withParameter({ customizer: { min: '10 mm', max: '80 mm', step: '5 mm' } });
    expect(write(doc, 'max', ' ').parameters[0]?.customizer).toEqual({
      min: '10 mm',
      step: '5 mm',
    });
    const store = createDocumentStore(doc);
    store.getState().dispatch(
      setParameterCustomizer({
        id: pid('p1'),
        customizer: withRangeField(doc.parameters[0]?.customizer, 'min', ''),
      }),
    );
    expect(store.getState().doc.parameters[0]?.customizer).toEqual({ max: '80 mm', step: '5 mm' });
    store.getState().undo();
    expect(store.getState().doc.parameters[0]?.customizer).toEqual({
      min: '10 mm',
      max: '80 mm',
      step: '5 mm',
    });
  });

  it('leaves the parameter exposed with no range when all three are gone', () => {
    let doc = withParameter({ customizer: { min: '10 mm', max: '80 mm', step: '5 mm' } });
    for (const field of ['min', 'max', 'step'] as const) doc = write(doc, field, '');
    expect(doc.parameters[0]?.customizer).toEqual({});
    // Exposed, so the panel still lists it (it just has no slider).
    expect(customizerRows(doc, evaluateParameters(doc))).toHaveLength(1);
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
    const store = createDocumentStore(
      withParameter({ customizer: { min: '10 mm', max: '80 mm' } }),
    );
    expect(store.getState().doc.parameters[0]?.customizer).toEqual({ min: '10 mm', max: '80 mm' });
    store.getState().dispatch(starCommand(pid('p1'), true));
    expect(store.getState().doc.parameters[0]?.customizer).toBeUndefined();
    expect(evaluate(withParameter()).value).toBe(25.4);
  });
});
