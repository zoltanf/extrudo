/**
 * The list tools' right column and the cards of a selected parts list, balloon or free table
 * (P6-24 S5, plan §4.3, §4.5). Built on the notes' card frame (`SheetNoteCard`).
 *
 * - **The panel** (a tool running): what to do next; for Balloon which list numbers each view
 *   and what to do when the sheet has none; the views still being drawn.
 * - **Parts list**: its view; which columns are shown; per row the name and material typed
 *   over it (the model's name as the placeholder, and a way back to it); Delete, which takes
 *   its balloons along.
 * - **Balloon**: its number and the list that gives it (a choice when the sheet has more than
 *   one); why it is lost or moved, and how to pick it again; Delete.
 * - **Table**: its size, rows and columns added or removed at the end, each column's width (an
 *   `ExpressionInput`); Delete. Cells are typed on the sheet (a double-click).
 *
 * Every change is one `updateSheetItem` step.
 *
 * Test hooks: the regions "Parts List tool", "Balloon tool", "Table tool", "Parts list",
 * "Balloon", "Table"; `[data-note-step]`; the combobox "View" and "Parts list"; the checkboxes
 * named by column ("Item", "Qty", …); per row the textboxes "Name, row n" and "Material, row n"
 * and the button "Model's name, row n"; `[data-balloon-number]`; the buttons "Add row",
 * "Remove row", "Add column", "Remove column"; the fields "Column n width".
 */
import {
  type ExtrudoDocument,
  SHEET_PARTS_COLUMNS,
  type Sheet,
  type SheetBalloonItem,
  type SheetItemChanges,
  type SheetPartsColumn,
  type SheetPartsListItem,
  type SheetTableItem,
} from '@extrudo/core';
import { type SheetPartBody, sheetPartsHeader, sheetPartsRows } from '@extrudo/sheets';
import { RotateCcw } from 'lucide-react';
import { Button, Select } from '../design-system';
import { CommitField } from './controls';
import {
  partsListName,
  partsListsOf,
  withColumnAdded,
  withColumnRemoved,
  withColumnShown,
  withRowAdded,
  withRowRemoved,
  withRowText,
  withWidth,
} from './listTools';
import {
  CARD,
  CARD_STYLE,
  Delete,
  Heading,
  ItemState,
  LengthField,
  ViewLine,
} from './SheetNoteCard';
import type { SheetItemRow } from './sheetAnchors';

/** The list tools by their session tool ID. */
export type ListToolId = 'sheetPartsList' | 'sheetBalloon' | 'sheetTable';

const TOOL = {
  sheetPartsList: { name: 'Parts List', icon: 'parts-list', category: 'insert' },
  sheetBalloon: { name: 'Balloon', icon: 'balloon', category: 'inspect', key: 'B' },
  sheetTable: { name: 'Table', icon: 'sheet-table', category: 'insert' },
} as const;

/** What a card changes: one `updateSheetItem` step with its label; a refusal's message back. */
type Change = (changes: SheetItemChanges, label: string) => string | undefined;

/** The right column while a list tool runs. */
export function ListToolPanel({
  tool,
  step,
  notes = [],
  waiting = [],
}: {
  tool: ListToolId;
  /** What to do next. */
  step: string;
  /** More to know (which list numbers a view's balloons). */
  notes?: readonly string[];
  /** The views whose exact lines are not in yet (Balloon picks on them). */
  waiting?: readonly string[];
}) {
  const t = TOOL[tool];
  return (
    <section aria-label={`${t.name} tool`} className={CARD} style={CARD_STYLE}>
      <Heading
        icon={t.icon}
        category={t.category}
        name={t.name}
        {...('key' in t && { kind: t.key })}
      />
      <p className="text-sm font-medium text-accent" data-note-step="" aria-live="polite">
        {step}
      </p>
      {notes.map((note) => (
        <p key={note} className="text-sm text-muted">
          {note}
        </p>
      ))}
      {tool === 'sheetBalloon' && waiting.length > 0 && (
        <p className="text-sm text-muted" data-note-waiting="">
          {waiting.join(', ')} {waiting.length === 1 ? 'is' : 'are'} still being drawn: its lines
          can be picked once they are exact.
        </p>
      )}
      <p className="border-t border-line pt-2.5 text-sm">
        {tool === 'sheetTable'
          ? 'Double-click a cell on the sheet to type in it.'
          : 'It follows the model: change the model and its rows and numbers follow.'}
      </p>
    </section>
  );
}

