/**
 * The bottom row in the drawing (P6-24, plan §4.4): one tab per sheet in place of the
 * timeline, with a small page in the sheet's orientation and "n · name", the open one in
 * the accent. Click opens, double-click (or F2) renames, a drag onto another tab moves the
 * sheet there, `+` adds one; the right-click menu has Rename, Duplicate, Export This
 * Sheet and Delete. Ctrl+PageUp and Ctrl+PageDown are the shell's commands. The status
 * text and the bell stay on the right.
 *
 * Test hooks: the region "Sheets", the list "Sheet tabs" with a `data-sheet-tab` (the
 * sheet ID) per tab and `aria-current` on the open one, the button "New sheet", the
 * output "Status".
 */
import type { SessionStore, Sheet, SheetId } from '@extrudo/core';
import { Copy, FileDown, Plus, TextCursorInput, Trash2 } from 'lucide-react';
import { type DragEvent, useState } from 'react';
import { useStore } from 'zustand';
import {
  ContextMenu,
  IconButton,
  MenuItem,
  MenuSeparator,
  NotificationHistory,
  type NotificationStore,
} from '../design-system';
import { RenameField } from '../shell/FeatureMenu';
import { sizeLabel } from './defaults';

export interface SheetTabActions {
  open(id: SheetId): void;
  add(): void;
  rename(id: SheetId, name: string): string | undefined;
  duplicate(id: SheetId): void;
  exportOne(id: SheetId): void;
  remove(id: SheetId): void;
  move(id: SheetId, index: number): void;
}

export interface SheetTabsProps {
  sheets: readonly Sheet[];
  session: SessionStore;
  units: string;
  actions: SheetTabActions;
  notify(tone: 'info' | 'error', text: string): void;
  notifications?: NotificationStore;
  /** The timeline marker rolled back: the features the views show, of how many (plan §3.3). */
  marker?: { at: number; of: number };
}

/** The type a dragged tab carries: the sheet's ID. */
const SHEET_MIME = 'application/x-extrudo-sheet';

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * The status text: "Editing drawing · sheet 1 of 2 · A3 landscape · 1:1 · mm", and "·
 * Showing the model at feature 5 of 7" while the timeline marker is rolled back (the views
 * draw the bodies at the marker).
 */
export function sheetStatus(
  sheets: readonly Sheet[],
  id: SheetId | undefined,
  units: string,
  marker?: { at: number; of: number },
) {
  const at = sheets.findIndex((s) => s.id === id);
  const sheet = sheets[at];
  if (!sheet) return 'Editing drawing';
  const back = marker && marker.at < marker.of;
  return [
    'Editing drawing',
    `sheet ${at + 1} of ${sheets.length}`,
    `${sizeLabel(sheet.size)} ${sheet.orientation}`,
    `${num(sheet.scale[0])}:${num(sheet.scale[1])}`,
    units,
    ...(back ? [`Showing the model at feature ${marker.at} of ${marker.of}`] : []),
  ].join(' · ');
}

