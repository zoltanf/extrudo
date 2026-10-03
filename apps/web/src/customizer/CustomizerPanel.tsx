import { type ConfigurationId, type CustomizerRow, dimOfKind, formatQuantity } from '@extrudo/core';
import { MoreVertical, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button, Menu, MenuItem, Select, ToolIcon } from '../design-system';
import { sliderStep, valueExpression } from '../parameters/customizer';
import { ExpressionInput } from '../parameters/ExpressionInput';
import { RenameField } from '../shell/FeatureMenu';
import { TOOLS } from '../shell/tools';
import { type CustomizerTool, sliderValue } from './useCustomizer';

/** Top-right below the ViewCube, where feature dialogs, Print Info and Measure open (UI spec §2). */
const HOME = { right: 12, top: 148 };

/** What the Configuration actions menu asked for. */
type Pending = 'save' | 'rename' | 'delete' | undefined;

export interface CustomizerPanelProps {
  tool: CustomizerTool;
  /** Opens the Parameters dialog, where a parameter is starred. */
  onOpenParameters(): void;
  onClose(): void;
}

/**
 * The Customizer panel (P4-07, ADR-0059 §4): the parameters the design exposes,
 * in the panel order and under their headings, each with an expression field and
 * — where the value is a plain number with both ends of a range — a slider. A
 * configuration is a named set of the same values: the header chooses one (which
 * writes every value it lists in one undo step, re-solving the sketches that use
 * them), and the menu beside it saves, updates, renames and deletes.
 *
 * Non-modal like a feature dialog or Print Info, in the same corner. Dragging a
 * slider is one undo step; a typed value is one command.
 *
 * Test hooks: the region "Customizer", `data-customizer-state` (`empty`,
 * `parameters`), rows `[data-customizer-row="<name>"]` with `data-out-of-range`,
 * the sliders `[data-customizer-slider="<name>"]`, the combobox "Configuration",
 * the button "Configuration actions" and the line `[data-customizer-missing]`.
 */
