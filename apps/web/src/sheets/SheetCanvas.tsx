/**
 * The sheet on screen (P6-24, ADR-0143 §7): `layoutSheet`'s display list drawn as SVG
 * with `@extrudo/io`'s screen helpers, so what is on screen is what the PDF and the SVG
 * export draw. White paper on the viewport glow, with a shadow; no WebGL.
 *
 * Navigation follows the chosen mouse preset's own pan and zoom bindings (`dragAction`,
 * `wheelAction`; there is no orbit), the wheel zooms at the pointer, `fit()` shows the
 * whole sheet (F6). Moving the sheet writes the paper element's box straight to the DOM:
 * no React render per frame (ADR-0102). The SVG's `viewBox` is the paper in mm, so the
 * vectors stay sharp at every zoom.
 *
 * **Selecting** (no nav tool): the pointer pre-highlights the target under it, a click
 * selects it (Shift or Ctrl/⌘ toggles), a drag on empty paper selects what lies wholly in
 * its box, a drag on a selected item moves the selection (`onMove` once, at the end). A
 * target is what a display item's `key` belongs to (`selection.ts`), so this layer knows no
 * item kind. While dragging, the moved items' paths are shifted in the DOM; the document
 * changes once, on release.
 *
 * **Placing a view** (Base View, S2): the frame of the new view's lines follows the pointer
 * (`[data-sheet-placing]`, its transform written directly) and a click places it
 * (`onPlace` with the view's `at`); nothing is selected meanwhile. **A pointer tool** (the
 * Dimension tool, S3) hears every pointer move and click in sheet mm with the pick tolerance
 * (`pointer`) and draws what it shows in the `overlay`, sheet mm; nothing is selected
 * meanwhile. **Notices** (a view being drawn, a body gone) are written under their target's
 * frame, on screen only. **A double-click** on a target (no tool) opens it (`onOpen`: a text
 * typed in place, S4); the field is the `editor`, laid on the paper in mm. **Snapping** (S4,
 * `snap`): a dragged selection snaps to the other targets' edges and middles and a dimension
 * to rows 10 mm apart (`snap.ts`), with dashed guides (`[data-sheet-guides]`) written in the
 * DOM while dragging; a tool's own guides come in `guides`.
 *
 * Test hooks: the region "Sheet" (`data-sheet-canvas`, `data-sheet` the sheet ID,
 * `data-paper` "420x297", `data-zoom` "62%", `data-hover` and `data-selected` the targets),
 * each drawn item's `data-key` (the display item's `key`: `paper`, `border`, `title-block`,
 * `title-block:<field>`, `view:<id>`, `item:<id>`), the invisible text layer
 * (`data-sheet-text`), and the selection layer's frames (`[data-sheet-frame]` = target,
 * `data-state` `hover` or `selected`).
 */
