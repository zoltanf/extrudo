/**
 * The browser's joint rows (P6-05, ADR-0081 §6): after a component's bodies, the joints whose
 * moving side it is, each with the kernel's verdict (`ModelState.joints`) and the app's own
 * check that each frame is still on its side's component. Pure, so unit tests don't load React.
 */
import {
  type BodyId,
  type ComponentId,
  type ExtrudoDocument,
  type Joint,
  type JointId,
  type JointReport,
  jointsOf,
  type ReferenceIssue,
} from '@extrudo/core';

export type JointStatus = JointReport['status'];

export interface JointRow {
  joint: Joint;
  /** The verdict; absent while suppressed or before the first recompute. */
  status?: JointStatus;
  message?: string;
  /** Frames the kernel lost or guessed (Fix References, Keep Closest Match). */
  refs?: ReferenceIssue[];
}

/**
 * One joint's row: the kernel's report, turned into a warning when a frame's body has left the
 * side's component ("Hinge's moving frame isn't on Leaf any more").
 */
export function jointRow(
  doc: Pick<ExtrudoDocument, 'components'>,
  joint: Joint,
  reports: Readonly<Record<JointId, JointReport>>,
  componentOf: (body: BodyId) => ComponentId | undefined,
): JointRow {
  const report = joint.suppressed ? undefined : reports[joint.id];
  if (!report) return { joint };
  const row: JointRow = {
    joint,
    status: report.status,
    ...(report.message && { message: report.message }),
    ...(report.refs && report.refs.length > 0 && { refs: report.refs }),
  };
  if (report.status !== 'ok' && report.status !== 'warning') return row;
  const moved: string[] = [];
  for (const [side, label] of [
    ['a', 'moving'],
    ['b', 'fixed'],
  ] as const) {
    const body = report.bodies?.[side];
    if (body === undefined || componentOf(body) === joint[side].component) continue;
    const name = doc.components?.find((c) => c.id === joint[side].component)?.name;
    moved.push(`${joint.name}'s ${label} frame isn't on ${name ?? 'its component'} any more.`);
  }
  if (moved.length === 0) return row;
  return {
    ...row,
    status: 'warning',
    message: [...(report.message ? [report.message] : []), ...moved].join(' '),
  };
}

/** The joints a component moves (its rows), in `doc.joints` order. */
export function jointRows(
  doc: Pick<ExtrudoDocument, 'components' | 'joints'>,
  component: ComponentId,
  reports: Readonly<Record<JointId, JointReport>>,
  componentOf: (body: BodyId) => ComponentId | undefined,
): JointRow[] {
  return jointsOf(doc, component).map((joint) => jointRow(doc, joint, reports, componentOf));
}

const flat = (text: string) => text.replace(/\s+/g, '_');
const number = (n: number) => {
  const rounded = Number(n.toFixed(2));
  return Object.is(rounded, -0) ? 0 : rounded;
};
const vector = (v: readonly number[]) => v.map(number).join(',');

/**
 * The Viewport's `data-joints` for tests: `Hinge:revolute:ok:<origin>:<direction>;…` per
 * unsuppressed joint in `doc.joints` order (names with spaces as `_`, numbers to 0.01; a joint
 * with no axis ends after its status). Absent (`undefined`) with no joints.
 */
export function jointsSummary(
  doc: Pick<ExtrudoDocument, 'components' | 'joints'>,
  reports: Readonly<Record<JointId, JointReport>>,
  componentOf: (body: BodyId) => ComponentId | undefined,
): string | undefined {
  const parts = (doc.joints ?? [])
    .filter((joint) => !joint.suppressed)
    .map((joint) => {
      const row = jointRow(doc, joint, reports, componentOf);
      const axis = reports[joint.id]?.axis;
      const head = `${flat(joint.name)}:${joint.type}:${row.status ?? 'pending'}`;
      return axis ? `${head}:${vector(axis.origin)}:${vector(axis.direction)}` : head;
    });
  return parts.length > 0 ? parts.join(';') : undefined;
}
