import type { ReactNode } from 'react';
import { ErrorBoundary, errorText } from '../design-system/ErrorBoundary';
import { NoWebgl, ViewStopped } from './NoWebgl';
import { isContextError, webglSupport } from './webglSupport';

/**
 * Catches a render error in the 3D view (ADR-0076): a context-creation failure
 * shows the no-WebGL panel, anything else "The 3D view stopped working". The
 * rest of the shell stays mounted. "Try again" probes WebGL again first.
 */
export function ViewportBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={(error, reset) => {
        const retry = () => {
          webglSupport(true);
          reset();
        };
        return (
          <section
            aria-label="Viewport"
            className="relative min-w-0 flex-1"
            style={{ background: 'var(--x-viewport-glow)' }}
          >
            {isContextError(error) ? (
              <NoWebgl onRetry={retry} detail={errorText(error)} />
            ) : (
              <ViewStopped message={errorText(error)} onRetry={retry} />
            )}
          </section>
        );
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
