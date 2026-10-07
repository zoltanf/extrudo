/**
 * The shell's glue for feature dialogs (ADR-0027): one controller per open
 * project, made in an effect so Strict Mode's second mount gets a live one
 * (like the sketch tool host), and the pick field's selection filter in the
 * viewport store.
 */
import type { BodyId, DocumentStore, Feature, ModelStore, SessionStore } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { ToastOptions } from '../design-system';
import type { SelectionFilter } from '../selection/filter';
import type { ViewportStore } from '../viewport/store';
import {
  createDialogController,
  type DialogController,
  type DialogKernel,
  type DialogState,
  type OpenDialog,
} from './dialog';
import { fieldFilter, refItems } from './refs';
import type { FeatureDialogs } from './registry';
import type { DialogField, FeatureDialogSpec } from './spec';
import { shownFields } from './values';

const CLOSED = createStore<DialogState>()(() => ({ open: undefined }));

export interface FeatureDialogsOptions {
  store: DocumentStore;
  session: SessionStore;
  model: ModelStore<BodyMesh>;
  viewport: ViewportStore;
  dialogs: FeatureDialogs;
  /** The dialog of a stored feature the registry has none for (a plugin's, ADR-0077 §6). */
  specFor?(feature: Feature): FeatureDialogSpec | undefined;
  /** The project's `Recomputer`; may arrive after the first render. */
  kernel: DialogKernel | undefined;
  notify(tone: 'info' | 'error', text: string, options?: ToastOptions): void;
}

export function useFeatureDialogs({
  store,
  session,
  model,
  viewport,
  dialogs,
  specFor,
  kernel,
  notify,
}: FeatureDialogsOptions): {
  controller: DialogController | undefined;
  open: OpenDialog | undefined;
} {
  // The kernel and notify may change; the controller reaches the latest through refs.
  const kernelRef = useRef(kernel);
  kernelRef.current = kernel;
  const specForRef = useRef(specFor);
  specForRef.current = specFor;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const [controller, setController] = useState<DialogController>();
  useEffect(() => {
    const c = createDialogController({
      store,
      session,
      model,
      dialogs,
      specFor: (feature) => specForRef.current?.(feature),
      kernel: {
        preview: (draft, index, options) =>
          kernelRef.current?.preview(draft, index, options) ?? Promise.resolve(undefined),
        endPreview: () => kernelRef.current?.endPreview(),
        reference: (body, kind, index, base) =>
          kernelRef.current?.reference(body, kind, index, base) ?? Promise.resolve(undefined),
        tangentChain: (body, index, base, kind) =>
          kernelRef.current?.tangentChain?.(body, index, base, kind) ?? Promise.resolve(undefined),
        scadParameters: (file) =>
          kernelRef.current?.scadParameters?.(file) ??
          Promise.resolve({ ok: false, error: 'The kernel is not running.' }),
      },
      notify: (tone, text, options) => notifyRef.current(tone, text, options),
    });
    setController(c);
    return () => c.dispose();
  }, [store, session, model, dialogs]);
  const open = useStore(controller?.state ?? CLOSED, (s) => s.open);

  // The pick field narrows picking to what it takes; a closed dialog lifts that.
  const field = open?.spec.fields.find((f) => f.name === open.pickField);
  useEffect(() => {
    viewport.getState().setFieldFilter(field?.kind === 'selection' ? filterOf(field) : undefined);
    // An axis field shows the origin axes while it takes picks (P3-17).
    viewport.getState().setPickAxes(field?.kind === 'selection' && field.accepts.includes('axis'));
  }, [viewport, field]);
  useEffect(
    () => () => {
      viewport.getState().setFieldFilter(undefined);
      viewport.getState().setPickAxes(false);
    },
    [viewport],
  );

  return { controller, open };
}

const filters = new WeakMap<DialogField, SelectionFilter>();

function filterOf(field: Extract<DialogField, { kind: 'selection' }>): SelectionFilter {
  let filter = filters.get(field);
  if (!filter) {
    filter = fieldFilter(field.accepts, field);
    filters.set(field, filter);
  }
  return filter;
}

/** What the view highlights while a dialog is open: every shown selection field's picks. */
export function useDialogItems(
  open: OpenDialog | undefined,
  bodies: Readonly<Record<BodyId, BodyMesh>>,
) {
  return useMemo(() => {
    if (!open) return undefined;
    const refs = shownFields(open.spec, open.values).flatMap((f) =>
      f.kind === 'selection' ? (open.values.refs[f.name] ?? []) : [],
    );
    return refItems(refs, bodies);
  }, [open, bodies]);
}
