/**
 * The right column for views (P6-24 S2, plan §4.3, mock-up 1): a selected view's card, and
 * Base View's panel while the tool runs. Every change of the card is one command and one
 * undo step with its own label; every number is an `ExpressionInput` (a custom scale's
 * two parts), and the evaluated number is stored (plan §5.3).
 *
 * - **A base view**: Looking from (the six standard views, four isometrics, the model's
 *   current view, each named view), Scale (the sheet's, the standard ones, custom), Style
 *   (visible edges; visible and hidden: the shaded styles come later), the switches
 *   Tangent edges, Centre lines and View label, and the bodies as checkboxes under "All
 *   shown".
 * - **A projected view**: its parent, and its own centre lines and label only (it takes
 *   everything else from its base view).
 *
 * Centre lines (S4) only hides the view's own centre marks and centre lines: none is ever
 * made for a view by itself.
 *
 * Test hooks: the regions "View" (the card) and "Base view" (the tool's panel); the
 * comboboxes "Looking from" and "Scale"; the radio group "Style"; the switches "Tangent
 * edges", "Centre lines" and "View label"; the checkboxes "All shown" and one per body by its name; the
 * number fields "View scale: model" and "View scale: sheet" for a custom scale.
 */
import {
  type BodyId,
  type EvaluateResult,
  ExprError,
  type ExtrudoDocument,
  evaluateParameters,
  type Sheet,
  type SheetScale,
  type SheetView,
  type SheetViewChanges,
  type SheetViewStyle,
} from '@extrudo/core';
import { shownBodies } from '@extrudo/kernel';
import { Trash2 } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Button, Select, ToolIcon } from '../design-system';
import { ExpressionInput } from '../parameters/ExpressionInput';
import { CommitField, Row, Segmented, Switch } from './controls';
import { baseViewOf } from './viewLines';
import { type LookingFrom, lookingFromOf, STANDARD_SCALES, scaleText } from './views';

const CARD =
  'pointer-events-auto flex shrink-0 flex-col gap-3 rounded-dialog border border-line p-3 shadow-raised backdrop-blur-[6px]';
const CARD_STYLE = { background: 'color-mix(in srgb, var(--x-raised) 92%, transparent)' };

const STYLES: { value: SheetViewStyle; label: string }[] = [
  { value: 'visible', label: 'Visible edges' },
  { value: 'hidden', label: 'Visible and hidden' },
];

const fail = (expression: string, message: string): EvaluateResult => ({
  ok: false,
  error: new ExprError(message, { start: 0, end: expression.length }),
});

/**
 * Scale: "Sheet · 1:2" (`undefined`), a standard one, or custom with two number fields.
 * `onChange(undefined)` is the sheet's.
 */
