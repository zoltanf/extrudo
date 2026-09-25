import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { createDocument } from '../document';
import {
  addParameter,
  removeParameter,
  updateParameter,
  updateSettings,
} from '../document-commands';
import type { ExtrudoDocument, Feature, Parameter, UnitKind } from '../schema';
import { fid, pid } from '../testing';
import {
  evaluateParameters,
  mentions,
  nextModelParameterName,
  renameReferences,
} from './parameters';
import { ANGLE, LENGTH, UNITLESS } from './units';

function param(name: string, expression: string, unit: UnitKind = 'length'): Parameter {
  return { id: pid(`id-${name}`), name, expression, unit };
}

function feature(id: string, inputs: Record<string, [expr: string, paramName?: string]>): Feature {
  return {
    id: fid(id),
    type: 'extrude',
    name: `Feature ${id}`,
    suppressed: false,
    inputs: Object.fromEntries(
      Object.entries(inputs).map(([key, [expr, paramName]]) => [
        key,
        { kind: 'expr' as const, expr, ...(paramName ? { paramName } : {}) },
      ]),
    ),
  };
}

function doc(parameters: Parameter[], features: Feature[] = []): ExtrudoDocument {
  return {
    ...createDocument({ now: '2026-09-25T10:00:00.000Z' }),
    parameters,
    features,
    timelineMarker: features.length,
  };
}

function valueFor(d: ExtrudoDocument, name: string) {
  const result = evaluateParameters(d).parameters.get(name)?.result;
  if (!result?.ok) throw new Error(`${name}: ${result?.error.message}`);
  return result;
}

function errorFor(d: ExtrudoDocument, name: string) {
  const result = evaluateParameters(d).parameters.get(name)?.result;
  if (!result || result.ok) throw new Error(`${name}: expected an error`);
  return result.error;
}

describe('evaluateParameters', () => {
  it('evaluates parameters in dependency order, whatever the list order', () => {
    const d = doc([
      param('lid', 'box_h / 4'),
      param('box_h', 'width * ratio'),
      param('width', '80 mm'),
      param('ratio', '0.5', 'unitless'),
    ]);
    expect(valueFor(d, 'lid')).toEqual({ ok: true, value: 10, dim: LENGTH });
    expect(valueFor(d, 'box_h').value).toBe(40);
  });

  it('applies each parameter’s unit kind', () => {
    const d = doc([param('a', '15', 'angle'), param('n', '3', 'unitless'), param('w', '2')]);
    expect(valueFor(d, 'a')).toEqual({ ok: true, value: 15, dim: ANGLE });
    expect(valueFor(d, 'n')).toEqual({ ok: true, value: 3, dim: UNITLESS });
    expect(valueFor(d, 'w')).toEqual({ ok: true, value: 2, dim: LENGTH });
  });

  it('takes plain numbers in the document unit', () => {
    let d = doc([param('w', '2')]);
    d = applyCommand(d, updateSettings({ units: 'in' })).doc;
    expect(valueFor(d, 'w').value).toBeCloseTo(50.8);
  });

  it('reports a cycle on every parameter in it, with the path (FR-PAR-04)', () => {
    const d = doc([
      param('wall', 'lid_gap + 1 mm'),
      param('lid_gap', 'wall / 2'),
      param('depth', 'wall * 2'),
      param('ok', '5 mm'),
    ]);
    expect(errorFor(d, 'wall').message).toBe('`wall` refers to itself: wall → lid_gap → wall.');
    expect(errorFor(d, 'lid_gap').message).toBe(
      '`lid_gap` refers to itself: lid_gap → wall → lid_gap.',
    );
    expect(errorFor(d, 'depth').message).toBe('Uses `wall`, which has an error.');
    expect(valueFor(d, 'ok').value).toBe(5);
  });

  it('underlines the reference that closes the cycle', () => {
    const d = doc([param('a', '2 * b + 1'), param('b', 'a')]);
    expect(errorFor(d, 'a').span).toEqual({ start: 4, end: 5 });
  });

  it('reports a parameter that refers to itself directly', () => {
    const d = doc([param('a', 'a + 1')]);
    expect(errorFor(d, 'a').message).toBe('`a` refers to itself.');
  });

  it('finds cycles through longer chains and model parameters', () => {
    const d = doc(
      [param('a', 'b'), param('b', 'd1 * 2')],
      [feature('f1', { distance: ['a + 1 mm', 'd1'] })],
    );
    expect(errorFor(d, 'd1').message).toBe('`d1` refers to itself: d1 → a → b → d1.');
  });

  it('reports undefined names with a suggestion (FR-PAR-04)', () => {
    const d = doc([param('width', '10 mm'), param('h', 'widht * 2')]);
    expect(errorFor(d, 'h').message).toBe('Unknown name `widht`. Did you mean `width`?');
  });

  it('passes errors on to dependents without hiding the original', () => {
    const d = doc([param('a', '1 +'), param('b', 'a * 2'), param('c', 'b + 1 mm')]);
    expect(errorFor(d, 'a').message).toBe('Expected a value after `+`.');
    expect(errorFor(d, 'b').message).toBe('Uses `a`, which has an error.');
    expect(errorFor(d, 'c').message).toBe('Uses `b`, which has an error.');
  });

  it('includes model parameters and plain feature inputs', () => {
    const d = doc(
      [param('wall', '3 mm')],
      [feature('f1', { distance: ['wall * 4', 'd1'], offset: ['d1 / 2'] })],
    );
    const e = evaluateParameters(d);
    expect([...e.parameters.keys()]).toEqual(['wall', 'd1']);
    expect(e.parameters.get('d1')).toMatchObject({
      owner: { type: 'model', featureId: 'f1', input: 'distance' },
      refs: ['wall'],
      result: { ok: true, value: 12 },
    });
    expect(e.inputs.get(fid('f1'))?.get('offset')).toEqual({ ok: true, value: 6, dim: LENGTH });
    expect(e.inputs.get(fid('f1'))?.get('distance')).toEqual({ ok: true, value: 12, dim: LENGTH });
  });

  it('flags a model parameter name that is already taken', () => {
    const d = doc([param('d1', '3 mm')], [feature('f1', { distance: ['5 mm', 'd1'] })]);
    const input = evaluateParameters(d).inputs.get(fid('f1'))?.get('distance');
    expect(input).toMatchObject({ ok: false, error: { message: 'The name `d1` is used twice.' } });
  });

  it('evaluates extra expressions against the current values', () => {
    const e = evaluateParameters(doc([param('w', '40 mm')]));
    expect(e.evaluate('w / 4')).toEqual({ ok: true, value: 10, dim: LENGTH });
    expect(e.evaluate('w', 'angle')).toMatchObject({ ok: false });
  });
});