export function CustomizerPanel({ tool, onOpenParameters, onClose }: CustomizerPanelProps) {
  const [pending, setPending] = useState<Pending>();
  // A menu item that opens the name field keeps the focus it would otherwise
  // give back to the menu's trigger (Radix returns focus as the menu closes).
  const keepFocus = useRef(false);
  const ask = (what: Pending) => {
    keepFocus.current = true;
    setPending(what);
  };
  const rows = tool.groups.flatMap((g) => g.rows);
  const current = tool.current;
  const icon = TOOLS.customizer;
  return (
    <section
      aria-label="Customizer"
      data-customizer-state={rows.length === 0 ? 'empty' : 'parameters'}
      className="pointer-events-auto absolute z-20 flex w-80 flex-col rounded-dialog border border-line shadow-raised backdrop-blur-[6px]"
      style={{
        right: HOME.right,
        top: HOME.top,
        maxHeight: `calc(100% - ${HOME.top + 8}px)`,
        background: 'color-mix(in srgb, var(--x-raised) 94%, transparent)',
      }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <ToolIcon name={icon.icon} category={icon.category} size={18} />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">Customizer</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="grid size-6 place-items-center rounded-control text-muted hover:bg-accent-soft hover:text-ink"
        >
          <X size={14} />
        </button>
      </header>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
        <div className="flex items-center gap-2">
          <Select
            aria-label="Configuration"
            value={current?.id ?? ''}
            onChange={(event) => {
              const id = event.target.value as ConfigurationId;
              // "Custom" is what the document has when no configuration matches.
              if (id) tool.choose(id);
            }}
          >
            <option value="">Custom</option>
            {tool.configurations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Menu
            align="end"
            label="Configuration actions"
            onCloseAutoFocus={(event) => {
              if (!keepFocus.current) return;
              keepFocus.current = false;
              event.preventDefault();
            }}
            trigger={
              <button
                type="button"
                aria-label="Configuration actions"
                className="grid size-8 shrink-0 place-items-center rounded-control text-muted hover:bg-accent-soft hover:text-ink"
              >
                <MoreVertical size={16} />
              </button>
            }
          >
            <MenuItem icon={<Plus size={14} />} onSelect={() => ask('save')}>
              Save as…
            </MenuItem>
            <MenuItem
              icon={<RefreshCw size={14} />}
              disabled={!current}
              onSelect={() => {
                setPending(undefined);
                tool.update();
              }}
            >
              {current ? `Update ${current.name}` : 'Update'}
            </MenuItem>
            <MenuItem
              icon={<Pencil size={14} />}
              disabled={!current}
              onSelect={() => ask('rename')}
            >
              {current ? `Rename ${current.name}…` : 'Rename…'}
            </MenuItem>
            <MenuItem
              icon={<Trash2 size={14} />}
              disabled={!current}
              onSelect={() => ask('delete')}
            >
              {current ? `Delete ${current.name}` : 'Delete'}
            </MenuItem>
          </Menu>
        </div>

        {pending && (
          <div className="rounded-control border border-line p-2">
            {pending === 'save' && (
              <>
                <p className="mb-1.5 text-sm text-muted">
                  Save the exposed parameters' values as a new configuration.
                </p>
                <RenameField
                  name=""
                  label="Name of the configuration"
                  onCommit={tool.save}
                  onDone={() => setPending(undefined)}
                />
              </>
            )}
            {pending === 'rename' && current !== undefined && (
              <>
                <p className="mb-1.5 text-sm text-muted">
                  A new name for <span className="font-medium">{current.name}</span>.
                </p>
                <RenameField
                  name={current.name}
                  label={`Rename ${current.name}`}
                  onCommit={tool.rename}
                  onDone={() => setPending(undefined)}
                />
              </>
            )}
            {pending === 'delete' && current !== undefined && (
              <>
                <p className="mb-1.5 text-sm text-muted">
                  Delete the configuration <span className="font-medium">{current.name}</span>? The
                  parameters keep their values.
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setPending(undefined)}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (tool.remove()) setPending(undefined);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {tool.error && (
          <p role="status" className="text-sm text-error">
            {tool.error}
          </p>
        )}
        {tool.missing.length > 0 && (
          <p role="status" className="text-sm text-muted" data-customizer-missing>
            Missing: {tool.missing.join(', ')}
          </p>
        )}

        {rows.length === 0 ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted">
              No parameters in the customizer yet. Star a parameter in the Parameters dialog to show
              it here.
            </p>
            <Button variant="secondary" onClick={onOpenParameters}>
              Open Parameters
            </Button>
          </div>
        ) : (
          <>
            {tool.groups.map((group) => (
              <section key={group.group ?? ''} aria-label={group.group ?? 'Parameters'}>
                {group.group !== undefined && (
                  <h3 className="mb-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
                    {group.group}
                  </h3>
                )}
                <ul className="flex flex-col gap-3">
                  {group.rows.map((row) => (
                    <CustomizerRowView key={row.id} row={row} tool={tool} />
                  ))}
                </ul>
              </section>
            ))}
            <p className="text-xs text-muted">
              A range is a slider range, not a limit: a value outside it is kept, and warned about.
              Take a parameter out of here by unstarring it in the Parameters dialog.
            </p>
          </>
        )}
      </div>

      <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-3 py-2">
        {/* The empty state has its own way to the Parameters dialog. */}
        {rows.length > 0 && (
          <Button variant="ghost" onClick={onOpenParameters}>
            Open Parameters
          </Button>
        )}
        <Button variant="primary" onClick={onClose}>
          Done <kbd className="font-mono text-xs opacity-85">Esc</kbd>
        </Button>
      </footer>
    </section>
  );
}

/**
 * One exposed parameter: its name and comment, its value (an expression field
 * for a plain value, the computed value for a formula, which can't be dragged),
 * the slider where a range makes one, and the warning while the value is outside
 * that range.
 */
function CustomizerRowView({ row, tool }: { row: CustomizerRow; tool: CustomizerTool }) {
  const { settings } = tool;
  // A slider needs a plain value (only those can be dragged) and both ends.
  const span =
    row.plain && row.min !== undefined && row.max !== undefined
      ? { min: row.min, max: row.max }
      : undefined;
  const show = (value: number) => valueExpression(row.unit, value, settings);
  return (
    <li
      className="grid gap-1"
      data-customizer-row={row.name}
      data-out-of-range={row.outOfRange || undefined}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-base font-medium">{row.name}</span>
        {row.comment && (
          <span className="truncate text-xs text-muted" title={row.comment}>
            {row.comment}
          </span>
        )}
      </div>
      {row.plain ? (
        <ExpressionInput
          label={`Expression of ${row.name}`}
          value={row.expression}
          evaluate={(expression) => tool.evaluate(row, expression)}
          format={(result) => formatQuantity(result.value, result.dim, settings)}
          onCommit={(expression) => tool.setValue(row, expression)}
        />
      ) : (
        <output
          aria-label={`Value of ${row.name}`}
          title={row.expression}
          className="expr-field block px-1.5 py-1 text-base"
        >
          {row.value === undefined ? '—' : formatQuantity(row.value, dimOfKind(row.unit), settings)}
        </output>
      )}
      {span && (
        <input
          type="range"
          aria-label={row.name}
          data-customizer-slider={row.name}
          min={span.min}
          max={span.max}
          step={sliderStep(span.min, span.max, row.step)}
          value={sliderValue(row)}
          onPointerDown={() => tool.beginDrag(row)}
          onChange={(event) => tool.dragTo(row, event.currentTarget.valueAsNumber)}
          className="w-full accent-(--x-accent)"
        />
      )}
      {row.outOfRange && span && (
        <p className="text-xs text-warning">
          Outside {show(span.min)} to {show(span.max)}
        </p>
      )}
    </li>
  );
}
