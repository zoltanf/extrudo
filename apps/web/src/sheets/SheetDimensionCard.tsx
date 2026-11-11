/**
 * The Dimension tool's right column and a selected dimension's card (P6-24 S3, plan §4.3,
 * mock-up 3), and what the tool draws over the sheet.
 *
 * - **The panel** (the tool running): what to pick next, the views still being drawn (their
 *   quick lines can't be picked), and the choices the next dimension is placed with:
 *   Direction (Auto, Horizontal, Vertical, Aligned), Decimals, In brackets, Before, After.
 * - **The card** (one dimension selected): its text, its view and, when it is not ok, why;
 *   the same fields, each change one undo step; Delete. Arrows inside or outside are not
 *   offered: the layout puts them outside by itself when there is no room between the
 *   extension lines, and the item has no field for it.
 * - **The overlay**: what a click takes (the accent, faint), what is picked (the accent), a
 *   vertex as a diamond, and the dimension following the pointer in the preview colour with
 *   "Click to place".
 *
 * Test hooks: the regions "Dimension tool" and "Dimension"; `[data-dimension-step]` (what to
 * pick next); the radio group "Direction" (radios "Auto", "Horizontal", "Vertical", "Aligned");
 * the field "Decimals" (an `ExpressionInput`), the switch "In brackets (reference)", the
 * textboxes "Text before" and "Text after", the button "Delete"; in the overlay
 * `[data-dimension-hover]` (the pickable's key, `data-end` at a vertex), `[data-dimension-picked]`,
 * `[data-dimension-preview]` (its text in `data-text`).
 */
import {
  type EvaluateResult,
  ExprError,
  type ExtrudoDocument,
  evaluateParameters,
  SHEET_AFFIX_MAX,
  SHEET_DECIMALS_MAX,
  type Sheet,
  type SheetDimensionDirection,
  type SheetDimensionItem,
  type Vec2,
} from '@extrudo/core';
import { type DisplayItem, displayPaint, displayPathData } from '@extrudo/io';
import { Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { Button, ToolIcon } from '../design-system';
import { ExpressionInput } from '../parameters/ExpressionInput';
import { CommitField, Row, Segmented, Switch } from './controls';
import type { DimensionChoices, SheetPickable } from './dimensionTool';
import { nextStep } from './dimensionTool';
import type { SheetItemRow } from './sheetAnchors';
import type { PickToolState } from './usePickTool';

const CARD =
  'pointer-events-auto flex shrink-0 flex-col gap-3 rounded-dialog border border-line p-3 shadow-raised backdrop-blur-[6px]';
const CARD_STYLE = { background: 'color-mix(in srgb, var(--x-raised) 92%, transparent)' };

/** The paper's preview colour (mock-up 3): the dimension following the pointer. */
export const PAPER_PREVIEW = '#2f86f0';
/** The paper's accent for what is picked (the brand's orange; the paper is white in both themes). */
const PAPER_ACCENT = '#e08a1e';

const DIRECTIONS: { value: SheetDimensionDirection | 'auto'; label: string; name?: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'horizontal', label: 'Horiz.', name: 'Horizontal' },
  { value: 'vertical', label: 'Vert.', name: 'Vertical' },
  { value: 'aligned', label: 'Aligned' },
];

const fail = (expression: string, message: string): EvaluateResult => ({
  ok: false,
  error: new ExprError(message, { start: 0, end: expression.length }),
});

function Heading({ name, kind }: { name: string; kind: string }) {
  return (
    <div className="flex items-center gap-2">
      <ToolIcon name="sheet-dimension" category="sketch" size={18} />
      <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{name}</h2>
      <span className="font-mono text-sm whitespace-nowrap text-muted">{kind}</span>
    </div>
  );
}

/**
 * The fields a dimension has (plan §4.3): Direction (a linear one only), Decimals (empty: the
 * sheet's), In brackets, Before, After. `onChange` gets one change and its undo label.
 */
