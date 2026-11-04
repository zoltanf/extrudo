/**
 * The annotations over the 3D view (P6-23, ADR-0126 §6): one callout per note, the badge
 * with its number and the text cut to three lines, a leader from a dot at the anchor to the
 * callout's nearest edge. The text is always visible (the owner's choice), unless "Numbers
 * only" is on or the note is done; a note the part hides is a faint badge ("ghosted").
 *
 * The callouts are React, but their positions follow the camera imperatively (a store
 * subscription writing `style.transform`, as the ViewCube does), so orbiting re-renders
 * nothing. Whether the part hides an anchor is asked of the view's picking code after the
 * camera settles and after a recompute, never every frame.
 *
 * Test hooks: `data-annotations` on the layer ("<number>:<status>:<state>", state
 * `full|done|ghost|hidden`), and per callout `data-annotation`, `data-annotation-behind`,
 * `data-annotation-text`; `data-annotation-editor` on the in-place editor.
 */
import {
  type Annotation,
  type AnnotationId,
  addAnnotation,
  CommandError,
  type DocumentStore,
  type ModelStore,
  newId,
  removeAnnotation,
  type SelectionItem,
  type SessionStore,
  updateAnnotation,
} from '@extrudo/core';
import { Check, Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useStore } from 'zustand';
import { useKeysFor } from '../commands/keymapStore';
import { MenuItem, PointMenu } from '../design-system';
import { isRightClick, menuSelection } from '../sketch/tools/glyphMenu';
import { viewProject } from '../viewport/camera';
import type { ViewportStore } from '../viewport/store';
import { type PlacedAnnotation, placeAnnotations, type Vec3 } from './anchor';
import { boxOffset, calloutBox, leaderEnd, type Screen } from './layout';
import type { AnnotationsUiStore } from './ui';

/** A press turns into a drag after this many pixels (as a dimension label's). */
const DRAG_PX = 3;
/** The view counts as settled this long after the camera last moved, ms. */
const SETTLE_MS = 150;

export interface AnnotationsOverlayProps {
  store: DocumentStore;
  session: SessionStore;
  model: ModelStore<unknown>;
  viewport: ViewportStore;
  ui: AnnotationsUiStore;
  /** False while a dialog, a sketch or another tool owns the pointer: callouts let it through. */
  interactive: boolean;
  onError(message: string): void;
}

type State = 'full' | 'done' | 'ghost' | 'hidden';

interface Drawn {
  id: string;
  number: number;
  at: Vec3;
  annotation: Annotation | undefined;
  offset: Screen | undefined;
}

interface Press {
  id: string;
  x: number;
  y: number;
  /** The callout's top-left when the press began, px in the layer. */
  left: number;
  bottom: number;
  moved: boolean;
}

const isAnnotation = (items: readonly (SelectionItem | undefined)[], id: string) =>
  items.some((i) => i?.kind === 'annotation' && i.id === id);

