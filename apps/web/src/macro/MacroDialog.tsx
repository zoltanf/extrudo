import type { DocumentStore, SessionStore } from '@extrudo/core';
import { type ComponentType, useEffect, useState } from 'react';
import { Button, FloatingDialog } from '../design-system';
import {
  keepScript,
  MACRO_NOTHING,
  type MacroOutcome,
  type Recorded,
  replaceWithScript,
} from './macro';

export interface MacroDialogProps {
  /** What Stop recorded; undefined while the dialog is closed. */
  recorded: Recorded | undefined;
  store: DocumentStore;
  /** Stamps the Script with the active component (P6-05 S4). */
  session?: SessionStore;
  onClose(): void;
  notify(tone: 'info' | 'success' | 'error', text: string): void;
}

type CodeViewProps = { code: string; label: string };

/** CodeMirror is a lazy chunk, loaded when the dialog opens (the Script dialog does the same). */
function useCodeView(wanted: boolean) {
  const [View, setView] = useState<ComponentType<CodeViewProps>>();
  useEffect(() => {
    // Only while the dialog is open: the editor chunk is not fetched with the app.
    if (!wanted) return;
    let live = true;
    void import('../features/scriptEditor').then((module) => {
      if (live) setView(() => module.CodeView);
    });
    return () => {
      live = false;
    };
  }, [wanted]);
  return View;
}

/**
 * The Macro dialog (P5-05, ADR-0073 §4): the code Stop wrote, read only, with Copy and the two
 * ways to keep it as a Script feature. After either, it says what happened and offers Close; the
 * Script is edited from its chip like any other.
 */
export function MacroDialog({ recorded, store, session, onClose, notify }: MacroDialogProps) {
  const [outcome, setOutcome] = useState<MacroOutcome>();
  const View = useCodeView(recorded !== undefined);
  // A new recording starts without the last one's message.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when another run opens
  useEffect(() => setOutcome(undefined), [recorded]);
  const empty = recorded !== undefined && recorded.ids.length === 0;
  const done = outcome?.ok === true;
  const copy = () => {
    if (!recorded) return;
    navigator.clipboard.writeText(recorded.code).then(
      () => notify('success', 'Copied'),
      () => notify('error', 'The browser did not allow copying. Select the code and copy it.'),
    );
  };
  return (
    <FloatingDialog
      open={recorded !== undefined}
      onOpenChange={(open) => !open && onClose()}
      title="Macro"
      width={640}
      maxHeight={560}
      dim
    >
      <section
        aria-label="Macro"
        data-macro-dialog={empty ? 'empty' : done ? 'done' : 'ready'}
        className="flex flex-col gap-3 overflow-auto p-4"
      >
        <h2 className="text-lg font-semibold">Macro</h2>
        {empty ? (
          <p role="status">{MACRO_NOTHING}</p>
        ) : (
          <>
            <p className="text-sm text-muted">
              {recorded?.ids.length} {recorded?.ids.length === 1 ? 'feature' : 'features'} as
              TypeScript, ready to run in a Script feature.
            </p>
            {recorded && View ? (
              <View code={recorded.code} label="Macro code" />
            ) : (
              <p role="status">Loading code…</p>
            )}
          </>
        )}
        <p
          role="status"
          data-macro-outcome={outcome ? (outcome.ok ? 'ok' : 'refused') : undefined}
          className={`min-h-5 text-sm ${outcome && !outcome.ok ? 'text-error' : 'text-muted'}`}
        >
          {outcome?.message}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          {!empty && !done && recorded && (
            <>
              <Button onClick={copy}>Copy</Button>
              <Button
                variant="primary"
                onClick={() =>
                  setOutcome(
                    replaceWithScript(store, {
                      recorded: recorded.ids,
                      code: recorded.code,
                      session,
                    }),
                  )
                }
              >
                Replace with a Script
              </Button>
              <Button
                onClick={() => setOutcome(keepScript(store, { code: recorded.code, session }))}
              >
                Keep both
              </Button>
            </>
          )}
          <Button onClick={onClose}>Close</Button>
        </div>
      </section>
    </FloatingDialog>
  );
}
