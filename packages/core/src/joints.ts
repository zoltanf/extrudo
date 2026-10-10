/**
 * Joints (P6-05, ADR-0081 §4): as-built joints between two components.
 *
 * A joint is made where the parts already are: a frame on each of two
 * components, and nothing moves. Side `a` moves, side `b` stays. What a joint
 * does is look: its pose is view state and its clearance check a kernel query,
 * so nothing here recomputes a feature. The kernel resolves every unsuppressed
 * joint's frames after each recompute (`ModelState.joints`).
 */
import { CommandError, type CommandFactory, type DocumentDraft, defineCommand } from './commands';
import type { ComponentId, JointId } from './ids';
import {
  type ExprInput,
  type ExtrudoDocument,
  JOINT_FRAME_KINDS,
  JOINT_LIMIT_UNIT,
  type Joint,
} from './schema';

export type JointType = Joint['type'];

/** The longest joint name (the schema's limit). */
export const JOINT_NAME_MAX = 100;

/** "Joint1", "Joint2"…: the lowest number no joint's name uses. "Hinge1"… is not guessed. */
export function newJointName(doc: Pick<ExtrudoDocument, 'joints'>): string {
  const taken = new Set((doc.joints ?? []).map((j) => j.name.toLowerCase()));
  let n = 1;
  while (taken.has(`joint${n}`)) n++;
  return `Joint${n}`;
}

/** The joints whose moving side is `component`, in `doc.joints` order (the browser's rows). */
export function jointsOf(doc: Pick<ExtrudoDocument, 'joints'>, component: ComponentId): Joint[] {
  return (doc.joints ?? []).filter((j) => j.a.component === component);
}

/**
 * The components that move when `joint` moves its side a: a's component plus
 * every component joined to it by unsuppressed rigid joints, never crossing
 * b's component. In the order the walk reaches them, a's first.
 */
export function movingComponents(
  doc: Pick<ExtrudoDocument, 'joints'>,
  joint: Joint,
): ComponentId[] {
  const stays = joint.b.component;
  const found: ComponentId[] = [joint.a.component];
  const seen = new Set<ComponentId>([joint.a.component, stays]);
  const rigid = (doc.joints ?? []).filter(
    (j) => j.type === 'rigid' && !j.suppressed && j.id !== joint.id,
  );
  for (let at = 0; at < found.length; at++) {
    const here = found[at] as ComponentId;
    for (const j of rigid) {
      const other =
        j.a.component === here ? j.b.component : j.b.component === here ? j.a.component : undefined;
      if (other === undefined || seen.has(other)) continue;
      seen.add(other);
      found.push(other);
    }
  }
  return found;
}

/**
 * A joint's limits in degrees (revolute) or mm (slider), read through `value`
 * (the document's expression evaluation). `undefined` unless both are there:
 * a revolute without both turns a whole turn, a slider without both can't be
 * posed or checked. A rigid joint has none.
 */
export function jointRange(
  joint: Joint,
  value: (input: ExprInput) => number,
): { min: number; max: number } | undefined {
  if (joint.type === 'rigid' || !joint.min || !joint.max) return undefined;
  return { min: value(joint.min), max: value(joint.max) };
}

/**
 * Why a joint can't be stored as it is, or `undefined`: the schema's rules
 * (ADR-0081 §4) in the words a person reads.
 */
export function jointProblem(
  doc: Pick<ExtrudoDocument, 'components'>,
  joint: Omit<Joint, 'id' | 'name'>,
): string | undefined {
  const components = doc.components ?? [];
  for (const side of ['a', 'b'] as const) {
    if (!components.some((c) => c.id === joint[side].component)) {
      return `Component ${joint[side].component} doesn't exist.`;
    }
    if (!JOINT_FRAME_KINDS[joint.type].includes(joint[side].ref.kind)) {
      return `A ${joint.type} joint can't use a ${joint[side].ref.kind} as a frame.`;
    }
  }
  if (joint.a.component === joint.b.component) {
    const name = components.find((c) => c.id === joint.a.component)?.name;
    return `Both sides are in ${name}: pick a frame on another component.`;
  }
  const unit = JOINT_LIMIT_UNIT[joint.type];
  for (const limit of [joint.min, joint.max]) {
    if (!limit) continue;
    if (unit === undefined) return 'A rigid joint has no limits.';
    if ((limit.unit ?? 'length') !== unit) {
      return `A ${joint.type} joint's limits are ${unit === 'angle' ? 'angles' : 'lengths'}.`;
    }
  }
  return undefined;
}