function DimensionFields({
  doc,
  sheet,
  value,
  linear,
  onChange,
}: {
  doc: ExtrudoDocument;
  sheet: Sheet;
  value: DimensionChoices;
  linear: boolean;
  onChange(changes: Partial<DimensionChoices>, label: string): string | undefined;
}) {
  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  const decimals = (expression: string): EvaluateResult => {
    const r = evaluation.evaluate(expression, 'unitless');
    if (!r.ok) return r;
    return Number.isInteger(r.value) && r.value >= 0 && r.value <= SHEET_DECIMALS_MAX
      ? r
      : fail(expression, `Decimals are a whole number from 0 to ${SHEET_DECIMALS_MAX}.`);
  };
  const affix = (text: string) =>
    text.length > SHEET_AFFIX_MAX ? `At most ${SHEET_AFFIX_MAX} characters.` : undefined;
  return (
    <>
      {linear && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">
            Direction
          </span>
          <Segmented
            label="Direction"
            value={value.direction}
            options={DIRECTIONS}
            onChange={(direction) => onChange({ direction }, 'Dimension direction')}
          />
        </div>
      )}
      <div className="grid grid-cols-[86px_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5">
        <Row label="Decimals">
          <div className="flex items-center gap-1">
            <ExpressionInput
              key={`d:${value.decimals}`}
              label="Decimals"
              value={value.decimals === undefined ? '' : String(value.decimals)}
              placeholder={`${sheet.decimals} (the sheet's)`}
              evaluate={decimals}
              format={(r) => String(r.value)}
              onCommit={(e) => {
                const r = decimals(e);
                if (r.ok) onChange({ decimals: r.value }, 'Dimension decimals');
              }}
            />
            {value.decimals !== undefined && (
              <Button
                variant="ghost"
                className="h-7 shrink-0 px-1.5 text-xs"
                onClick={() => onChange({ decimals: undefined }, 'Dimension decimals')}
              >
                Sheet's
              </Button>
            )}
          </div>
        </Row>
        <Row label="Before">
          <CommitField
            key={`b:${value.before ?? ''}`}
            label="Text before"
            value={value.before ?? ''}
            maxLength={SHEET_AFFIX_MAX}
            onCommit={(text) =>
              affix(text) ?? onChange({ before: text || undefined }, 'Dimension text')
            }
          />
        </Row>
        <Row label="After">
          <CommitField
            key={`a:${value.after ?? ''}`}
            label="Text after"
            value={value.after ?? ''}
            maxLength={SHEET_AFFIX_MAX}
            onCommit={(text) =>
              affix(text) ?? onChange({ after: text || undefined }, 'Dimension text')
            }
          />
        </Row>
      </div>
      <Switch
        checked={value.reference === true}
        onChange={(on) => onChange({ reference: on || undefined }, 'Dimension brackets')}
      >
        In brackets (reference)
      </Switch>
    </>
  );
}

/** The right column while the Dimension tool runs (mock-up 3). */
export function DimensionPanel({
  doc,
  sheet,
  tool,
  waiting,
  lost,
  value,
  onChange,
}: {
  doc: ExtrudoDocument;
  sheet: Sheet;
  tool: PickToolState;
  /** The views whose exact lines are not in yet: nothing on them can be picked. */
  waiting: readonly string[];
  /** Some dimension on the sheet is lost. */
  lost: boolean;
  value: DimensionChoices;
  onChange(value: DimensionChoices): void;
}) {
  return (
    <section aria-label="Dimension tool" className={CARD} style={CARD_STYLE}>
      <Heading name="Dimension" kind="D" />
      <p className="text-sm text-muted">
        Pick an edge, two edges or points, or a circle. Then click where the number goes.
      </p>
      <p className="text-sm font-medium text-accent" data-dimension-step="" aria-live="polite">
        {tool.busy ? 'Reading the pick…' : nextStep(tool.picks)}
      </p>
      {waiting.length > 0 && (
        <p className="text-sm text-muted" data-dimension-waiting="">
          {waiting.join(', ')} {waiting.length === 1 ? 'is' : 'are'} still being drawn: its lines
          can be picked once they are exact.
        </p>
      )}
      <DimensionFields
        doc={doc}
        sheet={sheet}
        value={value}
        linear
        onChange={(changes) => {
          onChange({ ...value, ...changes });
          return undefined;
        }}
      />
      <p className="border-t border-line pt-2.5 text-sm">
        The number is measured from the model. Change the model and it follows.
      </p>
      {lost && (
        <p className="text-sm text-error">
          A red dimension lost its edge. Drag an end onto an edge, or delete it.
        </p>
      )}
    </section>
  );
}

/** One dimension's choices as the fields show them. */
export function choicesOf(item: SheetDimensionItem): DimensionChoices {
  return {
    direction: item.direction ?? 'auto',
    ...(item.decimals !== undefined && { decimals: item.decimals }),
    ...(item.before !== undefined && { before: item.before }),
    ...(item.after !== undefined && { after: item.after }),
    ...(item.reference && { reference: true }),
  };
}

/**
 * The document change for one field: `null` takes a field away (`updateSheetItem`'s
 * `changes`), Auto takes the direction away.
 */
export function dimensionChanges(
  changes: Partial<DimensionChoices>,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'direction') out.direction = value === 'auto' ? null : (value as string);
    else out[key] = value === undefined ? null : (value as string | number | boolean);
  }
  return out;
}

