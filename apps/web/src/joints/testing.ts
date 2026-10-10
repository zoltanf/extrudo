/**
 * A design for the joint dialog's and actions' tests: components Base and Leaf, each with one
 * box body whose faces have persistent IDs, and a loose body. The kernel is a fake that names
 * every pick and resolves every joint `ok`.
 */
import {
  addComponent,
  type BodyId,
  type ComponentId,
  createDocument,
  createDocumentStore,
  createModelStore,
  createSessionStore,
  type GeomRef,
  type Joint,
  type JointReport,
  setBodyComponent,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { vi } from 'vitest';
import { boxMesh } from '../selection/testing';
import { createJointDialog, type JointDialogKernel } from './jointController';

export const BASE = 'base' as ComponentId;
export const LEAF = 'leaf' as ComponentId;

const mesh = (body: string): BodyMesh => ({
  ...boxMesh(),
  faceIds: [0, 1, 2, 3, 4, 5].map((i) => `${body}:face${i}`),
  edgeIds: Array.from({ length: 12 }, (_, i) => `${body}:edge${i}`),
});

export function setupJoints(report: JointReport = { status: 'ok' }) {
  const store = createDocumentStore(createDocument());
  const session = createSessionStore();
  const model = createModelStore<BodyMesh>();
  model.getState().computed({
    features: {},
    bodies: {
      ['B:0' as BodyId]: mesh('B'),
      ['L:0' as BodyId]: mesh('L'),
      ['X:0' as BodyId]: mesh('X'),
    },
  });
  store.getState().dispatch(addComponent({ id: BASE, name: 'Base', bodies: ['B:0' as BodyId] }));
  store.getState().dispatch(addComponent({ id: LEAF, name: 'Leaf', bodies: ['L:0' as BodyId] }));
  store.getState().dispatch(setBodyComponent({ ids: ['X:0' as BodyId], component: null }));
  const resolved: Joint[] = [];
  const kernel: JointDialogKernel = {
    reference: vi.fn(async (body, kind, index) => {
      const ref: GeomRef = {
        kind,
        id: `${body.slice(0, 1)}:${kind}${index}`,
        fingerprint: { type: 'cylinder', at: [0, 0, 0] },
      };
      return ref;
    }),
    resolveJoint: vi.fn(async (joint: Joint) => {
      resolved.push(joint);
      return report;
    }),
  };
  const notify = vi.fn();
  const componentOf = (body: BodyId) => store.getState().doc.bodies[body]?.component ?? undefined;
  const dialog = createJointDialog({ store, session, model, kernel, componentOf, notify });
  return { store, session, model, kernel, notify, dialog, resolved };
}

/** Lets the fake kernel's promises settle. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