/** A new joint, appended to `doc.joints` (ID from `newId()` in the caller). One undo step. */
export const addJoint = defineCommand<{ joint: Joint }>(
  'joint.add',
  'New joint',
  (draft, { joint }) => {
    if ((draft.joints ?? []).some((j) => j.id === joint.id)) {
      throw new CommandError(`Joint ${joint.id} already exists.`);
    }
    const name = jointName(draft, joint.name);
    check(draft, joint);
    draft.joints = [...(draft.joints ?? []), { ...joint, name }];
  },
);

/** Replaces a joint's type, frames, limits and flags, keeping its place. One undo step. */
export const updateJoint = defineCommand<{ id: JointId; joint: Omit<Joint, 'id'> }>(
  'joint.update',
  'Edit joint',
  (draft, { id, joint }) => {
    const at = indexOf(draft, id);
    const name = jointName(draft, joint.name, id);
    check(draft, joint);
    (draft.joints as Joint[])[at] = { ...joint, id, name };
  },
);

/** Renames a joint (F2); its own name in another case is allowed. One undo step. */
export const renameJoint = defineCommand<{ id: JointId; name: string }>(
  'joint.rename',
  'Rename joint',
  (draft, { id, name }) => {
    const joint = (draft.joints as Joint[])[indexOf(draft, id)] as Joint;
    joint.name = jointName(draft, name, id);
  },
);

const suppressJoints = defineCommand<{ ids: readonly JointId[]; suppressed: boolean }>(
  'joint.suppress',
  'Suppress joint',
  (draft, { ids, suppressed }) => {
    for (const id of ids) {
      const joint = (draft.joints as Joint[])[indexOf(draft, id)] as Joint;
      if (suppressed) joint.suppressed = true;
      else delete joint.suppressed;
    }
  },
);

/** Suppresses or unsuppresses joints (`false` deletes the key). One undo step. */
export const setJointSuppressed: CommandFactory<{
  ids: readonly JointId[];
  suppressed: boolean;
}> = Object.assign(
  (payload: { ids: readonly JointId[]; suppressed: boolean }) => ({
    ...suppressJoints(payload),
    label: `${payload.suppressed ? 'Suppress' : 'Unsuppress'} ${payload.ids.length === 1 ? 'joint' : 'joints'}`,
  }),
  { type: suppressJoints.type },
);

const deleteJoints = defineCommand<{ ids: readonly JointId[] }>(
  'joint.remove',
  'Delete joint',
  (draft, { ids }) => {
    for (const id of ids) indexOf(draft, id);
    removeJointsFrom(draft, (j) => ids.includes(j.id));
  },
);

/** Deletes joints; `joints` goes when it is empty. One undo step. */
export const removeJoint: CommandFactory<{ ids: readonly JointId[] }> = Object.assign(
  (payload: { ids: readonly JointId[] }) => ({
    ...deleteJoints(payload),
    label: payload.ids.length === 1 ? 'Delete joint' : 'Delete joints',
  }),
  { type: deleteJoints.type },
);

/** Drops the joints `drop` matches, and `joints` with them when none is left. */
export function removeJointsFrom(draft: DocumentDraft, drop: (joint: Joint) => boolean): number {
  const before = draft.joints?.length ?? 0;
  const left = (draft.joints ?? []).filter((j) => !drop(j as Joint));
  if (left.length === 0) delete draft.joints;
  else draft.joints = left;
  return before - left.length;
}

function indexOf(draft: DocumentDraft, id: JointId): number {
  const at = (draft.joints ?? []).findIndex((j) => j.id === id);
  if (at < 0) throw new CommandError(`Joint ${id} doesn't exist.`);
  return at;
}

function check(draft: DocumentDraft, joint: Omit<Joint, 'id' | 'name'>): void {
  const problem = jointProblem(draft, joint as Omit<Joint, 'id' | 'name'>);
  if (problem) throw new CommandError(problem);
}

/** A checked, trimmed name; `self` is the joint being renamed, whose own name is free. */
function jointName(doc: Pick<ExtrudoDocument, 'joints'>, name: string, self?: JointId): string {
  const trimmed = name.trim();
  if (!trimmed) throw new CommandError("The name can't be empty.");
  if (trimmed.length > JOINT_NAME_MAX) {
    throw new CommandError(`A joint's name can be at most ${JOINT_NAME_MAX} characters.`);
  }
  const clash = (doc.joints ?? []).find(
    (j) => j.id !== self && j.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (clash) throw new CommandError(`There is already a joint named ${clash.name}.`);
  return trimmed;
}
