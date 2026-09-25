import { describe, expect, it } from 'vitest';
import { createDocument } from './document';
import { DocumentSchema } from './schema';
import { feature, parameter, sampleDocument } from './testing';

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