/** A column's name on the card: the header's words in sentence case. */
const COLUMN_NAME: Readonly<Record<SheetPartsColumn, string>> = {
  item: 'Item',
  qty: 'Qty',
  name: 'Name',
  material: 'Material',
  size: 'Size',
  mass: 'Mass',
};

/** A selected parts list's card. */
export function PartsListCard({
  doc,
  sheet,
  item,
  bodies,
  density,
  change,
  onDelete,
}: {
  doc: ExtrudoDocument;
  sheet: Sheet;
  item: SheetPartsListItem;
  /** The view's bodies (the kernel's, with the document's names); undefined until known. */
  bodies: readonly SheetPartBody[] | undefined;
  /** The filament's density: without it the Mass column is empty. */
  density: number | undefined;
  change: Change;
  onDelete(): void;
}) {
  const shown = new Set(item.columns ?? SHEET_PARTS_COLUMNS);
  const rows = bodies ? sheetPartsRows(item, bodies) : undefined;
  // The model's own names: the rows with nothing typed over them.
  const own = bodies ? sheetPartsRows({}, bodies) : undefined;
  const balloons = sheet.items.filter((i) => i.kind === 'balloon' && i.list === item.id).length;
  return (
    <section aria-label="Parts list" className={CARD} style={CARD_STYLE}>
      <Heading icon="parts-list" category="insert" name={partsListName(sheet, item)} />
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-muted">Lists the bodies of</span>
        <Select
          aria-label="View"
          value={item.view}
          onChange={(event) =>
            change({ view: event.target.value } as SheetItemChanges, 'Parts list view')
          }
          className="h-7 text-sm"
        >
          {sheet.views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-xs text-muted">Columns</legend>
        <div className="grid grid-cols-3 gap-x-2 gap-y-1">
          {SHEET_PARTS_COLUMNS.map((column) => (
            <label key={column} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                className="accent-accent"
                checked={shown.has(column)}
                onChange={(event) => {
                  const next = withColumnShown(item.columns, column, event.target.checked);
                  if (typeof next === 'string') return;
                  change(
                    { columns: next } as SheetItemChanges,
                    event.target.checked
                      ? `Show ${COLUMN_NAME[column]}`
                      : `Hide ${COLUMN_NAME[column]}`,
                  );
                }}
              />
              {COLUMN_NAME[column]}
            </label>
          ))}
        </div>
      </fieldset>
      {shown.has('mass') && density === undefined && (
        <p className="text-sm text-muted">
          Mass needs the filament's density: choose it in Print Info.
        </p>
      )}
      {shown.has('size') && (
        <p className="text-sm text-muted">
          {sheetPartsHeader('size', doc.settings.units)}: each part's box along the model's axes,
          longest side first.
        </p>
      )}
      <div className="flex flex-col gap-2 border-t border-line pt-2.5">
        <span className="text-xs text-muted">
          Rows: type over a name or a material; empty goes back to the model's.
        </span>
        {!rows ? (
          <p className="text-sm text-muted">Reading the view's bodies…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted">The view shows no bodies.</p>
        ) : (
          rows.map((row, i) => {
            const model = own?.[i]?.name ?? row.name;
            const typedName = row.name !== model;
            const set = (field: 'name' | 'material', text: string | undefined, label: string) =>
              change(
                { rows: withRowText(item.rows, row.bodies, field, text) } as SheetItemChanges,
                label,
              );
            return (
              <div key={row.bodies[0]} className="flex flex-col gap-1" data-parts-row={row.item}>
                <span className="text-xs font-medium">
                  {row.item}
                  <span className="text-muted"> · Qty {row.qty}</span>
                </span>
                <div className="flex items-center gap-1">
                  <CommitField
                    key={`${row.bodies[0]}:name:${row.name}`}
                    label={`Name, row ${row.item}`}
                    value={typedName ? row.name : ''}
                    placeholder={model}
                    maxLength={200}
                    onCommit={(text) => set('name', text, 'Parts list name')}
                  />
                  {typedName && (
                    <Button
                      variant="ghost"
                      aria-label={`Model's name, row ${row.item}`}
                      title={`Back to “${model}”`}
                      className="h-7 shrink-0 px-1.5"
                      onClick={() => set('name', undefined, 'Parts list name')}
                    >
                      <RotateCcw size={14} strokeWidth={1.75} />
                    </Button>
                  )}
                </div>
                <CommitField
                  key={`${row.bodies[0]}:material:${row.material}`}
                  label={`Material, row ${row.item}`}
                  value={row.material}
                  placeholder="Material"
                  maxLength={200}
                  onCommit={(text) => set('material', text, 'Parts list material')}
                />
              </div>
            );
          })
        )}
      </div>
      {balloons > 0 && (
        <p className="text-sm text-muted">
          Deleting it deletes its {balloons === 1 ? 'balloon' : `${balloons} balloons`} too.
        </p>
      )}
      <Delete onDelete={onDelete} />
    </section>
  );
}

/** A selected balloon's card. */
export function BalloonCard({
  sheet,
  item,
  row,
  change,
  onDelete,
}: {
  sheet: Sheet;
  item: SheetBalloonItem;
  /** Its state and number (the row's text). */
  row: SheetItemRow | undefined;
  change: Change;
  onDelete(): void;
}) {
  const lists = partsListsOf(sheet);
  const list = lists.find((l) => l.id === item.list);
  return (
    <section aria-label="Balloon" className={CARD} style={CARD_STYLE}>
      <Heading icon="balloon" category="inspect" name="Balloon" kind={row?.text ?? '?'} />
      <p className="text-sm">
        Number{' '}
        <span className="font-mono font-semibold" data-balloon-number="">
          {row?.text ?? '?'}
        </span>
        : the row of the part it points at in{' '}
        {list ? partsListName(sheet, list).replace(/^Parts list/, 'the parts list') : 'its list'}.
      </p>
      {lists.length > 1 && (
        <Select
          aria-label="Parts list"
          value={item.list}
          onChange={(event) =>
            change({ list: event.target.value } as SheetItemChanges, 'Balloon list')
          }
          className="h-7 text-sm"
        >
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {partsListName(sheet, l)}
            </option>
          ))}
        </Select>
      )}
      <ViewLine sheet={sheet} view={item.view}>
        pointing at a part of the model.
      </ViewLine>
      <ItemState row={row} what="a part" />
      <Delete onDelete={onDelete} />
    </section>
  );
}

