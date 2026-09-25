import { LogoMark } from './design-system';

/**
 * Shown when the app can't open its storage at all: IndexedDB blocked (some
 * private windows) or broken. Nothing else works without it.
 */
export function StartupError({ error }: { error: unknown }) {
  return (
    <main className="grid h-full place-items-center bg-bg p-8 text-ink">
      <div className="flex max-w-[28rem] flex-col items-center gap-4 text-center">
        <LogoMark size={40} title="Extrudo" />
        <h1 className="text-xl font-semibold">Extrudo can't store designs in this window</h1>
        <p className="text-muted">
          The browser blocked its storage, which happens in some private windows. Open Extrudo in a
          normal window, or allow site data for it.
        </p>
        <p className="font-mono text-field text-muted">
          {error instanceof Error ? error.message : String(error)}
        </p>
      </div>
    </main>
  );
}
