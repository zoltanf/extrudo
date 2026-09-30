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
import { snap } from '../features/manipulate';
import { readTopology } from '../selection/items';
import type { ViewportStore } from '../viewport/store';
import type { PlanePicker } from '../viewport/Viewport';
import {
  clipSummary,
  middleOffset,
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

export interface SectionTool {
  state: SectionState | undefined;
  /** The picked plane before the offset, if it can be found. */
  frame: Frame | undefined;
  /** The offset in mm: the last one that evaluated, or none yet. */
  offset: number | undefined;
  /** The plane the view clips at, while the section is on and in model mode. */
  clip: SectionClip | undefined;
  /** The panel is waiting for a plane (a new section, or "Change"). */
  choosing: boolean;
  setChoosing(choosing: boolean): void;
  /** The view's plane picker, while choosing. */
  planePicker: PlanePicker | undefined;
  evaluate(expression: string): EvaluateResult;
  /** Puts the section on a plane (`plane`) or a flat face (`face`), keeping the flip. */
  pickPlane(plane: GeomRef): void;
  pickFace(item: SelectionItem): Promise<boolean>;
  setOffset(expression: string): void;
  setFlip(flip: boolean): void;
  setOn(on: boolean): void;
  remove(): void;
}

/** A length as an expression in the document's unit: "12.5 mm". */
export function lengthExpression(mm: number, settings: ExtrudoDocument['settings']): string {
  const factor = UNITS[settings.units]?.factor ?? 1;
  return `${snap(mm / factor, 0.1)} ${settings.units}`;
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
  const state = useStore(viewport, (s) => s.section);
  const [choosingPlane, setChoosing] = useState(false);
  // A new section starts by picking its plane, while the panel is open.
  const choosing = active && (choosingPlane || state === undefined);
  useEffect(() => {
    if (!active) setChoosing(false);
  }, [active]);

  const plane = state?.plane;
  const frame = useMemo(
    () => (plane ? sectionFrame(plane, { construction, bodies }) : undefined),
    [plane, construction, bodies],
  );

  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  const evaluate = useCallback(
    (expression: string) => evaluation.evaluate(expression, 'length'),
    [evaluation],
  );
  // An offset that stopped evaluating (a parameter it used was deleted) keeps its last value.
  const lastOffset = useRef<number>(undefined);
  const result = state ? evaluate(state.offset) : undefined;
  if (!state) lastOffset.current = undefined;
  else if (result?.ok) lastOffset.current = result.value;
  const offset = lastOffset.current;

  const on = state?.on ?? false;
  const flip = state?.flip ?? false;
  const clip = useMemo(
    () =>
      model && on && frame && offset !== undefined ? sectionClip(frame, offset, flip) : undefined,
    [model, on, frame, offset, flip],
  );
  // The same clip object while it stays put, so nothing downstream redraws for nothing.
  const summary = clipSummary(clip);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `summary` stands for `clip`.
  const steadyClip = useMemo(() => clip, [summary]);

  const pickPlane = useCallback(
    (plane: GeomRef) => {
      const current = viewport.getState().section;
      const next = sectionFrame(plane, { construction, bodies });
      // Start through the middle of what is shown, so the section shows something at once.
      const box = viewport.getState().bounds?.box;
      const middle = next && box ? middleOffset(next, box) : 0;
      viewport.getState().setSection({
        plane,
        offset: lengthExpression(middle, doc.settings),
        flip: current?.flip ?? false,
        on: true,
      });
      setChoosing(false);
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
      ...(state && { selected: [state.plane.id] }),
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
  }, [choosing, hover, state, session, pickPlane, pickFace]);

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
    state,
    frame,
    offset,
    clip: steadyClip,
    choosing,
    setChoosing,
    planePicker,
    evaluate,
    pickPlane,
    pickFace,
    setOffset: (expression) => viewport.getState().updateSection({ offset: expression }),
    setFlip: (value) => viewport.getState().updateSection({ flip: value }),
    setOn: (value) => viewport.getState().updateSection({ on: value }),
    remove: () => {
      viewport.getState().setSection(undefined);
      setChoosing(false);
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
