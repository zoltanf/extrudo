import type { BodyId, ExtrudoDocument } from '@extrudo/core';
import { LoaderCircle, X } from 'lucide-react';
import { useMemo } from 'react';
import { Button, ToolIcon } from '../design-system';
import { TOOLS } from '../shell/tools';
import { measureSections } from './format';
import type { InspectionState } from './inspection';

export interface MeasurePanelProps {
  state: InspectionState;
  settings: ExtrudoDocument['settings'];
  bodyName(id: BodyId): string | undefined;
  /** Something is selected that Measure can't measure (sketch curves, profiles, planes). */
  others: number;
  onClear(): void;
  onClose(): void;
}

/** Top-right below the ViewCube, where feature dialogs open (UI spec §2). */
const HOME = { right: 12, top: 148 };
const NOUNS = { face: 'Face', edge: 'Edge', vertex: 'Vertex' } as const;

/**
 * The Measure tool's panel (P2-13, UI spec §2): what is picked and what
 * lies between two picks, in the document's unit. Non-modal, like a
 * feature dialog; picking in the view goes on while it is open.
 *
 * Test hooks: the region "Measure", `data-measure-state` (`empty`,
 * `pending`, `ready`, `error`), and each value's `data-measure-row`
 * ("<section>/<label>").
 */
export function MeasurePanel({
  state,
  settings,
  bodyName,
  others,
  onClear,
  onClose,
}: MeasurePanelProps) {
  const { targets, inspection, error } = state;
  const sections = useMemo(() => {
    if (!inspection) return [];
    return measureSections(
      inspection,
      (i) => {
        const t = targets[i];
        if (!t) return 'Item';
        const body = bodyName(t.body) ?? 'Body';
        return t.kind === 'body' ? body : `${NOUNS[t.kind]} ${t.index + 1} · ${body}`;
      },
      settings,
    );
  }, [inspection, targets, bodyName, settings]);
  const status =
    targets.length === 0 ? 'empty' : error ? 'error' : inspection ? 'ready' : 'pending';
  const tool = TOOLS.measure;

  return (
    <section
      aria-label="Measure"
      data-measure-state={status}
      className="pointer-events-auto absolute z-20 flex w-72 flex-col rounded-dialog border border-line shadow-raised backdrop-blur-[6px]"
      style={{
        right: HOME.right,
        top: HOME.top,
        maxHeight: `calc(100% - ${HOME.top + 8}px)`,
        background: 'color-mix(in srgb, var(--x-raised) 94%, transparent)',
      }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <ToolIcon name={tool.icon} category={tool.category} size={18} />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">Measure</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="grid size-6 place-items-center rounded-control text-muted hover:bg-accent-soft hover:text-ink"
        >
          <X size={14} />
        </button>
      </header>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3" aria-live="polite">
        {status === 'empty' && (
          <p className="text-sm text-muted">
            {others > 0
              ? 'Measure works on bodies and their faces, edges and vertices. Pick one of those.'
              : 'Pick a body, face, edge or vertex. Pick a second one to measure between them.'}
          </p>
        )}
        {status === 'pending' && (
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <LoaderCircle size={14} className="animate-spin" /> Measuring…
          </p>
        )}
        {status === 'error' && <p className="text-sm text-error">{error}</p>}
        {sections.map((section) => (
          <div key={section.title} className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
              {section.title}
            </h3>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
              {section.rows.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="text-muted">{row.label}</dt>
                  <dd
                    data-measure-row={`${section.title}/${row.label}`}
                    className="text-right font-mono tabular-nums select-text"
                  >
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        {status !== 'empty' && targets.length < 2 && (
          <p className="text-xs text-muted">Pick another to measure between them.</p>
        )}
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-3 py-2">
        <Button variant="ghost" onClick={onClear} disabled={targets.length === 0}>
          Clear
        </Button>
        <Button variant="primary" onClick={onClose}>
          Close <kbd className="font-mono text-xs opacity-85">Esc</kbd>
        </Button>
      </footer>
    </section>
  );
}
