import { formatQuantity, LENGTH, TOLERANCE_PRESETS } from '@extrudo/core';
import { X } from 'lucide-react';
import { Button, ToolIcon } from '../design-system';
import { ExpressionInput } from '../parameters/ExpressionInput';
import { Message } from '../parameters/Message';
import { TOOLS } from '../shell/tools';
import { type Tolerance, tolerancePresetExpression } from './useTolerance';

/** Top-right below the ViewCube, where feature dialogs and Measure open (UI spec §2). */
const HOME = { right: 12, top: 148 };

/**
 * The Tolerance panel (P4-08, ADR-0062, FR-3DP-05): how much room a printed
 * fit gets, as the document parameter `tolerance`. A hole's diameter grows by
 * twice it, a thread's profile moves by once, and the hole presets write it
 * into their sizes; the line under the buttons says what reaches it. Typing a
 * value creates the parameter, the buttons set the three allowances printers
 * usually need. Every change is one command through the shell's `apply`, so it
 * undoes on its own; deleting it is the Parameters dialog's job.
 *
 * Test hooks: the region "Print tolerance", the textbox "Print tolerance"
 * (`exact`), the buttons "Tight 0.1 mm", "Normal 0.2 mm", "Loose 0.3 mm"
 * (`aria-pressed`), `data-tolerance-usage` (the usage line) and `data-tolerance`
 * (`set` or `unset`: whether the document has the parameter).
 */
export function TolerancePanel({ tolerance, onClose }: { tolerance: Tolerance; onClose(): void }) {
  const { expression, preset, usageText, settings, evaluate, set, error } = tolerance;
  const tool = TOOLS.tolerance;
  return (
    <section
      aria-label="Print tolerance"
      data-tolerance={tolerance.expression ? 'set' : 'unset'}
      className="pointer-events-auto absolute z-20 flex w-72 flex-col rounded-dialog border border-line shadow-raised backdrop-blur-[6px]"
      style={{
        right: HOME.right,
        top: HOME.top,
        background: 'color-mix(in srgb, var(--x-raised) 94%, transparent)',
      }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <ToolIcon name={tool.icon} category={tool.category} size={18} />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">Print tolerance</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="grid size-6 place-items-center rounded-control text-muted hover:bg-accent-soft hover:text-ink"
        >
          <X size={14} />
        </button>
      </header>

      <div className="flex flex-col gap-3 p-3" aria-live="polite">
        <div className="grid grid-cols-[104px_minmax(0,1fr)] items-start gap-2">
          <span className="pt-1 text-sm text-muted">Clearance</span>
          <ExpressionInput
            label="Print tolerance"
            value={expression}
            placeholder="Not set (threads use 0.1 mm)"
            evaluate={evaluate}
            format={(result) => formatQuantity(result.value, result.dim, settings)}
            onCommit={set}
          />
        </div>

        <div className="flex gap-2">
          {TOLERANCE_PRESETS.map((option) => (
            <Button
              key={option.id}
              variant="secondary"
              aria-pressed={preset === option.id}
              className="flex-1"
              title={`${option.label} clearance: a hole ${2 * option.value} mm wider, a thread ${option.value} mm under size.`}
              onClick={() => set(tolerancePresetExpression(option.value))}
            >
              {option.label} {formatQuantity(option.value, LENGTH, { ...settings, precision: 1 })}
            </Button>
          ))}
        </div>

        <p className="text-sm text-muted" data-tolerance-usage>
          {usageText}
        </p>
        {error && (
          <p className="text-sm text-error" role="alert">
            <Message text={error} />
          </p>
        )}
        <p className="text-xs text-muted">
          A printed hole comes out smaller and a printed peg larger than modelled. This is the room
          one side of a fit gets: hole presets add it to their diameters, threads move their profile
          by it.
        </p>
      </div>

      <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-3 py-2">
        <Button variant="primary" onClick={onClose}>
          Done <kbd className="font-mono text-xs opacity-85">Esc</kbd>
        </Button>
      </footer>
    </section>
  );
}
