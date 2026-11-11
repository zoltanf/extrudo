/**
 * The drawing in the browser (P6-24, plan §3.1, §3.2).
 *
 * - **Drawings** (the model's tree, below Annotations): always shown, "No sheets yet"
 *   when empty, like Sketches; a row per sheet, double-click or Enter opens it, F2
 *   renames, its menu has Open, Rename, Duplicate, Export and Delete.
 * - **Sheets** (in the drawing, before Bodies): a folder per sheet, the open one marked
 *   "editing", with its views, a Dimensions folder (S3), a Notes folder (S4: texts, leader
 *   notes, balloons, sticky notes, centre marks and lines), a Tables folder (S5: parts lists
 *   and free tables) and its title block; a click on a
 *   sheet opens it. A dimension's row reads its text and its view ("74 · Front"); on the
 *   open sheet a moved one has a warning ("moved") and a lost one is red ("lost its edge"),
 *   the reason in its tooltip (`sheetItemsStore`, what the workspace found).
 *
 * Test hooks: the folders "Drawings" and "Sheets", each sheet's row `data-sheet-row` (the
 * sheet ID), a view's `data-sheet-view-row`, the folders "Dimensions", "Notes" and "Tables", an item's
 * `data-sheet-item-row` (the item ID) with `data-state` (`ok`, `moved`, `detached`,
 * `invalid`), the title block's `data-sheet-title-row`.
 */
import type { Sheet, SheetDimensionItem, SheetId, SheetItem } from '@extrudo/core';
import { Copy, FileDown, FolderOpen, TextCursorInput, Trash2, TriangleAlert } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';
import { useStore } from 'zustand';
import { ContextMenu, MenuItem, MenuSeparator, ToolIcon } from '../design-system';
import { Folder, Leaf } from '../shell/BrowserPanel';
import { RenameField } from '../shell/FeatureMenu';
import { sizeLabel } from './defaults';
import { type SheetItemRow, sheetItemsStore } from './sheetAnchors';

export interface SheetRowActions {
  open(id: SheetId): void;
  rename(id: SheetId, name: string): string | undefined;
  duplicate(id: SheetId): void;
  exportOne(id: SheetId): void;
  remove(id: SheetId): void;
  notify(tone: 'info' | 'error', text: string): void;
  /** A click on a view's or the title block's row selects it on its sheet (opening that sheet). */
  select?(id: SheetId, target: string): void;
}

const sheetIcon = <ToolIcon name="sheets" category="export" size={16} />;

/** The model's Drawings folder. */
export function SheetsFolder({
  sheets,
  actions,
}: {
  sheets: readonly Sheet[];
  actions: SheetRowActions;
}) {
  return (
    <Folder label="Drawings" icon={sheetIcon} count={sheets.length}>
      {sheets.length === 0 ? (
        <Leaf muted>No sheets yet</Leaf>
      ) : (
        sheets.map((sheet, index) => (
          <SheetLeaf key={sheet.id} sheet={sheet} index={index} actions={actions} />
        ))
      )}
    </Folder>
  );
}

function SheetLeaf({
  sheet,
  index,
  actions,
}: {
  sheet: Sheet;
  index: number;
  actions: SheetRowActions;
}) {
  const [renaming, setRenaming] = useState(false);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'F2') setRenaming(true);
    else if (event.key === 'Enter') actions.open(sheet.id);
    else if (event.key === 'Delete' || event.key === 'Backspace') actions.remove(sheet.id);
    else return;
    // Handled here: not a shortcut for the view as well.
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <ContextMenu
      label={`${sheet.name} menu`}
      disabled={renaming}
      trigger={
        <Leaf
          data-sheet-row={sheet.id}
          onDoubleClick={renaming ? undefined : () => actions.open(sheet.id)}
        >
          {renaming ? (
            <RenameField
              name={sheet.name}
              label={`Rename ${sheet.name}`}
              className="h-6 min-w-0 flex-1 px-1"
              onCommit={(name) => {
                const problem = actions.rename(sheet.id, name);
                if (problem) actions.notify('error', problem);
                return problem === undefined;
              }}
              onDone={() => setRenaming(false)}
            />
          ) : (
            <button
              type="button"
              onKeyDown={onKeyDown}
              className="min-w-0 truncate rounded-input text-left focus-visible:outline-2 focus-visible:outline-accent"
            >
              {index + 1} · {sheet.name}
            </button>
          )}
          {!renaming && (
            <span className="ml-auto pr-1 font-mono text-xs whitespace-nowrap text-muted">
              {sizeLabel(sheet.size)}
            </span>
          )}
        </Leaf>
      }
    >
      <SheetMenuItems sheet={sheet} actions={actions} onRename={() => setRenaming(true)} open />
    </ContextMenu>
  );
}

