/**
 * Left-button pointer input over the view, in view pixels (P1-02, P1-09,
 * P2-03): moves, clicks, drags and selection boxes, a long press or a
 * right-click without movement (the "Select other…" menu). Sketch mode maps
 * these onto the sketch plane (`useSketchInput` in `Viewport.tsx`); model
 * mode picks in 3D (`useModelInput`).
 */
import { type RefObject, useEffect } from 'react';
import { dragAction } from './navigation';
import type { ViewportStore } from './store';

/** A pointer over the view. */
export interface ScreenPointer {
  /** px from the view's top-left corner. */
  x: number;
  y: number;
  /** The view's size, px. */
  width: number;
  height: number;
  /** Inference on: no Ctrl or ⌘ held. */
  infer: boolean;
  /** Shift, Ctrl or ⌘ held: add to or toggle the selection. */
  toggle: boolean;
}

export interface PointerHandlers {
  onMove(pointer: ScreenPointer): void;
  /** A left click that didn't turn into a drag. */
  onClick(pointer: ScreenPointer): void;
  /**
   * A left press that turned into a drag, at the press position. Returns
   * true if the drag is taken (it then ends with `onDragEnd`); one nobody
   * takes draws a selection box when there is `onBox`.
   */
  onDragStart?(pointer: ScreenPointer): boolean;
  onDragEnd?(pointer: ScreenPointer): void;
  /** A selection box from `from` (the press) to `to` (the release). */
  onBox?(from: ScreenPointer, to: ScreenPointer): void;
  onLeave(): void;
  /** A left press held still for `LONG_PRESS_MS`, or a right click without movement. */
  onMenu?(pointer: ScreenPointer): void;
}

/** A selection box being drawn, in view px: from the press to the pointer. */
export interface ScreenBox {
  from: readonly [number, number];
  to: readonly [number, number];
}

/** A left press that moves less than this (px) before release is a click. */
export const CLICK_SLOP = 5;
/** A left press held this long (ms) without moving opens the menu. */
export const LONG_PRESS_MS = 500;

