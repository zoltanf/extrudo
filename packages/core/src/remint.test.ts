// A plugin command's features re-minted as ordinary ones (P6-03 slice 2,
// ADR-0077 §5): new IDs, the app's names, and every reference among them
// rewritten — fake features that refer to each other and to the design.
import { describe, expect, it } from 'vitest';
import type { FeatureId } from './ids';
import { remintFeatures } from './remint';
import type { Feature } from './schema';
import { referencedFeatures } from './timeline';

const feature = (id: string, type: string, name: string, inputs: Feature['inputs']): Feature =>
  ({ id, type, name, suppressed: false, inputs }) as Feature;

const sketch = feature('cmd.f1', 'sketch', 'Three holes › Sketch1', {
  plane: { kind: 'ref', refs: [{ kind: 'face', id: 'extrude:E1:cap:end' }] },
  sketch: {
    kind: 'sketchData',
    sketch: {
      points: {},
      lines: {},
      circles: {},
      arcs: {},
      constraints: {},
      dimensions: {},
      projections: { p1: { ref: { kind: 'edge', id: 'e[extrude:cmd.f10:cap:end|x]' } } },
    },
  },
} as unknown as Feature['inputs']);
const cut = feature('cmd.f2', 'extrude', 'Three holes › Extrude1', {
  profiles: {
    kind: 'ref',
    refs: [
      { kind: 'profile', id: 'cmd.f1/abc' },
      { kind: 'profile', id: 'cmd.f1/def' },
    ],
  },
  distance: { kind: 'expr', expr: '3 mm', unit: 'length' },
});
const fillet = feature('cmd.f10', 'fillet', 'Three holes › Fillet1', {
  edges: {
    kind: 'ref',
    refs: [
      {
        kind: 'edge',
        id: 'e[extrude:cmd.f2:side:cmd.f1/l1|extrude:E1:cap:end]',
        fingerprint: 'fp',
      } as never,
    ],
  },
  target: { kind: 'ref', refs: [{ kind: 'feature', id: 'cmd.f2' }] },
});

const design = {
  features: [
    feature('S1', 'sketch', 'Sketch1', {}),
    feature('E1', 'extrude', 'Extrude1', {}),
    feature('S2', 'sketch', 'Sketch2', {}),
  ],
};
const ids = ['n1', 'n2', 'n3'] as FeatureId[];

describe('remintFeatures', () => {
  const out = remintFeatures([sketch, cut, fillet], design, ids);

  it('gives each feature its new ID and the name the app would', () => {
    expect(out.map((f) => [f.id, f.name])).toEqual([
      ['n1', 'Sketch3'],
      ['n2', 'Extrude2'],
      ['n3', 'Fillet1'],
    ]);
  });

  it("rewrites every reference to one of them, token by token, and leaves the design's alone", () => {
    expect(out[0]?.inputs.plane).toEqual({
      kind: 'ref',
      refs: [{ kind: 'face', id: 'extrude:E1:cap:end' }],
    });
    const projections = (out[0]?.inputs.sketch as { sketch: { projections: object } } | undefined)
      ?.sketch.projections;
    // `cmd.f10` is its own token: never read as `cmd.f1` + "0".
    expect(projections).toEqual({ p1: { ref: { kind: 'edge', id: 'e[extrude:n3:cap:end|x]' } } });
    expect(out[1]?.inputs.profiles).toEqual({
      kind: 'ref',
      refs: [
        { kind: 'profile', id: 'n1/abc' },
        { kind: 'profile', id: 'n1/def' },
      ],
    });
    expect(out[1]?.inputs.distance).toBe(cut.inputs.distance);
    expect(out[2]?.inputs.edges).toEqual({
      kind: 'ref',
      refs: [
        { kind: 'edge', id: 'e[extrude:n2:side:n1/l1|extrude:E1:cap:end]', fingerprint: 'fp' },
      ],
    });
    expect(out[2]?.inputs.target).toEqual({ kind: 'ref', refs: [{ kind: 'feature', id: 'n2' }] });
  });

  it('leaves the inputs given untouched, and the dependencies follow the new IDs', () => {
    expect(cut.inputs.profiles).toMatchObject({
      refs: [{ id: 'cmd.f1/abc' }, { id: 'cmd.f1/def' }],
    });
    const all = new Set(['S1', 'E1', 'S2', ...ids]);
    expect(referencedFeatures(out[2] as Feature, all).sort()).toEqual(['E1', 'n1', 'n2']);
  });

  it('wants one ID per feature', () => {
    expect(() => remintFeatures([sketch], design, [])).toThrow('One new ID per feature.');
  });
});
