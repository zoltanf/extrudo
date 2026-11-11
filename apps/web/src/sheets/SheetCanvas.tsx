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
 * Test hooks: the region "Sheet" (`data-sheet-canvas`, `data-sheet` the sheet ID,
 * `data-paper` "420x297", `data-zoom` "62%"), each drawn item's `data-key` (the display
 * item's `key`: `paper`, `border`, `title-block`, `title-block:<field>`, `view:<id>`,
 * `item:<id>`) and the invisible text layer (`data-sheet-text`).
 */
import type { DisplayItem, DisplayList, DisplayText } from '@extrudo/io';
import { displayPaint, displayPathData, displayTextLayer } from '@extrudo/io';
import { memo, type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import {
  dragAction,
  dragZoomFactor,
  type NavAction,
  type NavPreset,
  wheelAction,
} from '../viewport/navigation';
import {
  fitSheet,
  panSheet,
  type SheetInsets,
  type SheetView,
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
}

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
}: SheetCanvasProps) {
  const host = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const view = useRef<SheetView>({ x: 0, y: 0, scale: 1 });
  // True until the person moves the sheet: a resize then fits it again.
  const fitted = useRef(true);
  const latest = useRef({ paper, insets, preset, tool, onMenu });
  latest.current = { paper, insets, preset, tool, onMenu };

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
  }>(undefined);

  return (
    <section
      ref={host}
      aria-label="Sheet"
      data-sheet-canvas=""
      data-sheet={sheetId}
      data-paper={`${round(paper.width)}x${round(paper.height)}`}
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
        if (action === 'pan' || action === 'zoom' || event.button === 2) {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (!d || d.id !== event.pointerId) return;
        const dx = event.clientX - d.last.x;
        const dy = event.clientY - d.last.y;
        d.last = { x: event.clientX, y: event.clientY };
        if (Math.hypot(event.clientX - d.start.x, event.clientY - d.start.y) > CLICK_SLOP) {
          d.moved = true;
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
      }}
      onPointerCancel={() => {
        drag.current = undefined;
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
        <SheetSvg list={list} paper={paper} />
      </div>
    </section>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;

/** The display list as SVG in sheet mm: one `<path>` per item, then the invisible text. */
const SheetSvg = memo(function SheetSvg({
  list,
  paper,
}: {
  list: DisplayList | undefined;
  paper: { width: number; height: number };
}) {
  const texts = list?.items.filter((item): item is DisplayText => item.type === 'text') ?? [];
  return (
    <svg
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
