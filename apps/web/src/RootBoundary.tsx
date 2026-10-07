import type { ReactNode } from 'react';
import { Button } from './design-system/Button';
import { ErrorBoundary, errorText } from './design-system/ErrorBoundary';
import { LogoMark } from './design-system/Logo';
import { saveEverything } from './project/autosave';

/** The full-page message for a crash nothing else caught (ADR-0076). */
export function CrashScreen({ error, onReload }: { error: unknown; onReload(): void }) {
  return (
    <main role="alert" data-crash className="grid h-full place-items-center bg-bg p-8 text-ink">
      <div className="flex max-w-[28rem] flex-col items-center gap-4 text-center">
        <LogoMark size={40} title="Extrudo" />
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-muted">
          Your work is saved: Extrudo saves as you go and keeps a recovery copy. Reload to carry on.
        </p>
        <p className="font-mono text-field text-muted">{errorText(error)}</p>
        <Button variant="primary" onClick={onReload}>
          Reload
        </Button>
      </div>
    </main>
  );
}

/** Saves what it can, best effort, then reloads. */
export async function saveAndReload(
  save: () => Promise<boolean> = saveEverything,
  reload: () => void = () => location.reload(),
): Promise<void> {
  try {
    await save();
  } catch {
    // The rescue copy covers what autosave could not.
  }
  reload();
}

/** Never a white page: a render error anywhere shows the crash screen. */
export function RootBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      onError={() => {
        void saveEverything().catch(() => undefined);
      }}
      fallback={(error) => <CrashScreen error={error} onReload={() => void saveAndReload()} />}
    >
      {children}
    </ErrorBoundary>
  );
}
