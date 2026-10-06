/**
 * The Section Analysis tool's logic (P3-09, ADR-0045): the section lives in the viewport store
 * (`viewport.section`, view state: not in the document, not undoable), this hook resolves it
 * against the model as it is now (the plane's frame, the offset's value) into the clipping plane
 * the view draws and picks with, and offers what the panel, the view's plane picker, the
 * browser row and the context list do to it.
 */
import {
  type BodyId,
  type ConstructionReports,
  type EvaluateResult,
  type ExtrudoDocument,
  evaluateParameters,
  type GeomRef,
  type SelectionItem,
  type SessionStore,
  UNITS,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { Frame } from '../features/geometry';
import { draggedExpression, snap } from '../features/manipulate';
import { readTopology } from '../selection/items';
import type { ViewportStore } from '../viewport/store';
import type { PlanePicker } from '../viewport/Viewport';
import {
  type BoxFace,
  boxClips,
  clipsSummary,
  defaultBox,
  dragBoxFace,
  MAX_SECTIONS,
  middleOffset,
  type SectionBox,
  type SectionBoxState,
  type SectionClip,
  type SectionState,
  sectionClip,
  sectionFrame,
} from './clip';

/** The tool's ID: the session's `activeTool` while its panel is open. */
export const SECTION_TOOL = 'section';

/** The kernel side of picking a face: the project's `Recomputer`. */
export interface SectionKernel {
  reference(body: BodyId, kind: 'face', index: number): Promise<GeomRef | undefined>;
}

export interface SectionOptions {
  session: SessionStore;
  viewport: ViewportStore;
  doc: ExtrudoDocument;
  /** The model's meshes and the kernel's construction planes: where the plane is now. */
  bodies: Readonly<Record<BodyId, BodyMesh>>;
  construction: ConstructionReports | undefined;
  kernel: SectionKernel | undefined;
  notify(tone: 'info' | 'error', text: string): void;
  /** The panel is open. */
  active: boolean;
  /** Model mode: a sketch is drawn without the section. */
  model: boolean;
  /** The session's hover: the plane picker shows the plane under the pointer. */
  hover: SelectionItem | undefined;
}

/** One plane of the section as the panel and the view see it. */
export interface SectionRow {
  index: number;
  state: SectionState;
  /** The picked plane before the offset, if it can be found. */
  frame: Frame | undefined;
  /** The offset in mm: the last one that evaluated, or none yet. */
  offset: number | undefined;
  /** The plane the view clips at, while this plane is on and in model mode. */
  clip: SectionClip | undefined;
}

/** The section box with its values in mm (the last ones that evaluated). */
export interface SectionBoxRow {
  state: SectionBoxState;
  value: SectionBox | undefined;
}

export interface SectionTool {
  /** The planes in the order added; empty for none (or a box). */
  rows: readonly SectionRow[];
  box: SectionBoxRow | undefined;
  /** Every clipping plane while the section is on and in model mode (planes, or the box's six). */
  clips: readonly SectionClip[];
  /** A plane can be added (below `MAX_SECTIONS`, no box). */
  canAdd: boolean;
  /** The panel is waiting for a plane (a new one, or "Change"). */
  choosing: boolean;
  /** Waits for a plane to add, or (an index) to replace that row's plane; `undefined` stops. */
  choose(target: 'add' | number | undefined): void;
  /** The view's plane picker, while choosing. */
  planePicker: PlanePicker | undefined;
  evaluate(expression: string): EvaluateResult;
  /** Puts a plane (`plane`) or a flat face (`face`) in the section, as `choose` or Section Here says. */
  pickPlane(plane: GeomRef): void;
  pickFace(item: SelectionItem): Promise<boolean>;
  setOffset(index: number, expression: string): void;
  setFlip(index: number, flip: boolean): void;
  setOn(index: number, on: boolean): void;
  /** Turns every plane (or the box) on or off: the browser's eye. */
  setAllOn(on: boolean): void;
  remove(index: number): void;
  /** Removes the whole section, planes or box. */
  removeAll(): void;
  /** Starts a box around what is shown, in place of the planes. */
  startBox(): void;
  setBoxField(kind: 'center' | 'half', axis: 0 | 1 | 2, expression: string): void;
  setBoxOn(on: boolean): void;
  /** Moves a face of the box to `coordinate` (mm along its axis), snapped like a dialog's arrows. */
  dragBoxFace(face: BoxFace, coordinate: number, perPixel: number): void;
}

/** A length as an expression in the document's unit: "12.5 mm". */
export function lengthExpression(mm: number, settings: ExtrudoDocument['settings']): string {
  const factor = UNITS[settings.units]?.factor ?? 1;
  return `${snap(mm / factor, 0.1)} ${settings.units}`;
}

/** A length with up to four decimals, for numbers worked out (a dragged box). */
function exactExpression(mm: number, settings: ExtrudoDocument['settings']): string {
  const factor = UNITS[settings.units]?.factor ?? 1;
  return `${Number((mm / factor).toFixed(4)) + 0} ${settings.units}`;
}

export function useSection({
  session,
  viewport,
  doc,
  bodies,
  construction,
  kernel,
  notify,
  active,
  model,
  hover,
}: SectionOptions): SectionTool {
  const sections = useStore(viewport, (s) => s.section);
  const boxState = useStore(viewport, (s) => s.sectionBox);
  const [target, setTarget] = useState<'add' | number>();
  const targetRef = useRef(target);
  targetRef.current = target;
  // A new section starts by picking its first plane, while the panel is open.
  const choosing = active && (target !== undefined || (sections.length === 0 && !boxState));
  useEffect(() => {
    if (!active) setTarget(undefined);
  }, [active]);

  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  const evaluate = useCallback(
    (expression: string) => evaluation.evaluate(expression, 'length'),
    [evaluation],
  );

  // An offset that stopped evaluating (a parameter it used was deleted) keeps its last value.
  const lastOffsets = useRef<({ plane: string; value: number } | undefined)[]>([]);
  const rows = useMemo<SectionRow[]>(
    () =>
      sections.map((state, index) => {
        const frame = sectionFrame(state.plane, { construction, bodies });
        const result = evaluate(state.offset);
        const last = lastOffsets.current[index];
        if (result.ok) lastOffsets.current[index] = { plane: state.plane.id, value: result.value };
        const offset = result.ok
          ? result.value
          : last?.plane === state.plane.id
            ? last.value
            : undefined;
        return {
          index,
          state,
          frame,
          offset,
          clip:
            model && state.on && frame && offset !== undefined
              ? sectionClip(frame, offset, state.flip)
              : undefined,
        };
      }),
    [sections, construction, bodies, evaluate, model],
  );
  if (lastOffsets.current.length > sections.length) lastOffsets.current.length = sections.length;

  // The box's six numbers keep the last positive value that evaluated, like an offset.
  const lastBox = useRef<number[]>([]);
  const box = useMemo<SectionBoxRow | undefined>(() => {
    if (!boxState) return undefined;
    const fields = [...boxState.center, ...boxState.half];
    const values = fields.map((expression, i) => {
      const r = evaluate(expression);
      const ok = r.ok && (i < 3 || r.value > 0);
      if (ok && r.ok) lastBox.current[i] = r.value;
      return lastBox.current[i];
    });
    if (values.some((v) => v === undefined)) return { state: boxState, value: undefined };
    return {
      state: boxState,
      value: {
        center: [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0],
        half: [values[3] ?? 0, values[4] ?? 0, values[5] ?? 0],
      },
    };
  }, [boxState, evaluate]);
  if (!boxState) lastBox.current = [];

  const clips = useMemo<SectionClip[]>(() => {
    if (!model) return [];
    if (box) return box.state.on && box.value ? boxClips(box.value) : [];
    return rows.flatMap((r) => (r.clip ? [r.clip] : []));
  }, [model, box, rows]);
  // The same list while the planes stay put, so nothing downstream redraws for nothing.
  const summary = clipsSummary(clips);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `summary` stands for `clips`.
  const steadyClips = useMemo(() => clips, [summary]);

  const canAdd = !boxState && sections.length < MAX_SECTIONS;

  const pickPlane = useCallback(
    (plane: GeomRef) => {
      const store = viewport.getState();
      const next = sectionFrame(plane, { construction, bodies });
      // Start through the middle of what is shown, so the section shows something at once.
      const box = store.bounds?.box;
      const middle = next && box ? middleOffset(next, box) : 0;
      const make = (flip: boolean): SectionState => ({
        plane,
        offset: lengthExpression(middle, doc.settings),
        flip,
        on: true,
      });
      const at = targetRef.current;
      const list = store.section;
      if (typeof at === 'number' && list[at]) {
        const flip = list[at].flip;
        store.updateSection({ ...make(flip) }, at);
      } else if (store.sectionBox) store.setSection(make(false));
      else if (at === 'add' || list.length === 0) store.addSection(make(false));
      else {
        // Section Here: the only plane is replaced, at the limit the last one.
        const index = list.length === 1 || list.length >= MAX_SECTIONS ? list.length - 1 : -1;
        if (index >= 0) store.updateSection(make(list[index]?.flip ?? false), index);
        else store.addSection(make(false));
      }
      setTarget(undefined);
    },
    [viewport, construction, bodies, doc.settings],
  );

  const pickFace = useCallback(
    async (item: SelectionItem) => {
      const face = readTopology(item);
      if (face?.kind !== 'face') return false;
      const ref = await kernel?.reference(face.body, 'face', face.index);
      if (ref?.fingerprint?.type === 'plane') {
        pickPlane(ref);
        return true;
      }
      notify(
        'error',
        ref
          ? 'A section needs a flat face or a plane: that face is curved.'
          : "Can't section on that face yet: the model is still computing.",
      );
      return false;
    },
    [kernel, pickPlane, notify],
  );

  const planePicker = useMemo<PlanePicker | undefined>(() => {
    if (!choosing) return undefined;
    return {
      hover: hover?.kind === 'plane' ? hover.id : undefined,
      ...(sections.length > 0 && { selected: sections.map((s) => s.plane.id) }),
      onHover: (plane) => session.getState().setHover({ kind: 'plane', id: plane }),
      onLeave: (plane) => {
        const current = session.getState().hover;
        if (current?.kind === 'plane' && current.id === plane)
          session.getState().setHover(undefined);
      },
      onPick: (plane) => pickPlane({ kind: 'plane', id: plane }),
      faces: {
        onHover: (item) => {
          const current = session.getState().hover;
          if (item) session.getState().setHover(item);
          else if (current?.kind === 'face') session.getState().setHover(undefined);
        },
        onPick: (item) => {
          void pickFace(item);
        },
      },
    };
  }, [choosing, hover, sections, session, pickPlane, pickFace]);

  // The pointer's hover goes when the plane pick ends.
  useEffect(() => {
    if (!choosing) return;
    return () => {
      const current = session.getState().hover;
      if (current?.kind === 'plane' || current?.kind === 'face')
        session.getState().setHover(undefined);
    };
  }, [choosing, session]);

  return {
    rows,
    box,
    clips: steadyClips,
    canAdd,
    choosing,
    choose: setTarget,
    planePicker,
    evaluate,
    pickPlane,
    pickFace,
    setOffset: (index, expression) =>
      viewport.getState().updateSection({ offset: expression }, index),
    setFlip: (index, value) => viewport.getState().updateSection({ flip: value }, index),
    setOn: (index, value) => viewport.getState().updateSection({ on: value }, index),
    setAllOn: (value) => {
      const store = viewport.getState();
      if (store.sectionBox) store.updateSectionBox({ on: value });
      for (let i = 0; i < store.section.length; i++) store.updateSection({ on: value }, i);
    },
    remove: (index) => {
      viewport.getState().removeSection(index);
      setTarget(undefined);
    },
    removeAll: () => {
      const store = viewport.getState();
      store.setSection(undefined);
      store.setSectionBox(undefined);
      setTarget(undefined);
    },
    startBox: () => {
      const store = viewport.getState();
      const fit = store.bounds?.box;
      const start = defaultBox(fit ?? { min: [-10, -10, -10], max: [10, 10, 10] });
      const e = (v: number) => lengthExpression(v, doc.settings);
      store.setSectionBox({
        center: [e(start.center[0]), e(start.center[1]), e(start.center[2])],
        half: [e(start.half[0]), e(start.half[1]), e(start.half[2])],
        on: true,
      });
      setTarget(undefined);
    },
    setBoxField: (kind, axis, expression) => {
      const current = viewport.getState().sectionBox;
      if (!current) return;
      const list = [...current[kind]] as [string, string, string];
      list[axis] = expression;
      viewport.getState().updateSectionBox({ [kind]: list });
    },
    setBoxOn: (on) => viewport.getState().updateSectionBox({ on }),
    dragBoxFace: (face, coordinate, perPixel) => {
      const current = box?.value;
      const state = viewport.getState().sectionBox;
      if (!current || !state) return;
      const snapped = evaluate(draggedExpression(coordinate, 'length', doc.settings, perPixel));
      const moved = dragBoxFace(current, face, snapped.ok ? snapped.value : coordinate);
      const axis = 'xyz'.indexOf(face[1] ?? 'x');
      const center = [...state.center] as [string, string, string];
      const half = [...state.half] as [string, string, string];
      center[axis] = exactExpression(moved.center[axis] ?? 0, doc.settings);
      half[axis] = exactExpression(moved.half[axis] ?? 0, doc.settings);
      viewport.getState().updateSectionBox({ center, half });
    },
  };
}

/** The origin planes a section can be put on from the panel, in the order they are listed. */
export const SECTION_ORIGIN_PLANES = [
  { id: 'origin:xy', name: 'XY plane' },
  { id: 'origin:xz', name: 'XZ plane' },
  { id: 'origin:yz', name: 'YZ plane' },
] as const;

/** The plane as the panel and the browser name it: "XY plane", "Offset Plane1", "Face of Body1". */
export function planeName(
  plane: GeomRef,
  names: {
    /** A construction plane's name from its feature. */
    construction(id: string): string | undefined;
    /** The body a face reference names, and that body's name. */
    faceBody(faceId: string): string | undefined;
  },
): string {
  if (plane.kind === 'face') {
    const body = names.faceBody(plane.id);
    return body ? `Face of ${body}` : 'Face';
  }
  return (
    SECTION_ORIGIN_PLANES.find((p) => p.id === plane.id)?.name ??
    names.construction(plane.id) ??
    'Plane'
  );
}
