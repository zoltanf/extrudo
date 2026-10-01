/**
 * The right-click menu of constraint glyphs and dimension labels (P3-17, ADR-0042 open item).
 * Glyphs and labels sit over the view and let the right button through to it (a right drag
 * pans or orbits), so the menu opens on a right click without movement, heard on the window
 * as the view's own marking menu is (`viewport/pointer.ts`): the navigation captures the
 * release.
 */
import type { SelectionItem, SessionStore } from '@extrudo/core';
import { Pencil, Trash2 } from 'lucide-react';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { keysFor } from '../../commands/keymap';
import { MenuItem, PointMenu } from '../../design-system';
import { CLICK_SLOP } from '../../viewport/pointer';

/**
 * What a right click on an annotation selects: nothing new when it is already selected (the
 * menu acts on the whole selection, like Delete), else just that annotation.
 */
export function menuSelection(
  selection: readonly SelectionItem[],
  item: SelectionItem,
): SelectionItem[] | undefined {
  return selection.some((s) => s.kind === item.kind && s.id === item.id) ? undefined : [item];
}

/** A right press and its release: a click when it moved no more than the view's slop. */
export function isRightClick(
  press: { x: number; y: number },
  release: { clientX: number; clientY: number },
): boolean {
  return Math.hypot(release.clientX - press.x, release.clientY - press.y) <= CLICK_SLOP;
}

type Listener = { current: ((e: globalThis.PointerEvent) => void) | undefined };

function stopListening(listener: Listener) {
  if (listener.current) window.removeEventListener('pointerup', listener.current, true);
  listener.current = undefined;
}

interface OpenMenu {
  at: { x: number; y: number };
  item: SelectionItem;
}

export interface AnnotationMenuOptions {
  session: SessionStore;
  /** False while a tool runs: no menu (the right button still navigates). */
  interactive: boolean;
  /** Deletes the selection (`deleteSelection`, with the shell's error toast). */
  onDelete?(): void;
  /** Edits a dimension's value in place (dimension labels only). */
  onEdit?(item: SelectionItem): void;
}

/**
 * `onPointerDown(item)` for each glyph or label, and the menu to draw once in the layer.
 * The menu has Delete (the selection) and, for dimensions, Edit Value.
 */
export function useAnnotationMenu({
  session,
  interactive,
  onDelete,
  onEdit,
}: AnnotationMenuOptions) {
  const [open, setOpen] = useState<OpenMenu>();
  const listener = useRef<(e: globalThis.PointerEvent) => void>(undefined);
  const stop = () => stopListening(listener);
  useEffect(() => () => stopListening(listener), []);
  // A tool that starts closes the menu.
  useEffect(() => {
    if (!interactive) setOpen(undefined);
  }, [interactive]);

  const onPointerDown = (item: SelectionItem) => (event: PointerEvent<Element>) => {
    if (event.button !== 2 || !interactive) return;
    stop();
    const press = { x: event.clientX, y: event.clientY, id: event.pointerId };
    const up = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== press.id || e.button !== 2) return;
      stop();
      if (!isRightClick(press, e)) return;
      const select = menuSelection(session.getState().selection, item);
      if (select) session.getState().select(select, 'replace');
      setOpen({ at: { x: press.x, y: press.y }, item });
    };
    listener.current = up;
    window.addEventListener('pointerup', up, true);
  };

  const remove = keysFor('delete')[0]?.replace('Delete', 'Del');
  const menu = (
    <PointMenu
      at={open?.at}
      onClose={() => setOpen(undefined)}
      label={open?.item.kind === 'dimension' ? 'Dimension menu' : 'Constraint menu'}
    >
      {open?.item.kind === 'dimension' && onEdit && (
        <MenuItem icon={<Pencil size={14} />} onSelect={() => onEdit(open.item)}>
          Edit Value
        </MenuItem>
      )}
      <MenuItem
        icon={<Trash2 size={14} />}
        shortcut={remove}
        disabled={!onDelete}
        onSelect={() => onDelete?.()}
      >
        Delete
      </MenuItem>
    </PointMenu>
  );
  return { onPointerDown, menu, open: open !== undefined };
}