export function ScaleField({
  doc,
  sheet,
  value,
  onChange,
}: {
  doc: ExtrudoDocument;
  sheet: Sheet;
  value: SheetScale | undefined;
  onChange(scale: SheetScale | undefined): void;
}) {
  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  const [customising, setCustomising] = useState(false);
  const known = value && STANDARD_SCALES.some((s) => scaleText(s) === scaleText(value));
  const choice =
    value === undefined ? 'sheet' : known && !customising ? scaleText(value) : 'custom';
  const positive = (expression: string): EvaluateResult => {
    const r = evaluation.evaluate(expression, 'unitless');
    if (!r.ok) return r;
    return r.value > 0 ? r : fail(expression, 'A scale needs numbers above 0.');
  };
  const part = (expression: string) => {
    const r = positive(expression);
    return r.ok ? Math.round(r.value * 1000) / 1000 : undefined;
  };
  const shown = value ?? sheet.scale;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Select
        aria-label="Scale"
        className="h-7"
        value={choice}
        onChange={(event) => {
          const next = event.target.value;
          setCustomising(next === 'custom');
          if (next === 'sheet') onChange(undefined);
          else if (next !== 'custom') {
            const scale = STANDARD_SCALES.find((s) => scaleText(s) === next);
            if (scale) onChange([...scale] as SheetScale);
          }
        }}
      >
        <option value="sheet">Sheet · {scaleText(sheet.scale)}</option>
        {STANDARD_SCALES.map((s) => (
          <option key={scaleText(s)} value={scaleText(s)}>
            {scaleText(s)}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </Select>
      {choice === 'custom' && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
          <ExpressionInput
            key={`a:${shown[0]}`}
            label="View scale: model"
            value={String(shown[0])}
            evaluate={positive}
            format={(r) => String(Math.round(r.value * 1000) / 1000)}
            onCommit={(e) => {
              const a = part(e);
              if (a !== undefined) onChange([a, shown[1]]);
            }}
          />
          <span className="text-muted">:</span>
          <ExpressionInput
            key={`b:${shown[1]}`}
            label="View scale: sheet"
            value={String(shown[1])}
            evaluate={positive}
            format={(r) => String(Math.round(r.value * 1000) / 1000)}
            onCommit={(e) => {
              const b = part(e);
              if (b !== undefined) onChange([shown[0], b]);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** "Looking from": the choices, and "Custom direction" for a view that matches none. */
function LookingFromField({
  choices,
  value,
  onChange,
}: {
  choices: readonly LookingFrom[];
  value: LookingFrom | undefined;
  onChange(choice: LookingFrom): void;
}) {
  return (
    <Select
      aria-label="Looking from"
      className="h-7"
      value={value?.value ?? 'custom'}
      onChange={(event) => {
        const next = choices.find((c) => c.value === event.target.value);
        if (next) onChange(next);
      }}
    >
      {!value && (
        <option value="custom" disabled>
          Custom direction
        </option>
      )}
      {choices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </Select>
  );
}

function Heading({ name, kind }: { name: string; kind: string }) {
  return (
    <div className="flex items-center gap-2">
      <ToolIcon
        name={kind === 'projected view' ? 'projected-view' : 'base-view'}
        category="create"
        size={18}
      />
      <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{name}</h2>
      <span className="text-sm whitespace-nowrap text-muted">{kind}</span>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">{label}</span>
      {children}
    </div>
  );
}

export interface SheetViewCardProps {
  doc: ExtrudoDocument;
  sheet: Sheet;
  view: SheetView;
  /** The bodies at the marker, in the browser's order. */
  bodies: readonly BodyId[];
  choices: readonly LookingFrom[];
  /** One change as one undo step; returns a refusal's message. */
  change(changes: SheetViewChanges, label: string): string | undefined;
  /**
   * A new scale (`undefined`: the sheet's) as one undo step: the view keeps its middle and
   * its projected views follow (`rescaleSheetView`); returns a refusal's message.
   */
  rescale(scale: SheetScale | undefined): string | undefined;
  notify(tone: 'info' | 'error', text: string): void;
  onDelete(): void;
  onFinish(): void;
}

/** A selected view's card (mock-up 1). */
export function SheetViewCard({
  doc,
  sheet,
  view,
  bodies,
  choices,
  change,
  rescale,
  notify,
  onDelete,
  onFinish,
}: SheetViewCardProps) {
  const apply = (changes: SheetViewChanges, label: string) => {
    const problem = change(changes, label);
    if (problem) notify('error', problem);
  };
  const base = baseViewOf(sheet, view);
  const projected = view.from.kind === 'projected';
  const parent = view.from.kind === 'projected' ? view.from.parent : undefined;
  const followers = sheet.views.filter(
    (v) => v.from.kind === 'projected' && v.from.parent === view.id,
  );
  const current = view.from.kind === 'base' ? lookingFromOf(view.from, choices) : undefined;
  const shown = new Set(shownBodies(doc, bodies));
  const shownNow = bodies.filter((id) => shown.has(id));
  const chosen = view.bodies;
  const toggleBody = (id: BodyId, on: boolean) => {
    const was = chosen ?? shownNow;
    const next = on ? [...new Set([...was, id])] : was.filter((b) => b !== id);
    if (next.length === 0) return;
    apply({ bodies: next }, 'View bodies');
  };
  return (
    <section aria-label="View" className={CARD} style={CARD_STYLE}>
      <Heading name={view.name} kind={projected ? 'projected view' : 'base view'} />
      <div className="grid grid-cols-[86px_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5">
        <Row label="Name">
          <CommitField
            key={`${view.id}:name:${view.name}`}
            label="View name"
            value={view.name}
            maxLength={100}
            onCommit={(name) => {
              const trimmed = name.trim();
              if (trimmed === '') return 'A view needs a name.';
              if (trimmed === view.name) return undefined;
              return change({ name: trimmed }, 'Rename view');
            }}
          />
        </Row>
        {projected ? (
          <Row label="From">
            <span className="block truncate pt-1 text-sm">
              {sheet.views.find((v) => v.id === parent)?.name ?? 'A missing view'}
            </span>
          </Row>
        ) : (
          <>
            <Row label="Looking from">
              <LookingFromField
                choices={choices}
                value={current}
                onChange={(next) => {
                  // A view still called after its direction takes the new one's name.
                  const renamed =
                    current && view.name === current.name
                      ? freeName(sheet, view, next.name)
                      : undefined;
                  apply({ from: next.from, ...(renamed && { name: renamed }) }, 'View direction');
                }}
              />
            </Row>
            <Row label="Scale">
              <ScaleField
                doc={doc}
                sheet={sheet}
                value={view.scale}
                onChange={(scale) => {
                  const problem = rescale(scale);
                  if (problem) notify('error', problem);
                }}
              />
            </Row>
          </>
        )}
      </div>
      {!projected && (
        <Group label="Style">
          <Segmented
            label="Style"
            value={view.style === 'visible' ? 'visible' : 'hidden'}
            options={STYLES}
            onChange={(style) => apply({ style: style === 'hidden' ? null : style }, 'View style')}
          />
        </Group>
      )}
      <Group label="Show">
        {!projected && (
          <Switch
            checked={view.tangentEdges !== false}
            onChange={(on) => apply({ tangentEdges: on ? null : false }, 'Tangent edges')}
          >
            Tangent edges
          </Switch>
        )}
        <Switch
          checked={view.centreLines !== false}
          onChange={(on) => apply({ centreLines: on ? null : false }, 'Centre lines')}
        >
          Centre lines
        </Switch>
        <Switch
          checked={view.label === true}
          onChange={(on) => apply({ label: on ? true : null }, 'View label')}
        >
          View label
        </Switch>
      </Group>
      {!projected && (
        <Group label="Bodies">
          <label className="flex h-7 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={chosen === undefined}
              onChange={(event) =>
                apply(
                  { bodies: event.target.checked ? null : shownNow.length > 0 ? shownNow : null },
                  'View bodies',
                )
              }
              aria-label="All shown"
              className="accent-(--x-accent)"
            />
            <span>All shown</span>
          </label>
          {bodies.map((id) => {
            const on = chosen ? chosen.includes(id) : shownNow.includes(id);
            const name = doc.bodies[id]?.name ?? 'Body';
            return (
              <label key={id} className="flex h-7 cursor-pointer items-center gap-2 pl-4">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={on && (chosen ?? shownNow).length === 1}
                  onChange={(event) => toggleBody(id, event.target.checked)}
                  aria-label={name}
                  className="accent-(--x-accent)"
                />
                <span className="min-w-0 truncate">{name}</span>
              </label>
            );
          })}
          {chosen
            ?.filter((id) => !bodies.includes(id))
            .map((id) => (
              <span key={id} className="pl-4 text-sm text-error">
                {doc.bodies[id]?.name ?? 'A body'} is gone
              </span>
            ))}
        </Group>
      )}
      {followers.length > 0 && base?.id === view.id && (
        <p className="text-sm text-accent">
          {followers.map((v) => v.name).join(' and ')}{' '}
          {followers.length === 1 ? 'follows' : 'follow'} this view: it moves, scales and restyles
          with it.
        </p>
      )}
      <Button onClick={onDelete}>
        <Trash2 size={14} strokeWidth={1.75} />
        Delete
        <span className="ml-auto font-mono text-xs text-muted">Del</span>
      </Button>
      <Button
        className="border-success/60 font-semibold text-ink hover:bg-success/10"
        onClick={onFinish}
      >
        <ToolIcon name="finish-sketch" category="file" size={18} color="var(--x-success)" />
        Finish Drawing
      </Button>
    </section>
  );
}

/** `name` made unique among the sheet's other views. */
function freeName(sheet: Sheet, view: SheetView, name: string): string {
  const others = new Set(
    sheet.views.filter((v) => v.id !== view.id).map((v) => v.name.toLowerCase()),
  );
  if (!others.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) if (!others.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`;
}

/** What Base View places: its choices, kept while the tool runs. */
export interface BaseViewChoices {
  looking: string;
  scale: SheetScale | undefined;
  style: SheetViewStyle;
}

/** Base View's panel while the tool runs (plan §4.5): the choices, and what to do. */
export function BaseViewPanel({
  doc,
  sheet,
  choices,
  value,
  onChange,
  drawing,
}: {
  doc: ExtrudoDocument;
  sheet: Sheet;
  choices: readonly LookingFrom[];
  value: BaseViewChoices;
  onChange(next: BaseViewChoices): void;
  /** The frame's lines are still being drawn. */
  drawing: boolean;
}) {
  return (
    <section aria-label="Base view" className={CARD} style={CARD_STYLE}>
      <Heading name="Base View" kind="tool" />
      <div className="grid grid-cols-[86px_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5">
        <Row label="Looking from">
          <LookingFromField
            choices={choices}
            value={choices.find((c) => c.value === value.looking)}
            onChange={(next) => onChange({ ...value, looking: next.value })}
          />
        </Row>
        <Row label="Scale">
          <ScaleField
            doc={doc}
            sheet={sheet}
            value={value.scale}
            onChange={(scale) => onChange({ ...value, scale })}
          />
        </Row>
      </div>
      <Group label="Style">
        <Segmented
          label="Style"
          value={value.style === 'visible' ? 'visible' : 'hidden'}
          options={STYLES}
          onChange={(style) => onChange({ ...value, style })}
        />
      </Group>
      <p className="text-sm text-muted">
        {drawing ? 'Drawing the view…' : 'Click on the sheet to place the view. Esc ends the tool.'}
      </p>
    </section>
  );
}

/**
 * Projected View's panel while the tool runs (plan §4.5): which view it projects from and
 * what to do; before a view is chosen, how to choose one.
 */
export function ProjectedViewPanel({
  parent,
  side,
  drawing,
}: {
  /** The parent view's name; absent until one is chosen. */
  parent?: string;
  /** What the pointer's place gives ("Top"). */
  side?: string;
  drawing: boolean;
}) {
  return (
    <section aria-label="Projected view" className={CARD} style={CARD_STYLE}>
      <Heading name="Projected View" kind="tool" />
      {parent ? (
        <>
          <p className="text-sm" data-projected-next={side}>
            From <span className="font-semibold">{parent}</span>
            {side ? <span className="text-muted"> · next: {side}</span> : null}
          </p>
          <p className="text-sm text-muted">
            {drawing
              ? 'Drawing the view…'
              : 'Move beside, above or below it for the view of that side, or diagonally for an isometric. Click to place; Esc ends the tool.'}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">Click the view to project from. Esc ends the tool.</p>
      )}
    </section>
  );
}
