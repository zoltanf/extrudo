/**
 * The notes tools' right column and the cards of a selected text, leader note, sticky note,
 * centre mark or centre line (P6-24 S4, plan §4.3, §4.5).
 *
 * - **The panel** (a tool running): what to do next, the views still being drawn (nothing on
 *   them can be picked), and the next item's choices: Text its letter height, Sticky Note its
 *   colour.
 * - **The cards**: the fields the item has, each change one `updateSheetItem` step, every
 *   number an `ExpressionInput` (stored as the evaluated number): a text's Text, Letter
 *   height and Wrap width; a leader note's Text and its view; a sticky note's Text, Colour,
 *   Width, Height and Print; a centre mark's and line's view. An anchored item that is lost or
 *   moved says why and how to pick it again. Every card has Delete.
 *
 * Test hooks: the regions "Text tool", "Leader Note tool", "Sticky Note tool", "Centre Mark
 * tool", "Centreline tool" and "Text", "Leader note", "Sticky note", "Centre mark", "Centre
 * line"; `[data-note-step]` (what to do next); the textbox "Text"; the fields "Letter height",
 * "Wrap width", "Note width", "Note height"; the radio group "Colour" (radios "Yellow" …); the
 * switch "Print"; `[data-note-state]` (moved, detached or invalid); the button "Delete".
 */
import {
  type EvaluateResult,
  ExprError,
  type ExtrudoDocument,
  evaluateParameters,
  SHEET_STICKY_COLORS,
  SHEET_STICKY_MAX,
  SHEET_STICKY_MIN,
  SHEET_TEXT_MAX,
  type Sheet,
  type SheetCentreLineItem,
  type SheetCentreMarkItem,
  type SheetItemChanges,
  type SheetLeaderItem,
  type SheetStickyColor,
  type SheetStickyItem,
  type SheetTextItem,
} from '@extrudo/core';
import { SHEET_STICKY, SHEET_TEXT_SIZE } from '@extrudo/sheets';
import { Trash2 } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { Button, type IconName, type ToolCategory, ToolIcon } from '../design-system';
import { ExpressionInput } from '../parameters/ExpressionInput';
import { CommitArea, Row, Switch } from './controls';
import type { SheetItemRow } from './sheetAnchors';

const CARD =
  'pointer-events-auto flex shrink-0 flex-col gap-3 rounded-dialog border border-line p-3 shadow-raised backdrop-blur-[6px]';
const CARD_STYLE = { background: 'color-mix(in srgb, var(--x-raised) 92%, transparent)' };

/** The notes tools by their session tool ID. */
export type NoteToolId =
  | 'sheetText'
  | 'sheetLeader'
  | 'sheetSticky'
  | 'sheetCentreMark'
  | 'sheetCentreLine';

const TOOL: Readonly<
  Record<NoteToolId, { name: string; icon: IconName; category: ToolCategory; key?: string }>
> = {
  sheetText: { name: 'Text', icon: 'sheet-text', category: 'inspect', key: 'T' },
  sheetLeader: { name: 'Leader Note', icon: 'leader-note', category: 'inspect', key: 'N' },
  sheetSticky: { name: 'Sticky Note', icon: 'sticky-note', category: 'inspect' },
  sheetCentreMark: { name: 'Centre Mark', icon: 'centre-mark', category: 'sketch' },
  sheetCentreLine: { name: 'Centreline', icon: 'centreline', category: 'sketch' },
};

/** The words every text kind shares about its keys (UI spec §4a). */
export const TYPING_KEYS = 'Enter finishes, Shift+Enter starts a new line, Esc leaves it.';

const COLOUR_NAME: Readonly<Record<SheetStickyColor, string>> = {
  yellow: 'Yellow',
  orange: 'Orange',
  pink: 'Pink',
  blue: 'Blue',
  green: 'Green',
};

const fail = (expression: string, message: string): EvaluateResult => ({
  ok: false,
  error: new ExprError(message, { start: 0, end: expression.length }),
});

const num = (n: number) => String(Math.round(n * 1000) / 1000);

