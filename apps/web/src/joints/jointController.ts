/**
 * The Joint dialog's controller (P6-05, ADR-0081 §4, §6): one per open project, a vanilla
 * store like the feature dialogs' (`features/dialog.ts`) but not that controller — a joint
 * inserts no feature and needs no preview recompute. It holds the type, the two frames
 * ("Moving part" = side a, "Fixed part" = side b, one reference each, picked in the view), the
 * limits as expression text and Flip; asks the kernel to resolve the draft for the read-only
 * line (`resolveJoint`); and on OK dispatches `addJoint` or `updateJoint`, one undo step.
 */
import {
  addJoint,
  type BodyId,
  CommandError,
  type ComponentId,
  type DocumentStore,
  type EvaluateResult,
  type ExtrudoDocument,
  evaluateParameters,
  type GeomRef,
  type GeomRefKind,
  JOINT_FRAME_KINDS,
  JOINT_LIMIT_UNIT,
  type Joint,
  type JointFrame,
  type JointId,
  type JointReport,
  type JointType,
  type ModelStore,
  newId,
  newJointName,
  parseSketchEntityRefId,
  type ReferenceIssue,
  type SelectionItem,
  type SessionStore,
  updateJoint,
} from '@extrudo/core';
import type { BodyMesh, SubShapeKind } from '@extrudo/kernel';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { pickName } from '../features/pickName';
import { accepts, itemRef, refItems } from '../features/refs';
import { readTopology } from '../selection/items';
import { clearPickedHover, createModelSelect } from '../selection/useModelSelection';
import type { ModelSelect } from '../viewport/Viewport';

export type JointSide = 'a' | 'b';

/** What the dialog needs from the kernel: the `Recomputer` in the app. */
export interface JointDialogKernel {
  reference(body: BodyId, kind: SubShapeKind, index: number): Promise<GeomRef | undefined>;
  resolveJoint(joint: Joint): Promise<JointReport | undefined>;
}

export interface OpenJoint {
  mode: 'create' | 'edit';
  id: JointId;
  name: string;
  type: JointType;
  /** Each side's frame, once picked. */
  frames: Partial<Record<JointSide, JointFrame>>;
  /** Limit texts (empty: no limit). */
  min: string;
  max: string;
  flip: boolean;
  /** The side picks in the view go to. */
  pickField: JointSide | undefined;
  /** Why a pick was refused, per side (a body in no component). */
  hints: Partial<Record<JointSide, string>>;
  /** Limit texts that don't evaluate, with the message. */
  typing: Partial<Record<'min' | 'max', string>>;
  /** The kernel's answer for the draft (the read-only line), once both frames are picked. */
  report: JointReport | undefined;
  /** Fix References: the sides whose frames were lost, to pick again. */
  fix?: readonly JointSide[];
  note?: string;
}

export interface JointDialogState {
  open: OpenJoint | undefined;
}

export interface JointDialogOptions {
  store: DocumentStore;
  session: SessionStore;
  model: ModelStore<BodyMesh>;
  kernel: JointDialogKernel | undefined;
  /** The component a live body is in (the browser's entries, `componentOfBody`). */
  componentOf(body: BodyId): ComponentId | undefined;
  notify(tone: 'info' | 'error', text: string): void;
}

export interface JointDialog {
  readonly state: StoreApi<JointDialogState>;
  /** The view's model picking while the dialog is open. */
  readonly select: ModelSelect;
  /** Opens a new joint, filled from the selection (pre-selection) in field order. */
  start(): void;
  /** Opens a stored joint; with `fix`, the lost frames are flagged for picking again. */
  edit(id: JointId, options?: { fix?: readonly ReferenceIssue[] }): boolean;
  setType(type: JointType): void;
  setLimit(limit: 'min' | 'max', text: string): void;
  setTyping(limit: 'min' | 'max', message: string | undefined): void;
  setFlip(flip: boolean): void;
  pickInto(side: JointSide): void;
  clear(side: JointSide): void;
  /** A limit's text evaluated in the type's unit. */
  evaluate(text: string): EvaluateResult;
  /** The reference kinds a side takes for the open type. */
  kinds(): readonly GeomRefKind[];
  /** What the view highlights: both frames. */
  items(bodies: Readonly<Record<BodyId, BodyMesh>>): SelectionItem[];
  /** The field text: "Cylinder face · Leaf", or the prompt. */
  frameText(side: JointSide): string;
  /** Why OK can't run, or undefined. */
  problem(): string | undefined;
  /** Commits (one step); false when refused. */
  ok(): boolean;
  cancel(): void;
  dispose(): void;
}

