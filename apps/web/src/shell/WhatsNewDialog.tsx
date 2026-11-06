import { ChevronRight, X } from 'lucide-react';
import { Dialog as Radix } from 'radix-ui';
import { type ReactNode, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { ReleaseNotes } from '../../pwa/release-notes';
import { Button, IconButton } from '../design-system';
import { BUILD } from '../version';
import { loadReleaseNotes, setWhatsNewOpen, whatsNewStore } from './whatsNew';

/** `**bold**` and `` `code` `` in a notes line; everything else is text (no HTML). */
export function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed line
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed line
        <code key={i} className="rounded bg-panel px-1 font-mono text-[0.92em]">
          {part.slice(1, -1)}
        </code>
      );
    return part;
  });
}

/**
 * What's new in this version (ADR-0133): the release's highlights, and its
 * whole changelog section behind a disclosure. Opened by the toast after an
 * update and by About › What's new; the notes load on first open.
 */
export function WhatsNewDialog({
  notes: load = loadReleaseNotes,
}: {
  notes?: () => Promise<ReleaseNotes | null>;
}) {
  const open = useStore(whatsNewStore, (s) => s.open);
  const [notes, setNotes] = useState<ReleaseNotes | null>();
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (!open || notes !== undefined) return;
    let live = true;
    void load()
      .catch(() => null)
      .then((n) => live && setNotes(n));
    return () => {
      live = false;
    };
  }, [open, notes, load]);

  const version = notes?.version ?? BUILD.version.split('+')[0];

  return (
    <Radix.Root
      open={open}
      onOpenChange={(next) => {
        setWhatsNewOpen(next);
        if (!next) setFull(false);
      }}
    >
      <Radix.Portal>
        <Radix.Overlay className="fixed inset-0 z-40 bg-[rgb(10_12_16/55%)]" />
        <Radix.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
          className="fixed top-1/2 left-1/2 z-40 flex max-h-[calc(100vh-48px)] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-dialog border border-line bg-raised text-ink shadow-raised"
        >
          <header className="relative border-b border-line px-6 pt-5 pb-4">
            <Radix.Title className="pr-8 text-xl font-semibold">
              What's new in Extrudo {version}
            </Radix.Title>
            <Radix.Close asChild>
              <IconButton label="Close" className="absolute top-3 right-3">
                <X size={18} strokeWidth={1.75} />
              </IconButton>
            </Radix.Close>
          </header>

          <div className="min-h-0 overflow-auto px-6 py-4">
            {notes === undefined ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : notes === null ? (
              <p className="text-sm text-muted">This build has no release notes.</p>
            ) : (
              <>
                <ul className="flex list-disc flex-col gap-2 pl-5 text-base leading-6">
                  {notes.highlights.map((h) => (
                    <li key={h}>{inline(h)}</li>
                  ))}
                </ul>
                {notes.changes.length > 0 && (
                  <section className="mt-4 border-t border-line pt-3">
                    <button
                      type="button"
                      aria-expanded={full}
                      onClick={() => setFull((f) => !f)}
                      className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink"
                    >
                      <ChevronRight
                        size={14}
                        className={`transition-transform duration-(--x-fast) ${full ? 'rotate-90' : ''}`}
                      />
                      Full changelog ({notes.changes.length} changes)
                    </button>
                    {full && (
                      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-5 text-muted">
                        {notes.changes.map((c) => (
                          <li key={c}>{inline(c)}</li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}
              </>
            )}
          </div>

          <footer className="flex justify-end border-t border-line px-6 py-3">
            <Radix.Close asChild>
              <Button variant="primary">Got it</Button>
            </Radix.Close>
          </footer>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