function Heading({
  icon,
  category,
  name,
  kind,
}: {
  icon: IconName;
  category: ToolCategory;
  name: string;
  kind?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <ToolIcon name={icon} category={category} size={18} />
      <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{name}</h2>
      {kind && <span className="font-mono text-sm whitespace-nowrap text-muted">{kind}</span>}
    </div>
  );
}

/** A length in mm from `min` to `max` (an `ExpressionInput`); empty means `none` when given. */
function LengthField({
  doc,
  label,
  value,
  min,
  max,
  placeholder,
  none,
  onChange,
}: {
  doc: ExtrudoDocument;
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  placeholder?: string;
  /** The button that clears the field ("Default"), when it may be empty. */
  none?: string;
  onChange(value: number | undefined): void;
}) {
  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  const check = (expression: string): EvaluateResult => {
    const r = evaluation.evaluate(expression, 'length');
    if (!r.ok) return r;
    return r.value >= min && r.value <= max
      ? r
      : fail(expression, `${label} is ${num(min)} to ${num(max)} mm.`);
  };
  return (
    <div className="flex items-center gap-1">
      <ExpressionInput
        key={`${label}:${value}`}
        label={label}
        value={value === undefined ? '' : `${num(value)} mm`}
        {...(placeholder && { placeholder })}
        evaluate={check}
        format={(r) => `${num(r.value)} mm`}
        onCommit={(e) => {
          const r = check(e);
          if (r.ok) onChange(r.value);
        }}
      />
      {none && value !== undefined && (
        <Button
          variant="ghost"
          className="h-7 shrink-0 px-1.5 text-xs"
          onClick={() => onChange(undefined)}
        >
          {none}
        </Button>
      )}
    </div>
  );
}

/** The five sticky colours as one choice. */
function Colours({
  value,
  onChange,
}: {
  value: SheetStickyColor;
  onChange(color: SheetStickyColor): void;
}) {
  return (
    <div role="radiogroup" aria-label="Colour" className="flex gap-1.5">
      {SHEET_STICKY_COLORS.map((color) => (
        // biome-ignore lint/a11y/useSemanticElements: a row of colour swatches.
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={color === value}
          aria-label={COLOUR_NAME[color]}
          title={COLOUR_NAME[color]}
          onClick={() => color !== value && onChange(color)}
          className="size-6 rounded-full border border-line aria-checked:ring-2 aria-checked:ring-accent aria-checked:ring-offset-1 aria-checked:ring-offset-panel"
          style={{ background: SHEET_STICKY[color].fill }}
        />
      ))}
    </div>
  );
}

function Delete({ onDelete }: { onDelete(): void }) {
  return (
    <Button onClick={onDelete}>
      <Trash2 size={14} strokeWidth={1.75} />
      Delete
      <span className="ml-auto font-mono text-xs text-muted">Del</span>
    </Button>
  );
}

/** Why an anchored item is lost, moved or can't be drawn, and what to do (plan §4.6). */
function ItemState({ row, what }: { row: SheetItemRow | undefined; what: string }) {
  const state = row?.state ?? 'ok';
  if (state === 'ok') return null;
  return (
    <>
      <p
        className={`text-sm ${state === 'moved' ? 'text-warning' : 'text-error'}`}
        data-note-state={state}
      >
        {row?.message ?? (state === 'moved' ? `It moved to matching geometry.` : '')}
      </p>
      {(state === 'detached' || state === 'moved') && (
        <p className="text-sm text-muted">Drag the round handle onto {what} to pick it again.</p>
      )}
    </>
  );
}

