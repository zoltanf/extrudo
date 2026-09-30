import {
  CircularPatternInputsSchema,
  circularSettings,
  type Feature,
  type FeatureId,
  originAxisRef,
  PathPatternInputsSchema,
  RectangularPatternInputsSchema,
  rectangularSettings,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { fixReferences } from './dialog';
import { repeatableFeatures } from './featureList';
import {
  circularPatternDialog,
  type PATTERN_DIALOGS,
  pathPatternDialog,
  rectangularPatternDialog,
} from './pattern';
import { featureDialogs, specForCommand } from './registry';
import type { DialogValues, ManipulatorContext } from './spec';
import { BOX, setupDialogs } from './testing';
import { checkValues, defaultValues, mergeValues, shownFields } from './values';

const body = { kind: 'body' as const, id: BOX };
const X = originAxisRef('origin:x');
const Z = originAxisRef('origin:z');

const names = (spec: (typeof PATTERN_DIALOGS)[number], more: Partial<DialogValues> = {}) =>
  shownFields(spec, mergeValues(defaultValues(spec), more)).map((f) => f.name);

describe('the pattern dialogs', () => {
  it('are the app’s dialogs for the three pattern tools', () => {
    const dialogs = featureDialogs();
    expect(specForCommand(dialogs, 'rectangularPattern')?.type).toBe('rectangularPattern');
    expect(specForCommand(dialogs, 'circularPattern')?.type).toBe('circularPattern');
    expect(specForCommand(dialogs, 'pathPattern')?.type).toBe('pathPattern');
  });

  it('show the fields of what is patterned: bodies with Join, or features without', () => {
    expect(names(rectangularPatternDialog)).toEqual([
      'objects',
      'bodies',
      'direction1',
      'count1',
      'distance1',
      'measure1',
      'symmetric1',
      'direction2',
      'join',
    ]);
    expect(names(rectangularPatternDialog, { choices: { objects: 'features' } })).toEqual([
      'objects',
      'features',
      'direction1',
      'count1',
      'distance1',
      'measure1',
      'symmetric1',
      'direction2',
    ]);
  });

  it('a second direction brings its own count, distance, measure and symmetry', () => {
    expect(names(rectangularPatternDialog, { refs: { direction2: [Z] } })).toEqual(
      expect.arrayContaining(['direction2', 'count2', 'distance2', 'measure2', 'symmetric2']),
    );
    expect(names(rectangularPatternDialog)).not.toContain('count2');
  });

  it('circular and path patterns have their own fields', () => {
    expect(names(circularPatternDialog)).toEqual([
      'objects',
      'bodies',
      'axis',
      'count',
      'angle',
      'measure',
      'symmetric',
      'join',
    ]);
    expect(names(pathPatternDialog)).toEqual([
      'objects',
      'bodies',
      'path',
      'count',
      'distance',
      'measure',
      'aligned',
      'flip',
      'join',
    ]);
  });

  it('take the body selected before the tool; OK inserts a valid rectangular pattern', () => {
    const t = setupDialogs([rectangularPatternDialog]);
    t.session.getState().select([{ kind: 'body', id: BOX }]);
    t.controller.start('rectangularPattern');
    expect(t.open()?.values.refs.bodies).toEqual([body]);
    // The direction is the next field to pick.
    expect(t.open()?.pickField).toBe('direction1');
    t.controller.setRefs('direction1', [X]);
    t.controller.setExpr('count1', '4');
    t.controller.setExpr('distance1', '15 mm');
    const inputs = t.open()?.draft.inputs ?? {};
    expect(RectangularPatternInputsSchema.safeParse(inputs).success).toBe(true);
    expect(inputs.count1).toMatchObject({ kind: 'expr', expr: '4', unit: 'unitless' });
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.at(-1);
    expect(feature).toMatchObject({ type: 'rectangularPattern', name: 'Rectangular Pattern1' });
    expect(rectangularSettings(feature?.inputs as never)).toMatchObject({
      objects: 'bodies',
      direction1: X,
      join: false,
    });
  });

  it('a circular pattern has an axis, and a whole turn by default', () => {
    const t = setupDialogs([circularPatternDialog]);
    t.controller.start('circularPattern');
    t.controller.setRefs('bodies', [body]);
    t.controller.setRefs('axis', [Z]);
    const inputs = t.open()?.draft.inputs ?? {};
    expect(CircularPatternInputsSchema.safeParse(inputs).success).toBe(true);
    expect(inputs.angle).toMatchObject({ expr: '360 deg', unit: 'angle' });
    expect(circularSettings(inputs as never).measure).toBe('total');
  });

  it('a path pattern takes sketch curves and edges', () => {
    const t = setupDialogs([pathPatternDialog]);
    t.controller.start('pathPattern');
    t.controller.setRefs('bodies', [body]);
    t.controller.setRefs('path', [{ kind: 'sketchEntity', id: 'S1/l1' }]);
    expect(PathPatternInputsSchema.safeParse(t.open()?.draft.inputs).success).toBe(true);
    expect(t.controller.ok()).toBe(true);
  });

  it('refuse OK without bodies or a direction', () => {
    const t = setupDialogs([rectangularPatternDialog]);
    t.controller.start('rectangularPattern');
    expect(Object.keys(t.open()?.checked.fields ?? {}).sort()).toEqual(['bodies', 'direction1']);
    expect(t.controller.ok()).toBe(false);
  });
});

describe('patterns of features', () => {
  const feature = (id: string, type: string, operation?: string, more: Partial<Feature> = {}) =>
    ({
      id: id as FeatureId,
      type,
      name: `${type}-${id}`,
      suppressed: false,
      inputs: operation ? { operation: { kind: 'enum', value: operation } } : {},
      ...more,
    }) as Feature;

  it('lists the features before the pattern that join or cut', () => {
    const doc = {
      features: [
        feature('sk', 'sketch'),
        feature('e1', 'extrude', 'new-body'),
        feature('e2', 'extrude', 'cut'),
        feature('b1', 'box', 'join'),
        feature('e3', 'extrude', 'join', { suppressed: true }),
        feature('r1', 'revolve', 'intersect'),
        feature('e4', 'extrude', 'join'),
      ],
    };
    const types = ['extrude', 'revolve', 'box'];
    expect(repeatableFeatures(doc, 6, types).map((f) => [f.id, f.operation])).toEqual([
      ['e2', 'cut'],
      ['b1', 'join'],
    ]);
    // The draft's own position limits the list: nothing after it.
    expect(repeatableFeatures(doc, 3, types).map((f) => f.id)).toEqual(['e2']);
    expect(repeatableFeatures(doc, 7, types).map((f) => f.id)).toEqual(['e2', 'b1', 'e4']);
  });

  it('OK inserts a features pattern once a feature is ticked', () => {
    const t = setupDialogs([rectangularPatternDialog]);
    t.controller.start('rectangularPattern');
    t.controller.setChoice('objects', 'features');
    t.controller.setRefs('direction1', [X]);
    expect(t.open()?.checked.fields.features).toBe('Tick at least one feature.');
    expect(t.controller.ok()).toBe(false);
    t.controller.setRefs('features', [{ kind: 'feature', id: 'e2' }]);
    const inputs = t.open()?.draft.inputs ?? {};
    expect(RectangularPatternInputsSchema.safeParse(inputs).success).toBe(true);
    // A features pattern has no bodies and no Join input.
    expect(Object.keys(inputs)).not.toContain('bodies');
    expect(Object.keys(inputs)).not.toContain('join');
    expect(inputs.objects).toEqual({ kind: 'enum', value: 'features' });
    expect(t.controller.ok()).toBe(true);
    const stored = t.store.getState().doc.features.at(-1);
    expect(rectangularSettings(stored?.inputs as never).features).toEqual([
      { kind: 'feature', id: 'e2' },
    ]);
  });

  it('checks the tick count with the same wording as other lists', () => {
    const t = setupDialogs([circularPatternDialog]);
    const ctx = { doc: t.store.getState().doc, bodies: { [BOX]: t.mesh } };
    const values = mergeValues(defaultValues(circularPatternDialog), {
      choices: { objects: 'features' },
      refs: { axis: [Z] },
    });
    const checked = checkValues(circularPatternDialog, values, new Map(), ctx);
    expect(checked.first?.message).toBe('Tick at least one feature.');
  });
});

describe('pattern handles', () => {
  const t = setupDialogs([rectangularPatternDialog, circularPatternDialog]);
  const ctx: ManipulatorContext = {
    doc: t.store.getState().doc,
    bodies: { [BOX]: t.mesh },
    value: () => 0,
  };

  it('a distance arrow per direction, starting at the middle of the body', () => {
    const values = mergeValues(defaultValues(rectangularPatternDialog), {
      refs: { bodies: [body], direction1: [X], direction2: [Z] },
    });
    const handles = rectangularPatternDialog.manipulators?.(values, ctx) ?? [];
    expect(handles.map((h) => (h.kind === 'distance' ? h.field : h.kind))).toEqual([
      'distance1',
      'distance2',
    ]);
    const first = handles[0];
    expect(first?.kind === 'distance' && first.direction).toEqual([1, 0, 0]);
  });

  it('a features pattern puts them in the middle of all bodies; nothing without a direction', () => {
    const values = mergeValues(defaultValues(rectangularPatternDialog), {
      choices: { objects: 'features' },
      refs: { direction1: [X] },
    });
    expect(rectangularPatternDialog.manipulators?.(values, ctx)).toHaveLength(1);
    const none = mergeValues(defaultValues(rectangularPatternDialog), { refs: { bodies: [body] } });
    expect(rectangularPatternDialog.manipulators?.(none, ctx)).toEqual([]);
  });

  it('circular gets an angle ring about its axis', () => {
    const values = mergeValues(defaultValues(circularPatternDialog), {
      refs: { bodies: [body], axis: [Z] },
    });
    const [ring] = circularPatternDialog.manipulators?.(values, ctx) ?? [];
    expect(ring).toMatchObject({ kind: 'angle', field: 'angle', axis: [0, 0, 1], fullTurn: true });
  });
});

describe('fixing references of a features pattern', () => {
  it('takes a lost feature out of the list', () => {
    const values = mergeValues(defaultValues(circularPatternDialog), {
      choices: { objects: 'features' },
      refs: {
        features: [
          { kind: 'feature', id: 'gone' },
          { kind: 'feature', id: 'kept' },
        ],
      },
    });
    const fixed = fixReferences(circularPatternDialog, values, [
      { ref: { kind: 'feature', id: 'gone' }, state: 'lost' },
    ]);
    expect(fixed.values.refs.features).toEqual([{ kind: 'feature', id: 'kept' }]);
    expect(fixed.fields).toEqual(['features']);
  });
});
