import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Select, ToolIcon } from '../design-system';
import { ExpressionInput } from '../parameters/ExpressionInput';
import { TOOLS } from '../shell/tools';
import {
  FILAMENT_DIAMETERS,
  lengthText,
  MATERIALS,
  type MaterialChoice,
  volumeText,
  weightText,
} from './material';
import type { PrintInfo } from './usePrintAids';

/** Top-right below the ViewCube, where feature dialogs and Measure open (UI spec §2). */
const HOME = { right: 12, top: 148 };

/**
 * The Print Info panel (P3-10, FR-3DP-02): the volume, weight and filament length of the
 * selected bodies (or every shown body), for a material (PLA, PETG, ABS, TPU or a density of
 * your own) and a filament diameter (1.75 or 2.85 mm). The volume is exact (from the kernel, not
 * the display mesh). Infill isn't modelled: the numbers are for a solid part. The material is
 * remembered in the `print.material` preference.
 *
 * Test hooks: the region "Print Info", `data-print-state` (`empty`, `pending`, `ready`,
 * `error`), rows `[data-print-row="volume|weight|filament"]`, the combobox "Material", the
 * textbox "Density" (custom only), the radios "1.75 mm" and "2.85 mm".
 */
export function PrintInfoPanel({ info, onClose }: { info: PrintInfo; onClose(): void }) {
  const { choice, estimate } = info;
  const tool = TOOLS.printInfo;
  const set = (change: Partial<MaterialChoice>) => info.setChoice(change);
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
        <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
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
                evaluate={info.evaluateDensity}
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
                <Row name="weight" label="Weight">
                  {estimate ? weightText(estimate.weight) : '…'}
                </Row>
                <Row name="filament" label="Filament length">
                  {estimate ? lengthText(estimate.filament) : '…'}
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
        <p className="text-xs text-muted">
          Solid, 100 % infill: a real print with infill is lighter. Filament length is the same for
          every material.
        </p>
      </div>

      <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-3 py-2">
        <Button variant="primary" onClick={onClose}>
          Done <kbd className="font-mono text-xs opacity-70">Esc</kbd>
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