/** The right column while a notes tool runs. */
export function NoteToolPanel({
  tool,
  doc,
  step,
  waiting,
  textSize,
  onTextSize,
  color,
  onColor,
}: {
  tool: NoteToolId;
  doc: ExtrudoDocument;
  /** What to do next. */
  step: string;
  /** The views whose exact lines are not in yet (the anchored tools only). */
  waiting: readonly string[];
  textSize: number | undefined;
  onTextSize(size: number | undefined): void;
  color: SheetStickyColor;
  onColor(color: SheetStickyColor): void;
}) {
  const { name, icon, category, key } = TOOL[tool];
  const anchored =
    tool === 'sheetLeader' || tool === 'sheetCentreMark' || tool === 'sheetCentreLine';
  return (
    <section aria-label={`${name} tool`} className={CARD} style={CARD_STYLE}>
      <Heading icon={icon} category={category} name={name} {...(key && { kind: key })} />
      <p className="text-sm font-medium text-accent" data-note-step="" aria-live="polite">
        {step}
      </p>
      {(tool === 'sheetText' || tool === 'sheetLeader' || tool === 'sheetSticky') && (
        <p className="text-sm text-muted">{TYPING_KEYS}</p>
      )}
      {anchored && waiting.length > 0 && (
        <p className="text-sm text-muted" data-note-waiting="">
          {waiting.join(', ')} {waiting.length === 1 ? 'is' : 'are'} still being drawn: its lines
          can be picked once they are exact.
        </p>
      )}
      {tool === 'sheetText' && (
        <div className="grid grid-cols-[86px_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5">
          <Row label="Height">
            <LengthField
              doc={doc}
              label="Letter height"
              value={textSize}
              min={0.5}
              max={1000}
              placeholder={`${SHEET_TEXT_SIZE} mm`}
              none="Default"
              onChange={onTextSize}
            />
          </Row>
        </div>
      )}
      {tool === 'sheetSticky' && (
        <>
          <Colours value={color} onChange={onColor} />
          <p className="text-sm text-muted">
            On screen only until its Print switch is on: select the note to switch it.
          </p>
        </>
      )}
      {anchored && (
        <p className="border-t border-line pt-2.5 text-sm">
          It follows the model: change the model and it moves with it.
        </p>
      )}
    </section>
  );
}

/** What a card changes: one `updateSheetItem` step with its label; a refusal's message back. */
type Change = (changes: SheetItemChanges, label: string) => string | undefined;

const textProblem = (text: string) =>
  text.trim() === ''
    ? 'A note needs some text: delete it instead.'
    : text.length > SHEET_TEXT_MAX
      ? `At most ${SHEET_TEXT_MAX} characters.`
      : undefined;

function TextField({ value, change, label }: { value: string; change: Change; label: string }) {
  return (
    <CommitArea
      label="Text"
      value={value}
      maxLength={SHEET_TEXT_MAX}
      onCommit={(text) => textProblem(text) ?? change({ text } as SheetItemChanges, label)}
    />
  );
}

/** A selected text's card. */
export function TextCard({
  doc,
  item,
  change,
  onDelete,
}: {
  doc: ExtrudoDocument;
  item: SheetTextItem;
  change: Change;
  onDelete(): void;
}) {
  return (
    <section aria-label="Text" className={CARD} style={CARD_STYLE}>
      <Heading icon="sheet-text" category="inspect" name="Text" />
      <TextField value={item.text} change={change} label="Edit text" />
      <p className="text-sm text-muted">
        Double-click it on the sheet to type there. {TYPING_KEYS}
      </p>
      <div className="grid grid-cols-[86px_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5">
        <Row label="Height">
          <LengthField
            doc={doc}
            label="Letter height"
            value={item.size}
            min={0.5}
            max={1000}
            placeholder={`${SHEET_TEXT_SIZE} mm`}
            none="Default"
            onChange={(size) => change({ size: size ?? null } as SheetItemChanges, 'Text height')}
          />
        </Row>
        <Row label="Wrap at">
          <LengthField
            doc={doc}
            label="Wrap width"
            value={item.width}
            min={1}
            max={10000}
            placeholder="No wrapping"
            none="None"
            onChange={(width) =>
              change({ width: width ?? null } as SheetItemChanges, 'Text wrap width')
            }
          />
        </Row>
      </div>
      <Delete onDelete={onDelete} />
    </section>
  );
}

function ViewLine({ sheet, view, children }: { sheet: Sheet; view: string; children: ReactNode }) {
  const name = sheet.views.find((v) => v.id === view)?.name ?? 'No view';
  return (
    <p className="text-sm text-muted">
      In <span className="text-ink">{name}</span>, {children}
    </p>
  );
}