export const SIDE_LABELS: Record<JointSide, string> = { a: 'Moving part', b: 'Fixed part' };

/** The refusal of a pick on a body in no component (ADR-0081 §6). */
export const LOOSE_BODY_HINT = 'Put this body in a component first (Solid › New Component).';

const KIND_NAMES: Record<string, string> = {
  plane: 'Flat face',
  cylinder: 'Cylinder face',
  cone: 'Cone face',
  sphere: 'Sphere face',
  torus: 'Torus face',
  line: 'Straight edge',
  circle: 'Circular edge',
};

export function createJointDialog(options: JointDialogOptions): JointDialog {
  const { store, session, model, componentOf, notify } = options;
  const state = createStore<JointDialogState>()(() => ({ open: undefined }));
  const sessionSelect = createModelSelect(session);
  const get = () => state.getState().open;
  const set = (open: OpenJoint | undefined) => state.setState({ open });
  let generation = 0;

  const doc = () => store.getState().doc;

  /** The component of a picked item's geometry, or why it can't be a frame. */
  const componentOfItem = (
    item: SelectionItem,
  ): { component: ComponentId } | { hint: string } | undefined => {
    const topology = readTopology(item);
    if (topology) {
      const component = componentOf(topology.body);
      return component ? { component } : { hint: LOOSE_BODY_HINT };
    }
    const stamp = (id: string) => doc().features.find((f) => f.id === id)?.component;
    const feature =
      item.kind === 'sketchEntity' ? parseSketchEntityRefId(item.id)?.feature : item.id;
    const component = feature === undefined ? undefined : stamp(feature);
    return component ? { component } : { hint: 'Pick geometry on a component’s body.' };
  };

  /** Asks the kernel about the draft for the read-only line. */
  const readout = (open: OpenJoint) => {
    const draft = draftOf(open, doc());
    const kernel = options.kernel;
    if (!draft || !kernel) return;
    const mine = ++generation;
    kernel
      .resolveJoint({ ...draft, id: open.id, suppressed: undefined } as Joint)
      .then((report) => {
        const now = get();
        if (!now || mine !== generation) return;
        set({ ...now, report });
      })
      .catch(() => {});
  };

  const update = (open: OpenJoint, readAgain = true) => {
    set(open);
    if (readAgain) readout(open);
  };

  const fingerprint = (side: JointSide, item: SelectionItem) => {
    const topology = readTopology(item);
    const kernel = options.kernel;
    if (!kernel || !topology || topology.kind === 'body') return;
    kernel
      .reference(topology.body, topology.kind, topology.index)
      .then((ref) => {
        const open = get();
        const frame = open?.frames[side];
        if (!open || !frame || !ref || ref.id !== frame.ref.id) return;
        update({ ...open, frames: { ...open.frames, [side]: { ...frame, ref } } }, false);
      })
      .catch(() => {});
  };

  const pick = (item: SelectionItem) => {
    const open = get();
    if (!open?.pickField) return;
    const side = open.pickField;
    if (!accepts(JOINT_FRAME_KINDS[open.type], item)) return;
    const ref = itemRef(item, model.getState().bodies);
    if (!ref) return;
    const where = componentOfItem(item);
    if (!where) return;
    if ('hint' in where) {
      update({ ...open, hints: { ...open.hints, [side]: where.hint } }, false);
      return;
    }
    const frames = { ...open.frames, [side]: { component: where.component, ref } };
    const other: JointSide = side === 'a' ? 'b' : 'a';
    const hints = { ...open.hints };
    delete hints[side];
    const fix = open.fix?.filter((s) => s !== side);
    update({
      ...open,
      frames,
      hints,
      ...(fix && { fix }),
      pickField: frames[other] ? side : other,
      report: undefined,
    });
    fingerprint(side, item);
  };

  const select: ModelSelect = {
    onHover: (item) => {
      const open = get();
      const ok = item && open?.pickField && accepts(JOINT_FRAME_KINDS[open.type], item);
      sessionSelect.onHover(ok ? item : undefined);
    },
    onClick: (item) => {
      if (item) pick(item);
    },
    onBox: (items) => {
      const [first] = items;
      if (first) pick(first);
    },
  };

  const close = () => {
    generation++;
    set(undefined);
    clearPickedHover(session);
  };

  // An edited joint that went away (undo, a deleted component) closes its dialog.
  const unsubscribe = store.subscribe((s, prev) => {
    const open = get();
    if (!open || s.doc === prev.doc) return;
    if (open.mode === 'edit' && !s.doc.joints?.some((j) => j.id === open.id)) close();
  });

  const evaluateIn = (type: JointType, text: string): EvaluateResult => {
    const unit = JOINT_LIMIT_UNIT[type] ?? 'angle';
    return evaluateParameters(doc()).evaluate(text, unit);
  };

  return {
    state,
    select,
    start() {
      const type: JointType = 'revolute';
      const frames: Partial<Record<JointSide, JointFrame>> = {};
      const bodies = model.getState().bodies;
      const picked: [JointSide, SelectionItem][] = [];
      for (const item of session.getState().selection) {
        const side: JointSide | undefined = !frames.a ? 'a' : !frames.b ? 'b' : undefined;
        if (!side) break;
        if (!accepts(JOINT_FRAME_KINDS[type], item)) continue;
        const ref = itemRef(item, bodies);
        const where = componentOfItem(item);
        if (!ref || !where || 'hint' in where) continue;
        frames[side] = { component: where.component, ref };
        picked.push([side, item]);
      }
      const open: OpenJoint = {
        mode: 'create',
        id: newId<JointId>(),
        name: newJointName(doc()),
        type,
        frames,
        min: '',
        max: '',
        flip: false,
        pickField: !frames.a ? 'a' : !frames.b ? 'b' : undefined,
        hints: {},
        typing: {},
        report: undefined,
      };
      generation++;
      update(open);
      for (const [side, item] of picked) fingerprint(side, item);
    },
    edit(id, { fix } = {}) {
      const joint = doc().joints?.find((j) => j.id === id);
      if (!joint) return false;
      // A lost frame, or one the kernel guessed (perhaps wrongly): both are picked again.
      const lost = fix ?? [];
      const flagged = (['a', 'b'] as const).filter((side) =>
        lost.some((l) => l.ref.kind === joint[side].ref.kind && l.ref.id === joint[side].ref.id),
      );
      const frames: Partial<Record<JointSide, JointFrame>> = { a: joint.a, b: joint.b };
      for (const side of flagged) delete frames[side];
      generation++;
      update({
        mode: 'edit',
        id,
        name: joint.name,
        type: joint.type,
        frames,
        min: joint.min?.expr ?? '',
        max: joint.max?.expr ?? '',
        flip: joint.flip === true,
        pickField: flagged[0],
        hints: {},
        typing: {},
        report: undefined,
        ...(flagged.length > 0 && {
          fix: flagged,
          note: `${joint.name} lost its ${flagged.map((s) => SIDE_LABELS[s].toLowerCase()).join(' and ')} frame: pick ${flagged.length === 1 ? 'it' : 'them'} again.`,
        }),
      });
      return true;
    },
    setType(type) {
      const open = get();
      if (!open || open.type === type) return;
      const frames = { ...open.frames };
      for (const side of ['a', 'b'] as const) {
        const frame = frames[side];
        if (frame && !JOINT_FRAME_KINDS[type].includes(frame.ref.kind)) delete frames[side];
      }
      // The limits change unit with the type: they start again.
      update({
        ...open,
        type,
        frames,
        min: '',
        max: '',
        typing: {},
        report: undefined,
        pickField: open.pickField ?? (!frames.a ? 'a' : !frames.b ? 'b' : undefined),
      });
    },
    setLimit(limit, text) {
      const open = get();
      if (!open) return;
      const typing = { ...open.typing };
      delete typing[limit];
      update({ ...open, [limit]: text, typing }, false);
    },
    setTyping(limit, message) {
      const open = get();
      if (!open) return;
      const typing = { ...open.typing };
      if (message) typing[limit] = message;
      else delete typing[limit];
      update({ ...open, typing }, false);
    },
    setFlip(flip) {
      const open = get();
      if (open) update({ ...open, flip }, false);
    },
    pickInto(side) {
      const open = get();
      if (open) update({ ...open, pickField: side }, false);
    },
    clear(side) {
      const open = get();
      if (!open) return;
      const frames = { ...open.frames };
      delete frames[side];
      update({ ...open, frames, pickField: side, report: undefined }, false);
    },
    evaluate(text) {
      const open = get();
      return evaluateIn(open?.type ?? 'revolute', text);
    },
    kinds() {
      const open = get();
      return open ? JOINT_FRAME_KINDS[open.type] : [];
    },
    items(bodies) {
      const open = get();
      if (!open) return [];
      const refs = (['a', 'b'] as const).flatMap((side) => {
        const frame = open.frames[side];
        return frame ? [frame.ref] : [];
      });
      return refItems(refs, bodies);
    },
    frameText(side) {
      const open = get();
      const frame = open?.frames[side];
      if (!open || !frame)
        return side === 'a' ? 'Pick the part that moves' : 'Pick the part that stays';
      return frameLabel(frame, doc());
    },
    problem() {
      const open = get();
      if (!open) return undefined;
      return problemOf(open, doc(), (text) => evaluateIn(open.type, text));
    },
    ok() {
      const open = get();
      if (!open) return false;
      const current = doc();
      if (problemOf(open, current, (text) => evaluateIn(open.type, text))) return false;
      const draft = draftOf(open, current);
      if (!draft) return false;
      try {
        if (open.mode === 'create') {
          store.getState().dispatch(addJoint({ joint: { ...draft, id: open.id } }));
        } else {
          store.getState().dispatch(updateJoint({ id: open.id, joint: draft }));
        }
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
        notify('error', error.message);
        return false;
      }
      close();
      return true;
    },
    cancel() {
      if (get()) close();
    },
    dispose() {
      unsubscribe();
      close();
    },
  };
}

