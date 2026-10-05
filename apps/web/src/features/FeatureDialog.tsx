import { type ExtrudoDocument, formatQuantity } from '@extrudo/core';
import { CircleAlert, X } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Button, Select, ToolIcon, Tooltip } from '../design-system';
import { ExpressionInput } from '../parameters/ExpressionInput';
import { Message } from '../parameters/Message';
import { TOOLS, type Tool } from '../shell/tools';
import { canCommit, commitProblem, type DialogController, type OpenDialog } from './dialog';
import { repeatableFeatures } from './featureList';
import { pickName } from './pickName';
import type {
  DialogField,
  FeatureDialogSpec,
  FeatureListField,
  LabelsField,
  SelectionField,
} from './spec';
import { countLabel, pickPrompt, shownFields } from './values';

export interface FeatureDialogProps {
  controller: DialogController;
  settings: ExtrudoDocument['settings'];
}

/** Top-right below the ViewCube, like the sketch palette (UI spec §2). */
const HOME = { right: 12, top: 148 };

/**
 * The column the dialog takes on the right of the view: its 256 px width and
 * a 12 px margin each side. What else floats over the view keeps out of it —
 * the heads-up box (`DialogOverlay`) and the toast stack, whose 12-second
 * "Sketch1 is hidden…" notice would otherwise sit on the OK button.
 */
export const DIALOG_COLUMN = 280;

/**
 * The command dialog (UI spec §2, §3.4; ADR-0027): floating on the right of
 * the view, draggable by its title, with the spec's fields, the draft's
 * problem or error, and OK (Enter) / Cancel (Esc). Non-modal: the view
 * stays live for picking and navigating.
 *
 * Test hooks: `data-feature-dialog` (the feature type), `data-dialog-mode`
 * (`create`/`edit`), `data-dialog-valid`, `data-preview-status`
 * (`pending`, `ok`, `warning`, `error`, or absent before the first preview).
 */
export function FeatureDialog({ controller, settings }: FeatureDialogProps) {
  const open = useStore(controller.state, (s) => s.open);
  // Kept while the page is open: the next dialog comes up where the last was moved to.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  if (!open) return null;
  return (
    <FeatureDialogPanel
      open={open}
      controller={controller}
      settings={settings}
      offset={offset}
      onMove={setOffset}
    />
  );
}

export interface FeatureDialogPanelProps extends FeatureDialogProps {
  open: OpenDialog;
  /** How far it was dragged from its home, px. */
  offset: { x: number; y: number };
  onMove(offset: { x: number; y: number }): void;
}

/** The dialog for an open state (rendered by `FeatureDialog`; tests render it directly). */
export function FeatureDialogPanel({
  open,
  controller,
  settings,
  offset,
  onMove,
}: FeatureDialogPanelProps) {
  const drag = useRef<{ x: number; y: number; from: { x: number; y: number } }>(undefined);
  const { spec } = open;
  const valid = canCommit(open);
  const why = open.checked.first?.message ?? Object.values(open.typing)[0];
  const refusal = commitProblem(open);
  const status = open.preview.status;
  const fieldIssue = open.checked.first?.field !== undefined;

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, from: offset };
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    onMove({ x: d.from.x + event.clientX - d.x, y: d.from.y + event.clientY - d.y });
  };
  const onPointerUp = () => {
    drag.current = undefined;
  };

  return (
    <section
      aria-label={`${title(open)} dialog`}
      data-feature-dialog={spec.type}
      data-dialog-mode={open.mode}
      data-dialog-valid={valid || undefined}
      data-preview-status={open.preview.pending ? 'pending' : status?.status}
      className="pointer-events-auto absolute z-20 flex w-64 flex-col rounded-dialog border border-line shadow-raised backdrop-blur-[6px]"
      style={{
        right: HOME.right - offset.x,
        top: HOME.top + offset.y,
        // A long dialog (Extrude with two sides) scrolls its fields instead of running off the view.
        maxHeight: `calc(100% - ${Math.max(0, HOME.top + offset.y) + 8}px)`,
        background: 'color-mix(in srgb, var(--x-raised) 94%, transparent)',
      }}
    >
      <header
        className="flex shrink-0 cursor-grab items-center gap-2 border-b border-line px-3 py-2 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title="Drag to move"
      >
        <SpecIcon spec={spec} />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{title(open)}</h2>
        <button
          type="button"
          aria-label="Cancel"
          onClick={() => controller.cancel()}
          className="grid size-6 place-items-center rounded-control text-muted hover:bg-accent-soft hover:text-ink"
        >
          <X size={14} />
        </button>
      </header>
      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto p-3">
        {open.note && (
          <p role="note" aria-label="Fix references" className="text-sm text-warning">
            {open.note}
          </p>
        )}
        {shownFields(spec, open.values, controller.context()).map((field) => (
          <FieldRow
            key={field.name}
            field={field}
            open={open}
            controller={controller}
            settings={settings}
          />
        ))}
        {spec.extra && (
          <div className="flex min-w-0 flex-col gap-1.5">
            <spec.extra open={open} controller={controller} />
          </div>
        )}
      </div>
      {(status?.status === 'error' || status?.status === 'warning' || (why && !fieldIssue)) && (
        <p
          role="status"
          aria-label="Feature status"
          className={`mx-3 mb-2 flex shrink-0 items-start gap-1.5 text-sm ${status?.status === 'warning' && !why ? 'text-warning' : 'text-error'}`}
        >
          <CircleAlert size={14} className="mt-0.5 shrink-0" />
          <span>
            <Message text={why && !fieldIssue ? why : (status?.message ?? '')} />
          </span>
        </p>
      )}
      <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-3 py-2">
        <Button variant="ghost" onClick={() => controller.cancel()}>
          Cancel <kbd className="font-mono text-xs text-muted">Esc</kbd>
        </Button>
        <Tooltip label={refusal ?? 'OK'}>
          <Button
            variant="primary"
            aria-disabled={!valid || undefined}
            className={valid ? '' : 'opacity-45'}
            onClick={() => controller.ok()}
          >
            OK <kbd className="font-mono text-xs opacity-85">Enter</kbd>
          </Button>
        </Tooltip>
      </footer>
    </section>
  );
}

