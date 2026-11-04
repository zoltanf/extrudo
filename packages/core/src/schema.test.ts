import { describe, expect, it } from 'vitest';
import { createDocument } from './document';
import type { ConfigurationId } from './ids';
import { loadDocument } from './migrations';
import { DocumentSchema } from './schema';
import { feature, parameter, sampleDocument } from './testing';

const cid = (id: string) => id as ConfigurationId;

/** A document with a customizer parameter and two configurations. */
function customizedDocument() {
  const doc = sampleDocument();
  return {
    ...doc,
    parameters: [
      {
        ...parameter('p1', 'width', '40 mm'),
        customizer: { min: '10 mm', max: '80 mm', step: '1 mm' },
      },
      {
        ...parameter('p2', 'wall', '3 mm'),
        group: 'Walls',
        customizer: { min: '1 mm', max: 'width / 8' },
      },
      parameter('p3', 'gap'),
    ],
    configurations: [
      { id: cid('c1'), name: 'Big', values: { p1: '60 mm' } },
      { id: cid('c2'), name: 'Small', values: { p1: '20 mm', p2: '2 mm' } },
    ],
  };
}

function issues(doc: unknown): string[] {
  const result = DocumentSchema.safeParse(doc);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('document schema v1', () => {
  it('accepts a new document and a populated one', () => {
    expect(issues(createDocument())).toEqual([]);
    expect(issues(sampleDocument())).toEqual([]);
  });

  it('gives new documents unique IDs and sensible defaults', () => {
    const a = createDocument();
    const b = createDocument({ name: 'Box', units: 'in' });
    expect(a.id).not.toBe(b.id);
    expect(a.settings).toEqual({ units: 'mm', precision: 2 });
    expect(b).toMatchObject({ name: 'Box', settings: { units: 'in' } });
  });

  it('survives a JSON round trip unchanged', () => {
    const doc = sampleDocument();
    expect(DocumentSchema.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('rejects unknown keys, since newer formats carry a higher formatVersion', () => {
    expect(issues({ ...sampleDocument(), extra: 1 })).toEqual([': Unrecognized key: "extra"']);
    const doc = sampleDocument();
    const withExtraFeatureKey = {
      ...doc,
      features: [{ ...doc.features[0], color: 'red' }, ...doc.features.slice(1)],
    };
    expect(issues(withExtraFeatureKey)).toHaveLength(1);
  });

  it('rejects another format version', () => {
    expect(issues({ ...sampleDocument(), formatVersion: 3 })).toHaveLength(1);
  });

  it('keeps the timeline marker within the timeline', () => {
    expect(issues({ ...sampleDocument(), timelineMarker: 4 })).toEqual([
      'timelineMarker: is 4, past the end of the timeline (3 features)',
    ]);
    expect(issues({ ...sampleDocument(), timelineMarker: 0 })).toEqual([]);
  });

  it('rejects duplicate IDs and parameter names', () => {
    const doc = sampleDocument();
    expect(issues({ ...doc, features: [...doc.features, feature('f1')] })).toEqual([
      'features.3.id: duplicate id "f1"',
    ]);
    expect(issues({ ...doc, parameters: [...doc.parameters, parameter('p3', 'wall')] })).toEqual([
      'parameters.2.name: duplicate name "wall"',
    ]);
  });

  it('checks parameter names are identifiers', () => {
    const doc = sampleDocument();
    expect(issues({ ...doc, parameters: [parameter('p9', '2wide')] })).toHaveLength(1);
    expect(issues({ ...doc, parameters: [parameter('p9', '_wide_2')] })).toEqual([]);
  });

  it('validates each input kind', () => {
    const doc = sampleDocument();
    const withInputs = (inputs: unknown) => ({
      ...doc,
      features: [{ ...feature('f9'), inputs }],
      timelineMarker: 1,
    });
    expect(
      issues(
        withInputs({
          d: { kind: 'expr', expr: 'width / 2', paramName: 'd1' },
          e: { kind: 'enum', value: 'symmetric' },
          b: { kind: 'bool', value: true },
          r: { kind: 'ref', refs: [{ kind: 'face', id: 'extrude:f2:cap:end' }] },
          s: { kind: 'sketchData', sketch: { entities: {}, constraints: {}, dimensions: {} } },
        }),
      ),
    ).toEqual([]);
    expect(issues(withInputs({ d: { kind: 'number', value: 3 } }))).toHaveLength(1);
    expect(issues(withInputs({ s: { kind: 'sketchData', sketch: { entities: [] } } }))).toEqual([
      'features.0.inputs.s.sketch.entities: Invalid input: expected record, received array',
      'features.0.inputs.s.sketch.constraints: Invalid input: expected record, received undefined',
      'features.0.inputs.s.sketch.dimensions: Invalid input: expected record, received undefined',
    ]);
    expect(
      issues(withInputs({ r: { kind: 'ref', refs: [{ kind: 'face', id: 3 }] } })),
    ).toHaveLength(1);
  });
});

describe('customizer and configurations (P4-07, ADR-0059)', () => {
  it('accepts exposed parameters with ranges and named value sets', () => {
    const doc = customizedDocument();
    expect(issues(doc)).toEqual([]);
    expect(DocumentSchema.parse(doc)).toEqual(doc);
    // A parameter without `customizer` stays out of the panel, and a design
    // without configurations is the same design.
    expect(issues({ ...sampleDocument() })).toEqual([]);
    expect(issues({ ...sampleDocument(), configurations: [] })).toEqual([]);
  });

  it('leaves a range that runs backwards to the panel', () => {
    // Ranges are expressions now (ADR-0086 §2): only evaluating them can tell,
    // so the schema accepts the document and the panel shows no slider.
    const doc = customizedDocument();
    const backwards = {
      ...doc,
      parameters: [{ ...parameter('p1', 'width'), customizer: { min: '80 mm', max: '10 mm' } }],
    };
    expect(issues(backwards)).toEqual([]);
  });

  it('checks the customizer fields and the group themselves', () => {
    const doc = customizedDocument();
    const withCustomizer = (customizer: unknown) => ({
      ...doc,
      parameters: [{ ...parameter('p1', 'width'), customizer }],
    });
    const withGroup = (group: unknown) => ({
      ...doc,
      parameters: [{ ...parameter('p1', 'width'), group }],
    });
    expect(issues(withCustomizer({ min: 10 }))).toHaveLength(1);
    expect(issues(withCustomizer({ step: 1 }))).toHaveLength(1);
    expect(issues(withCustomizer({ group: 'Size' }))).toHaveLength(1);
    expect(issues(withCustomizer({ min: '1 mm', extra: 2 }))).toHaveLength(1);
    expect(issues(withCustomizer({ min: '1 mm', max: 'width', step: '0.5 mm' }))).toEqual([]);
    expect(issues(withGroup(''))).toHaveLength(1);
    expect(issues(withGroup('x'.repeat(41)))).toHaveLength(1);
    expect(issues(withGroup('x'.repeat(40)))).toEqual([]);
  });

  it('checks configuration IDs, names and value keys', () => {
    const doc = customizedDocument();
    const withConfigurations = (configurations: unknown) => ({ ...doc, configurations });
    const big = { id: cid('c1'), name: 'Big', values: {} };
    const small = { id: cid('c2'), name: 'Small', values: {} };
    expect(issues(withConfigurations([big, { ...small, id: cid('c1') }]))).toEqual([
      'configurations.1.id: duplicate id "c1"',
    ]);
    // Names are unique however they are capitalised or padded.
    expect(issues(withConfigurations([big, { ...small, name: ' big ' }]))).toEqual([
      'configurations.1.name: duplicate name " big "',
    ]);
    expect(issues(withConfigurations([big, small]))).toEqual([]);
    expect(issues(withConfigurations([{ ...big, name: '' }]))).toHaveLength(1);
    expect(issues(withConfigurations([{ ...big, name: 'x'.repeat(61) }]))).toHaveLength(1);
    expect(issues(withConfigurations([{ ...big, extra: 1 }]))).toHaveLength(1);
    // Values are expressions, keyed by a non-empty ID. A key that names a
    // parameter that isn't there is allowed (ADR-0059 §2): applying it ignores it.
    expect(issues(withConfigurations([{ ...big, values: { p1: '12 mm', p9: '3 mm' } }]))).toEqual(
      [],
    );
    expect(issues(withConfigurations([{ ...big, values: { '': '3 mm' } }]))).toHaveLength(1);
    expect(issues(withConfigurations([{ ...big, values: { p1: 12 } }]))).toHaveLength(1);
  });

  it('brings a design saved before the customizer up to the current version unchanged', () => {
    // What an older Extrudo wrote: format 1, no `customizer`, no `configurations`.
    const current = JSON.parse(JSON.stringify(sampleDocument()));
    const { doc, loadedVersion, migrated, dropped } = loadDocument({
      ...current,
      formatVersion: 1,
    });
    expect(loadedVersion).toBe(1);
    expect(migrated).toBe(true);
    expect(dropped).toEqual([]);
    expect(doc).toEqual(current);
    expect(doc).not.toHaveProperty('configurations');
    expect(doc.parameters.every((p) => !('customizer' in p))).toBe(true);
    expect(DocumentSchema.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });
});

describe('annotations (P6-23, ADR-0126 §1)', () => {
  const sketch = {
    ...feature('s1', 'sketch', 'Sketch9'),
    inputs: {
      plane: { kind: 'ref', refs: [{ kind: 'plane', id: 'origin:xy' }] },
      sketch: { kind: 'sketchData', sketch: { entities: {}, constraints: {}, dimensions: {} } },
    },
  };
  const ref = {
    kind: 'face',
    id: 'extrude:f2:cap:end',
    fingerprint: { type: 'plane', at: [0, 0, 1] },
  };
  const withNotes = (annotations: unknown[], counter = 3) => ({
    ...sampleDocument(),
    features: [...sampleDocument().features, sketch],
    timelineMarker: 4,
    annotations,
    annotationCounter: counter,
  });
  const n = (number: number, anchor: unknown, extra: object = {}) => ({
    id: `n${number}`,
    number,
    text: 'Note',
    anchor,
    ...extra,
  });

  it('takes the three anchor kinds, an offset and the two flags', () => {
    expect(
      issues(
        withNotes([
          n(1, { kind: 'model', ref, at: [1, 2, 3] }, { offset: [28, -28], done: true }),
          n(2, { kind: 'free', at: [0, 0, 0] }, { hidden: true }),
          n(3, { kind: 'sketch', sketch: 's1', at: [1, 1], entity: 'p1' }),
        ]),
      ),
    ).toEqual([]);
  });

  it('refuses a duplicate number, a number past the counter, an unknown sketch', () => {
    expect(
      issues(
        withNotes([
          n(1, { kind: 'free', at: [0, 0, 0] }),
          { ...n(1, { kind: 'free', at: [0, 0, 0] }), id: 'other' },
        ]),
      ),
    ).toEqual(['annotations.1.number: duplicate number "1"']);
    expect(issues(withNotes([n(4, { kind: 'free', at: [0, 0, 0] })]))).toEqual([
      'annotations.0.number: is 4, past annotationCounter (3)',
    ]);
    expect(
      issues({
        ...withNotes([n(1, { kind: 'free', at: [0, 0, 0] })]),
        annotationCounter: undefined,
      }),
    ).toEqual(['annotations.0.number: is 1, past annotationCounter (0)']);
    expect(issues(withNotes([n(1, { kind: 'sketch', sketch: 'f2', at: [0, 0] })]))).toEqual([
      'annotations.0.anchor.sketch: is f2, which is not a sketch of this timeline',
    ]);
  });

  it('refuses an index reference, a kind it does not take, an empty or long text, a false flag', () => {
    const model = (r: object) => n(1, { kind: 'model', ref: r, at: [0, 0, 0] });
    expect(issues(withNotes([model({ kind: 'face', id: 'index:b1:face:2' })]))).toEqual([
      "annotations.0.anchor.ref.id: is an index reference, which an annotation can't keep: pick the geometry again",
    ]);
    expect(issues(withNotes([model({ kind: 'profile', id: 's1/0' })]))).toHaveLength(1);
    expect(
      issues(withNotes([{ ...n(1, { kind: 'free', at: [0, 0, 0] }), text: '' }])),
    ).toHaveLength(1);
    expect(
      issues(withNotes([{ ...n(1, { kind: 'free', at: [0, 0, 0] }), text: 'x'.repeat(2001) }])),
    ).toHaveLength(1);
    expect(
      issues(withNotes([n(1, { kind: 'free', at: [0, 0, 0] }, { done: false })])),
    ).toHaveLength(1);
    expect(issues(withNotes([n(1, { kind: 'free', at: [0, 0] })]))).toHaveLength(1);
  });

  it('keeps a counter without annotations (they were all deleted)', () => {
    expect(issues({ ...sampleDocument(), annotationCounter: 7 })).toEqual([]);
    expect(issues({ ...sampleDocument(), annotationCounter: 0 })).toHaveLength(1);
  });
});
