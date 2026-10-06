import {
  type EvaluateResult,
  ExprError,
  type ExtrudoDocument,
  formatQuantity,
} from '@extrudo/core';
import { X } from 'lucide-react';
import { Button, ToolIcon } from '../design-system';
import { ExpressionInput } from '../parameters/ExpressionInput';
import { TOOLS } from '../shell/tools';
import { MAX_SECTIONS } from './clip';
import { SECTION_ORIGIN_PLANES, type SectionTool } from './useSection';

export interface SectionPanelProps {
  tool: SectionTool;
  settings: ExtrudoDocument['settings'];
  /** A row's plane as named for the user ("XY plane", "Face of Body1"). */
  planeLabel(index: number): string;
  /** Construction planes that can be picked from the panel, besides the origin planes. */
  constructionPlanes: readonly { id: string; name: string }[];
  onClose(): void;
}

/** Top-right below the ViewCube, where feature dialogs and Measure open (UI spec §2). */
const HOME = { right: 12, top: 148 };

const AXES = ['X', 'Y', 'Z'] as const;

/**
 * The Section Analysis panel (P3-09, UI spec §2; several planes and a box since P4-12): one row
 * per plane with its offset along the plane's normal (an expression; the arrow in the view drags
 * it too), which side goes, and whether it clips at all, "Add plane" up to three, or a **Box**
 * of six planes as one object. A box and planes exclude each other. Non-modal like a feature
 * dialog. Closing it leaves the section as it is; the browser's Analysis row brings it back,
 * and Remove ends it.
 *
 * Test hooks: the region "Section Analysis", `data-section-state` (`choosing`, `lost`, `on`,
 * `off`), `data-section-mode` (`planes` or `box`), each plane's group `[data-section-index]`
 * with the textbox "Offset", the checkboxes "Flip" and "Show section" and the buttons "Change"
 * and "Remove" (rows beyond the first), "Add plane", "Box"; the box's textboxes "Centre X"…
 * and "Half-size X"….
 */