function title(open: OpenDialog): string {
  return open.mode === 'edit' ? `Edit ${open.name}` : open.spec.label;
}

function SpecIcon({ spec }: { spec: FeatureDialogSpec }) {
  const tool: Pick<Tool, 'icon' | 'category'> =
    typeof spec.command === 'string' ? TOOLS[spec.command] : spec.command;
  return <ToolIcon name={tool.icon} category={tool.category} size={18} />;
}

function FieldRow({
  field,
  open,
  controller,
  settings,
}: {
  field: DialogField;
  open: OpenDialog;
  controller: DialogController;
  settings: ExtrudoDocument['settings'];
}) {
  // An empty selection field already asks for its pick.
  const empty = field.kind === 'selection' && (open.values.refs[field.name]?.length ?? 0) === 0;
  const issue = empty ? undefined : open.checked.fields[field.name];
  let control: ReactNode;
  switch (field.kind) {
    case 'selection':
      control = <SelectionControl field={field} open={open} controller={controller} />;
      break;
    case 'features':
      control = <FeatureListControl field={field} open={open} controller={controller} />;
      break;
    case 'expression':
      control = (
        <FieldExpression
          field={field.name}
          label={field.label}
          open={open}
          controller={controller}
          settings={settings}
        />
      );
      break;
    case 'choice':
      control = (
        <Select
          aria-label={field.label}
          value={open.values.choices[field.name] ?? field.default}
          onChange={(event) => controller.setChoice(field.name, event.target.value)}
        >
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
      break;
    case 'toggle':
      control = (
        <input
          type="checkbox"
          aria-label={field.label}
          className="size-4 accent-(--x-accent)"
          checked={open.values.toggles[field.name] ?? field.default}
          onChange={(event) => controller.setToggle(field.name, event.target.checked)}
        />
      );
      break;
    case 'labels':
      control = <LabelsControl field={field} open={open} controller={controller} />;
      break;
    case 'info': {
      // A read-only line: what the file is, not something to change (ADR-0066 §2).
      const ctx = controller.context();
      const text = ctx ? field.text(open.values, ctx) : '';
      control = (
        <p data-info={field.name} className="truncate pt-1.5 text-sm">
          {text}
        </p>
      );
      break;
    }
  }
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2" data-field={field.name}>
      <span className="pt-1.5 text-sm text-muted" title={field.hint}>
        {field.label}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        {control}
        {issue && (
          <p className="text-xs text-error">
            <Message text={issue} />
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * A labels field (P4-12: a pattern's skipped instances): the names the field
 * holds, and a clear button. What fills it is the dots on the instances in the
 * view, so there is nothing to type.
 */
function LabelsControl({
  field,
  open,
  controller,
}: {
  field: LabelsField;
  open: OpenDialog;
  controller: DialogController;
}) {
  const labels = open.values.labels[field.name] ?? [];
  return (
    <div className="flex min-w-0 items-center gap-1 pt-1" data-labels={field.name}>
      <p
        className={`min-w-0 flex-1 truncate text-sm ${labels.length ? 'text-ink' : 'text-muted'}`}
        data-skipped={labels.join(' ')}
      >
        {labels.length > 0 ? labels.join(', ') : (field.empty ?? 'None')}
      </p>
      {labels.length > 0 && (
        <button
          type="button"
          aria-label={`Clear ${field.label}`}
          onClick={() => controller.setLabels(field.name, [])}
          className="grid size-6 shrink-0 place-items-center rounded-control text-muted hover:bg-accent-soft hover:text-ink"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

/**
 * A selection field: a button that makes it the pick field (accent border
 * while it is), the count or the prompt, and a clear button.
 */
function SelectionControl({
  field,
  open,
  controller,
}: {
  field: SelectionField;
  open: OpenDialog;
  controller: DialogController;
}) {
  const refs = open.values.refs[field.name] ?? [];
  const active = open.pickField === field.name;
  const one = refs.length === 1 && refs[0] ? pickName(refs[0], controller.context()) : undefined;
  const text =
    refs.length === 0
      ? pickPrompt(field)
      : (one ??
        countLabel(refs, {
          ...(field.noun && { noun: field.noun }),
          ...(field.wholeTexts && { wholeTexts: true }),
        }));
  return (
    <div
      className={`flex h-8 items-center rounded-input border ${active ? 'border-accent bg-accent-soft' : 'border-line'}`}
    >
      <button
        type="button"
        aria-label={field.label}
        aria-pressed={active}
        data-count={refs.length}
        onClick={() => controller.pickInto(field.name)}
        className={`min-w-0 flex-1 truncate px-2 text-left text-sm ${refs.length ? 'text-ink' : 'text-muted'}`}
      >
        {text}
      </button>
      {refs.length > 0 && (
        <button
          type="button"
          aria-label={`Clear ${field.label}`}
          onClick={() => {
            controller.setRefs(field.name, []);
            controller.pickInto(field.name);
          }}
          className="mr-1 grid size-6 place-items-center rounded-control text-muted hover:bg-accent-soft hover:text-ink"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

/**
 * A list of features to tick (patterns and mirror): each a checkbox with its
 * name and what it does; an empty list says what to make first.
 */
function FeatureListControl({
  field,
  open,
  controller,
}: {
  field: FeatureListField;
  open: OpenDialog;
  controller: DialogController;
}) {
  const doc = controller.context()?.doc;
  const listed = doc ? repeatableFeatures(doc, open.index, field.types) : [];
  const ticked = open.values.refs[field.name] ?? [];
  // A ticked feature that is no longer listed (suppressed, moved after the draft) stays so it can be unticked.
  const stale = ticked.filter((ref) => !listed.some((f) => f.id === ref.id));
  if (listed.length === 0 && stale.length === 0) {
    return (
      <p className="pt-1.5 text-sm text-muted">
        Nothing to repeat yet: make an extrude, revolve or primitive that joins or cuts.
      </p>
    );
  }
  const toggle = (id: string, on: boolean) => {
    const others = ticked.filter((ref) => ref.id !== id);
    controller.setRefs(field.name, on ? [...others, { kind: 'feature', id }] : others);
  };
  return (
    <ul aria-label={field.label} className="flex flex-col gap-1 pt-1">
      {[
        ...listed.map((f) => ({ ...f, stale: false })),
        ...stale.map((ref) => ({
          id: ref.id,
          name: doc?.features.find((f) => f.id === ref.id)?.name ?? ref.id,
          operation: undefined,
          stale: true,
        })),
      ].map((f) => (
        <li key={f.id}>
          <label className="flex min-w-0 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-feature={f.id}
              className="size-4 accent-(--x-accent)"
              checked={ticked.some((ref) => ref.id === f.id)}
              onChange={(event) => toggle(f.id, event.target.checked)}
            />
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            <span className="text-xs text-muted">{f.stale ? 'unavailable' : f.operation}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/**
 * An expression field, in the dialog or the heads-up box: the draft goes
 * into the dialog on every keystroke that evaluates (live preview), a
 * draft that doesn't marks the field; Enter commits it and presses OK.
 */
export function FieldExpression({
  field,
  label,
  open,
  controller,
  settings,
  className,
}: {
  field: string;
  label: string;
  open: OpenDialog;
  controller: DialogController;
  settings: ExtrudoDocument['settings'];
  className?: string;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A valid draft blurred its field on Enter (committing it): Enter also means OK.
    if (event.key === 'Enter' && document.activeElement !== event.target) controller.ok();
    // Esc on text that doesn't evaluate puts the last good value back (the field does that);
    // it doesn't cancel the dialog too. (The field re-renders only after this handler.)
    const target = event.target as HTMLElement;
    if (event.key === 'Escape' && target.dataset.keepEscape !== undefined) event.preventDefault();
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: forwards Enter and focus from the field inside.
    <div onKeyDown={onKeyDown} onFocus={() => controller.activate(field)} className="min-w-0">
      <ExpressionInput
        label={label}
        value={open.values.exprs[field] ?? ''}
        evaluate={(expr) => controller.evaluate(field, expr)}
        format={(r) => formatQuantity(r.value, r.dim, settings)}
        onDraftChange={(expr, valid) => {
          if (valid) controller.setExpr(field, expr);
          else {
            const result = controller.evaluate(field, expr);
            controller.setTyping(
              field,
              result.ok ? undefined : `${label}: ${result.error.message}`,
            );
          }
        }}
        onCommit={(expr) => controller.setExpr(field, expr)}
        {...(className && { className })}
      />
    </div>
  );
}
