/**
 * Left-button pointer input over the view, in view pixels (P1-02, P1-09,
 * P2-03): moves, clicks, drags and selection boxes, a long press or a
 * right-click without movement (the "Select other…" menu). Sketch mode maps
 * these onto the sketch plane (`useSketchInput` in `Viewport.tsx`); model
 * mode picks in 3D (`useModelInput`).
 */
import { type RefObject, useEffect } from 'react';
import { orbit } from './camera';
import { dragAction, freeDragAction, type NavAction, ORBIT_RATE } from './navigation';
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
  /** The second of two clicks close together (a double-click, P4-03). */
  double?: boolean;
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
  /**
   * A left press held still for `LONG_PRESS_MS` ("Select other…"), or a right click without
   * movement when there is no `onContextMenu`.
   */
  onMenu?(pointer: ScreenPointer): void;
  /** A right click without movement (P3-11: the marking menu); a right drag navigates instead. */
  onContextMenu?(pointer: ScreenPointer): void;
}

/** A selection box being drawn, in view px: from the press to the pointer. */
export interface ScreenBox {
  from: readonly [number, number];
  to: readonly [number, number];
}

/** A left press that moves less than this (px) before release is a click. */
export const CLICK_SLOP = 5;
/** Two clicks within this many ms of each other, this close, are a double-click. */
export const DOUBLE_CLICK_MS = 400;
/** A left press held this long (ms) without moving opens the menu. */
export const LONG_PRESS_MS = 500;

export function usePointerInput(
  surface: RefObject<HTMLDivElement | null>,
  viewport: ViewportStore,
  handlers: PointerHandlers | undefined,
  onBoxChange: (box: ScreenBox | undefined) => void,
  onNavDrag?: (action: NavAction | undefined) => void,
) {
  useEffect(() => {
    const el = surface.current;
    if (!el || !handlers) return;
    return attachPointerInput(el, viewport, handlers, onBoxChange, window, onNavDrag);
  }, [surface, viewport, handlers, onBoxChange, onNavDrag]);
}

/**
 * `usePointerInput`'s listeners on `el` (and `win`); returns their removal.
 * Apart from the hook for unit tests. `onNavDrag` hears a left drag the preset turns into
 * navigation (Slicer's orbit, `freeDragAction`) start and end, for the cursor.
 */