function SheetMenuItems({
  sheet,
  actions,
  onRename,
  open,
}: {
  sheet: Sheet;
  actions: SheetRowActions;
  onRename(): void;
  open?: boolean;
}) {
  return (
    <>
      {open && (
        <MenuItem icon={<FolderOpen size={14} />} onSelect={() => actions.open(sheet.id)}>
          Open
        </MenuItem>
      )}
      <MenuItem icon={<TextCursorInput size={14} />} shortcut="F2" onSelect={onRename}>
        Rename
      </MenuItem>
      <MenuItem icon={<Copy size={14} />} onSelect={() => actions.duplicate(sheet.id)}>
        Duplicate
      </MenuItem>
      <MenuItem icon={<FileDown size={14} />} onSelect={() => actions.exportOne(sheet.id)}>
        Export
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Trash2 size={14} />} onSelect={() => actions.remove(sheet.id)}>
        Delete
      </MenuItem>
    </>
  );
}

/** The drawing's Sheets tree: a folder per sheet with its views and title block. */
export function SheetsTree({
  sheets,
  active,
  selected,
  actions,
}: {
  sheets: readonly Sheet[];
  active: SheetId | undefined;
  /** The targets selected on the open sheet. */
  selected?: readonly string[];
  actions: SheetRowActions;
}) {
  const isSelected = (sheet: Sheet, target: string) =>
    sheet.id === active && (selected ?? []).includes(target);
  return (
    <Folder label="Sheets" icon={sheetIcon} count={sheets.length}>
      {sheets.map((sheet) => (
        <Folder
          key={sheet.id}
          nested
          label={sheet.name}
          // The open sheet's dot is the accent's (its tab is, too).
          icon={
            <span
              className={`size-2 rounded-full ${sheet.id === active ? 'bg-accent' : 'bg-muted/60'}`}
            />
          }
          defaultOpen={sheet.id === active}
          attrs={{
            'data-sheet-row': sheet.id,
            'data-sheet-active': sheet.id === active ? '' : undefined,
          }}
          onSelect={() => actions.open(sheet.id)}
          rename={{
            onCommit: (name) => {
              const problem = actions.rename(sheet.id, name);
              if (problem) actions.notify('error', problem);
              return problem === undefined;
            },
          }}
          menu={
            <>
              <MenuItem icon={<Copy size={14} />} onSelect={() => actions.duplicate(sheet.id)}>
                Duplicate
              </MenuItem>
              <MenuItem icon={<FileDown size={14} />} onSelect={() => actions.exportOne(sheet.id)}>
                Export
              </MenuItem>
              <MenuItem icon={<Trash2 size={14} />} onSelect={() => actions.remove(sheet.id)}>
                Delete
              </MenuItem>
            </>
          }
        >
          {sheet.views.length === 0 ? (
            <Leaf muted>No views yet</Leaf>
          ) : (
            sheet.views.map((view) => (
              <Leaf
                key={view.id}
                data-sheet-view-row={view.id}
                active={isSelected(sheet, `view:${view.id}`)}
              >
                <button
                  type="button"
                  className="min-w-0 truncate rounded-input text-left focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => actions.select?.(sheet.id, `view:${view.id}`)}
                >
                  {view.name}
                </button>
              </Leaf>
            ))
          )}
          <DimensionRows
            sheet={sheet}
            isSelected={(target) => isSelected(sheet, target)}
            onSelect={(target) => actions.select?.(sheet.id, target)}
          />
          <NoteRows
            sheet={sheet}
            isSelected={(target) => isSelected(sheet, target)}
            onSelect={(target) => actions.select?.(sheet.id, target)}
          />
          <TableRows
            sheet={sheet}
            isSelected={(target) => isSelected(sheet, target)}
            onSelect={(target) => actions.select?.(sheet.id, target)}
          />
          {sheet.titleBlock && (
            <Leaf data-sheet-title-row={sheet.id} active={isSelected(sheet, 'title-block')}>
              <button
                type="button"
                className="min-w-0 truncate rounded-input text-left focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => actions.select?.(sheet.id, 'title-block')}
              >
                Title block
              </button>
            </Leaf>
          )}
        </Folder>
      ))}
    </Folder>
  );
}