/** A selected free table's card. */
export function TableCard({
  doc,
  item,
  change,
  notify,
  onDelete,
}: {
  doc: ExtrudoDocument;
  item: SheetTableItem;
  change: Change;
  notify(tone: 'info' | 'error', text: string): void;
  onDelete(): void;
}) {
  const run = (changes: object | string, label: string) => {
    if (typeof changes === 'string') notify('info', changes);
    else {
      const problem = change(changes as SheetItemChanges, label);
      if (problem) notify('error', problem);
    }
  };
  const rows = item.rows.length;
  const columns = item.columns.length;
  return (
    <section aria-label="Table" className={CARD} style={CARD_STYLE}>
      <Heading icon="sheet-table" category="insert" name="Table" kind={`${rows} × ${columns}`} />
      <p className="text-sm text-muted">
        Double-click a cell on the sheet to type in it. Enter finishes, Shift+Enter starts a new
        line, Esc leaves it.
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        <Button className="h-7 text-sm" onClick={() => run(withRowAdded(item), 'Add table row')}>
          Add row
        </Button>
        <Button
          className="h-7 text-sm"
          disabled={rows <= 1}
          onClick={() => run(withRowRemoved(item), 'Remove table row')}
        >
          Remove row
        </Button>
        <Button
          className="h-7 text-sm"
          onClick={() => run(withColumnAdded(item), 'Add table column')}
        >
          Add column
        </Button>
        <Button
          className="h-7 text-sm"
          disabled={columns <= 1}
          onClick={() => run(withColumnRemoved(item), 'Remove table column')}
        >
          Remove column
        </Button>
      </div>
      <div className="grid grid-cols-[86px_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5">
        {item.columns.map((width, c) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a column is its place.
          <div key={c} className="contents">
            <span className="truncate pt-1 text-sm text-muted">Column {c + 1}</span>
            <LengthField
              doc={doc}
              label={`Column ${c + 1} width`}
              value={width}
              min={1}
              max={1000}
              onChange={(w) =>
                w !== undefined &&
                w !== width &&
                run({ columns: withWidth(item, c, w) }, 'Table column width')
              }
            />
          </div>
        ))}
      </div>
      <Delete onDelete={onDelete} />
    </section>
  );
}
