/**
 * The status bar's line for a lost note (ADR-0126 §4): while a `detached` annotation is
 * hovered or selected, it says what to do about it.
 */
import type { DocumentStore, ModelStore, SessionStore } from '@extrudo/core';
import { useStore } from 'zustand';

export function AnnotationHint({
  session,
  store,
  model,
}: {
  session: SessionStore;
  store: DocumentStore;
  model: ModelStore<unknown>;
}) {
  const hovered = useStore(session, (s) =>
    s.hover?.kind === 'annotation' ? s.hover.id : undefined,
  );
  const selected = useStore(session, (s) => {
    const notes = s.selection.filter((item) => item.kind === 'annotation');
    return notes.length === 1 ? notes[0]?.id : undefined;
  });
  const reports = useStore(model, (s) => s.annotations);
  const annotations = useStore(store, (s) => s.doc.annotations);
  const id = [hovered, selected].find(
    (n) => n !== undefined && reports[n as never]?.status === 'detached',
  );
  const note = id === undefined ? undefined : annotations?.find((a) => a.id === id);
  if (!note || note.anchor.kind !== 'model') return null;
  return (
    <output aria-label="Annotation status" className="text-[11px] whitespace-nowrap text-warning">
      Annotation #{note.number} lost its geometry: drag it onto something or delete it. ·
    </output>
  );
}
