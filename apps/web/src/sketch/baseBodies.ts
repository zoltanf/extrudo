/**
 * The bodies as they were before a feature (P2-09, P2-11): what the Project
 * tool and Redefine Plane show and pick, since a sketch can only use
 * geometry made before it. Asks the kernel for a preview of the feature
 * with its base when later features change the bodies; otherwise the
 * model's bodies are the same and this gives `undefined`.
 */
import type { BodyId, DocumentStore, FeatureId } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { useEffect, useState } from 'react';
import type { DialogKernel } from '../features/dialog';

export function useBodiesBefore({
  active,
  featureId,
  store,
  kernel,
}: {
  active: boolean;
  featureId: FeatureId | undefined;
  store: DocumentStore;
  kernel: DialogKernel | undefined;
}): Record<BodyId, BodyMesh> | undefined {
  const [base, setBase] = useState<Record<BodyId, BodyMesh>>();
  useEffect(() => {
    if (!active || !featureId || !kernel) return;
    const { doc } = store.getState();
    const index = doc.features.findIndex((f) => f.id === featureId);
    const feature = doc.features[index];
    const later = doc.features
      .slice(index + 1, doc.timelineMarker)
      .some((f) => !f.suppressed && f.type !== 'sketch');
    if (!feature || !later) return;
    let current = true;
    kernel.preview(feature, index, { base: true }).then((preview) => {
      if (current && preview?.base) setBase(preview.base);
    });
    return () => {
      current = false;
      setBase(undefined);
      kernel.endPreview();
    };
  }, [active, featureId, kernel, store]);
  return active ? base : undefined;
}
