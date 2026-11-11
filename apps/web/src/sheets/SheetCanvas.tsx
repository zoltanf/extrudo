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
 * Test hooks: the region "Sheet" (`data-sheet-canvas`, `data-sheet` the sheet ID,
 * `data-paper` "420x297", `data-zoom` "62%", `data-hover` and `data-selected` the targets),
 * each drawn item's `data-key` (the display item's `key`: `paper`, `border`, `title-block`,
 * `title-block:<field>`, `view:<id>`, `item:<id>`), the invisible text layer
 * (`data-sheet-text`), and the selection layer's frames (`[data-sheet-frame]` = target,
 * `data-state` `hover` or `selected`).
 */
import type { DisplayItem, DisplayList, DisplayText } from '@extrudo/io';
import { displayPaint, displayPathData, displayTextLayer } from '@extrudo/io';
import { memo, type RefObject, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  dragAction,
  dragZoomFactor,
  type NavAction,
  type NavPreset,
  wheelAction,
} from '../viewport/navigation';
import {
  hitTarget,
  keyOfTarget,
  movable,
  type SheetBox,
  type SheetTarget,
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

/** What the shell can ask of the canvas: F6 and the floating bar's Fit. */
export interface SheetCanvasControl {
  fit(): void;
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
  onMove?: (targets: SheetTarget[], dx: number, dy: number) => boolean;
}

const NONE: readonly SheetTarget[] = [];

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
  const latest = useRef({ paper, insets, preset, tool, onMenu, boxes, selected, hovered });
  latest.current = { paper, insets, preset, tool, onMenu, boxes, selected, hovered };
  const events = useRef({ onHover, onSelect, onMove });
  events.current = { onHover, onSelect, onMove };
  const svg = useRef<SVGSVGElement>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const band = useRef<SVGRectElement>(null);
  /** The sheet point under a window point. */
  const at = (clientX: number, clientY: number): [number, number] => {
    const box = host.current?.getBoundingClientRect();
    return sheetPoint(view.current, clientX - (box?.left ?? 0), clientY - (box?.top ?? 0));
  };
  /** Shifts the drawn paths of `targets` (and their frames) by (`dx`, `dy`) mm, or back. */
  const shift = (targets: readonly SheetTarget[], dx: number, dy: number) => {
    const transform = dx === 0 && dy === 0 ? null : `translate(${dx} ${dy})`;
    for (const root of [svg.current, overlay.current]) {
      for (const el of root?.querySelectorAll<SVGElement>('[data-key], [data-sheet-frame]') ?? []) {
        const key = el.dataset.key ?? el.dataset.sheetFrame;
        if (!targets.some((t) => keyOfTarget(key, t))) continue;
        if (transform) el.setAttribute('transform', transform);
        else el.removeAttribute('transform');
      }
    }
  };
  // A moved selection keeps its shift until the document's new list is drawn.
  const shifted = useRef<readonly SheetTarget[]>(NONE);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a new list only.
  useLayoutEffect(() => {
    if (shifted.current.length > 0) shift(shifted.current, 0, 0);
    shifted.current = NONE;
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
  control.current = { fit };

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
      className="absolute inset-0 touch-none overflow-hidden select-none"
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
        if (event.button === 0 && !action) {
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
        if (!d) {
          // No button down: pre-highlight what a click would take.
          if (event.buttons !== 0) return;
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
            shift(pick.moving, x - pick.from[0], y - pick.from[1]);
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
          latest.current.onMenu?.({ x: event.clientX, y: event.clientY });
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
          const dx = x - pick.from[0];
          const dy = y - pick.from[1];
          shifted.current = pick.moving;
          if (events.current.onMove?.(pick.moving, dx, dy) !== true) {
            shift(pick.moving, 0, 0);
            shifted.current = NONE;
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
        const pick = drag.current?.select;
        if (pick?.moving.length) shift(pick.moving, 0, 0);
        if (band.current) band.current.style.display = 'none';
        drag.current = undefined;
      }}
      onPointerLeave={() => {
        if (!drag.current && latest.current.hovered) events.current.onHover?.(undefined);
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

function DisplayPath({ item }: { item: DisplayItem }) {
  const contours = item.type === 'text' ? item.outline : item.contours;
  return <path d={displayPathData(contours)} {...displayPaint(item)} data-key={item.key} />;
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