/** The joint the dialog's values make (no ID), or undefined while a frame is missing. */
export function draftOf(open: OpenJoint, doc: ExtrudoDocument): Omit<Joint, 'id'> | undefined {
  const { a, b } = open.frames;
  if (!a || !b) return undefined;
  const unit = JOINT_LIMIT_UNIT[open.type];
  const limit = (text: string) =>
    unit && text.trim() ? { kind: 'expr' as const, expr: text.trim(), unit } : undefined;
  const min = limit(open.min);
  const max = limit(open.max);
  const name =
    open.mode === 'edit'
      ? (doc.joints?.find((j) => j.id === open.id)?.name ?? open.name)
      : open.name;
  return {
    name,
    type: open.type,
    a,
    b,
    ...(min && { min }),
    ...(max && { max }),
    ...(open.flip && { flip: true as const }),
    ...(open.mode === 'edit' &&
      doc.joints?.find((j) => j.id === open.id)?.suppressed && { suppressed: true as const }),
  };
}

/** Why the dialog can't commit yet, or undefined. */
export function problemOf(
  open: OpenJoint,
  doc: ExtrudoDocument,
  evaluate: (text: string) => EvaluateResult,
): string | undefined {
  if (!open.frames.a) return 'Pick the part that moves.';
  if (!open.frames.b) return 'Pick the part that stays.';
  if (open.frames.a.component === open.frames.b.component) {
    const name = doc.components?.find((c) => c.id === open.frames.a?.component)?.name;
    return `Both sides are in ${name}: pick a frame on another component.`;
  }
  const typed = open.typing.min ?? open.typing.max;
  if (typed) return typed;
  if (JOINT_LIMIT_UNIT[open.type]) {
    for (const text of [open.min, open.max]) {
      if (!text.trim()) continue;
      const result = evaluate(text);
      if (!result.ok) return result.error.message;
    }
  }
  return undefined;
}