export function SectionPanel({
  tool,
  settings,
  planeLabel,
  constructionPlanes,
  onClose,
}: SectionPanelProps) {
  const { rows, box, choosing } = tool;
  const lost = !choosing && rows.some((r) => r.frame === undefined);
  const anyOn = box ? box.state.on : rows.some((r) => r.state.on);
  const status = choosing ? 'choosing' : lost ? 'lost' : anyOn ? 'on' : 'off';
  const has = rows.length > 0 || box !== undefined;
  const icon = TOOLS.section;
  const format = (r: Extract<EvaluateResult, { ok: true }>) =>
    formatQuantity(r.value, r.dim, settings);
  const positive = (expression: string): EvaluateResult => {
    const r = tool.evaluate(expression);
    return r.ok && r.value <= 0
      ? {
          ok: false,
          error: new ExprError('A half-size must be more than zero.', {
            start: 0,
            end: expression.length,
          }),
        }
      : r;
  };
  return (
    <section
      aria-label="Section Analysis"
      data-section-state={status}
      data-section-mode={box ? 'box' : 'planes'}
      className="pointer-events-auto absolute z-20 flex w-72 flex-col rounded-dialog border border-line shadow-raised backdrop-blur-[6px]"
      style={{
        right: HOME.right,
        top: HOME.top,
        maxHeight: `calc(100% - ${HOME.top + 8}px)`,
        background: 'color-mix(in srgb, var(--x-raised) 94%, transparent)',
      }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <ToolIcon name={icon.icon} category={icon.category} size={18} />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">Section Analysis</h2>
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
        {choosing ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">
              Pick a plane or a flat face in the view, or choose one here.
            </p>
            <fieldset className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
              <legend className="sr-only">Planes</legend>
              {[...SECTION_ORIGIN_PLANES, ...constructionPlanes].map((p) => (
                <Button
                  key={p.id}
                  variant="secondary"
                  onClick={() => tool.pickPlane({ kind: 'plane', id: p.id })}
                >
                  {p.name}
                </Button>
              ))}
            </fieldset>
            {rows.length === 0 && !box && (
              <Button variant="secondary" onClick={tool.startBox}>
                Box
              </Button>
            )}
            {has && (
              <Button variant="ghost" onClick={() => tool.choose(undefined)}>
                Keep the section as it is
              </Button>
            )}
          </div>
        ) : (
          <>
            {rows.map((row, i) => (
              <fieldset
                // biome-ignore lint/suspicious/noArrayIndexKey: a plane is its place in the list.
                key={i}
                data-section-index={i}
                className="m-0 grid min-w-0 grid-cols-[64px_minmax(0,1fr)] items-center gap-2 border-0 border-b border-line p-0 pb-3 last:border-b-0 last:pb-0"
              >
                <legend className="sr-only">Plane {i + 1}</legend>
                <span className="text-sm text-muted">Plane</span>
                <div className="flex min-w-0 items-center gap-2">
                  <span data-section-plane className="min-w-0 flex-1 truncate text-base">
                    {planeLabel(i)}
                  </span>
                  <Button variant="ghost" onClick={() => tool.choose(i)}>
                    Change
                  </Button>
                  {rows.length > 1 && (
                    <Button variant="ghost" onClick={() => tool.remove(i)}>
                      Remove
                    </Button>
                  )}
                </div>
                <span className="pt-0.5 text-sm text-muted">Offset</span>
                <ExpressionInput
                  label="Offset"
                  value={row.state.offset}
                  evaluate={tool.evaluate}
                  format={format}
                  onCommit={(expression) => tool.setOffset(i, expression)}
                  onDraftChange={(expression, valid) => {
                    if (valid) tool.setOffset(i, expression);
                  }}
                />
                <span className="text-sm text-muted">Side</span>
                <label className="flex items-center gap-2 text-base">
                  <input
                    type="checkbox"
                    aria-label="Flip"
                    className="size-4 accent-(--x-accent)"
                    checked={row.state.flip}
                    onChange={(event) => tool.setFlip(i, event.target.checked)}
                  />
                  Flip
                </label>
                <span className="text-sm text-muted">View</span>
                <label className="flex items-center gap-2 text-base">
                  <input
                    type="checkbox"
                    aria-label="Show section"
                    className="size-4 accent-(--x-accent)"
                    checked={row.state.on}
                    onChange={(event) => tool.setOn(i, event.target.checked)}
                  />
                  Show section
                </label>
              </fieldset>
            ))}
            {box && (
              <div className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2">
                {AXES.map((axis, k) => (
                  <BoxField
                    key={`c${axis}`}
                    name={`Centre ${axis}`}
                    value={box.state.center[k] ?? ''}
                    evaluate={tool.evaluate}
                    format={format}
                    onChange={(expression) =>
                      tool.setBoxField('center', k as 0 | 1 | 2, expression)
                    }
                  />
                ))}
                {AXES.map((axis, k) => (
                  <BoxField
                    key={`h${axis}`}
                    name={`Half-size ${axis}`}
                    value={box.state.half[k] ?? ''}
                    evaluate={positive}
                    format={format}
                    onChange={(expression) => tool.setBoxField('half', k as 0 | 1 | 2, expression)}
                  />
                ))}
                <span className="text-sm text-muted">View</span>
                <label className="flex items-center gap-2 text-base">
                  <input
                    type="checkbox"
                    aria-label="Show section"
                    className="size-4 accent-(--x-accent)"
                    checked={box.state.on}
                    onChange={(event) => tool.setBoxOn(event.target.checked)}
                  />
                  Show section
                </label>
              </div>
            )}
            {lost && (
              <p className="text-sm text-error" role="status">
                A plane of the section is not in the model any more. Change it to see the section
                again.
              </p>
            )}
            {has && (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => tool.choose('add')}>
                  Add plane
                </Button>
                {!box && (
                  <Button variant="secondary" onClick={tool.startBox}>
                    Box
                  </Button>
                )}
              </div>
            )}
            <p className="text-xs text-muted" data-section-hint>
              {box
                ? 'A box counts as six planes, so it can’t be combined with planes: adding a plane replaces the box. Drag a face’s handle to move it.'
                : `The model is cut away on the side each arrow points to. Drag an arrow to move its cut. Up to ${MAX_SECTIONS} planes; a box replaces them.`}
            </p>
          </>
        )}
      </div>

      <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-3 py-2">
        <Button
          variant="ghost"
          onClick={() => {
            tool.removeAll();
            onClose();
          }}
          disabled={!has}
        >
          {rows.length > 1 ? 'Remove all' : 'Remove'}
        </Button>
        <Button variant="primary" onClick={onClose}>
          Done <kbd className="font-mono text-xs opacity-85">Esc</kbd>
        </Button>
      </footer>
    </section>
  );
}

function BoxField({
  name,
  value,
  evaluate,
  format,
  onChange,
}: {
  name: string;
  value: string;
  evaluate(expression: string): EvaluateResult;
  format(result: Extract<EvaluateResult, { ok: true }>): string;
  onChange(expression: string): void;
}) {
  return (
    <>
      <span className="pt-0.5 text-sm text-muted">{name}</span>
      <ExpressionInput
        label={name}
        value={value}
        evaluate={evaluate}
        format={format}
        onCommit={onChange}
        onDraftChange={(expression, valid) => {
          if (valid) onChange(expression);
        }}
      />
    </>
  );
}