describe('dependencies', () => {
  const d = doc(
    [
      param('width', '80 mm'),
      param('wall', '2 mm'),
      param('inner', 'width - 2 * wall'),
      param('lid', 'inner / 2'),
      param('other', '5 mm'),
    ],
    [
      feature('f1', { distance: ['width', 'd1'] }),
      feature('f2', { distance: ['lid'] }),
      feature('f3', { distance: ['other', 'd2'] }),
      feature('f4', { distance: ['d1 + 1 mm'] }),
    ],
  );
  const e = evaluateParameters(d);

  it('finds direct and indirect dependents', () => {
    expect(e.dependents(['wall'])).toEqual(new Set(['inner', 'lid']));
    expect(e.dependents(['width'])).toEqual(new Set(['inner', 'lid', 'd1']));
    expect(e.dependents(['other'])).toEqual(new Set(['d2']));
    expect(e.dependents(['lid'])).toEqual(new Set());
  });

  it('marks the features that need a recompute when parameters change', () => {
    expect(e.featuresAffectedBy(['wall'])).toEqual(['f2']);
    expect(e.featuresAffectedBy(['width'])).toEqual(['f1', 'f2', 'f4']);
    expect(e.featuresAffectedBy(['d2'])).toEqual(['f3']);
    expect(e.featuresAffectedBy([])).toEqual([]);
  });
});

describe('names', () => {
  it('numbers model parameters after the highest in use', () => {
    const d = doc([param('d7', '1')], [feature('f1', { a: ['1', 'd2'], b: ['2', 'd12'] })]);
    expect(nextModelParameterName(d)).toBe('d13');
    expect(nextModelParameterName(doc([]))).toBe('d1');
  });

  it.each<[string, string, boolean]>([
    ['wall * 2', 'wall', true],
    ['2*wall', 'wall', true],
    ['walls + 1', 'wall', false],
    ['my_wall', 'wall', false],
    ['wall(2)', 'wall', false],
    ['max(wall, 1)', 'wall', true],
    ['max(wall , 1', 'wall', true],
  ])('%s mentions %s: %s', (expression, name, expected) => {
    expect(mentions(expression, name)).toBe(expected);
  });

  it('renames references and nothing else', () => {
    expect(renameReferences('wall + walls * max(wall, d1) + my_wall', 'wall', 't')).toBe(
      't + walls * max(t, d1) + my_wall',
    );
  });
});

describe('parameter commands', () => {
  const base = doc(
    [param('width', '80 mm'), param('wall', '2 mm'), param('inner', 'width - 2*wall')],
    [feature('f1', { distance: ['wall * 3', 'd1'] })],
  );

  it('rename carries over to every expression that uses the parameter', () => {
    const next = applyCommand(
      base,
      updateParameter({ id: pid('id-wall'), changes: { name: 'thickness' } }),
    ).doc;
    expect(next.parameters.map((p) => [p.name, p.expression])).toEqual([
      ['width', '80 mm'],
      ['thickness', '2 mm'],
      ['inner', 'width - 2*thickness'],
    ]);
    expect(next.features[0]?.inputs.distance).toMatchObject({ expr: 'thickness * 3' });
    expect(valueFor(next, 'inner').value).toBe(76);
  });

  it('refuse to delete a parameter that is in use', () => {
    expect(() => applyCommand(base, removeParameter({ id: pid('id-wall') }))).toThrow(
      '`wall` is used by `inner` and Feature f1. Change those first.',
    );
    const unused = applyCommand(base, removeParameter({ id: pid('id-inner') })).doc;
    expect(unused.parameters.map((p) => p.name)).toEqual(['width', 'wall']);
  });

  it.each(['mm', 'sin', 'pi', 'd1', 'width'])('reject the name %s', (name) => {
    expect(() => applyCommand(base, addParameter({ parameter: param(name, '1') }))).toThrow();
  });
});
