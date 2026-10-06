import { type ExtrudoDocument, formatQuantity } from '@extrudo/core';
import { X } from 'lucide-react';
import { Button, ToolIcon } from '../design-system';
import { ExpressionInput } from '../parameters/ExpressionInput';
import { TOOLS } from '../shell/tools';
import { type ThicknessTool, thicknessLines } from './useThickness';

/** Top-right below the ViewCube, where feature dialogs and Measure open (UI spec §2). */
const HOME = { right: 12, top: 148 };

/**
 * The Wall Thickness panel (P5-06, FR-3DP-07, ADR-0072): walls thinner than a minimum are
 * shaded, and the panel says how thin the thinnest one is and how much area is below the
 * minimum. The minimum is an expression (two line widths of the print material by default:
 * 0.9 mm at 0.45 mm, so a wall prints as at least two lines). Closing the panel leaves the
 * shading on; the browser's Analysis row brings the panel back, and Remove ends the check.
 *
 * Test hooks: the region "Wall Thickness", `data-thickness-state` (`on`, `off`), the textbox
 * "Minimum" (`exact`), the checkbox "Show thin walls" and the result in `data-thickness-result`.
 */
export function WallThicknessPanel({
  tool,
  settings,
  onClose,
}: {
  tool: ThicknessTool;
  settings: ExtrudoDocument['settings'];
  onClose(): void;
}) {
  const { state, report, pending } = tool;
  const icon = TOOLS.wallThickness;
  return (
    <section
      aria-label="Wall Thickness"
      data-thickness-state={state?.on ? 'on' : 'off'}
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
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">Wall Thickness</h2>
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
        {state && (
          <>
            <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
              <span className="pt-0.5 text-sm text-muted">Minimum</span>
              <ExpressionInput
                label="Minimum"
                value={state.min}
                evaluate={tool.evaluate}
                format={(r) => formatQuantity(r.value, r.dim, { ...settings, precision: 2 })}
                onCommit={tool.setMin}
                onDraftChange={(expression, valid) => {
                  if (valid) tool.setMin(expression);
                }}
              />
              <span className="text-sm text-muted">View</span>
              <label className="flex items-center gap-2 text-base">
                <input
                  type="checkbox"
                  aria-label="Show thin walls"
                  className="size-4 accent-(--x-accent)"
                  checked={state.on}
                  onChange={(event) => tool.setOn(event.target.checked)}
                />
                Show thin walls
              </label>
            </div>
            <div className="flex flex-col gap-0.5 text-sm" data-thickness-result role="status">
              {pending ? (
                <p>Measuring…</p>
              ) : !state.on ? (
                <p>Shading is off.</p>
              ) : report === undefined ? (
                <p>Nothing to analyse yet.</p>
              ) : (
                thicknessLines(report, tool.min, settings).map((line) => <p key={line}>{line}</p>)
              )}
            </div>
            <p className="text-xs text-muted">
              Shaded in red: walls thinner than the minimum, measured from each triangle along the
              inward normal to the far side. The label marks the thinnest wall.
            </p>
          </>
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
