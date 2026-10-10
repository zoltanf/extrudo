import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Select, ToolIcon } from '../design-system';
import { ExpressionInput } from '../parameters/ExpressionInput';
import { TOOLS } from '../shell/tools';
import {
  costText,
  FILAMENT_DIAMETERS,
  lengthText,
  MATERIALS,
  type MaterialChoice,
  type PrintField,
  volumeText,
  weightText,
} from './material';
import type { PrintInfo } from './usePrintAids';

/** Top-right below the ViewCube, where feature dialogs and Measure open (UI spec §2). */
const HOME = { right: 12, top: 148 };

/**
 * The Print Info panel (P3-10, FR-3DP-02; walls, infill and cost in P4-12, ADR-0048's
 * amendment): what the selected bodies (or every shown one) take to print. The volume and the
 * area are exact (from the kernel, not the display mesh), so the walls' volume and the printed
 * one are worked out from them for a material (PLA, PETG, ABS, TPU or a density of your own),
 * a filament diameter (1.75 or 2.85 mm), a wall count, a line width, an infill and a price per
 * kg. Supports are not modelled: generating them needs a slicer. Everything the panel sets is
 * remembered in the `print.material` preference.
 *
 * Test hooks: the region "Print Info", `data-print-state` (`empty`, `pending`, `ready`,
 * `error`), rows `[data-print-row="volume|printed|weight|filament|cost"]`, the combobox
 * "Material", the footnote `[data-print-footnote]` (pinned under the scrolling content), the textbox "Density" (custom only), the radios "1.75 mm" and "2.85 mm", and the
 * textboxes "Walls", "Line width", "Infill" and "Price per kg".
 */
export function PrintInfoPanel({ info, onClose }: { info: PrintInfo; onClose(): void }) {
  const { choice, estimate } = info;
  const tool = TOOLS.printInfo;
  const set = (change: Partial<MaterialChoice>) => info.setChoice(change);
  const number = (field: PrintField) => (expression: string) => info.evaluate(field, expression);
  /** A whole count of walls: a decimal one is rounded. */
  const walls = (expression: string, valid: boolean) => {
    if (!valid) return;
    const result = info.evaluate('walls', expression);
    if (result.ok) set({ walls: Math.round(result.value) });
  };
  return (
    <section
      aria-label="Print Info"
      data-print-state={info.state}
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
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">Print Info</h2>
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
        <div className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2">
          <span className="text-sm text-muted">Material</span>
          <Select
            aria-label="Material"
            value={choice.material}
            onChange={(event) =>
              set({ material: event.target.value as MaterialChoice['material'] })
            }
          >
            {MATERIALS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.density} g/cm³
              </option>
            ))}
            <option value="custom">Custom density</option>
          </Select>
          {choice.material === 'custom' && (
            <>
              <span className="pt-0.5 text-sm text-muted">Density</span>
              <ExpressionInput
                label="Density"
                value={choice.density}
                evaluate={number('density')}
                format={(r) => `${r.value} g/cm³`}
                onCommit={(density) => set({ density })}
                onDraftChange={(density, valid) => {
                  if (valid) set({ density });
                }}
              />
            </>
          )}
          <span className="text-sm text-muted">Filament</span>
          <fieldset className="m-0 flex gap-3 border-0 p-0">
            <legend className="sr-only">Filament diameter</legend>
            {FILAMENT_DIAMETERS.map((d) => (
              <label key={d} className="flex cursor-pointer items-center gap-1.5 text-base">
                <input
                  type="radio"
                  name="filament-diameter"
                  aria-label={`${d} mm`}
                  className="accent-(--x-accent)"
                  checked={choice.diameter === d}
                  onChange={() => set({ diameter: d })}
                />
                {d} mm
              </label>
            ))}
          </fieldset>
          <span className="text-sm text-muted">Walls</span>
          <ExpressionInput
            label="Walls"
            value={String(choice.walls)}
            evaluate={number('walls')}
            format={(r) => `${r.value}`}
            onCommit={(expression) => walls(expression, true)}
            onDraftChange={walls}
          />
          <span className="text-sm text-muted">Line width</span>
          <ExpressionInput
            label="Line width"
            value={choice.lineWidth}
            evaluate={number('lineWidth')}
            format={(r) => `${r.value} mm`}
            onCommit={(lineWidth) => set({ lineWidth })}
            onDraftChange={(lineWidth, valid) => {
              if (valid) set({ lineWidth });
            }}
          />
          <span className="text-sm text-muted">Infill</span>
          <ExpressionInput
            label="Infill"
            value={choice.infill}
            evaluate={number('infill')}
            format={(r) => `${r.value} %`}
            onCommit={(infill) => set({ infill })}
            onDraftChange={(infill, valid) => {
              if (valid) set({ infill });
            }}
          />
          <span className="text-sm text-muted">Price per kg</span>
          <ExpressionInput
            label="Price per kg"
            value={choice.price}
            evaluate={number('price')}
            format={(r) => `${r.value} / kg`}
            onCommit={(price) => set({ price })}
            onDraftChange={(price, valid) => {
              if (valid) set({ price });
            }}
          />
        </div>

        <div className="border-t border-line pt-3">
          {info.state === 'empty' ? (
            <p className="text-sm text-muted">
              There is nothing to weigh yet: the model has no body.
            </p>
          ) : info.state === 'error' ? (
            <p className="text-sm text-error" role="status">
              {info.error ?? "Couldn't measure the bodies."}
            </p>
          ) : (
            <>
              <p className="mb-2 text-sm text-muted" data-print-scope={info.scope}>
                {info.scope === 'selected' ? 'Selected: ' : 'All shown bodies: '}
                {info.bodies.map((b) => b.name).join(', ') || '…'}
              </p>
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-base">
                <Row name="volume" label="Volume">
                  {estimate ? volumeText(estimate.volume) : '…'}
                </Row>
                <Row name="printed" label="Printed (est.)">
                  {estimate ? volumeText(estimate.printed) : '…'}
                </Row>
                <Row name="weight" label="Weight">
                  {estimate ? weightText(estimate.weight) : '…'}
                </Row>
                <Row name="filament" label="Filament length">
                  {estimate ? lengthText(estimate.filament) : '…'}
                </Row>
                <Row name="cost" label="Cost">
                  {estimate ? costText(estimate.cost) : '…'}
                </Row>
              </dl>
              {info.density === undefined && (
                <p className="mt-2 text-sm text-error" role="status">
                  Enter a density above 0 to see the weight.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <p className="shrink-0 border-t border-line px-3 py-2 text-xs text-muted" data-print-footnote>
        An estimate: walls and infill as set, no supports. Filament length is the same for every
        material.
      </p>

      <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-3 py-2">
        <Button variant="primary" onClick={onClose}>
          Done <kbd className="font-mono text-xs opacity-85">Esc</kbd>
        </Button>
      </footer>
    </section>
  );
}

function Row({ name, label, children }: { name: string; label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="m-0 text-right font-medium tabular-nums" data-print-row={name}>
        {children}
      </dd>
    </>
  );
}
