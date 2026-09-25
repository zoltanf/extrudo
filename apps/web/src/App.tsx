import { createDocumentStore, createModelStore } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { lazy, Suspense, useMemo, useSyncExternalStore } from 'react';
import type { Platform } from './platform';
import { AppShell } from './shell/AppShell';
import { sampleDocument } from './shell/sample-document';

// Loaded on demand so the shell doesn't pull in the kernel client.
const KernelDebug = lazy(() =>
  import('./debug/KernelDebug').then((m) => ({ default: m.KernelDebug })),
);

const subscribeToHash = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};

/** Hash routes (Electron-safe, architecture §8): the shell, and debug pages. */
export function App({ platform }: { platform: Platform }) {
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash);
  // Until project storage (P0-08), the shell opens a sample document in memory.
  const store = useMemo(() => createDocumentStore(sampleDocument()), []);
  // Filled by the recompute pipeline (Phase 2); empty until then.
  const model = useMemo(() => createModelStore<BodyMesh>(), []);
  if (hash === '#/debug/kernel') {
    return (
      <Suspense fallback={null}>
        <KernelDebug platform={platform} />
      </Suspense>
    );
  }
  return <AppShell store={store} model={model} platform={platform} />;
}
