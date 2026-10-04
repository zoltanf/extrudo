import { describe, expect, it } from 'vitest';
import { createDocument } from './document';
import { evaluateParameters } from './expr/parameters';
import {
  HOLE_TYPE,
  type HolePreset,
  holeInputs,
  holePreset,
  presetMatches,
  presetSizes,
} from './hole';
import type { ParameterId } from './ids';
import type { ExtrudoDocument, Feature } from './schema';
import { createDocumentStore } from './stores';
import { feature, parameter } from './testing';
import { THREAD_TYPE, TOLERANCE_PARAMETER } from './thread';
import {
  setToleranceCommand,
  TOLERANCE_COMMENT,
  TOLERANCE_PRESETS,
  toleranceParameter,
  toleranceUsage,
} from './tolerance';

const pid = (s: string) => s as ParameterId;

/** A document with `tolerance` already, or without it. */
function document(withTolerance: boolean): ExtrudoDocument {
  const doc = createDocument();
  return withTolerance
    ? { ...doc, parameters: [parameter('p1', TOLERANCE_PARAMETER, '0.2 mm')] }
    : doc;
}

/** Dispatches the command the panel would, as its `apply` does. */
function set(store: ReturnType<typeof createDocumentStore>, expression: string, id: string) {
  store.getState().dispatch(setToleranceCommand(store.getState().doc, expression, pid(id)));
}

describe('the print tolerance parameter', () => {
  it('is the length parameter named tolerance, and nothing else', () => {
    expect(toleranceParameter(document(false))).toBeUndefined();
    const doc = document(true);
    expect(toleranceParameter(doc)).toMatchObject({ name: 'tolerance', expression: '0.2 mm' });
    // A parameter of another unit with the same name isn't it.
    const angle = {
      ...doc,
      parameters: [{ ...parameter('p1', 'tolerance'), unit: 'angle' as const }],
    };
    expect(toleranceParameter(angle)).toBeUndefined();
  });

  it('the first change creates it, with the comment saying what it is for', () => {
    const store = createDocumentStore(document(false));
    set(store, '0.2 mm', 'p9');
    expect(store.getState().doc.parameters).toEqual([
      {
        id: 'p9',
        name: 'tolerance',
        expression: '0.2 mm',
        unit: 'length',
        comment: TOLERANCE_COMMENT,
      },
    ]);
    expect(store.getState().undoLabel).toBe('Add parameter');
    store.getState().undo();
    expect(store.getState().doc.parameters).toEqual([]);
  });

  it('later changes edit the same parameter, one undo step each', () => {
    const store = createDocumentStore(document(false));
    set(store, '0.2 mm', 'p9');
    set(store, '0.3 mm', 'p10');
    expect(store.getState().doc.parameters).toHaveLength(1);
    expect(toleranceParameter(store.getState().doc)?.expression).toBe('0.3 mm');
    store.getState().undo();
    expect(toleranceParameter(store.getState().doc)?.expression).toBe('0.2 mm');
    store.getState().undo();
    expect(store.getState().doc.parameters).toEqual([]);
    store.getState().redo();
    expect(toleranceParameter(store.getState().doc)?.expression).toBe('0.2 mm');
  });

  it('keeps the thread feature and a hole on the same parameter', () => {
    const doc = document(true);
    const evaluation = evaluateParameters(doc);
    expect(evaluation.parameters.get(TOLERANCE_PARAMETER)?.result).toMatchObject({
      ok: true,
      value: 0.2,
    });
    // What a thread dialog proposes, and what a hole preset writes with it.
    const hole = holeInputs({ numbers: presetSizes(holePreset('m3-clearance') as never, true) });
    expect(hole.diameter).toMatchObject({ expr: '3.4 mm + 2 * tolerance', unit: 'length' });
  });

  it('offers three allowances, tight to loose', () => {
    expect(TOLERANCE_PRESETS).toEqual([
      { id: 'tight', label: 'Tight', value: 0.1 },
      { id: 'normal', label: 'Normal', value: 0.2 },
      { id: 'loose', label: 'Loose', value: 0.3 },
    ]);
  });
});

describe('hole presets with a tolerance', () => {
  const preset = holePreset('m3-clearance') as HolePreset;

  it('every diameter grows by twice the tolerance; depths and angles stay plain', () => {
    expect(presetSizes(preset, true)).toEqual({
      diameter: '3.4 mm + 2 * tolerance',
      cbDiameter: '6 mm + 2 * tolerance',
      cbDepth: '3.3 mm',
      csDiameter: '6.7 mm + 2 * tolerance',
      csAngle: '90 deg',
    });
  });

  it('without a parameter the sizes are the preset’s own', () => {
    expect(presetSizes(preset, false)).toEqual(preset.exprs);
  });

  it('matches a preset in both forms, whatever the spacing', () => {
    expect(presetMatches(preset, preset.exprs)).toBe(true);
    expect(presetMatches(preset, presetSizes(preset, true))).toBe(true);
    expect(presetMatches(preset, { diameter: '3.4mm+2*tolerance' })).toBe(true);
    // A size that isn't the preset's leaves it.
    expect(presetMatches(preset, { diameter: '3.5 mm' })).toBe(false);
    expect(presetMatches(preset, { diameter: '3.4 mm + tolerance' })).toBe(false);
    // Sizes the hole doesn't have (a simple hole's counterbore) don't count against it.
    expect(presetMatches(preset, { diameter: '3.4 mm', depth: '12 mm' })).toBe(true);
  });
});

describe('what the tolerance reaches', () => {
  const withFeatures = (...features: Feature[]) => ({ ...document(true), features });

  it('counts holes, threads and anything else, once per feature', () => {
    const doc = withFeatures(
      {
        ...feature('h1', HOLE_TYPE),
        inputs: holeInputs({ numbers: { diameter: '3.4 mm + 2 * tolerance' } }),
      },
      {
        ...feature('h2', HOLE_TYPE),
        inputs: holeInputs({ numbers: { diameter: '6 mm', csDiameter: '6.7 mm + 2 * tolerance' } }),
      },
      {
        ...feature('t1', THREAD_TYPE),
        inputs: { tolerance: { kind: 'expr', expr: TOLERANCE_PARAMETER, unit: 'length' } },
      },
      {
        ...feature('e1', 'extrude'),
        inputs: { distance: { kind: 'expr', expr: 'tolerance * 3' } },
      },
      feature('f1', 'fillet'),
    );
    expect(toleranceUsage(doc)).toEqual({ holes: 2, threads: 1, other: 1 });
  });

  it('counts a parameter that uses it as other, and skips the tolerance itself', () => {
    const doc = {
      ...document(true),
      parameters: [
        ...document(true).parameters,
        parameter('p2', 'diameter', '4 mm + 2 * tolerance'),
        parameter('p3', 'wall', '2 mm'),
      ],
    };
    expect(toleranceUsage(doc)).toEqual({ holes: 0, threads: 0, other: 1 });
    // Nothing uses it in an empty design.
    expect(toleranceUsage(document(false))).toEqual({ holes: 0, threads: 0, other: 0 });
  });
});
