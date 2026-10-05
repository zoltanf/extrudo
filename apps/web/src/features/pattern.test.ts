import {
  CircularPatternInputsSchema,
  circularSettings,
  type Feature,
  type FeatureId,
  MAX_PATTERN_TOGGLES,
  originAxisRef,
  PathPatternInputsSchema,
  type PatternReport,
  RectangularPatternInputsSchema,
  rectangularPatternInputs,
  rectangularSettings,
  toggleSkip,
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
      'skip',
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
      'skip',
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
      'skip',
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
      'skip',
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
  // An emboss has a `mode` where a solid feature has an `operation` (P4-04).
  const emboss = (id: string, mode: 'emboss' | 'deboss') =>
    ({
      id: id as FeatureId,
      type: 'emboss',
      name: `Emboss-${id}`,
      suppressed: false,
      inputs: { mode: { kind: 'enum', value: mode } },
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

    // An emboss joins or cuts by its mode.
    const withEmboss = {
      features: [feature('sk', 'sketch'), emboss('m1', 'emboss'), emboss('m2', 'deboss')],
    };
    expect(repeatableFeatures(withEmboss, 3, ['emboss']).map((f) => [f.id, f.operation])).toEqual([
      ['m1', 'join'],
      ['m2', 'cut'],
    ]);
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

  /**
   * The layout a 3 × 2 pattern of the box would report: the original at its
   * centre, five more 20 mm along X and Z, `1x1` skipped (P4-12).
   */
  const layout = (): PatternReport => ({
    instances: [
      { label: '0x0', at: [20, 15, 10], skipped: false, original: true },
      { label: '1x0', at: [40, 15, 10], skipped: false, original: false },
      { label: '2x0', at: [60, 15, 10], skipped: false, original: false },
      { label: '0x1', at: [20, 15, 30], skipped: false, original: false },
      { label: '1x1', at: [40, 15, 30], skipped: true, original: false },
      { label: '2x1', at: [60, 15, 30], skipped: false, original: false },
    ],
    series: [
      {
        mode: 'linear',
        direction: [1, 0, 0],
        step: 20,
        count: 3,
        first: [20, 15, 10],
        last: [60, 15, 10],
      },
      {
        mode: 'linear',
        direction: [0, 0, 1],
        step: 20,
        count: 2,
        first: [20, 15, 10],
        last: [20, 15, 30],
      },
    ],
  });

  it('a count handle on the last instance of each direction, and a dot per instance', () => {
    const values = mergeValues(defaultValues(rectangularPatternDialog), {
      refs: { bodies: [body], direction1: [X], direction2: [Z] },
    });
    const handles =
      rectangularPatternDialog.manipulators?.(values, { ...ctx, pattern: layout() }) ?? [];
    expect(handles.map((h) => `${h.kind}:${h.field}`)).toEqual([
      'distance:distance1',
      'distance:distance2',
      'count:count1',
      'count:count2',
      ...Array.from({ length: 5 }, () => 'toggle:skip'),
    ]);
    const counts = handles.filter((h) => h.kind === 'count');
    expect(counts[0]).toMatchObject({
      field: 'count1',
      origin: [20, 15, 10],
      last: [60, 15, 10],
      direction: [1, 0, 0],
      step: 20,
      count: 3,
      extent: false,
    });
    expect(counts[1]).toMatchObject({ field: 'count2', direction: [0, 0, 1] });
    const dots = handles.filter((h) => h.kind === 'toggle');
    // No dot on the original (it can't be skipped), and the skipped one says so.
    expect(dots.map((d) => (d.kind === 'toggle' ? [d.label, d.at, d.skipped] : []))).toEqual([
      ['1x0', [40, 15, 10], false],
      ['2x0', [60, 15, 10], false],
      ['0x1', [20, 15, 30], false],
      ['1x1', [40, 15, 30], true],
      ['2x1', [60, 15, 30], false],
    ]);
  });

  it("reads the dialog's own skip list, and leaves a huge pattern without dots", () => {
    const values = mergeValues(defaultValues(rectangularPatternDialog), {
      refs: { bodies: [body], direction1: [X] },
      // A skip the last report hasn't caught up with yet still shows as skipped.
      labels: { skip: ['1x0'] },
    });
    const dots = (
      rectangularPatternDialog.manipulators?.(values, { ...ctx, pattern: layout() }) ?? []
    )
      .filter((h) => h.kind === 'toggle' && h.skipped)
      .map((h) => (h.kind === 'toggle' ? h.label : ''));
    expect(dots).toEqual(['1x0', '1x1']);
    const many = {
      instances: Array.from({ length: MAX_PATTERN_TOGGLES + 1 }, (_, i) => ({
        label: String(i + 1),
        at: [20 + i, 15, 10] as [number, number, number],
        skipped: false,
        original: false,
      })),
      series: layout().series,
    };
    expect(
      (rectangularPatternDialog.manipulators?.(values, { ...ctx, pattern: many }) ?? []).filter(
        (h) => h.kind === 'toggle',
      ),
    ).toEqual([]);
  });

  it('counts by its share when the measure is an extent', () => {
    const values = mergeValues(defaultValues(rectangularPatternDialog), {
      refs: { bodies: [body], direction1: [X] },
      choices: { measure1: 'extent' },
    });
    const handles =
      rectangularPatternDialog.manipulators?.(values, { ...ctx, pattern: layout() }) ?? [];
    expect(handles.find((h) => h.kind === 'count')).toMatchObject({
      field: 'count1',
      extent: true,
    });
  });

  it('a circular pattern counts round the arc, and a path drives its distance', () => {
    const turn: PatternReport = {
      instances: layout().instances,
      series: [
        {
          mode: 'turn',
          direction: [0, 0, 1],
          step: Math.PI / 3,
          count: 3,
          first: [20, 15, 10],
          last: [0, 38, 10],
        },
      ],
    };
    const round = mergeValues(defaultValues(circularPatternDialog), {
      refs: { bodies: [body], axis: [Z] },
    });
    const ring = circularPatternDialog.manipulators?.(round, { ...ctx, pattern: turn }) ?? [];
    expect(ring[0]).toMatchObject({ kind: 'angle', field: 'angle' });
    // The count turns about the axis, measured from where the series starts on it.
    expect(ring[1]).toMatchObject({
      kind: 'count',
      field: 'count',
      origin: [0, 0, 10],
      // Away from the axis: the box's centre (20, 15, 10) off the world Z axis.
      zero: [0.8, 0.6, 0],
      last: [0, 38, 10],
      direction: [0, 0, 1],
      turn: true,
      extent: true,
    });

    const series: PatternReport['series'][number] = {
      mode: 'linear',
      direction: [1, 0, 0],
      step: 40,
      count: 3,
      first: [20, 15, 10],
      last: [100, 15, 10],
    };
    const along = mergeValues(defaultValues(pathPatternDialog), {
      refs: { bodies: [body], path: [{ kind: 'sketchEntity', id: 'S1/l1' }] },
    });
    const onPath = pathPatternDialog.manipulators?.(along, {
      ...ctx,
      pattern: { instances: layout().instances, series: [series] },
    });
    // Between neighbours the distance is one step, and the arrow spans the whole
    // run: two steps of it, which is the scale.
    expect(onPath?.[0]).toMatchObject({
      kind: 'distance',
      field: 'distance',
      origin: [20, 15, 10],
      direction: [1, 0, 0],
      scale: 2,
    });
    // First to last: the distance is the whole extent, so the arrow is not scaled.
    const asExtent = pathPatternDialog.manipulators?.(
      { ...along, choices: { measure: 'extent' } },
      { ...ctx, pattern: { instances: layout().instances, series: [series] } },
    );
    const extentArrow = asExtent?.[0] as unknown as {
      kind: string;
      origin: number[];
      scale?: number;
    };
    expect(extentArrow).toMatchObject({ kind: 'distance', origin: [20, 15, 10] });
    expect(extentArrow.scale ?? 1).toBe(1);
    // Nothing to stretch: one instance makes no copy, so no distance handle.
    const alone = pathPatternDialog.manipulators?.(along, {
      ...ctx,
      pattern: { instances: layout().instances, series: [{ ...series, count: 1 }] },
    });
    expect(alone?.filter((h) => h.kind === 'distance')).toEqual([]);
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

describe('the Skipped field (P4-12)', () => {
  it('is empty to begin with, and a dot on an instance fills it', () => {
    const t = setupDialogs([rectangularPatternDialog]);
    t.controller.start('rectangularPattern');
    t.controller.setRefs('bodies', [body]);
    t.controller.setRefs('direction1', [X]);
    expect(t.open()?.values.labels.skip).toEqual([]);
    // Nothing skipped makes no input at all.
    expect(t.open()?.draft.inputs.skip).toBeUndefined();

    t.controller.toggleLabel('skip', '1');
    t.controller.toggleLabel('skip', '1x1');
    expect(t.open()?.values.labels.skip).toEqual(['1', '1x1']);
    expect(t.open()?.draft.inputs.skip).toEqual({ kind: 'labels', labels: ['1', '1x1'] });
    expect(RectangularPatternInputsSchema.safeParse(t.open()?.draft.inputs).success).toBe(true);

    // Clicking the same dot again takes the label back out.
    t.controller.toggleLabel('skip', '1');
    expect(t.open()?.values.labels.skip).toEqual(['1x1']);
    // A label that isn't there is refused: the original can't be skipped.
    t.controller.toggleLabel('skip', '0');
    expect(t.open()?.values.labels.skip).toEqual(['1x1', '0']);

    t.controller.setLabels('skip', []);
    expect(t.open()?.values.labels.skip).toEqual([]);
    expect(t.open()?.draft.inputs.skip).toBeUndefined();
  });

  it('commits the list with the feature, and reads it back when the dialog opens again', () => {
    const t = setupDialogs([rectangularPatternDialog]);
    t.controller.start('rectangularPattern');
    t.controller.setRefs('bodies', [body]);
    t.controller.setRefs('direction1', [X]);
    t.controller.setLabels('skip', ['1']);
    expect(t.controller.ok()).toBe(true);
    const stored = t.store.getState().doc.features.at(-1);
    expect(stored?.inputs.skip).toEqual({ kind: 'labels', labels: ['1'] });
    expect(rectangularSettings(stored?.inputs as never).skip).toEqual(['1']);

    expect(t.controller.edit(stored?.id as never)).toBe(true);
    expect(t.open()?.values.labels.skip).toEqual(['1']);
    // One undo step takes the list with the feature.
    t.store.getState().undo();
    expect(t.store.getState().doc.features).toHaveLength(1);
  });

  it('the list repeats nothing, so a label twice is one', () => {
    const inputs = rectangularPatternInputs({
      bodies: ['A:0'],
      direction1: X,
      skip: ['1', '1', '2'],
    });
    expect(inputs.skip).toEqual({ kind: 'labels', labels: ['1', '1', '2'] });
    expect(rectangularSettings(inputs).skip).toEqual(['1', '2']);
    // What is left out of a grid is named by its position, negatives as `m1`.
    expect(toggleSkip(['m1'], '1x0')).toEqual(['m1', '1x0']);
    expect(toggleSkip(['m1', '1x0'], 'm1')).toEqual(['1x0']);
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