export function SheetTabs({
  sheets,
  session,
  units,
  actions,
  notify,
  notifications,
  marker,
}: SheetTabsProps) {
  const active = useStore(session, (s) => s.activeSheetId);
  const [renaming, setRenaming] = useState<SheetId>();
  const [over, setOver] = useState<SheetId>();
  const accepts = (event: DragEvent) => event.dataTransfer.types.includes(SHEET_MIME);
  return (
    <section
      aria-label="Sheets"
      className="flex min-h-9 items-center gap-2 border-t border-line bg-panel px-2 py-1"
    >
      <ol
        aria-label="Sheet tabs"
        className="flex min-w-0 items-center gap-1.5 overflow-x-auto py-0.5"
      >
        {sheets.map((sheet, index) => {
          const current = sheet.id === active;
          const label = `${index + 1} · ${sheet.name}`;
          return (
            <li
              key={sheet.id}
              data-sheet-tab={sheet.id}
              data-drop-over={over === sheet.id || undefined}
              className="shrink-0"
              onDragOver={(event) => {
                if (!accepts(event)) return;
                event.preventDefault();
                setOver(sheet.id);
              }}
              onDragLeave={() => setOver(undefined)}
              onDrop={(event) => {
                setOver(undefined);
                if (!accepts(event)) return;
                event.preventDefault();
                const id = event.dataTransfer.getData(SHEET_MIME) as SheetId;
                if (id && id !== sheet.id) actions.move(id, index);
              }}
            >
              {renaming === sheet.id ? (
                <RenameField
                  name={sheet.name}
                  label={`Rename ${sheet.name}`}
                  className="h-8 w-40 px-2"
                  onCommit={(name) => {
                    const problem = actions.rename(sheet.id, name);
                    if (problem) notify('error', problem);
                    return problem === undefined;
                  }}
                  onDone={() => setRenaming(undefined)}
                />
              ) : (
                <ContextMenu
                  label={`${sheet.name} menu`}
                  trigger={
                    <button
                      type="button"
                      draggable
                      aria-current={current ? 'page' : undefined}
                      title={label}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(SHEET_MIME, sheet.id);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onClick={() => actions.open(sheet.id)}
                      onDoubleClick={() => setRenaming(sheet.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'F2') {
                          event.preventDefault();
                          setRenaming(sheet.id);
                        }
                      }}
                      className={`flex h-8 max-w-56 items-center gap-2 rounded-[9px] border pr-2.5 pl-1.5 text-sm ${
                        current
                          ? 'border-accent bg-accent-soft font-semibold'
                          : 'border-line bg-bg hover:border-muted'
                      } ${over === sheet.id ? 'outline-2 outline-accent' : ''}`}
                    >
                      <PageIcon orientation={sheet.orientation} />
                      <span className="min-w-0 truncate">{label}</span>
                    </button>
                  }
                >
                  <MenuItem
                    icon={<TextCursorInput size={14} />}
                    shortcut="F2"
                    onSelect={() => setRenaming(sheet.id)}
                  >
                    Rename
                  </MenuItem>
                  <MenuItem icon={<Copy size={14} />} onSelect={() => actions.duplicate(sheet.id)}>
                    Duplicate
                  </MenuItem>
                  <MenuItem
                    icon={<FileDown size={14} />}
                    onSelect={() => actions.exportOne(sheet.id)}
                  >
                    Export This Sheet
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem icon={<Trash2 size={14} />} onSelect={() => actions.remove(sheet.id)}>
                    Delete
                  </MenuItem>
                </ContextMenu>
              )}
            </li>
          );
        })}
        <li className="shrink-0">
          <IconButton
            label="New sheet"
            hint="Add an empty sheet after this one."
            onClick={actions.add}
            className="border border-dashed border-line"
          >
            <Plus size={16} strokeWidth={1.75} />
          </IconButton>
        </li>
      </ol>
      <span className="flex-1" />
      <output className="font-mono text-[11px] whitespace-nowrap text-muted" aria-label="Status">
        {sheetStatus(sheets, active, units, marker)}
      </output>
      {notifications && <NotificationHistory store={notifications} />}
    </section>
  );
}

/** A small page in the sheet's orientation, white like the paper. */
function PageIcon({ orientation }: { orientation: Sheet['orientation'] }) {
  const landscape = orientation === 'landscape';
  const [w, h] = landscape ? [22, 16] : [16, 22];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" className="shrink-0">
      <rect
        x=".5"
        y=".5"
        width={w - 1}
        height={h - 1}
        rx="1.5"
        fill="#ffffff"
        stroke="var(--x-muted)"
      />
      <path
        d={landscape ? 'M13 10h6v3h-6Z' : 'M7 16h6v3H7Z'}
        fill="none"
        stroke="#111318"
        strokeWidth=".8"
      />
    </svg>
  );
}
