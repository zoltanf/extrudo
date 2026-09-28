import {
  createDocument,
  createDocumentStore,
  createModelStore,
  createSessionStore,
  type DocumentId,
  type ExtrudoDocument,
  type FeatureId,
  FeatureRegistry,
} from '@extrudo/core';
import { type BodyMesh, spawnDebugKernel } from '@extrudo/kernel';
import { useEffect, useMemo } from 'react';
import { createStore } from 'zustand/vanilla';
import { Toasts, useToasts } from '../design-system';
import type { FeatureDialogSpec } from '../features/spec';
import type { Platform } from '../platform';
import type { Autosaver, AutosaveState } from '../project/autosave';
import { useRecompute } from '../project/useRecompute';
import { HOME_HREF, navigate } from '../routes';
import type { FileActions } from '../shell/AppBar';
import { AppShell } from '../shell/AppShell';
import { createViewportStore } from '../viewport/store';
import { pressDialog } from './pressDialog';

/**
 * Feature dialog debug page (P2-05, ADR-0027), at `#/debug/dialog`: the real
 * shell on an in-memory document holding a 20 mm test box, computed by the
 * debug kernel worker (the app's kernel plus the engine's test features),
 * with one feature dialog registered: "Press Pull (test)" (`pressDialog.ts`,
 * in the command palette, Ctrl+K). Nothing is saved. Until Extrude has its
 * dialog (P2-06), the dialog e2e tests run here, as the B-rep selection
 * tests ran on the kernel debug page.
 */
export function DialogDebug({ platform }: { platform: Platform }) {
  const doc = useMemo(debugDocument, []);
  const store = useMemo(() => createDocumentStore(doc), [doc]);
  const session = useMemo(() => createSessionStore(), []);
  const model = useMemo(() => createModelStore<BodyMesh>(), []);
  const viewport = useMemo(
    () => createViewportStore({ preferences: platform.preferences }),
    [platform],
  );
  const recomputer = useRecompute(store, model, spawnDebugKernel);
  const autosave = useMemo(memoryAutosaver, []);
  const dialogs = useMemo(() => new FeatureRegistry<FeatureDialogSpec>().register(pressDialog), []);
  const { toasts, push, dismiss } = useToasts();
  const file = useMemo<FileActions>(() => {
    const unavailable = () => push('info', 'The dialog debug page keeps its design in memory.');
    return {
      home: () => navigate(HOME_HREF),
      newDesign: unavailable,
      exportFile: unavailable,
      importFile: unavailable,
    };
  }, [push]);
  // Frame the box once its body arrives.
  useEffect(
    () =>
      viewport.subscribe((s, prev) => {
        if (s.bounds && !prev.bounds) s.fit();
      }),
    [viewport],
  );

  return (
    <>
      <AppShell
        store={store}
        session={session}
        model={model}
        viewport={viewport}
        autosave={autosave}
        file={file}
        platform={platform}
        notify={push}
        dialogs={dialogs}
        kernel={recomputer}
      />
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

/** "Dialog test": one `test-box` feature, a 20 mm cube at the origin. */
function debugDocument(): ExtrudoDocument {
  const doc = createDocument({ id: 'dialog-debug' as DocumentId, name: 'Dialog test' });
  return {
    ...doc,
    features: [
      {
        id: 'box' as FeatureId,
        type: 'test-box',
        name: 'Box1',
        suppressed: false,
        inputs: { size: { kind: 'expr', expr: '20 mm', paramName: 'd1', unit: 'length' } },
      },
    ],
    timelineMarker: 1,
  };
}

/** Autosave that has nothing to save: the page's document lives in memory. */
function memoryAutosaver(): Autosaver {
  const state = createStore<AutosaveState>()(() => ({
    status: 'saved',
    error: undefined,
    savedAt: undefined,
  }));
  return Object.assign(state, {
    flush: async () => {},
    retry: async () => {},
    dispose: () => {},
  });
}
