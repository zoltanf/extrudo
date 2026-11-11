/**
 * The drawing's centre (P6-24, plan §3.1, §4): the sheet in place of the 3D view, its
 * floating bar (select, pan, zoom, fit, zoom %) and the right column: Sheet Setup and
 * Finish Drawing while nothing is selected, the title block's fields when it is, else a
 * card for the selection (what it is, Delete). A lazy chunk of its own: it holds
 * `@extrudo/sheets`, whose text needs the shaper (`@extrudo/sketch/text`), which never
 * reaches the entry chunk (ADR-0058 §4). The 3D view stays mounted underneath, covered.
 */
import {
  CommandError,
  type DocumentStore,
  type SessionStore,
  type SheetId,
  sheetPaperSize,
} from '@extrudo/core';
import type { DisplayList } from '@extrudo/io';
import { layoutSheet, SHEET_FONTS } from '@extrudo/sheets';
import { Hand, Maximize, MousePointer2, Trash2, ZoomIn } from 'lucide-react';
import { type RefObject, useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { Button, IconButton } from '../design-system';
import type { Preferences } from '../platform/preferences';
import { ensureUiFonts, fontsStore } from '../sketch/fonts';
import type { ViewportStore } from '../viewport/store';
import { changeSheet, finishDrawing, renameSheet, type SheetModeStores } from './mode';
import { SheetCanvas, type SheetCanvasControl } from './SheetCanvas';
import { SheetSetup } from './SheetSetup';
import {
  deleteTargets,
  moveTargets,
  type SheetTarget,
  selectedTargets,
  sheetSelection,
  targetName,
} from './selection';

export interface SheetWorkspaceProps {
  stores: SheetModeStores;
  store: DocumentStore;
  session: SessionStore;
  viewport: ViewportStore;
  sheetId: SheetId;
  /** The browser's width while shown, px: the sheet is centred in the room beside it. */
  browserInset: number;
  control: RefObject<SheetCanvasControl | undefined>;
  nameField: RefObject<HTMLInputElement | null>;
  preferences: Preferences;
  notify(tone: 'info' | 'error', text: string): void;
  onMenu?: (at: { x: number; y: number }) => void;
}

/** The right column's width and gap, px (as wide as the sketch palette). */
const COLUMN = 256 + 12;

export default function SheetWorkspace({
  stores,
  store,
  session,
  viewport,
  sheetId,
  browserInset,
  control,
  nameField,
  preferences,
  notify,
  onMenu,
}: SheetWorkspaceProps) {
  const doc = useStore(store, (s) => s.doc);
  const sheets = doc.sheets ?? [];
  const sheet = sheets.find((s) => s.id === sheetId);
  const preset = useStore(viewport, (s) => s.preset);
  const tool = useStore(viewport, (s) => s.tool);
  const fonts = useStore(fontsStore, (s) => s.version);
  const zoomLabel = useRef<HTMLOutputElement>(null);
  const selection = useStore(session, (s) => s.selection);
  const hover = useStore(session, (s) => s.hover);
  const selected = useMemo(() => selectedTargets(selection), [selection]);
  const hovered = hover?.kind === 'sheet' ? hover.id : undefined;

  useEffect(() => {
    void ensureUiFonts(SHEET_FONTS);
    // Orbit means nothing on a sheet: the floating bar has Pan and Zoom only.
    if (viewport.getState().tool === 'orbit') viewport.getState().setTool(undefined);
  }, [viewport]);

  // What is on screen is what is exported: the same list `sheetsToPdf` writes.
  const list = useMemo<DisplayList | undefined>(() => {
    if (!sheet) return undefined;
    void fonts;
    try {
      return layoutSheet(sheet, { name: doc.name, sheets });
    } catch {
      // The sheet fonts are still loading: the paper is drawn bare until they are in.
      return undefined;
    }
  }, [sheet, sheets, doc.name, fonts]);

  // What the document no longer has (undone, deleted) leaves the selection.
  useEffect(() => {
    if (!sheet || selected.length === 0) return;
    const exists = (t: SheetTarget) =>
      t === 'title-block'
        ? sheet.titleBlock !== undefined
        : t.startsWith('view:')
          ? sheet.views.some((v) => v.id === t.slice(5))
          : sheet.items.some((i) => i.id === t.slice(5));
    const left = selected.filter(exists);
    if (left.length !== selected.length) session.getState().select(sheetSelection(left));
  }, [sheet, selected, session]);

  if (!sheet) return null;
  const paper = sheetPaperSize(sheet);
  const fail = (error: unknown) => {
    if (!(error instanceof CommandError)) throw error;
    notify('error', error.message);
  };
  const remove = () => {
    try {
      deleteTargets(store, selected);
      session.getState().clearSelection();
    } catch (error) {
      fail(error);
    }
  };
  const insets = { left: browserInset, right: COLUMN, top: 0, bottom: 56 };
  const navTool = tool === 'pan' || tool === 'zoom' ? tool : undefined;
  return (
    <div className="absolute inset-0 z-[5]" data-sheet-workspace="">
      <SheetCanvas
        list={list}
        sheetId={sheet.id}
        paper={paper}
        preset={preset}
        tool={navTool}
        insets={insets}
        control={control}
        zoomLabel={zoomLabel}
        {...(onMenu && { onMenu })}
        selected={selected}
        {...(hovered && { hovered })}
        nameOf={(target) => targetName(sheet, target)}
        onHover={(target) =>
          session.getState().setHover(target ? { kind: 'sheet', id: target } : undefined)
        }
        onSelect={(targets, mode) => {
          if (targets.length === 0 && mode === 'replace') session.getState().clearSelection();
          else session.getState().select(sheetSelection(targets), mode);
        }}
        onMove={(targets, dx, dy) => {
          try {
            moveTargets(store, targets, dx, dy);
            return true;
          } catch (error) {
            fail(error);
            return false;
          }
        }}
      />
      <nav
        aria-label="Sheet navigation"
        className="absolute bottom-3 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line px-2 py-1 backdrop-blur-[6px] transition-[left] duration-(--x-normal) ease-ui"
        style={{
          left: `calc((100% - ${COLUMN}px) / 2 + ${browserInset}px / 2)`,
          background: 'color-mix(in srgb, var(--x-raised) 85%, transparent)',
        }}
      >
        <IconButton
          label="Select"
          hint="Back to the pointer: Pan and Zoom stop. Esc does too."
          pressed={navTool === undefined}
          onClick={() => viewport.getState().setTool(undefined)}
        >
          <MousePointer2 size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton
          label="Pan"
          hint="Drag with the left button to move the sheet. Esc to stop."
          pressed={navTool === 'pan'}
          onClick={() => viewport.getState().setTool(navTool === 'pan' ? undefined : 'pan')}
        >
          <Hand size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton
          label="Zoom"
          hint="Drag up or down with the left button to zoom. Esc to stop."
          pressed={navTool === 'zoom'}
          onClick={() => viewport.getState().setTool(navTool === 'zoom' ? undefined : 'zoom')}
        >
          <ZoomIn size={16} strokeWidth={1.75} />
        </IconButton>
        <div className="mx-1 h-4 w-px bg-line" />
        <IconButton
          label="Fit"
          shortcut="F6"
          hint="Fit the whole sheet in the view."
          onClick={() => control.current?.fit()}
        >
          <Maximize size={16} strokeWidth={1.75} />
        </IconButton>
        <output
          ref={zoomLabel}
          data-sheet-zoom=""
          aria-label="Zoom level"
          className="min-w-12 border-l border-line pl-2 text-center font-mono text-xs text-muted tabular-nums"
        />
      </nav>
      <div className="pointer-events-none absolute top-3 right-3 bottom-3 z-10 flex w-64 flex-col gap-2 overflow-y-auto [scrollbar-width:none]">
        {selected.length > 0 && !(selected.length === 1 && selected[0] === 'title-block') ? (
          <SelectionCard
            names={selected.map((t) => targetName(sheet, t))}
            deletable={selected.some((t) => t !== 'title-block')}
            onDelete={remove}
          />
        ) : (
          <SheetSetup
            titleBlockOnly={selected[0] === 'title-block'}
            doc={doc}
            sheet={sheet}
            change={(changes, label) => changeSheet(stores, sheet.id, changes, label)}
            rename={(name) => renameSheet(stores, sheet.id, name)}
            preferences={preferences}
            notify={notify}
            onFinish={() => finishDrawing(stores)}
            nameField={nameField}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The right column for a selection on the sheet (not the title block alone): what is
 * selected, Delete, and how to move it. The properties of each kind come with its slice.
 */
function SelectionCard({
  names,
  deletable,
  onDelete,
}: {
  names: readonly string[];
  deletable: boolean;
  onDelete(): void;
}) {
  const title = names.length === 1 ? (names[0] ?? 'Item') : `${names.length} selected`;
  return (
    <section
      aria-label="Selection"
      className="pointer-events-auto flex shrink-0 flex-col gap-3 rounded-dialog border border-line p-3 shadow-raised backdrop-blur-[6px]"
      style={{ background: 'color-mix(in srgb, var(--x-raised) 92%, transparent)' }}
    >
      <h2 className="truncate text-base font-semibold">{title}</h2>
      {names.length > 1 && (
        <ul className="flex flex-col gap-0.5 text-sm">
          {names.map((name, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: two texts may read the same.
            <li key={i} className="truncate">
              {name}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted">
        Drag to move. The arrow keys nudge by 1 mm, with Shift by 10 mm. Esc clears the selection.
      </p>
      {deletable && (
        <Button onClick={onDelete}>
          <Trash2 size={14} strokeWidth={1.75} />
          Delete
          <span className="ml-auto font-mono text-xs text-muted">Del</span>
        </Button>
      )}
    </section>
  );
}