/** A selected dimension's card (plan §4.3). */
export function DimensionCard({
  doc,
  sheet,
  item,
  row,
  change,
  onDelete,
}: {
  doc: ExtrudoDocument;
  sheet: Sheet;
  item: SheetDimensionItem;
  row: SheetItemRow | undefined;
  change(changes: Partial<DimensionChoices>, label: string): string | undefined;
  onDelete(): void;
}) {
  const view = sheet.views.find((v) => v.id === item.view)?.name ?? 'No view';
  const kind =
    item.type === 'linear'
      ? 'length'
      : item.type === 'angle'
        ? 'angle'
        : item.type === 'radius'
          ? 'radius'
          : 'diameter';
  const state = row?.state ?? 'ok';
  return (
    <section aria-label="Dimension" className={CARD} style={CARD_STYLE}>
      <Heading name={row?.text ?? 'Dimension'} kind={kind} />
      <p className="text-sm text-muted">
        In <span className="text-ink">{view}</span>, measured from the model.
      </p>
      {state !== 'ok' && row?.message && (
        <p
          className={`text-sm ${state === 'moved' ? 'text-warning' : 'text-error'}`}
          data-dimension-state={state}
        >
          {row.message}
        </p>
      )}
      {state === 'detached' && (
        <p className="text-sm text-muted">
          Drag its end onto an edge to pick it again, or delete it.
        </p>
      )}
      {state === 'moved' && !row?.message && (
        <p className="text-sm text-warning" data-dimension-state={state}>
          It moved to a matching edge: drag an end onto an edge to pick it again.
        </p>
      )}
      <DimensionFields
        doc={doc}
        sheet={sheet}
        value={choicesOf(item)}
        linear={item.type === 'linear'}
        onChange={change}
      />
      <Button onClick={onDelete}>
        <Trash2 size={14} strokeWidth={1.75} />
        Delete
        <span className="ml-auto font-mono text-xs text-muted">Del</span>
      </Button>
    </section>
  );
}

const pathOf = (p: SheetPickable) =>
  p.paths
    .map((path) => path.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(''))
    .join('');

/** A vertex's diamond, sheet mm. */
function Diamond({ at, solid }: { at: Vec2; solid?: boolean }) {
  return (
    <rect
      x={at[0] - 1}
      y={at[1] - 1}
      width={2}
      height={2}
      transform={`rotate(45 ${at[0]} ${at[1]})`}
      fill={solid ? PAPER_ACCENT : '#ffffff'}
      stroke={PAPER_ACCENT}
      strokeWidth={1.5}
      vectorEffect="non-scaling-stroke"
    />
  );
}

/** Display items in the paper's preview colour (an item following the pointer), sheet mm. */
export function PreviewItems({ items }: { items: readonly DisplayItem[] }) {
  return (
    <g pointerEvents="none">
      {items.map((item, i) => {
        const paint = displayPaint(item);
        return (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: the layout's order.
            key={i}
            d={displayPathData(item.type === 'text' ? item.outline : item.contours)}
            {...paint}
            {...(paint.fill && paint.fill !== 'none' && { fill: PAPER_PREVIEW })}
            {...(paint.stroke && { stroke: PAPER_PREVIEW })}
          />
        );
      })}
    </g>
  );
}

/** What a pick tool (Dimension, Leader Note, Centre Mark, Centreline) draws over the sheet, sheet mm. */
export function DimensionOverlay({
  tool,
  points,
}: {
  tool: PickToolState;
  /** The picked vertices, sheet mm. */
  points: readonly Vec2[];
}) {
  const { hover, picked, preview, pointer } = tool;
  const hoverEnd = hover?.end !== undefined ? hover.pickable.ends[hover.end] : undefined;
  return (
    <g pointerEvents="none">
      {picked.map((p) => (
        <path
          key={p.key}
          data-dimension-picked={p.key}
          d={pathOf(p)}
          fill="none"
          stroke={PAPER_ACCENT}
          strokeWidth={3}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {hover && (
        <path
          data-dimension-hover={hover.pickable.key}
          data-end={hover.end}
          d={pathOf(hover.pickable)}
          fill="none"
          stroke={PAPER_ACCENT}
          strokeOpacity={hoverEnd ? 0.3 : 0.55}
          strokeWidth={3}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {points.map((p) => (
        <Diamond key={`${p[0]},${p[1]}`} at={p} solid />
      ))}
      {hoverEnd && <Diamond at={hoverEnd} />}
      {hover?.pickable.kind === 'face' && hover.at && (
        <circle
          data-face-hover={hover.pickable.key}
          cx={hover.at[0]}
          cy={hover.at[1]}
          r={1.2}
          fill={PAPER_ACCENT}
          fillOpacity={0.55}
          stroke="#ffffff"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {preview && (
        <g data-dimension-preview="" data-text={preview.text}>
          <PreviewItems items={preview.items} />
        </g>
      )}
      {preview && pointer && (
        <g transform={`translate(${pointer[0] + 3} ${pointer[1] + 3})`}>
          <rect width={27} height={6} rx={1.5} fill="#111318" />
          <text x={2.2} y={4.1} fontSize={3.2} fill="#ffffff" fontFamily="Inter, sans-serif">
            Click to place
          </text>
        </g>
      )}
    </g>
  );
}