export function attachPointerInput(
  el: HTMLElement,
  viewport: Pick<ViewportStore, 'getState' | 'subscribe'>,
  handlers: PointerHandlers,
  onBoxChange: (box: ScreenBox | undefined) => void,
  win: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  onNavDrag?: (action: NavAction | undefined) => void,
): () => void {
  let last: { x: number; y: number; infer: boolean; toggle: boolean } | undefined;
  let press:
    | {
        x: number;
        y: number;
        id: number;
        dragging: boolean;
        box: boolean;
        /** The drag orbits (Slicer): the camera follows the pointer from `last`. */
        nav: NavAction | undefined;
        last: { x: number; y: number };
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
  /** Whether this click follows another one closely enough to be a double-click. */
  let previousClick: { x: number; y: number; at: number } | undefined;
  const isDouble = (x: number, y: number): boolean => {
    const now = Date.now();
    const was = previousClick;
    previousClick = { x, y, at: now };
    return (
      was !== undefined &&
      now - was.at <= DOUBLE_CLICK_MS &&
      Math.hypot(x - was.x, y - was.y) <= CLICK_SLOP
    );
  };
  // Picking (and a sketch tool's drag) runs at most once per animation frame, with the
  // latest pointer; a press, release or leave flushes it first, so a click sees the hover
  // it was aimed at (ADR-0102 §2).
  let frame: number | undefined;
  const reportNow = () => {
    if (last) handlers.onMove(at(last.x, last.y, last.infer, last.toggle));
  };
  const report = () => {
    frame ??= requestAnimationFrame(() => {
      frame = undefined;
      reportNow();
    });
  };
  const flush = () => {
    if (frame === undefined) return;
    cancelAnimationFrame(frame);
    frame = undefined;
    reportNow();
  };
  const local = (x: number, y: number): [number, number] => {
    const r = el.getBoundingClientRect();
    return [x - r.left, y - r.top];
  };
  const endPress = () => {
    endNav();
    clearTimeout(press?.timer);
    press = undefined;
  };
  /**
   * Starts a drag at the press; one nobody takes becomes a selection box, or in Slicer an
   * orbit where the box would be drawn, and where nobody listens to the drag at all (plane
   * picking). A drawing tool's drag (no box, an `onDragEnd`) stays the tool's.
   */
  const startDrag = (
    x: number,
    y: number,
    infer: boolean,
    toggle: boolean,
  ): 'box' | NavAction | undefined => {
    const taken = handlers.onDragStart?.(at(x, y, infer, toggle)) ?? false;
    if (taken) return undefined;
    const free = handlers.onBox !== undefined || handlers.onDragEnd === undefined;
    const nav = free ? freeDragAction(viewport.getState().preset, toggle) : undefined;
    if (nav) return nav;
    return handlers.onBox !== undefined ? 'box' : undefined;
  };
  const startNav = (current: NonNullable<typeof press>, nav: NavAction) => {
    current.nav = nav;
    current.last = { x: current.x, y: current.y };
    onNavDrag?.(nav);
  };
  const endNav = () => {
    if (!press?.nav) return;
    press.nav = undefined;
    onNavDrag?.(undefined);
  };
  const navMove = (current: NonNullable<typeof press>, x: number, y: number) => {
    const dx = x - current.last.x;
    const dy = y - current.last.y;
    current.last = { x, y };
    if (dx === 0 && dy === 0) return;
    const { view, setView } = viewport.getState();
    setView(orbit(view, -dx * ORBIT_RATE, -dy * ORBIT_RATE));
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
      const drag = startDrag(press.x, press.y, last.infer, last.toggle);
      press.box = drag === 'box';
      if (drag && drag !== 'box') startNav(press, drag);
      // Keep the drag's events when the pointer leaves the view (synthetic pointers can't be captured).
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
    }
    if (press?.nav) {
      navMove(press, e.clientX, e.clientY);
      return;
    }
    if (press?.box) {
      onBoxChange({ from: local(press.x, press.y), to: local(e.clientX, e.clientY) });
      return;
    }
    report();
  };
  const onPointerDown = (e: PointerEvent) => {
    flush();
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
      nav: undefined,
      last: { x: e.clientX, y: e.clientY },
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
    flush();
    if (!press || e.pointerId !== press.id) return;
    const current = press;
    const navigated = current.nav !== undefined;
    endPress();
    if (current.menu || navigated) return;
    const { infer, toggle } = modifiers(e);
    if (current.box) {
      finishBox(current, e.clientX, e.clientY, toggle);
      return;
    }
    const p = at(e.clientX, e.clientY, infer, toggle);
    if (current.dragging) handlers.onDragEnd?.(p);
    else if (Math.hypot(e.clientX - current.x, e.clientY - current.y) > CLICK_SLOP) {
      // A drag whose moves were coalesced away: start and end it now.
      const drag = startDrag(current.x, current.y, infer, toggle);
      if (drag === 'box') finishBox(current, e.clientX, e.clientY, toggle);
      else if (drag === undefined) handlers.onDragEnd?.(p);
      else {
        startNav(current, drag);
        navMove(current, e.clientX, e.clientY);
        onNavDrag?.(undefined);
      }
    } else handlers.onClick({ ...p, double: isDouble(e.clientX, e.clientY) || undefined });
  };
  const onPointerCancel = (e: PointerEvent) => {
    flush();
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
        (handlers.onContextMenu ?? handlers.onMenu)?.(at(x, y, infer, toggle));
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
    flush();
    previousClick = undefined;
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
  win.addEventListener('pointerup', onWindowPointerUp);
  win.addEventListener('pointermove', onWindowPointerMove);
  win.addEventListener('keydown', onKey);
  win.addEventListener('keyup', onKey);
  const unsubscribe = viewport.subscribe((s, prev) => {
    if (s.view !== prev.view) report();
  });
  return () => {
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerCancel);
    el.removeEventListener('pointerleave', onPointerLeave);
    win.removeEventListener('pointerup', onWindowPointerUp);
    win.removeEventListener('pointermove', onWindowPointerMove);
    win.removeEventListener('keydown', onKey);
    win.removeEventListener('keyup', onKey);
    unsubscribe();
    if (frame !== undefined) cancelAnimationFrame(frame);
    clearTimeout(press?.timer);
    onBoxChange(undefined);
  };
}
