/**
 * The shell's glue for the Joint dialog (P6-05, ADR-0081 §6): one controller per open project,
 * made in an effect (as the feature dialogs' is), and the frame kinds' selection filter in the
 * viewport store while it is open.
 */
import type { BodyId, ComponentId, DocumentStore, ModelStore, SessionStore } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { fieldFilter } from '../features/refs';
import type { ViewportStore } from '../viewport/store';
import {
  createJointDialog,
  type JointDialog,
  type JointDialogKernel,
  type JointDialogState,
  type OpenJoint,
} from './jointController';

const CLOSED = createStore<JointDialogState>()(() => ({ open: undefined }));

export function useJointDialog(options: {
  store: DocumentStore;
  session: SessionStore;
  model: ModelStore<BodyMesh>;
  viewport: ViewportStore;
  kernel: JointDialogKernel | undefined;
  componentOf(body: BodyId): ComponentId | undefined;
  notify(tone: 'info' | 'error', text: string): void;
}): { controller: JointDialog | undefined; open: OpenJoint | undefined } {
  const { store, session, model, viewport } = options;
  const latest = useRef(options);
  latest.current = options;
  const [controller, setController] = useState<JointDialog>();
  useEffect(() => {
    const c = createJointDialog({
      store,
      session,
      model,
      kernel: {
        reference: (body, kind, index) =>
          latest.current.kernel?.reference(body, kind, index) ?? Promise.resolve(undefined),
        resolveJoint: (joint) =>
          latest.current.kernel?.resolveJoint(joint) ?? Promise.resolve(undefined),
      },
      componentOf: (body) => latest.current.componentOf(body),
      notify: (tone, text) => latest.current.notify(tone, text),
    });
    setController(c);
    return () => c.dispose();
  }, [store, session, model]);
  const open = useStore(controller?.state ?? CLOSED, (s) => s.open);

  // The pick field takes only the type's frame kinds; a closed dialog lifts that.
  const type = open?.pickField ? open.type : undefined;
  useEffect(() => {
    if (!type) return;
    const kinds = controller?.kinds() ?? [];
    viewport.getState().setFieldFilter(fieldFilter(kinds));
    viewport.getState().setPickAxes(kinds.includes('axis'));
    return () => {
      viewport.getState().setFieldFilter(undefined);
      viewport.getState().setPickAxes(false);
    };
  }, [viewport, controller, type]);

  return { controller, open };
}
