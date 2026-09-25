import { FILE_EXTENSION, FORMAT_VERSION } from '@extrudo/core';
import { lazy, Suspense, useSyncExternalStore } from 'react';
import { LogoMark } from './Logo';

// Loaded on demand so the hello page doesn't pull in three.js.
const KernelDebug = lazy(() =>
  import('./debug/KernelDebug').then((m) => ({ default: m.KernelDebug })),
);

const subscribeToHash = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};

/** Placeholder page for P0-01. P0-04 replaces it with the real app shell. */
export function App() {
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash);
  if (hash === '#/debug/kernel') {
    return (
      <Suspense fallback={null}>
        <KernelDebug />
      </Suspense>
    );
  }
  return (
    <main className="hello">
      <div className="lockup">
        <LogoMark size={88} />
        <h1 className="wordmark">extrudo</h1>
      </div>
      <p className="tagline">Parametric CAD for 3D printing, in your browser.</p>
      <p className="status">
        Phase 0 · toolchain ready · file format <code>{FILE_EXTENSION}</code> v{FORMAT_VERSION}
      </p>
    </main>
  );
}