/** What a dimension's row says after its text and view, by its state. */
const ROW_NOTE: Partial<Record<SheetItemRow['state'], string>> = {
  moved: 'moved',
  detached: 'lost its edge',
  invalid: "can't be measured",
};

/** A sheet's Dimensions folder: one row per dimension, which selects it on its sheet. */
function DimensionRows({
  sheet,
  isSelected,
  onSelect,
}: {
  sheet: Sheet;
  isSelected(target: string): boolean;
  onSelect(target: string): void;
}) {
  const open = useStore(sheetItemsStore, (s) => (s.sheet === sheet.id ? s.rows : undefined));
  const dimensions = sheet.items.filter((i): i is SheetDimensionItem => i.kind === 'dimension');
  if (dimensions.length === 0) return null;
  return (
    <Folder
      nested
      label="Dimensions"
      icon={<ToolIcon name="sheet-dimension" category="sketch" size={16} />}
      count={dimensions.length}
    >
      {dimensions.map((item) => {
        const row = open?.get(item.id);
        const state = row?.state ?? 'ok';
        const view = sheet.views.find((v) => v.id === item.view)?.name ?? 'No view';
        const note = ROW_NOTE[state];
        const warn = state !== 'ok';
        return (
          <Leaf
            key={item.id}
            data-sheet-item-row={item.id}
            data-state={state}
            active={isSelected(`item:${item.id}`)}
            className={state === 'detached' || state === 'invalid' ? 'text-error' : ''}
          >
            <button
              type="button"
              title={row?.message}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-input text-left focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => onSelect(`item:${item.id}`)}
            >
              <span className="shrink-0 font-mono text-xs">{row?.text ?? 'Dimension'}</span>
              <span className={`min-w-0 truncate ${warn ? '' : 'text-muted'}`}>
                {note ? `${view} · ${note}` : view}
              </span>
            </button>
            {warn && (
              <TriangleAlert
                size={14}
                strokeWidth={1.75}
                aria-label={row?.message ?? note}
                className={`ml-auto shrink-0 ${state === 'moved' ? 'text-warning' : ''}`}
              />
            )}
          </Leaf>
        );
      })}
    </Folder>
  );
}

/** The items the Notes folder lists (S4): texts, leader notes, sticky notes, centre marks and lines. */
const NOTE_KINDS: ReadonlySet<SheetItem['kind']> = new Set([
  'text',
  'leader',
  'balloon',
  'sticky',
  'centreMark',
  'centreLine',
]);

/** A note's row: what it is, and what it reads (its first line; a balloon's number). */
function noteLabel(
  item: SheetItem,
  row: SheetItemRow | undefined,
): { kind: string; text?: string } {
  const first = 'text' in item ? item.text.split('\n')[0]?.trim() : undefined;
  switch (item.kind) {
    case 'text':
      return { kind: 'Text', ...(first && { text: first }) };
    case 'leader':
      return { kind: 'Leader note', ...(first && { text: first }) };
    case 'sticky':
      return {
        kind: item.print ? 'Sticky note' : 'Sticky note · on screen only',
        ...(first && { text: first }),
      };
    case 'centreMark':
      return { kind: 'Centre mark' };
    case 'centreLine':
      return { kind: 'Centre line' };
    case 'balloon':
      return { kind: `Balloon ${row?.text ?? '?'}` };
    default:
      return { kind: 'Item' };
  }
}

