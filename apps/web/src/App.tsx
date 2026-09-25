import { FILE_EXTENSION, FORMAT_VERSION } from '@extrudo/core';
import { LogoMark } from './Logo';

/** Placeholder page for P0-01. P0-04 replaces it with the real app shell. */
export function App() {
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
