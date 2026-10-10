import type { BodyId, ComponentId, Joint, JointId, JointReport } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { jointRow, jointRows, jointsSummary } from './jointRows';

const cid = (id: string) => id as ComponentId;
const components = [
  { id: cid('base'), name: 'Base', visible: true },
  { id: cid('leaf'), name: 'Leaf', visible: true },
];
const hinge: Joint = {
  id: 'j1' as JointId,
  name: 'Lid hinge',
  type: 'revolute',
  a: { component: cid('leaf'), ref: { kind: 'face', id: 'hole' } },
  b: { component: cid('base'), ref: { kind: 'face', id: 'pin' } },
};
const slide: Joint = { ...hinge, id: 'j2' as JointId, name: 'Slide', type: 'slider' };
const doc = { components, joints: [hinge, { ...slide, a: hinge.b, b: hinge.a }] };
const ok: JointReport = {
  status: 'ok',
  axis: { origin: [-0.001, 0, 2], direction: [1, 0, -0] },
  bodies: { a: 'L:0' as BodyId, b: 'B:0' as BodyId },
};
const members: Record<string, ComponentId> = { 'L:0': cid('leaf'), 'B:0': cid('base') };
const componentOf = (body: BodyId) => members[body];

describe('joint rows', () => {
  it('lists the joints a component moves, with the verdict', () => {
    const reports = { j1: ok, j2: { status: 'error', message: 'Lost.' } } as Record<
      JointId,
      JointReport
    >;
    expect(jointRows(doc, cid('leaf'), reports, componentOf)).toEqual([
      { joint: hinge, status: 'ok' },
    ]);
    expect(jointRows(doc, cid('base'), reports, componentOf)[0]).toMatchObject({
      status: 'error',
      message: 'Lost.',
    });
    // Suppressed or not computed yet: no verdict.
    expect(jointRow(doc, { ...hinge, suppressed: true }, reports, componentOf)).toEqual({
      joint: { ...hinge, suppressed: true },
    });
    expect(jointRow(doc, hinge, {}, componentOf)).toEqual({ joint: hinge });
  });

  it("warns when a frame's body left the side's component", () => {
    const moved = (body: BodyId) => (body === 'L:0' ? cid('base') : componentOf(body));
    expect(jointRow(doc, hinge, { [hinge.id]: ok }, moved)).toMatchObject({
      status: 'warning',
      message: "Lid hinge's moving frame isn't on Leaf any more.",
    });
  });

  it('sums them up for tests', () => {
    expect(jointsSummary(doc, { [hinge.id]: ok }, componentOf)).toBe(
      'Lid_hinge:revolute:ok:0,0,2:1,0,0;Slide:slider:pending',
    );
    expect(jointsSummary({ components }, {}, componentOf)).toBeUndefined();
  });
});
