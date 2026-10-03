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
      { ...parameter('p1', 'width', '40 mm'), customizer: { min: 10, max: 80, step: 1 } },
      { ...parameter('p2', 'wall', '3 mm'), customizer: { group: 'Walls', min: 1, max: 5 } },
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
    expect(issues({ ...sampleDocument(), formatVersion: 2 })).toHaveLength(1);
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

  it('checks a slider range that runs backwards', () => {
    const doc = customizedDocument();
    const bad = {
      ...doc,
      parameters: [
        { ...parameter('p1', 'width'), customizer: { min: 80, max: 10 } },
        parameter('p2', 'wall'),
      ],
    };
    expect(issues(bad)).toEqual(['parameters.0.customizer: min is 80, above max 10']);
    // Only min, only max, and min equal to max are all fine.
    for (const customizer of [{}, { min: 10 }, { max: 10 }, { min: 10, max: 10 }]) {
      expect(issues({ ...doc, parameters: [{ ...parameter('p1', 'width'), customizer }] })).toEqual(
        [],
      );
    }
  });

  it('checks the customizer fields themselves', () => {
    const doc = customizedDocument();
    const withCustomizer = (customizer: unknown) => ({
      ...doc,
      parameters: [{ ...parameter('p1', 'width'), customizer }],
    });
    expect(issues(withCustomizer({ min: '10 mm' }))).toHaveLength(1);
    expect(issues(withCustomizer({ step: 0 }))).toHaveLength(1);
    expect(issues(withCustomizer({ step: -1 }))).toHaveLength(1);
    expect(issues(withCustomizer({ group: '' }))).toHaveLength(1);
    expect(issues(withCustomizer({ group: 'x'.repeat(41) }))).toHaveLength(1);
    expect(issues(withCustomizer({ group: 'x'.repeat(40) }))).toEqual([]);
    expect(issues(withCustomizer({ min: 1, extra: 2 }))).toHaveLength(1);
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

  it('leaves a design saved before the customizer alone (no migration)', () => {
    // Exactly what an older Extrudo wrote: no `customizer`, no `configurations`.
    const old = JSON.parse(JSON.stringify(sampleDocument()));
    const { doc, loadedVersion, migrated, dropped } = loadDocument(old);
    expect(loadedVersion).toBe(1);
    expect(migrated).toBe(false);
    expect(dropped).toEqual([]);
    expect(doc).toEqual(old);
    expect(doc).not.toHaveProperty('configurations');
    expect(doc.parameters.every((p) => !('customizer' in p))).toBe(true);
    expect(DocumentSchema.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });
});