/** What a note's row says after its kind when it is not ok. */
const NOTE_STATE: Partial<Record<SheetItemRow['state'], string>> = {
  moved: 'moved',
  detached: 'lost',
  invalid: "can't be drawn",
};

/**
 * A sheet's Notes folder (S4, plan §3.1): one row per text, leader note, sticky note, centre
 * mark and centre line, in the sheet's order; a click selects it on its sheet. A leader
 * note, centre mark or line on the open sheet says when it is moved or lost (its tooltip why).
 */
function NoteRows({
  sheet,
  isSelected,
  onSelect,
}: {
  sheet: Sheet;
  isSelected(target: string): boolean;
  onSelect(target: string): void;
}) {
  const open = useStore(sheetItemsStore, (s) => (s.sheet === sheet.id ? s.rows : undefined));
  const notes = sheet.items.filter((i) => NOTE_KINDS.has(i.kind));
  if (notes.length === 0) return null;
  return (
    <Folder
      nested
      label="Notes"
      icon={<ToolIcon name="leader-note" category="inspect" size={16} />}
      count={notes.length}
    >
      {notes.map((item) => {
        const row = open?.get(item.id);
        const state = row?.state ?? 'ok';
        const view =
          'view' in item
            ? (sheet.views.find((v) => v.id === item.view)?.name ?? 'No view')
            : undefined;
        const { kind, text } = noteLabel(item, row);
        const note = NOTE_STATE[state];
        const warn = state !== 'ok';
        const after = [view, note].filter(Boolean).join(' · ');
        return (
          <Leaf
            key={item.id}
            data-sheet-item-row={item.id}
            data-state={state}
            active={isSelected(`item:${item.id}`)}
            className={state === 'detached' || state === 'invalid' ? 'text-error' : ''}
          >
            <button
              type="button"
              title={row?.message ?? text}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-input text-left focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => onSelect(`item:${item.id}`)}
            >
              <span className="shrink-0">{text ? `“${text}”` : kind}</span>
              <span className={`min-w-0 truncate ${warn ? '' : 'text-muted'}`}>
                {text ? [kind, after].filter(Boolean).join(' · ') : after}
              </span>
            </button>
            {warn && (
              <TriangleAlert
                size={14}
                strokeWidth={1.75}
                aria-label={row?.message ?? note}
                className={`ml-auto shrink-0 ${state === 'moved' ? 'text-warning' : ''}`}
              />
            )}
          </Leaf>
        );
      })}
    </Folder>
  );
}

/**
 * A sheet's Tables folder (S5; plan §3.1 names "parts list" beside the notes, the Drawing
 * tab groups them as Tables): one row per parts list ("Parts list · Front") and per free
 * table ("Table · 3 × 2"), in the sheet's order; a click selects it on its sheet.
 */
function TableRows({
  sheet,
  isSelected,
  onSelect,
}: {
  sheet: Sheet;
  isSelected(target: string): boolean;
  onSelect(target: string): void;
}) {
  const tables = sheet.items.filter((i) => i.kind === 'partsList' || i.kind === 'table');
  if (tables.length === 0) return null;
  return (
    <Folder
      nested
      label="Tables"
      icon={<ToolIcon name="parts-list" category="insert" size={16} />}
      count={tables.length}
    >
      {tables.map((item) => {
        const kind = item.kind === 'partsList' ? 'Parts list' : 'Table';
        const after =
          item.kind === 'partsList'
            ? (sheet.views.find((v) => v.id === item.view)?.name ?? 'No view')
            : item.kind === 'table'
              ? `${item.rows.length} × ${item.columns.length}`
              : '';
        return (
          <Leaf
            key={item.id}
            data-sheet-item-row={item.id}
            data-state="ok"
            active={isSelected(`item:${item.id}`)}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-input text-left focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => onSelect(`item:${item.id}`)}
            >
              <span className="shrink-0">{kind}</span>
              <span className="min-w-0 truncate text-muted">{after}</span>
            </button>
          </Leaf>
        );
      })}
    </Folder>
  );
}