export function usePointerInput(
  surface: RefObject<HTMLDivElement | null>,
  viewport: ViewportStore,
  handlers: PointerHandlers | undefined,
  onBoxChange: (box: ScreenBox | undefined) => void,
) {
  useEffect(() => {
    const el = surface.current;
    if (!el || !handlers) return;
    let last: { x: number; y: number; infer: boolean; toggle: boolean } | undefined;
    let press:
      | {
          x: number;
          y: number;
          id: number;
          dragging: boolean;
          box: boolean;
          /** The long press opened the menu: the release does nothing. */
          menu: boolean;
          timer: ReturnType<typeof setTimeout> | undefined;
        }
      | undefined;
    let rightPress: { x: number; y: number; id: number } | undefined;

    const at = (x: number, y: number, infer: boolean, toggle: boolean): ScreenPointer => {
      const r = el.getBoundingClientRect();
      return { x: x - r.left, y: y - r.top, width: r.width, height: r.height, infer, toggle };
    };
    const report = () => {
      if (last) handlers.onMove(at(last.x, last.y, last.infer, last.toggle));
    };
    const local = (x: number, y: number): [number, number] => {
      const r = el.getBoundingClientRect();
      return [x - r.left, y - r.top];
    };
    const endPress = () => {
      clearTimeout(press?.timer);
      press = undefined;
    };
    /** Starts a drag at the press; one nobody takes becomes a selection box. */
    const startDrag = (x: number, y: number, infer: boolean, toggle: boolean): boolean => {
      const taken = handlers.onDragStart?.(at(x, y, infer, toggle)) ?? false;
      return !taken && handlers.onBox !== undefined;
    };
    const finishBox = (from: { x: number; y: number }, x: number, y: number, toggle: boolean) => {
      onBoxChange(undefined);
      handlers.onBox?.(at(from.x, from.y, false, toggle), at(x, y, false, toggle));
    };

    const modifiers = (e: PointerEvent | KeyboardEvent) => ({
      infer: !(e.ctrlKey || e.metaKey),
      toggle: e.shiftKey || e.ctrlKey || e.metaKey,
    });
    const onPointerMove = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY, ...modifiers(e) };
      // A press whose release we never saw (it came up over the nav bar or a menu) is over:
      // without this, the next move over the view with no button held opened a box.
      if (press && e.pointerId === press.id && (e.buttons & 1) === 0) {
        if (press.box) onBoxChange(undefined);
        endPress();
      }
      if (
        press &&
        !press.dragging &&
        !press.menu &&
        e.pointerId === press.id &&
        Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP
      ) {
        clearTimeout(press.timer);
        press.dragging = true;
        press.box = startDrag(press.x, press.y, last.infer, last.toggle);
        // Keep the drag's events when the pointer leaves the view (synthetic pointers can't be captured).
        try {
          el.setPointerCapture(e.pointerId);
        } catch {}
      }
      if (press?.box) {
        onBoxChange({ from: local(press.x, press.y), to: local(e.clientX, e.clientY) });
        return;
      }
      report();
    };
    const onPointerDown = (e: PointerEvent) => {
      const s = viewport.getState();
      if (e.button === 2) {
        rightPress = { x: e.clientX, y: e.clientY, id: e.pointerId };
        return;
      }
      if (e.button !== 0 || dragAction(s.preset, e, s.tool)) return;
      endPress();
      const current = {
        x: e.clientX,
        y: e.clientY,
        id: e.pointerId,
        dragging: false,
        box: false,
        menu: false,
        timer: undefined as ReturnType<typeof setTimeout> | undefined,
      };
      if (handlers.onMenu) {
        const { infer, toggle } = modifiers(e);
        current.timer = setTimeout(() => {
          if (press !== current || current.dragging) return;
          current.menu = true;
          handlers.onMenu?.(at(current.x, current.y, infer, toggle));
        }, LONG_PRESS_MS);
      }
      press = current;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return;
      const current = press;
      endPress();
      if (current.menu) return;
      const { infer, toggle } = modifiers(e);
      if (current.box) {
        finishBox(current, e.clientX, e.clientY, toggle);
        return;
      }
      const p = at(e.clientX, e.clientY, infer, toggle);
      if (current.dragging) handlers.onDragEnd?.(p);
      else if (Math.hypot(e.clientX - current.x, e.clientY - current.y) > CLICK_SLOP) {
        // A drag whose moves were coalesced away: start and end it now.
        if (startDrag(current.x, current.y, infer, toggle)) {
          finishBox(current, e.clientX, e.clientY, toggle);
        } else handlers.onDragEnd?.(p);
      } else handlers.onClick(p);
    };
    const onPointerCancel = (e: PointerEvent) => {
      if (press?.box && e.pointerId === press.id) onBoxChange(undefined);
      if (press && e.pointerId === press.id) endPress();
    };
    // A release outside the view (not captured: the press hadn't become a drag yet, or the
    // pointer couldn't be captured) ends the press there: a drag or box finishes, a press
    // that never moved is dropped rather than taken for a click.
    const onWindowPointerUp = (e: PointerEvent) => {
      if (e.button === 2 && rightPress && e.pointerId === rightPress.id) {
        // A right click without movement (a right drag orbits in some presets). The release
        // may be captured by the navigation, so it is heard on the window.
        const { x, y } = rightPress;
        rightPress = undefined;
        if (Math.hypot(e.clientX - x, e.clientY - y) <= CLICK_SLOP) {
          const { infer, toggle } = modifiers(e);
          handlers.onMenu?.(at(x, y, infer, toggle));
        }
        return;
      }
      if (!press || e.pointerId !== press.id) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      if (press.dragging) onPointerUp(e);
      else endPress();
    };
    const onWindowPointerMove = (e: PointerEvent) => {
      if (
        rightPress &&
        e.pointerId === rightPress.id &&
        Math.hypot(e.clientX - rightPress.x, e.clientY - rightPress.y) > CLICK_SLOP
      ) {
        rightPress = undefined;
      }
    };
    const onPointerLeave = () => {
      last = undefined;
      handlers.onLeave();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!last || !['Control', 'Meta', 'Shift'].includes(e.key)) return;
      last = { ...last, ...modifiers(e) };
      report();
    };

    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    const unsubscribe = viewport.subscribe((s, prev) => {
      if (s.view !== prev.view) report();
    });
    return () => {
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      unsubscribe();
      clearTimeout(press?.timer);
      onBoxChange(undefined);
    };
  }, [surface, viewport, handlers, onBoxChange]);
}
