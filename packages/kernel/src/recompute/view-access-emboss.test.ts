// The emboss and the deboss keyed by their faces' body (`view`, ADR-0024's amendment on tools
// built on a body): `operate` takes that body as their only participant, the deboss cuts it and
// the emboss joins it if the tool touches it, asked of that body alone; the report is the emboss's
// own. Boxes before, between (on top, 12 mm off) and after. Real OCCT and manifold, strict leaks,
// no clock.
import {
  type ExtrudoDocument,
  embossInputs,
  type FeatureId,
  type FeatureInputs,
  type GeomRef,
  originPlaneRef,
  profileRefId,
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
  lifted,
  proveDesigns,
  provedSteps,
  statusOf,
  topOf,
  useKernel,
} from './view-access-features-test-support';
import { document } from './view-access-test-support';

useKernel();

/**
 * A 4 mm circle on XY embossed 1 mm onto `fb`'s top face (moved onto it), or debossed into it;
 * boxes before, between (on top, 12 mm off) and after.
 */
async function emboss(mode: 'emboss' | 'deboss' = 'emboss'): Promise<ExtrudoDocument> {
  const face = await topOf();
  const b = new SketchBuilder();
  b.circle(0, 0, 2);
  const [region] = detectProfiles(b.sketch);
  return document(`an ${mode} on a box's face`, [
    box('o0', -40),
    box('fb', 0),
    lifted('o1', 12, 10, 10),
    feature('es', 'sketch', sketchInputs(originPlaneRef('origin:xy'), b.sketch)),
    feature(
      'em',
      'emboss',
      embossInputs(
        [{ kind: 'profile', id: profileRefId('es' as FeatureId, region?.id ?? '') }],
        face,
        { depth: '1 mm', mode },
      ),
    ),
    box('o2', 40),
  ]);
}

const DESIGNS: Design[] = [
  {
    name: 'an emboss on a box’s face, the box and others edited, emboss and deboss',
    make: () => emboss(),
    target: 'em',
    refsKey: 'face',
    kinds: [
      ...BASE,
      'size-face',
      'size-face',
      'size-before',
      'emboss-mode',
      'emboss-mode',
      ...GENERIC_KINDS,
    ] as Kind[],
    flips: ['size-face: view→view', 'size-before: view→view', 'emboss-mode: view→view'],
    steps: 20,
  },
];

describe('view access: emboss and deboss (ADR-0024)', () => {
  proveDesigns(DESIGNS);

  it.each(['emboss', 'deboss'] as const)(
    'an %s on a box’s face: the box wider runs it again, another box doesn’t, not even over the face',
    { timeout: 120_000 },
    async (mode) => {
      const doc = await emboss(mode);
      const run = await provedSteps([
        doc,
        setInputs(doc, 'o0', { length: length('12 mm') }),
        setInputs(doc, 'fb', { width: length('12 mm') }),
        setInputs(doc, 'o1', { x: length('0 mm') }),
      ]);
      expect(statusOf(run, 0, 'em')).toBe('ok');
      expect(run[0]?.result.stats.viewed).toEqual(['em']);
      expect(run[1]?.evaluated).toEqual(['o0']);
      expect(run[2]?.evaluated).toEqual(['fb', 'em']);
      // A box come over the face, in the emboss's way: not in the view (the emboss joins, the
      // deboss cuts, the face's box alone), so not run again.
      expect(run[3]?.evaluated).toEqual(['o1']);
      expect(statusOf(run, 3, 'em')).toBe('ok');
    },
  );

  it('answers: view, for either mode, with a face or without', () => {
    const access = (inputs: FeatureInputs) =>
      kernelFeatures()
        .get('emboss')
        ?.bodyAccess?.(inputs as never);
    const profile: GeomRef = { kind: 'profile', id: 's/r' };
    const face: GeomRef = { kind: 'face', id: 'box:b:top' };
    expect(access(embossInputs([profile], face, { mode: 'emboss' }))).toBe('view');
    expect(access(embossInputs([profile], face, { mode: 'deboss' }))).toBe('view');
    expect(access(embossInputs([profile], [], {}))).toBe('view');
  });
});