/** "Cylinder face · Leaf": what a frame is (from its fingerprint or name) and its component. */
export function frameLabel(frame: JointFrame, doc: ExtrudoDocument): string {
  const { ref } = frame;
  const component = doc.components?.find((c) => c.id === frame.component)?.name ?? '?';
  const fingerprint = ref.fingerprint?.type;
  const what =
    (fingerprint && KIND_NAMES[fingerprint]) ??
    (ref.kind === 'face'
      ? 'Face'
      : ref.kind === 'edge'
        ? 'Edge'
        : ref.kind === 'vertex'
          ? 'Vertex'
          : (pickName(ref, { doc }) ?? (ref.kind === 'body' ? 'Body' : 'Axis')));
  return `${what} · ${component}`;
}

/** The read-only line: what the joint does, or the kernel's warning or error. */
export function jointInfo(open: OpenJoint, doc: ExtrudoDocument): string {
  const { a, b } = open.frames;
  if (!a || !b) return 'Pick a frame on each part.';
  const report = open.report;
  if (!report) return 'Checking the frames…';
  if (report.status !== 'ok') return report.message ?? 'The frames don’t work for a joint.';
  const name = (id: ComponentId) => doc.components?.find((c) => c.id === id)?.name ?? '?';
  if (open.type === 'revolute')
    return `Turns ${name(a.component)} about ${name(b.component)}'s axis.`;
  if (open.type === 'slider') {
    return `Slides ${name(a.component)} along ${name(b.component)}'s direction.`;
  }
  return `Holds ${name(a.component)} to ${name(b.component)}.`;
}
