import { createDocument, type Feature, type FeatureId, type ParameterId } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { fakeSpec } from './testing';
import {
  countIssue,
  countLabel,
  defaultInputs,
  defaultValues,
  mergeValues,
  shownFields,
  storedParameterNames,
  withParameterNames,
} from './values';

describe('what a selection field calls its picks', () => {
  it('counts one kind of pick', () => {
    expect(countLabel([{ kind: 'face', id: 'B:0:1' }])).toBe('1 face');
    expect(
      countLabel([
        { kind: 'edge', id: 'B:0:1' },
        { kind: 'edge', id: 'B:0:2' },
        { kind: 'edge', id: 'B:0:3' },
      ]),
    ).toBe('3 edges');
  });

  it('counts a whole text as a text, and mixes kinds one noun each (P4-03)', () => {
    const text = { kind: 'sketchEntity', id: 'S/word' } as const;
    expect(countLabel([text], { wholeTexts: true })).toBe('1 text');
    expect(countLabel([text, { ...text, id: 'S/other' }], { wholeTexts: true })).toBe('2 texts');
    expect(countLabel([text, { kind: 'profile', id: 'S/r1' }], { wholeTexts: true })).toBe(
      '1 text, 1 profile',
    );
    // The same reference in a field of sketch curves is a curve.
    expect(countLabel([text])).toBe('1 sketch curve');
  });

  it('says what the field calls its own', () => {
    expect(countLabel([{ kind: 'point', id: 'S/p1' }], { noun: ['point', 'points'] })).toBe(
      '1 point',
    );
  });
});

describe('values and inputs', () => {
  it('defaults every field and maps shown fields to inputs of their names', () => {
    const values = defaultValues(fakeSpec);
    expect(values).toEqual({
      refs: { faces: [] },
      exprs: { distance: '5 mm', angle: '10 deg' },
      choices: { operation: 'join' },
      toggles: { tilted: false },
      labels: {},
    });
    expect(shownFields(fakeSpec, values).map((f) => f.name)).toEqual([
      'faces',
      'operation',
      'distance',
      'tilted',
    ]);
    const tilted = mergeValues(values, { toggles: { tilted: true } });
    expect(defaultInputs(fakeSpec, tilted)).toEqual({
      faces: { kind: 'ref', refs: [] },
      operation: { kind: 'enum', value: 'join' },
      distance: { kind: 'expr', expr: '5 mm', unit: 'length' },
      tilted: { kind: 'bool', value: true },
      angle: { kind: 'expr', expr: '10 deg', unit: 'angle' },
    });
  });

  it('names parameters one past the highest dN, keeps names, and skips taken ones', () => {
    const doc = {
      ...createDocument(),
      parameters: [
        { id: 'p' as ParameterId, name: 'd4', expression: '1', unit: 'length' as const },
      ],
    };
    const inputs = {
      a: { kind: 'expr' as const, expr: '1' },
      b: { kind: 'expr' as const, expr: '2', paramName: 'd9' },
      c: { kind: 'bool' as const, value: true },
    };
    const first = withParameterNames(inputs, {}, doc);
    expect(first.names).toEqual({ a: 'd5' });
    expect(first.inputs.a).toEqual({ kind: 'expr', expr: '1', paramName: 'd5' });
    expect(first.inputs.b).toBe(inputs.b);
    // `d5` taken meanwhile (a user parameter): a new name.
    const taken = {
      ...doc,
      parameters: [...doc.parameters, { ...doc.parameters[0], id: 'q' as ParameterId, name: 'd5' }],
    } as typeof doc;
    expect(withParameterNames(inputs, first.names, taken).names).toEqual({ a: 'd6' });
    // An edited feature's own names aren't taken by itself.
    const own: Feature = {
      id: 'f' as FeatureId,
      type: 't',
      name: 'F',
      suppressed: false,
      inputs: { a: { kind: 'expr', expr: '1', paramName: 'd7' } },
    };
    const withOwn = { ...doc, features: [own] };
    expect(storedParameterNames(own)).toEqual({ a: 'd7' });
    expect(withParameterNames({ a: inputs.a }, { a: 'd7' }, withOwn, own.id).names).toEqual({
      a: 'd7',
    });
  });

  it.each([
    [{ accepts: ['face'] }, 0, 'Pick a face.'],
    [{ accepts: ['edge'], min: 2 }, 1, 'Pick at least 2 edges.'],
    [{ accepts: ['profile', 'face'], max: 1 }, 2, 'Pick at most 1 profile or face.'],
    [{ accepts: ['edge'], max: 3 }, 4, 'Pick at most 3 edges.'],
    [{ accepts: ['face'], prompt: 'Pick a flat face' }, 0, 'Pick a flat face.'],
    [{ accepts: ['face'], min: 0 }, 0, undefined],
  ] as const)('counts: %j with %i picked', (field, count, message) => {
    expect(countIssue({ kind: 'selection', name: 'x', label: 'X', ...field } as never, count)).toBe(
      message,
    );
  });
});