export function AnnotationsOverlay({
  store,
  session,
  model,
  viewport,
  ui,
  interactive,
  onError,
}: AnnotationsOverlayProps) {
  const doc = useStore(store, (s) => s.doc);
  const reports = useStore(model, (s) => s.annotations);
  const sketches = useStore(model, (s) => s.sketches);
  const shown = useStore(viewport, (s) => s.annotations);
  const behindMode = useStore(viewport, (s) => s.annotationsBehind);
  const textMode = useStore(viewport, (s) => s.annotationText);
  const occluded = useStore(viewport, (s) => s.occluded);
  const selection = useStore(session, (s) => s.selection);
  const hover = useStore(session, (s) => s.hover);
  const editing = useStore(ui, (s) => s.editing);
  const draft = useStore(ui, (s) => s.draft);

  const placed = useMemo(() => placeAnnotations(doc, reports, sketches), [doc, reports, sketches]);
  const visible = useMemo(
    () => (shown ? placed.filter((p) => !p.annotation.hidden) : []),
    [placed, shown],
  );
  const drawn = useMemo<Drawn[]>(() => {
    const list: Drawn[] = visible.map(({ annotation, at }) => ({
      id: annotation.id,
      number: annotation.number,
      at,
      annotation,
      offset: annotation.offset,
    }));
    if (draft)
      list.push({
        id: '',
        number: draft.number,
        at: draft.at,
        annotation: undefined,
        offset: undefined,
      });
    return list;
  }, [visible, draft]);

  const layer = useRef<HTMLDivElement>(null);
  // Which anchors the part hides, asked after the camera settles and after a recompute.
  const [behind, setBehind] = useState<ReadonlySet<string>>(new Set());
  const drawnRef = useRef(drawn);
  drawnRef.current = drawn;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `drawn` and `occluded` are what make it look again (a note added or moved, a recompute); the check reads them through the ref and the store.
  useEffect(() => {
    const check = () => {
      const list = drawnRef.current.filter((d) => d.annotation);
      const test = viewport.getState().occluded;
      if (!test || list.length === 0) {
        setBehind((b) => (b.size === 0 ? b : new Set()));
        return;
      }
      const el = layer.current;
      const size = { width: el?.clientWidth ?? 0, height: el?.clientHeight ?? 0 };
      const hidden = test(
        list.map((d) => d.at),
        size,
      );
      const next = new Set(list.filter((_, i) => hidden[i]).map((d) => d.id));
      setBehind((b) => (b.size === next.size && [...next].every((id) => b.has(id)) ? b : next));
    };
    check();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = viewport.subscribe((s, prev) => {
      if (s.view === prev.view && s.width === prev.width && s.aspect === prev.aspect) return;
      clearTimeout(timer);
      timer = setTimeout(check, SETTLE_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [viewport, drawn, occluded]);

  const status = (p: PlacedAnnotation) => p.status;
  const states = new Map<string, State>();
  for (const d of drawn) {
    if (!d.annotation) continue;
    const engaged =
      isAnnotation(selection, d.id) ||
      (hover?.kind === 'annotation' && hover.id === d.id) ||
      editing === d.id;
    states.set(
      d.id,
      !engaged && behindMode === 'ghost' && behind.has(d.id)
        ? 'ghost'
        : d.annotation.done && !engaged
          ? 'done'
          : 'full',
    );
  }
  const summary = [...(doc.annotations ?? [])]
    .sort((a, b) => a.number - b.number)
    .map((a) => {
      const p = placed.find((x) => x.annotation.id === a.id);
      return `${a.number}:${p ? status(p) : 'ok'}:${states.get(a.id) ?? 'hidden'}`;
    })
    .join(' ');

  // Positions follow the camera imperatively.
  const elements = useRef(new Map<string, HTMLDivElement>());
  const leaders = useRef(new Map<string, SVGGElement>());
  const press = useRef<Press | undefined>(undefined);
  const dragged = useRef<{ id: string; left: number; bottom: number } | undefined>(undefined);
  const place = useRef<() => void>(() => {});
  place.current = () => {
    const el = layer.current;
    if (!el) return;
    const width = el.clientWidth;
    const height = el.clientHeight;
    if (width === 0 || height === 0) return;
    const { view, projection } = viewport.getState();
    for (const d of drawnRef.current) {
      const box = elements.current.get(d.id);
      const leader = leaders.current.get(d.id);
      if (!box) continue;
      const ndc = viewProject(view, projection, width / height, d.at);
      if (!ndc) {
        box.style.visibility = 'hidden';
        if (leader) leader.style.visibility = 'hidden';
        continue;
      }
      const p: Screen = [((ndc[0] + 1) / 2) * width, ((1 - ndc[1]) / 2) * height];
      const size = { width: box.offsetWidth, height: box.offsetHeight };
      const drag = dragged.current?.id === d.id ? dragged.current : undefined;
      const rect = drag
        ? { left: drag.left, top: drag.bottom - size.height, ...size }
        : calloutBox(p, size, d.offset, { width, height });
      box.style.visibility = '';
      box.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
      box.dataset.anchor = `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
      if (!leader) continue;
      const ghost = box.dataset.annotationBehind !== undefined;
      leader.style.visibility = ghost ? 'hidden' : '';
      const [ex, ey] = leaderEnd(p, rect);
      const line = leader.firstElementChild as SVGLineElement | null;
      const dot = leader.lastElementChild as SVGCircleElement | null;
      line?.setAttribute('x1', String(p[0]));
      line?.setAttribute('y1', String(p[1]));
      line?.setAttribute('x2', String(ex));
      line?.setAttribute('y2', String(ey));
      dot?.setAttribute('cx', String(p[0]));
      dot?.setAttribute('cy', String(p[1]));
    }
  };
  useLayoutEffect(() => {
    place.current();
  });
  useLayoutEffect(() => {
    const el = layer.current;
    if (!el) return;
    const observer = new ResizeObserver(() => place.current());
    observer.observe(el);
    const unsubscribe = viewport.subscribe((s, prev) => {
      if (s.view !== prev.view || s.projection !== prev.projection) place.current();
    });
    return () => {
      observer.disconnect();
      unsubscribe();
    };
  }, [viewport]);

  // The right-click menu: Edit, Hide, Done, Delete.
  const keysFor = useKeysFor();
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; id: AnnotationId }>();
  useEffect(() => {
    if (!interactive) setMenu(undefined);
  }, [interactive]);

  const run = (command: Parameters<ReturnType<DocumentStore['getState']>['dispatch']>[0]) => {
    try {
      store.getState().dispatch(command);
      return true;
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      onError(error.message);
      return false;
    }
  };

  const local = (event: PointerEvent): Screen => {
    const r = layer.current?.getBoundingClientRect();
    return [event.clientX - (r?.left ?? 0), event.clientY - (r?.top ?? 0)];
  };

  const down = (d: Drawn) => (event: PointerEvent<HTMLDivElement>) => {
    if (!interactive || !d.annotation) return;
    const item: SelectionItem = { kind: 'annotation', id: d.id };
    if (event.button === 2) {
      const at = { x: event.clientX, y: event.clientY, id: event.pointerId };
      const up = (e: globalThis.PointerEvent) => {
        if (e.pointerId !== at.id || e.button !== 2) return;
        window.removeEventListener('pointerup', up, true);
        if (!isRightClick(at, e)) return;
        const select = menuSelection(session.getState().selection, item);
        if (select) session.getState().select(select, 'replace');
        setMenu({ at: { x: at.x, y: at.y }, id: d.id as AnnotationId });
      };
      window.addEventListener('pointerup', up, true);
      return;
    }
    if (event.button !== 0 || editing === d.id) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const [x, y] = local(event);
    const box = event.currentTarget.getBoundingClientRect();
    const r = layer.current?.getBoundingClientRect();
    press.current = {
      id: d.id,
      x,
      y,
      left: box.left - (r?.left ?? 0),
      bottom: box.bottom - (r?.top ?? 0),
      moved: false,
    };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    const [x, y] = local(event);
    if (!p.moved && Math.hypot(x - p.x, y - p.y) < DRAG_PX) return;
    p.moved = true;
    dragged.current = { id: p.id, left: p.left + x - p.x, bottom: p.bottom + y - p.y };
    place.current();
  };
  const up = (d: Drawn) => (event: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    press.current = undefined;
    if (!p) return;
    const drag = dragged.current;
    dragged.current = undefined;
    if (!p.moved) {
      const toggle = event.shiftKey || event.ctrlKey || event.metaKey;
      session.getState().select([{ kind: 'annotation', id: d.id }], toggle ? 'toggle' : 'replace');
      return;
    }
    const anchor = elements.current.get(d.id)?.dataset.anchor?.split(',').map(Number);
    if (!drag || !anchor || anchor.length !== 2) return;
    const height = elements.current.get(d.id)?.offsetHeight ?? 0;
    const offset = boxOffset(anchor as unknown as Screen, {
      left: drag.left,
      top: drag.bottom - height,
      width: 0,
      height,
    });
    if (!run(updateAnnotation({ id: d.id as AnnotationId, changes: { offset } }))) place.current();
  };

  const commit = (d: Drawn, text: string) => {
    const trimmed = text.trim();
    if (!d.annotation) {
      const current = ui.getState().draft;
      ui.getState().setDraft(undefined);
      if (!trimmed || !current) return;
      const id = newId<AnnotationId>();
      if (run(addAnnotation({ id, text: trimmed, anchor: current.anchor }))) {
        session.getState().select([{ kind: 'annotation', id }], 'replace');
      }
      return;
    }
    ui.getState().edit(undefined);
    if (!trimmed || trimmed === d.annotation.text) return;
    run(updateAnnotation({ id: d.annotation.id, changes: { text: trimmed } }));
  };
  const cancel = () => {
    if (ui.getState().draft) ui.getState().setDraft(undefined);
    else ui.getState().edit(undefined);
  };

  const opened = menu && (doc.annotations ?? []).find((a) => a.id === menu.id);
  const remove = keysFor('delete')[0]?.replace('Delete', 'Del');

  return (
    <div
      ref={layer}
      className="pointer-events-none absolute inset-0 z-[4] overflow-hidden"
      data-annotations={summary}
    >
      <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        {drawn.map((d) => (
          <g
            key={d.id || 'draft'}
            ref={(g) => {
              if (g) leaders.current.set(d.id, g);
              else leaders.current.delete(d.id);
            }}
            style={{ visibility: 'hidden' }}
          >
            <line
              stroke="var(--x-accent)"
              strokeWidth={1}
              strokeOpacity={states.get(d.id) === 'done' ? 0.5 : 1}
            />
            <circle r={2} fill="var(--x-accent)" stroke="var(--x-bg)" strokeWidth={1} />
          </g>
        ))}
      </svg>
      {drawn.map((d) => {
        const state = d.annotation ? (states.get(d.id) ?? 'full') : 'full';
        const engaged =
          !d.annotation ||
          isAnnotation(selection, d.id) ||
          (hover?.kind === 'annotation' && hover.id === d.id) ||
          editing === d.id;
        const selected = isAnnotation(selection, d.id);
        const detached = placed.find((p) => p.annotation.id === d.id)?.status === 'detached';
        const isEditing = !d.annotation || editing === d.id;
        const collapsed =
          !isEditing &&
          (state === 'ghost' || state === 'done' || (textMode === 'numbers' && !engaged));
        return (
          <div
            key={d.id || 'draft'}
            ref={(el) => {
              if (el) elements.current.set(d.id, el);
              else elements.current.delete(d.id);
            }}
            data-view-passthrough=""
            {...(d.annotation && { 'data-annotation': d.number })}
            data-annotation-state={state}
            data-annotation-text={textMode}
            {...(state === 'ghost' && { 'data-annotation-behind': '' })}
            {...(detached && { 'data-annotation-detached': '' })}
            {...(selected && { 'data-selected': '' })}
            role="note"
            tabIndex={d.annotation && interactive ? -1 : undefined}
            aria-label={
              d.annotation
                ? `Annotation #${d.number}: ${d.annotation.text}`
                : `New annotation #${d.number}`
            }
            className={`absolute top-0 left-0 flex items-start gap-1.5 ${
              interactive || isEditing ? 'pointer-events-auto' : 'pointer-events-none'
            } ${
              collapsed
                ? ''
                : `max-w-[36ch] rounded-control border px-1.5 py-1 text-xs shadow-raised ${
                    detached ? 'border-dashed' : ''
                  } ${selected ? 'border-accent ring-2 ring-accent' : 'border-line'}`
            } ${state === 'ghost' ? 'opacity-45' : ''} ${state === 'done' ? 'opacity-70' : ''}`}
            style={{
              visibility: 'hidden',
              ...(!collapsed && {
                background: 'color-mix(in srgb, var(--x-raised) 94%, transparent)',
              }),
            }}
            onPointerDown={down(d)}
            onPointerMove={move}
            onPointerUp={up(d)}
            onPointerEnter={() => {
              if (d.annotation && interactive)
                session.getState().setHover({ kind: 'annotation', id: d.id });
            }}
            onPointerLeave={() => {
              const h = session.getState().hover;
              if (h?.kind === 'annotation' && h.id === d.id) session.getState().setHover(undefined);
            }}
            onDoubleClick={(event) => {
              if (!interactive || !d.annotation) return;
              event.stopPropagation();
              ui.getState().edit(d.annotation.id);
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <Badge
              number={d.number}
              look={state === 'ghost' || detached ? 'hollow' : state === 'done' ? 'muted' : 'solid'}
              dashed={state === 'ghost'}
            />
            {!collapsed &&
              (isEditing ? (
                <Editor
                  initial={d.annotation?.text ?? ''}
                  onCommit={(text) => commit(d, text)}
                  onCancel={cancel}
                />
              ) : (
                <span
                  className={`min-w-0 whitespace-pre-wrap break-words text-ink ${
                    engaged ? '' : 'line-clamp-3'
                  }`}
                >
                  {d.annotation?.text}
                </span>
              ))}
          </div>
        );
      })}
      <PointMenu
        at={opened ? menu?.at : undefined}
        onClose={() => setMenu(undefined)}
        label="Annotation menu"
      >
        {opened && (
          <>
            <MenuItem icon={<Pencil size={14} />} onSelect={() => ui.getState().edit(opened.id)}>
              Edit
            </MenuItem>
            <MenuItem
              icon={opened.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
              onSelect={() =>
                run(updateAnnotation({ id: opened.id, changes: { hidden: !opened.hidden } }))
              }
            >
              {opened.hidden ? 'Show' : 'Hide'}
            </MenuItem>
            <MenuItem
              icon={<Check size={14} />}
              onSelect={() =>
                run(updateAnnotation({ id: opened.id, changes: { done: !opened.done } }))
              }
            >
              {opened.done ? 'Not done' : 'Done'}
            </MenuItem>
            <MenuItem
              icon={<Trash2 size={14} />}
              shortcut={remove}
              onSelect={() => {
                const ids = session
                  .getState()
                  .selection.filter((i) => i.kind === 'annotation')
                  .map((i) => i.id as AnnotationId);
                run(removeAnnotation({ ids: ids.length > 0 ? ids : [opened.id] }));
              }}
            >
              Delete
            </MenuItem>
          </>
        )}
      </PointMenu>
    </div>
  );
}

/** The numbered circle: accent with white digits, muted when done, hollow when detached or ghosted. */
function Badge({
  number,
  look,
  dashed,
}: {
  number: number;
  look: 'solid' | 'muted' | 'hollow';
  dashed: boolean;
}) {
  const style =
    look === 'solid'
      ? {
          background: 'var(--x-accent)',
          color: 'var(--x-on-accent)',
          borderColor: 'var(--x-accent)',
        }
      : look === 'muted'
        ? { background: 'var(--x-line)', color: 'var(--x-muted)', borderColor: 'var(--x-line)' }
        : {
            background: 'var(--x-raised)',
            color: 'var(--x-accent)',
            borderColor: 'var(--x-accent)',
          };
  return (
    <span
      className={`flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full border px-1 font-medium text-[11px] leading-none tabular-nums ${
        dashed ? 'border-dashed' : ''
      }`}
      style={style}
      data-annotation-badge=""
    >
      {number}
    </span>
  );
}

/**
 * The in-place editor: Enter commits, Shift+Enter is a newline, Esc cancels, leaving the
 * field commits. An empty text commits nothing.
 */
function Editor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit(text: string): void;
  onCancel(): void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = field.current;
    el?.focus();
    el?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(field.current?.value ?? '');
    else onCancel();
  };
  const key = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  };
  return (
    <textarea
      ref={field}
      data-annotation-editor=""
      aria-label="Annotation text"
      defaultValue={initial}
      rows={Math.min(6, Math.max(2, initial.split('\n').length))}
      maxLength={2000}
      className="w-[30ch] resize-none rounded-control border border-line bg-bg px-1 py-0.5 text-ink text-xs outline-none focus:border-accent"
      onKeyDown={key}
      onBlur={() => finish(true)}
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
}
