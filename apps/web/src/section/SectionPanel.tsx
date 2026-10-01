import { type ExtrudoDocument, formatQuantity } from '@extrudo/core';
import { X } from 'lucide-react';
import { Button, ToolIcon } from '../design-system';
import { ExpressionInput } from '../parameters/ExpressionInput';
import { TOOLS } from '../shell/tools';
import { SECTION_ORIGIN_PLANES, type SectionTool } from './useSection';

export interface SectionPanelProps {
  tool: SectionTool;
  settings: ExtrudoDocument['settings'];
  /** The picked plane as named for the user ("XY plane", "Face of Body1"). */
  planeLabel: string;
  /** Construction planes that can be picked from the panel, besides the origin planes. */
  constructionPlanes: readonly { id: string; name: string }[];
  onClose(): void;
}

/** Top-right below the ViewCube, where feature dialogs and Measure open (UI spec §2). */
const HOME = { right: 12, top: 148 };

/**
 * The Section Analysis panel (P3-09, UI spec §2): the plane, the offset along its normal (an
 * expression; the arrow in the view drags it too), which side goes, and whether the view is
 * clipped at all. Non-modal like a feature dialog. Closing it leaves the section as it is; the
 * browser's Analysis row brings it back, and Remove ends it.
 *
 * Test hooks: the region "Section Analysis", `data-section-state` (`choosing`, `lost`, `on`,
 * `off`), the textbox "Offset", the checkboxes "Flip" and "Show section".
 */
export function SectionPanel({
  tool,
  settings,
  planeLabel,
  constructionPlanes,
  onClose,
}: SectionPanelProps) {
  const { state, choosing } = tool;
  const lost = state !== undefined && !choosing && tool.frame === undefined;
  const status = choosing ? 'choosing' : lost ? 'lost' : state?.on ? 'on' : 'off';
  const icon = TOOLS.section;
  return (
    <section
      aria-label="Section Analysis"
      data-section-state={status}
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
            {state && (
              <Button variant="ghost" onClick={() => tool.setChoosing(false)}>
                Keep {planeLabel}
              </Button>
            )}
          </div>
        ) : (
          state && (
            <>
              <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
                <span className="text-sm text-muted">Plane</span>
                <div className="flex min-w-0 items-center gap-2">
                  <span data-section-plane className="min-w-0 flex-1 truncate text-base">
                    {planeLabel}
                  </span>
                  <Button variant="ghost" onClick={() => tool.setChoosing(true)}>
                    Change
                  </Button>
                </div>
                <span className="pt-0.5 text-sm text-muted">Offset</span>
                <ExpressionInput
                  label="Offset"
                  value={state.offset}
                  evaluate={tool.evaluate}
                  format={(r) => formatQuantity(r.value, r.dim, settings)}
                  onCommit={tool.setOffset}
                  onDraftChange={(expression, valid) => {
                    if (valid) tool.setOffset(expression);
                  }}
                />
                <span className="text-sm text-muted">Side</span>
                <label className="flex items-center gap-2 text-base">
                  <input
                    type="checkbox"
                    aria-label="Flip"
                    className="size-4 accent-(--x-accent)"
                    checked={state.flip}
                    onChange={(event) => tool.setFlip(event.target.checked)}
                  />
                  Flip
                </label>
                <span className="text-sm text-muted">View</span>
                <label className="flex items-center gap-2 text-base">
                  <input
                    type="checkbox"
                    aria-label="Show section"
                    className="size-4 accent-(--x-accent)"
                    checked={state.on}
                    onChange={(event) => tool.setOn(event.target.checked)}
                  />
                  Show section
                </label>
              </div>
              {lost && (
                <p className="text-sm text-error" role="status">
                  {planeLabel} is not in the model any more. Change the plane to see the section
                  again.
                </p>
              )}
              <p className="text-xs text-muted">
                The model is cut away on the side the arrow points to. Drag the arrow to move the
                cut.
              </p>
            </>
          )
        )}
      </div>

      <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-3 py-2">
        <Button
          variant="ghost"
          onClick={() => {
            tool.remove();
            onClose();
          }}
          disabled={!state}
        >
          Remove
        </Button>
        <Button variant="primary" onClick={onClose}>
          Done <kbd className="font-mono text-xs opacity-85">Esc</kbd>
        </Button>
      </footer>
    </section>
  );
}
