import { type ExtrudoDocument, formatQuantity } from '@extrudo/core';
import { X } from 'lucide-react';
import { Button, Select, ToolIcon } from '../design-system';
import { ExpressionInput } from '../parameters/ExpressionInput';
import { TOOLS } from '../shell/tools';
import { DOWN_DIRECTIONS, type DownId } from './overhang';
import type { OverhangTool } from './usePrintAids';

/** Top-right below the ViewCube, where feature dialogs and Measure open (UI spec §2). */
const HOME = { right: 12, top: 148 };

/**
 * The Overhang Analysis panel (P3-10, FR-3DP-03): faces that point more than an angle below the
 * horizontal are shaded, for a chosen "down" direction (the bed, -Z, by default). The angle is
 * an expression (45° by default: the usual limit of what prints without support). Faces lying
 * on the bed aren't overhangs. Closing the panel leaves the shading on; the browser's Analysis
 * row brings the panel back, and Remove ends the analysis.
 *
 * Test hooks: the region "Overhang Analysis", `data-overhang-state` (`on`, `off`), the textbox
 * "Angle" (`exact`), the combobox "Down", the checkbox "Show overhangs".
 */
export function OverhangPanel({
  tool,
  settings,
  onClose,
}: {
  tool: OverhangTool;
  settings: ExtrudoDocument['settings'];
  onClose(): void;
}) {
  const { state, report } = tool;
  const icon = TOOLS.overhang;
  return (
    <section
      aria-label="Overhang Analysis"
      data-overhang-state={state?.on ? 'on' : 'off'}
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
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">Overhang Analysis</h2>
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
              <span className="pt-0.5 text-sm text-muted">Angle</span>
              <ExpressionInput
                label="Angle"
                value={state.angle}
                evaluate={tool.evaluate}
                format={(r) => formatQuantity(r.value, r.dim, { ...settings, precision: 1 })}
                onCommit={tool.setAngle}
                onDraftChange={(expression, valid) => {
                  if (valid) tool.setAngle(expression);
                }}
              />
              <span className="text-sm text-muted">Down</span>
              <Select
                aria-label="Down"
                value={state.down}
                onChange={(event) => tool.setDown(event.target.value as DownId)}
              >
                {DOWN_DIRECTIONS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </Select>
              <span className="text-sm text-muted">View</span>
              <label className="flex items-center gap-2 text-base">
                <input
                  type="checkbox"
                  aria-label="Show overhangs"
                  className="size-4 accent-(--x-accent)"
                  checked={state.on}
                  onChange={(event) => tool.setOn(event.target.checked)}
                />
                Show overhangs
              </label>
            </div>
            <p className="text-sm" data-overhang-result role="status">
              {!state.on
                ? 'Shading is off.'
                : report === undefined
                  ? 'Nothing to analyse yet.'
                  : report.triangles === 0
                    ? 'No overhangs at this angle.'
                    : `${report.faces} ${report.faces === 1 ? 'face' : 'faces'} overhang, ${Math.round(report.area)} mm² in all.`}
            </p>
            <p className="text-xs text-muted">
              Shaded in red: faces whose normal points more than the angle below the horizontal.
              Faces lying on the lowest level of the model (the bed) are left out. Place on Bed
              turns a face down first.
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