import type { DisplayItem, DisplayList, DisplayText } from '@extrudo/io';
import { displayPaint, displayPathData, displayTextLayer } from '@extrudo/io';
import type { SheetViewLines } from '@extrudo/sheets';
import {
  memo,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import {
  dragAction,
  dragZoomFactor,
  type NavAction,
  type NavPreset,
  wheelAction,
} from '../viewport/navigation';
import {
  hitTarget,
  movable,
  type SheetBox,
  type SheetTarget,
  sheetTarget,
  targetBoxes,
  targetsInside,
} from './selection';
import {
  fitSheet,
  panSheet,
  type SheetInsets,
  type SheetView,
  sheetPoint,
  zoomSheetAt,
  zoomText,
} from './sheetView';
import { guidePath, type SnapRow, snapMove, snapTargets } from './snap';
import { sheetSnapshot } from './snapshot';
import { placedAt } from './views';

/**
 * A view being placed: its lines (when known) at scale `k`; a click calls `onPlace` with
 * the view's `at` and the sheet point. `locate` gives the `at` for a sheet point when it is
 * not "the lines' middle under the pointer" (a projected view keeps its parent's line);
 * `onPoint` hears where the pointer is (a projected view's side follows it).
 */
export interface SheetPlacing {
  lines?: SheetViewLines;
  k: number;
  locate?(point: [number, number]): [number, number];
  onPoint?(point: [number, number]): void;
  onPlace(at: [number, number], point: [number, number]): void;
}

/**
 * A tool that takes the pointer on the sheet (the Dimension tool): every move and every click
 * (a press and release without a drag), in sheet mm, with how near counts as on something.
 */
export interface SheetPointerTool {
  onPoint(point: [number, number], tolerance: number): void;
  onClick(point: [number, number], tolerance: number): void;
  onLeave?(): void;
}

/** A drag's move of each target, sheet mm. */
export type SheetMoves = ReadonlyMap<SheetTarget, readonly [number, number]>;

/** The type the browser's body rows carry when dragged (their IDs as JSON). */
export const BODIES_MIME = 'application/x-extrudo-bodies';

/** What the shell can ask of the canvas: F6 and the floating bar's Fit; Report a Bug's picture. */
export interface SheetCanvasControl {
  fit(): void;
  /** The sheet as a PNG, its longer side `size` px. */
  snapshot(size: number): Promise<Blob | null>;
  /** The sheet point (mm) under a window point. */
  sheetPoint(clientX: number, clientY: number): [number, number];
  /** How near counts as on something at this zoom, mm (5 px, at least 0.8 mm). */
  tolerance(): number;
}

export interface SheetCanvasProps {
  /** The sheet's display list; absent while the fonts load (the paper is drawn bare). */
  list: DisplayList | undefined;
  /** The sheet's ID: a new sheet is fitted on first show. */
  sheetId: string;
  paper: { width: number; height: number };
  preset: NavPreset;
  /** The floating bar's Pan or Zoom: a left drag does that. */
  tool: NavAction | undefined;
  insets: SheetInsets;
  control: RefObject<SheetCanvasControl | undefined>;
  /** Where the zoom text is shown; written directly, like the paper's box. */
  zoomLabel?: RefObject<HTMLElement | null>;
  /** A right-click without movement, at window px: the marking menu. */
  onMenu?: (at: { x: number; y: number }) => void;
  /** The selected targets (`item:<id>`, `view:<id>`, `title-block`). */
  selected?: readonly SheetTarget[];
  hovered?: SheetTarget;
  /** A person's name for a target: a view's tag. */
  nameOf?: (target: SheetTarget) => string;
  onHover?: (target: SheetTarget | undefined) => void;
  onSelect?: (targets: SheetTarget[], mode: 'replace' | 'add' | 'toggle') => void;
  /**
   * A drag of the selection ended: move these targets by (`dx`, `dy`) sheet mm. `false`
   * when nothing changed (the drawn shift is undone at once).
   */
  onMove?: (targets: SheetTarget[], dx: number, dy: number, free: boolean) => boolean;
  /**
   * How far each target and what follows it moves for a drag of (`dx`, `dy`) mm (`free`:
   * Alt held): a projected view keeps to its parent's line, and its parent's moves carry
   * it. Absent: every moved target by (`dx`, `dy`).
   */
  movesOf?: (targets: SheetTarget[], dx: number, dy: number, free: boolean) => SheetMoves;
  /** A right-click without movement on a view, at window px: its own menu. */
  onTargetMenu?: (target: SheetTarget, at: { x: number; y: number }) => void;
  /** Bodies dragged from the browser and dropped at a sheet point. */
  onDropBodies?: (ids: string[], point: [number, number]) => void;
  /** A view tool's frame following the pointer; selecting is off meanwhile. */
  placing?: SheetPlacing;
  /** A tool taking the pointer (moves and clicks); selecting is off meanwhile. */
  pointer?: SheetPointerTool;
  /** What a tool draws over the sheet, in sheet mm (no pointer events unless it asks). */
  overlay?: ReactNode;
  /** What the screen says under a target (a view being drawn, a body gone). */
  notices?: ReadonlyMap<SheetTarget, string>;
  /**
   * HTML laid on the paper (the text being typed): positioned in mm through the paper's
   * `--sheet-mm` (px per mm, written with the zoom).
   */
  editor?: ReactNode;
  /**
   * A double-click on a target with no tool running, at sheet `point` mm (plan §4.2: edit a
   * text in place; a table's cell under the point, S5).
   */
  onOpen?: (target: SheetTarget, point: [number, number]) => void;
  /**
   * Snapping a dragged selection (S4, plan §4.2), with the dimensions' rows; absent when the
   * floating bar's Snap is off.
   */
  snap?: { rows: ReadonlyMap<SheetTarget, SnapRow> };
  /** Guides to show while a tool places something (snapped), sheet mm. */
  guides?: string;
}

const NONE: readonly SheetTarget[] = [];
const NO_MOVES: SheetMoves = new Map();

/** How far a right-button press may move and still count as a click (the menu), px. */
const CLICK_SLOP = 4;

export function SheetCanvas({
  list,
  sheetId,
  paper,
  preset,
  tool,
  insets,
  control,
  zoomLabel,
  onMenu,
  selected = NONE,
  hovered,
  nameOf,
  onHover,
  onSelect,
  onMove,
  movesOf,
  onTargetMenu,
  onDropBodies,
  placing,
  pointer,
  overlay: extra,
  notices,
  editor,
  onOpen,
  snap,
  guides,
}: SheetCanvasProps) {
  const host = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const view = useRef<SheetView>({ x: 0, y: 0, scale: 1 });
  // True until the person moves the sheet: a resize then fits it again.
  const fitted = useRef(true);
  const boxes = useMemo(
    () => (list ? targetBoxes(list) : new Map<SheetTarget, SheetBox>()),
    [list],
  );
  const latest = useRef({
    paper,
    insets,
    preset,
    tool,
    onMenu,
    boxes,
    selected,
    hovered,
    placing,
    pointer,
    snap,
  });
  latest.current = {
    paper,
    insets,
    preset,
    tool,
    onMenu,
    boxes,
    selected,
    hovered,
    placing,
    pointer,
    snap,
  };
  const ghost = useRef<SVGGElement>(null);
  /** Moves the placing frame so the middle of its lines is under the sheet point. */
  const follow = (point: [number, number]) => {
    const p = latest.current.placing;
    if (!p || !ghost.current) return;
    p.onPoint?.(point);
    const [x, y] = p.locate ? p.locate(point) : placedAt(point, p.lines?.bounds, p.k);
    ghost.current.setAttribute('transform', `translate(${x} ${y})`);
    ghost.current.style.display = '';
  };
  const events = useRef({
    onHover,
    onSelect,
    onMove,
    movesOf,
    onTargetMenu,
    onDropBodies,
    onOpen,
  });
  events.current = { onHover, onSelect, onMove, movesOf, onTargetMenu, onDropBodies, onOpen };
  const svg = useRef<SVGSVGElement>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const band = useRef<SVGRectElement>(null);
  /** The sheet point under a window point. */
  const at = (clientX: number, clientY: number): [number, number] => {
    const box = host.current?.getBoundingClientRect();
    return sheetPoint(view.current, clientX - (box?.left ?? 0), clientY - (box?.top ?? 0));
  };
  /** Each target's move for a drag of the selection by (`dx`, `dy`) mm. */
  const movesFor = (targets: SheetTarget[], dx: number, dy: number, free: boolean): SheetMoves =>
    events.current.movesOf?.(targets, dx, dy, free) ??
    new Map(targets.map((t) => [t, [dx, dy] as const]));
  const guide = useRef<SVGPathElement>(null);
  /** A drag of the selection by (`dx`, `dy`) mm, snapped when Snap is on; draws its guides. */
  const snapped = (moving: SheetTarget[], dx: number, dy: number) => {
    const on = latest.current.snap;
    if (!on) return { dx, dy, guides: [] };
    const set = new Set(moving);
    const b = latest.current.boxes;
    const own = moving.length === 1 ? on.rows.get(moving[0] as SheetTarget) : undefined;
    const rows = [...on.rows].filter(([t]) => !set.has(t)).map(([, r]) => r);
    return snapMove(
      moving.flatMap((t) => b.get(t) ?? []),
      snapTargets(b, set),
      dx,
      dy,
      tolerance(),
      own,
      rows,
    );
  };
  const showGuides = (d: string) => {
    if (!guide.current) return;
    guide.current.setAttribute('d', d);
    guide.current.style.display = d ? '' : 'none';
  };
  /** Shifts the drawn paths of the moved targets (and their frames), or back with none. */
  const shift = (moves: SheetMoves) => {
    for (const root of [svg.current, overlay.current]) {
      for (const el of root?.querySelectorAll<SVGElement>('[data-key], [data-sheet-frame]') ?? []) {
        const target = sheetTarget(el.dataset.key ?? el.dataset.sheetFrame);
        const move = target === undefined ? undefined : moves.get(target);
        if (move && (move[0] !== 0 || move[1] !== 0)) {
          el.setAttribute('transform', `translate(${move[0]} ${move[1]})`);
        } else el.removeAttribute('transform');
      }
    }
  };
  // A moved selection keeps its shift until the document's new list is drawn.
  const shifted = useRef<SheetMoves>(NO_MOVES);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a new list only.
  useLayoutEffect(() => {
    if (shifted.current.size > 0) shift(NO_MOVES);
    shifted.current = NO_MOVES;
  }, [list]);

  const apply = (next: SheetView) => {
    view.current = next;
    const el = sheet.current;
    const { paper: p } = latest.current;
    if (el) {
      el.style.left = `${next.x}px`;
      el.style.top = `${next.y}px`;
      el.style.width = `${p.width * next.scale}px`;
      el.style.height = `${p.height * next.scale}px`;
      el.style.setProperty('--sheet-mm', `${next.scale}px`);
    }
    const text = zoomText(next);
    if (host.current) host.current.dataset.zoom = text;
    if (zoomLabel?.current) zoomLabel.current.textContent = text;
  };
  const fit = () => {
    const el = host.current;
    if (!el) return;
    fitted.current = true;
    apply(
      fitSheet(
        latest.current.paper,
        { width: el.clientWidth, height: el.clientHeight },
        latest.current.insets,
      ),
    );
  };
  const snapshot = async (size: number) =>
    svg.current ? sheetSnapshot(svg.current, latest.current.paper, size) : null;
  const tolerance = () => Math.max(0.8, 5 / view.current.scale);
  control.current = { fit, snapshot, sheetPoint: at, tolerance };

  // A sheet shown for the first time, or one whose paper changed, is fitted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refit when these change only.
  useLayoutEffect(() => fit(), [sheetId, paper.width, paper.height]);
  // The browser shown or hidden, the window resized: fit again unless the sheet was moved.
  // biome-ignore lint/correctness/useExhaustiveDependencies: insets by value.
  useLayoutEffect(() => {
    if (fitted.current) fit();
  }, [insets.left, insets.right, insets.top, insets.bottom]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fit` reads refs only.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (fitted.current) fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The wheel: zoom at the pointer (a trackpad's two-finger scroll pans). Not passive, so
  // the page doesn't scroll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `apply` reads refs only.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = el.getBoundingClientRect();
      const result = wheelAction(latest.current.preset, event);
      fitted.current = false;
      if (result.action === 'pan') apply(panSheet(view.current, result.dx, result.dy));
      else
        apply(
          zoomSheetAt(
            view.current,
            1 / result.factor,
            event.clientX - box.left,
            event.clientY - box.top,
          ),
        );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const drag = useRef<{
    id: number;
    action: NavAction | undefined;
    button: number;
    start: { x: number; y: number };
    last: { x: number; y: number };
    moved: boolean;
    /** A left drag with no nav tool: move these targets, or (none) a box select. */
    select?: {
      from: [number, number];
      moving: SheetTarget[];
      toggle: boolean;
      target?: SheetTarget;
    };
  }>(undefined);

  return (
    <section
      ref={host}
      aria-label="Sheet"
      data-sheet-canvas=""
      data-sheet={sheetId}
      data-paper={`${round(paper.width)}x${round(paper.height)}`}
      data-hover={hovered}
      data-selected={selected.join(' ') || undefined}
      className={`absolute inset-0 touch-none overflow-hidden select-none ${pointer ? 'cursor-crosshair' : ''}`}
      style={{ background: 'var(--x-viewport-glow)' }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        const { preset: p, tool: t } = latest.current;
        const action = dragAction(p, event, t);
        drag.current = {
          id: event.pointerId,
          action: action === 'orbit' ? undefined : action,
          button: event.button,
          start: { x: event.clientX, y: event.clientY },
          last: { x: event.clientX, y: event.clientY },
          moved: false,
        };
        if (event.button === 0 && !action && (latest.current.placing || latest.current.pointer)) {
          // A view tool or a pointer tool: the press places (clicks) on release, never selects.
        } else if (event.button === 0 && !action) {
          const { boxes: b, selected: chosen } = latest.current;
          const from = at(event.clientX, event.clientY);
          const target = hitTarget(b, from[0], from[1], Math.max(0.8, 5 / view.current.scale));
          const toggle = event.shiftKey || event.ctrlKey || event.metaKey;
          let moving: SheetTarget[] = [];
          if (target) {
            if (toggle) events.current.onSelect?.([target], 'toggle');
            else {
              if (!chosen.includes(target)) events.current.onSelect?.([target], 'replace');
              const now = chosen.includes(target) ? chosen : [target];
              moving = now.filter(movable);
            }
          }
          drag.current.select = { from, moving, toggle, ...(target && { target }) };
          // A press on a target moves (or toggles); on empty paper it starts a box.
          if (target && moving.length === 0) drag.current.select = undefined;
        }
        if (action === 'pan' || action === 'zoom' || event.button === 2 || drag.current.select) {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (latest.current.placing) follow(at(event.clientX, event.clientY));
        latest.current.pointer?.onPoint(at(event.clientX, event.clientY), tolerance());
        if (!d) {
          // No button down: pre-highlight what a click would take.
          if (event.buttons !== 0 || latest.current.placing || latest.current.pointer) return;
          const [x, y] = at(event.clientX, event.clientY);
          const { boxes: b, hovered: was } = latest.current;
          const now = hitTarget(b, x, y, Math.max(0.8, 5 / view.current.scale));
          if (now !== was) events.current.onHover?.(now);
          return;
        }
        if (d.id !== event.pointerId) return;
        const dx = event.clientX - d.last.x;
        const dy = event.clientY - d.last.y;
        d.last = { x: event.clientX, y: event.clientY };
        if (Math.hypot(event.clientX - d.start.x, event.clientY - d.start.y) > CLICK_SLOP) {
          d.moved = true;
        }
        const pick = d.select;
        if (pick && d.moved) {
          const [x, y] = at(event.clientX, event.clientY);
          if (pick.moving.length > 0) {
            const s = snapped(pick.moving, x - pick.from[0], y - pick.from[1]);
            shift(movesFor(pick.moving, s.dx, s.dy, event.altKey));
            showGuides(guidePath(s.guides));
          } else if (band.current) {
            band.current.setAttribute('x', String(Math.min(x, pick.from[0])));
            band.current.setAttribute('y', String(Math.min(y, pick.from[1])));
            band.current.setAttribute('width', String(Math.abs(x - pick.from[0])));
            band.current.setAttribute('height', String(Math.abs(y - pick.from[1])));
            band.current.style.display = '';
          }
        }
        if (!d.action) return;
        fitted.current = false;
        if (d.action === 'pan') apply(panSheet(view.current, dx, dy));
        else {
          const box = event.currentTarget.getBoundingClientRect();
          apply(
            zoomSheetAt(
              view.current,
              1 / dragZoomFactor(dy),
              d.start.x - box.left,
              d.start.y - box.top,
            ),
          );
        }
      }}
      onPointerUp={(event) => {
        const d = drag.current;
        if (!d || d.id !== event.pointerId) return;
        drag.current = undefined;
        if (d.button === 2 && !d.moved) {
          // On a view: its own menu; elsewhere the marking menu.
          const [px, py] = at(event.clientX, event.clientY);
          const under = hitTarget(
            latest.current.boxes,
            px,
            py,
            Math.max(0.8, 5 / view.current.scale),
          );
          const menu = events.current.onTargetMenu;
          if (under?.startsWith('view:') && menu)
            menu(under, { x: event.clientX, y: event.clientY });
          else latest.current.onMenu?.({ x: event.clientX, y: event.clientY });
        }
        const tap = latest.current.pointer;
        if (tap && d.button === 0 && !d.action && !d.moved) {
          tap.onClick(at(event.clientX, event.clientY), tolerance());
          return;
        }
        const place = latest.current.placing;
        if (place && d.button === 0 && !d.action && !d.moved) {
          const point = at(event.clientX, event.clientY);
          place.onPlace(
            place.locate ? place.locate(point) : placedAt(point, place.lines?.bounds, place.k),
            point,
          );
          return;
        }
        const pick = d.select;
        if (!pick) return;
        const [x, y] = at(event.clientX, event.clientY);
        if (pick.moving.length > 0) {
          // A click on one of several selected targets keeps that one alone.
          if (!d.moved) {
            if (pick.target && pick.moving.length > 1) {
              events.current.onSelect?.([pick.target], 'replace');
            }
            return;
          }
          const { dx, dy } = snapped(pick.moving, x - pick.from[0], y - pick.from[1]);
          showGuides('');
          shifted.current = movesFor(pick.moving, dx, dy, event.altKey);
          if (events.current.onMove?.(pick.moving, dx, dy, event.altKey) !== true) {
            shift(NO_MOVES);
            shifted.current = NO_MOVES;
          }
          return;
        }
        if (band.current) band.current.style.display = 'none';
        if (!d.moved) {
          // A click on empty paper clears the selection (with Shift or Ctrl it keeps it).
          if (!pick.toggle) events.current.onSelect?.([], 'replace');
          return;
        }
        const rect = {
          minX: Math.min(x, pick.from[0]),
          minY: Math.min(y, pick.from[1]),
          maxX: Math.max(x, pick.from[0]),
          maxY: Math.max(y, pick.from[1]),
        };
        events.current.onSelect?.(
          targetsInside(latest.current.boxes, rect),
          pick.toggle ? 'add' : 'replace',
        );
      }}
      onPointerCancel={() => {
        showGuides('');
        const pick = drag.current?.select;
        if (pick?.moving.length) shift(NO_MOVES);
        if (band.current) band.current.style.display = 'none';
        drag.current = undefined;
      }}
      onDragOver={(event) => {
        if (!events.current.onDropBodies || !event.dataTransfer.types.includes(BODIES_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        const drop = events.current.onDropBodies;
        if (!drop || !event.dataTransfer.types.includes(BODIES_MIME)) return;
        event.preventDefault();
        let ids: unknown;
        try {
          ids = JSON.parse(event.dataTransfer.getData(BODIES_MIME));
        } catch {
          return;
        }
        if (!Array.isArray(ids)) return;
        const bodies = ids.filter((id): id is string => typeof id === 'string');
        if (bodies.length > 0) drop(bodies, at(event.clientX, event.clientY));
      }}
      onDoubleClick={(event) => {
        const open = events.current.onOpen;
        if (!open || latest.current.placing || latest.current.pointer || latest.current.tool)
          return;
        const [x, y] = at(event.clientX, event.clientY);
        const target = hitTarget(latest.current.boxes, x, y, Math.max(0.8, 5 / view.current.scale));
        if (target) open(target, [x, y]);
      }}
      onPointerLeave={() => {
        latest.current.pointer?.onLeave?.();
        if (!drag.current && latest.current.hovered) events.current.onHover?.(undefined);
        if (ghost.current) ghost.current.style.display = 'none';
      }}
    >
      <div
        ref={sheet}
        data-sheet-paper=""
        className="absolute"
        style={{
          // Paper is white in both themes (decision 5): the sheet is what the PDF will be.
          background: '#ffffff',
          borderRadius: 2,
          boxShadow: '0 22px 44px -18px rgb(0 0 0 / 75%), 0 0 0 1px rgb(0 0 0 / 30%)',
        }}
      >
        <SheetSvg ref={svg} list={list} paper={paper} />
        <svg
          ref={overlay}
          viewBox={`0 0 ${paper.width} ${paper.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 block size-full overflow-visible"
        >
          {hovered && !selected.includes(hovered) && boxes.get(hovered) && (
            <Frame target={hovered} box={boxes.get(hovered) as SheetBox} state="hover" />
          )}
          {selected.map((target) => {
            const box = boxes.get(target);
            return (
              box && (
                <Frame
                  key={target}
                  target={target}
                  box={box}
                  state="selected"
                  {...(target.startsWith('view:') && nameOf && { tag: nameOf(target) })}
                />
              )
            );
          })}
          {notices &&
            [...notices].map(([target, text]) => {
              const box = boxes.get(target);
              return (
                box && (
                  <text
                    key={target}
                    data-sheet-notice={target}
                    x={(box.minX + box.maxX) / 2}
                    y={box.maxY + 4.5}
                    textAnchor="middle"
                    fontSize={3.2}
                    fill="var(--x-muted)"
                    fontFamily="Inter, sans-serif"
                  >
                    {text}
                  </text>
                )
              );
            })}
          {placing && <PlacingFrame ref={ghost} placing={placing} />}
          {extra}
          <path
            ref={guide}
            data-sheet-guides=""
            d={guides ?? ''}
            style={{ display: guides ? '' : 'none' }}
            fill="none"
            stroke="var(--x-accent)"
            strokeWidth={1}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
          <rect
            ref={band}
            data-sheet-band=""
            style={{ display: 'none' }}
            fill="color-mix(in srgb, var(--x-accent) 10%, transparent)"
            stroke="var(--x-accent)"
            strokeWidth={1}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {editor}
      </div>
    </section>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;

/** The display list as SVG in sheet mm: one `<path>` per item, then the invisible text. */
const SheetSvg = memo(function SheetSvg({
  list,
  paper,
  ref,
}: {
  list: DisplayList | undefined;
  paper: { width: number; height: number };
  ref?: RefObject<SVGSVGElement | null>;
}) {
  const texts = list?.items.filter((item): item is DisplayText => item.type === 'text') ?? [];
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${paper.width} ${paper.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="block size-full"
    >
      {list?.items.map((item, i) => (
        <DisplayPath
          // biome-ignore lint/suspicious/noArrayIndexKey: a list is drawn in its order.
          key={i}
          item={item}
        />
      ))}
      <g data-sheet-text="" fontFamily="Inter, sans-serif" pointerEvents="none">
        {texts.map((text, i) => (
          <text
            // biome-ignore lint/suspicious/noArrayIndexKey: a list is drawn in its order.
            key={i}
            {...displayTextLayer(text)}
            lengthAdjust="spacingAndGlyphs"
            fillOpacity={0}
            data-key={text.key}
          >
            {text.text}
          </text>
        ))}
      </g>
    </svg>
  );
});

/**
 * One item. Memoised by the item: layout gives back the same items for a view that did not
 * change, so a sheet laid out again redraws only what changed.
 */
const DisplayPath = memo(function DisplayPath({ item }: { item: DisplayItem }) {
  const contours = item.type === 'text' ? item.outline : item.contours;
  return (
    <path
      d={displayPathData(contours)}
      {...screenPaint(item)}
      data-key={item.key}
      data-state={item.state}
      opacity={item.state === 'stale' ? 0.35 : undefined}
    />
  );
});

/**
 * The paper's own error colour (the light theme's: the paper is white in both themes):
 * what a lost dimension or note is drawn in (plan §4.6).
 */
export const PAPER_ERROR = '#d93d3d';

/**
 * How an item is painted on screen: as the writers paint it, except that a `detached` item
 * (an anchor lost) is in the error colour with its lines dashed, and an `invalid` one (its
 * anchors don't make it) in the error colour (plan §4.6). The export ignores `state`.
 */
export function screenPaint(item: DisplayItem): ReturnType<typeof displayPaint> {
  const paint = displayPaint(item);
  if (item.state !== 'detached' && item.state !== 'invalid') return paint;
  const out = { ...paint };
  if (out.fill && out.fill !== 'none') out.fill = PAPER_ERROR;
  if (out.stroke) {
    out.stroke = PAPER_ERROR;
    if (item.state === 'detached') out.strokeDasharray = '1.6 1';
  }
  return out;
}

/**
 * The new view's frame and lines in the accent, from the view's origin (moved with the
 * pointer through its transform): the quick lines' box, else a placeholder's size.
 */
function PlacingFrame({
  placing,
  ref,
}: {
  placing: SheetPlacing;
  ref: RefObject<SVGGElement | null>;
}) {
  const { lines, k } = placing;
  const b = lines?.bounds;
  const [x0, y0, x1, y1] = b
    ? [k * b.min[0], -k * b.max[1], k * b.max[0], -k * b.min[1]]
    : [-30, -20, 30, 20];
  const d = useMemo(
    () =>
      lines
        ? displayPathData(
            lines.curves.filter((c) => c.kind !== 'hidden').flatMap((c) => c.contours),
          )
        : '',
    [lines],
  );
  return (
    <g ref={ref} data-sheet-placing="" style={{ display: 'none' }}>
      <rect
        x={x0 - FRAME_GAP}
        y={y0 - FRAME_GAP}
        width={x1 - x0 + 2 * FRAME_GAP}
        height={y1 - y0 + 2 * FRAME_GAP}
        rx={1}
        fill="color-mix(in srgb, var(--x-accent) 6%, transparent)"
        stroke="var(--x-accent)"
        strokeWidth={1.5}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      {d && (
        <path
          d={d}
          transform={`matrix(${k} 0 0 ${-k} 0 0)`}
          fill="none"
          stroke="var(--x-accent)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
}

/** The space between a target and its frame, mm. */
const FRAME_GAP = 1.2;

/**
 * A target's frame: the preselect tint under the pointer, a dashed accent frame when
 * selected, with a view's name in a tag above it (plan §4.2).
 */
function Frame({
  target,
  box,
  state,
  tag,
}: {
  target: SheetTarget;
  box: SheetBox;
  state: 'hover' | 'selected';
  tag?: string;
}) {
  const x = box.minX - FRAME_GAP;
  const y = box.minY - FRAME_GAP;
  return (
    <g data-sheet-frame={target} data-state={state}>
      <rect
        x={x}
        y={y}
        width={box.maxX - box.minX + 2 * FRAME_GAP}
        height={box.maxY - box.minY + 2 * FRAME_GAP}
        rx={1}
        fill={
          state === 'hover'
            ? 'color-mix(in srgb, var(--x-accent) 10%, transparent)'
            : 'color-mix(in srgb, var(--x-accent) 6%, transparent)'
        }
        stroke="var(--x-accent)"
        strokeOpacity={state === 'hover' ? 0.45 : 0.9}
        strokeWidth={state === 'hover' ? 1 : 1.5}
        strokeDasharray={state === 'selected' ? '6 4' : undefined}
        vectorEffect="non-scaling-stroke"
      />
      {tag && (
        <text
          x={x}
          y={y - 1.2}
          fontSize={3.4}
          fontWeight={600}
          fill="var(--x-accent)"
          fontFamily="Inter, sans-serif"
        >
          {tag}
        </text>
      )}
    </g>
  );
}