/** A selected leader note's card. */
export function LeaderCard({
  sheet,
  item,
  row,
  change,
  onDelete,
}: {
  sheet: Sheet;
  item: SheetLeaderItem;
  row: SheetItemRow | undefined;
  change: Change;
  onDelete(): void;
}) {
  const on =
    'free' in item.anchor
      ? 'a point'
      : 'silhouette' in item.anchor
        ? 'an outline'
        : item.anchor.ref.kind === 'face'
          ? 'a face'
          : item.anchor.at
            ? 'a point'
            : 'an edge';
  return (
    <section aria-label="Leader note" className={CARD} style={CARD_STYLE}>
      <Heading icon="leader-note" category="inspect" name="Leader note" />
      <ViewLine sheet={sheet} view={item.view}>
        pointing at {on} of the model.
      </ViewLine>
      <ItemState row={row} what="an edge, a point or a face" />
      <TextField value={item.text} change={change} label="Edit leader note" />
      <p className="text-sm text-muted">Double-click it on the sheet to type there.</p>
      <Delete onDelete={onDelete} />
    </section>
  );
}

/** A selected sticky note's card. */
export function StickyCard({
  doc,
  item,
  change,
  onDelete,
}: {
  doc: ExtrudoDocument;
  item: SheetStickyItem;
  change: Change;
  onDelete(): void;
}) {
  const [w, h] = item.size;
  return (
    <section aria-label="Sticky note" className={CARD} style={CARD_STYLE}>
      <Heading icon="sticky-note" category="inspect" name="Sticky note" />
      <TextField value={item.text} change={change} label="Edit sticky note" />
      <Colours
        value={item.color ?? 'yellow'}
        onChange={(color) =>
          change(
            { color: color === 'yellow' ? null : color } as SheetItemChanges,
            'Sticky note colour',
          )
        }
      />
      <div className="grid grid-cols-[86px_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5">
        <Row label="Width">
          <LengthField
            doc={doc}
            label="Note width"
            value={w}
            min={SHEET_STICKY_MIN}
            max={SHEET_STICKY_MAX}
            onChange={(v) =>
              v !== undefined && change({ size: [v, h] } as SheetItemChanges, 'Sticky note size')
            }
          />
        </Row>
        <Row label="Height">
          <LengthField
            doc={doc}
            label="Note height"
            value={h}
            min={SHEET_STICKY_MIN}
            max={SHEET_STICKY_MAX}
            onChange={(v) =>
              v !== undefined && change({ size: [w, v] } as SheetItemChanges, 'Sticky note size')
            }
          />
        </Row>
      </div>
      <Switch
        checked={item.print === true}
        onChange={(on) =>
          change(
            { print: on ? true : null } as SheetItemChanges,
            on ? 'Print sticky note' : 'Sticky note on screen only',
          )
        }
      >
        Print
      </Switch>
      <p className="text-sm text-muted">
        {item.print
          ? 'Printed and exported with the sheet.'
          : 'On screen only: left out of the PDF and SVG unless the export includes sticky notes.'}
      </p>
      <Delete onDelete={onDelete} />
    </section>
  );
}

/** A selected centre mark's or centre line's card. */
export function CentreCard({
  sheet,
  item,
  row,
  onDelete,
}: {
  sheet: Sheet;
  item: SheetCentreMarkItem | SheetCentreLineItem;
  row: SheetItemRow | undefined;
  onDelete(): void;
}) {
  const mark = item.kind === 'centreMark';
  const hidden = sheet.views.find((v) => v.id === item.view)?.centreLines === false;
  return (
    <section aria-label={mark ? 'Centre mark' : 'Centre line'} className={CARD} style={CARD_STYLE}>
      <Heading
        icon={mark ? 'centre-mark' : 'centreline'}
        category="sketch"
        name={mark ? 'Centre mark' : 'Centre line'}
        kind={mark ? 'circle' : item.anchors.length === 1 ? 'axis' : 'between'}
      />
      <ViewLine sheet={sheet} view={item.view}>
        on the model: it follows it.
      </ViewLine>
      {hidden && (
        <p className="text-sm text-muted">Hidden: the view's Centre lines switch is off.</p>
      )}
      <ItemState row={row} what={mark ? 'a circle' : 'an edge'} />
      <Delete onDelete={onDelete} />
    </section>
  );
}
