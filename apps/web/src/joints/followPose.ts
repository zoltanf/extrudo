/**
 * Keeps the pose honest (P6-05 J2, ADR-0081 §4): a pose belongs to a joint that still exists,
 * isn't suppressed and resolved `ok` (a warning or an error refuses the pose). When the document
 * or the model stops saying so (an undo of New Joint, a delete, a lost frame) the pose is cleared.
 * Returns the unsubscribe function.
 */
import type { DocumentStore, JointId, JointReport, ModelStore } from '@extrudo/core';
import type { ViewportStore } from '../viewport/store';

export function followJointPose(
  store: DocumentStore,
  model: Pick<ModelStore<unknown>, 'getState' | 'subscribe'>,
  viewport: ViewportStore,
): () => void {
  const check = () => {
    const pose = viewport.getState().jointPose;
    if (!pose) return;
    const joint = store.getState().doc.joints?.find((j) => j.id === pose.joint);
    const report = (model.getState().joints as Record<JointId, JointReport | undefined>)[
      pose.joint
    ];
    if (!joint || joint.suppressed || report?.status !== 'ok') {
      viewport.getState().setJointPose(undefined);
    }
  };
  const stops = [
    store.subscribe(check),
    model.subscribe(check),
    viewport.subscribe((s, prev) => {
      if (s.jointPose !== prev.jointPose) check();
    }),
  ];
  check();
  return () => {
    for (const stop of stops) stop();
  };
}
