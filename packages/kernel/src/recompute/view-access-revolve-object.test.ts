// A revolve up to an object keyed by the bodies it reads (ADR-0024's amendment on up to an
// object): `touch` up to a face or a plane, its target sized by the farthest box corner from the
// axis (`ctx.farthest`, rule B). A 2 × 2 mm ring profile on XZ, 8 to 10 mm from the Z axis, turned
// up to the YZ plane through `rb` (in the ring's way at its start); `o0` far off (the farthest
// box: moved or grown, a new target size), `o1` between (inside: kept), `o2` after. Real OCCT and
// manifold, strict leaks, no clock.
import {
  type FeatureId,
  type GeomRef,
  originPlaneRef,
  profileRefId,
  revolveInputs,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { describe, expect, it } from 'vitest';
import { kernelFeatures } from '../features';
import { GENERIC_KINDS, length, setInputs } from './add-access-test-support';
import {
  BASE,
  box,
  type Design,
  feature,
  type Kind,
  proveDesigns,
  provedSteps,
  statusOf,
  useKernel,
} from './view-access-features-test-support';
import { document } from './view-access-test-support';

useKernel();

const Z_AXIS: GeomRef = { kind: 'axis', id: 'origin:z' };
const YZ: GeomRef = { kind: 'plane', id: 'origin:yz' };

function turned(options: { operation?: 'cut' | 'join'; bodies?: string[] } = {}) {
  const b = new SketchBuilder();
  b.line(8, 2, 10, 2);
  b.line(10, 2, 10, 4);
  b.line(10, 4, 8, 4);
  b.line(8, 4, 8, 2);
  const [region] = detectProfiles(b.sketch);
  const profile: GeomRef = {
    kind: 'profile',
    id: profileRefId('rs' as FeatureId, region?.id ?? ''),
  };
  return document('a revolve up to a plane', [
    box('o0', -40),
    box('rb', 9),
    box('o1', 30),
    feature('rs', 'sketch', sketchInputs(originPlaneRef('origin:xz'), b.sketch)),
    feature(
      'rv',
      'revolve',
      revolveInputs([profile], Z_AXIS, {
        extent: 'to-object',
        toObject: YZ,
        operation: options.operation ?? 'cut',
        ...(options.bodies && { bodies: options.bodies }),
      }),
    ),
    box('o2', 60),
  ]);
}

const touching = (run: Awaited<ReturnType<typeof provedSteps>>, i: number) =>
  (run[i]?.result.reports['rv' as FeatureId] as { touching: string[] } | undefined)?.touching;

const DESIGNS: Design[] = [
  {
    name: 'a revolve cut up to a plane, the farthest box moved and grown',
    make: async () => turned(),
    target: 'rv',
    refsKey: 'toObject',
    // No object: the revolve's error, every body.
    rule: ['lose: view→write', 'find: write→view', 'empty: view→write', 'fill: write→view'],
    kinds: [
      ...BASE,
      'size-before',
      'tall',
      'tall',
      'op-cycle',
      'op-cycle',
      'op-cycle',
      'op-cycle',
      ...GENERIC_KINDS,
    ] as Kind[],
    flips: [
      'size-before: view→view',
      'tall: view→view',
      'op-cycle: view→write',
      'op-cycle: write→view',
    ],
    steps: 24,
  },
];

describe('view access: a revolve up to an object (ADR-0024)', () => {
  proveDesigns(DESIGNS);

  it('the farthest box moved or grown runs it, and back; a box inside the reach is kept', {
    timeout: 120_000,
  }, async () => {
    const doc = turned();
    const run = await provedSteps([
      doc,
      setInputs(doc, 'o0', { x: length('-60 mm') }),
      doc,
      setInputs(doc, 'o0', { height: length('30 mm') }),
      doc,
      setInputs(doc, 'o1', { width: length('12 mm') }),
      setInputs(doc, 'rb', { height: length('12 mm') }),
    ]);
    expect(statusOf(run, 0, 'rv')).not.toBe('error');
    expect(run[0]?.result.stats.viewed).toEqual(['rv']);
    expect(touching(run, 0)).toContain('rb:0');
    for (const i of [1, 3]) expect(run[i]?.evaluated, `step ${i}`).toEqual(['o0', 'rv']);
    for (const i of [2, 4]) expect(run[i]?.evaluated, `step ${i}`).toEqual([]);
    expect(run[5]?.evaluated).toEqual(['o1']);
    expect(run[6]?.evaluated).toEqual(['rb', 'rv']);
  });

  it('a picked join: touch; a picked cut and up to a body: every body', () => {
    const revolve = kernelFeatures().get('revolve');
    const access = (options: Parameters<typeof revolveInputs>[2]) =>
      revolve?.bodyAccess?.(
        revolveInputs([{ kind: 'profile', id: 's/r' }], Z_AXIS, options) as never,
      );
    const face: GeomRef = { kind: 'face', id: 'f[top]' };
    expect(access({ extent: 'to-object', toObject: YZ, operation: 'cut' })).toBe('touch');
    expect(access({ extent: 'to-object', toObject: face, operation: 'join' })).toBe('touch');
    expect(
      access({ extent: 'to-object', toObject: face, operation: 'join', bodies: ['b:0'] }),
    ).toBe('touch');
    expect(access({ extent: 'to-object', toObject: face, operation: 'cut', bodies: ['b:0'] })).toBe(
      'write',
    );
    expect(
      access({ extent: 'to-object', toObject: { kind: 'body', id: 'b:0' }, operation: 'cut' }),
    ).toBe('write');
    expect(access({ extent: 'to-object', operation: 'cut' })).toBe('write');
  });
});
