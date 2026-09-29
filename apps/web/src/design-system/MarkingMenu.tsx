import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ARROW_SLOT,
  LABEL_RADIUS,
  placeMenu,
  RING_OUTER,
  SLOT_COUNT,
  slotAt,
  slotCenter,
  wedgePath,
} from './marking';

/** A wedge of the ring. */
export interface MarkingSlot {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Keys, shown in the tooltip (`aria-keyshortcuts` takes them too). */
  shortcut?: string;
  /** Greyed out: it can't run here (or yet); `hint` says why. */
  disabled?: boolean;
  hint?: string;
  onSelect(): void;
}

/** A row of the list under the ring. */
export interface MarkingEntry {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  hint?: string;
  /** A hairline above this row: it starts a new group. */
  separatorBefore?: boolean;
  onSelect(): void;
  /** The pointer or the keyboard moved onto the row (it shows as highlighted). */
  onHighlight?(): void;
}

export interface MarkingMenuProps {
  /** Where the menu opens, in window (client) px; `undefined` keeps it closed. */
  at: { x: number; y: number } | undefined;
  /** Eight wedges clockwise from the top; `undefined` leaves one empty. */
  slots: readonly (MarkingSlot | undefined)[];
  /** The overflow list below the ring. */
  entries: readonly MarkingEntry[];
  /** `false`: no ring, one plain list (the slots first, then the entries). */
  radial?: boolean;
  label?: string;
  onClose(): void;
}

/**
 * The marking menu (P3-11, FR-UX-03, ADR-0042): a ring of eight wedges round
 * the pointer and an overflow list below it. Point at a wedge (the pointer
 * or the arrow keys) and click, or press anywhere in the ring, drag towards
 * a wedge and release (the classic flick); Esc or a click outside closes it.
 * The pointer's direction from the ring's centre picks the wedge, so a
 * flick doesn't have to hit the label.
 */
export function MarkingMenu(props: MarkingMenuProps) {
  if (!props.at) return null;
  return createPortal(<OpenMenu {...props} at={props.at} />, document.body);
}

const ITEM = '[role="menuitem"]';

function OpenMenu({
  at,
  slots,
  entries,
  radial = true,
  label = 'Marking menu',
  onClose,
}: MarkingMenuProps & { at: { x: number; y: number } }) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number>();
  /** A press that began in the ring: its release picks the wedge the pointer points at. */
  const gesture = useRef(false);

  const rows = useMemo<MarkingEntry[]>(() => {
    if (radial) return [...entries];
    const first = slots
      .filter((s): s is MarkingSlot => s !== undefined)
      .map<MarkingEntry>((s) => ({ ...s }));
    const [head, ...rest] = entries;
    return head ? [...first, { ...head, separatorBefore: first.length > 0 }, ...rest] : first;
  }, [radial, slots, entries]);
  const view = { width: window.innerWidth, height: window.innerHeight };
  const place = placeMenu(
    at,
    view,
    { rows: rows.length, separators: rows.filter((r) => r.separatorBefore).length },
    radial ? RING_OUTER : null,
  );

  // Focus the menu while it is open (keys belong to it, not to the shortcuts), then give it back.
  useEffect(() => {
    const before = document.activeElement;
    root.current?.focus({ preventScroll: true });
    return () => {
      if (before instanceof HTMLElement && document.contains(before)) {
        before.focus({ preventScroll: true });
      }
    };
  }, []);

  /** Closes the menu, then runs `action` once focus is back where it was. */
  const choose = (action: () => void) => {
    onClose();
    setTimeout(action, 0);
  };
  const pickSlot = (index: number) => {
    const slot = slots[index];
    if (!slot || slot.disabled) return;
    choose(slot.onSelect);
  };
  const pickRow = (row: MarkingEntry) => {
    if (row.disabled) return;
    choose(row.onSelect);
  };

  const offset = (event: PointerEvent) => ({
    dx: event.clientX - place.center.x,
    dy: event.clientY - place.center.y,
  });
  const inList = (event: PointerEvent) =>
    event.target instanceof Node && (list.current?.contains(event.target) ?? false);

  const onPointerMove = (event: PointerEvent) => {
    if (!radial) return;
    if (inList(event)) {
      setActive(undefined);
      return;
    }
    const { dx, dy } = offset(event);
    setActive(slotAt(dx, dy));
  };
  const onPointerDown = (event: PointerEvent) => {
    if (inList(event)) return;
    const { dx, dy } = offset(event);
    if (event.button === 0 && radial && Math.hypot(dx, dy) <= RING_OUTER + 24) {
      gesture.current = true;
      setActive(slotAt(dx, dy));
      return;
    }
    // A click away (or another button) closes the menu and does nothing else.
    event.preventDefault();
    onClose();
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!gesture.current) return;
    gesture.current = false;
    if (event.button !== 0 || inList(event)) return;
    const { dx, dy } = offset(event);
    const index = slotAt(dx, dy);
    if (index !== undefined) pickSlot(index);
  };

  const focusables = () => [...(root.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])];
  const move = (from: HTMLElement | undefined, step: 1 | -1, group?: HTMLElement | null) => {
    const items = group ? [...group.querySelectorAll<HTMLElement>(ITEM)] : focusables();
    if (items.length === 0) return;
    const at = from ? items.indexOf(from) : -1;
    const next =
      at < 0 ? (step === 1 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
    items[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    // The menu owns the keyboard while it is open: no shortcut runs behind it.
    event.stopPropagation();
    const target = event.target instanceof HTMLElement ? event.target : undefined;
    const inRing = target?.dataset.slot !== undefined;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      move(target?.matches(ITEM) ? target : undefined, event.shiftKey ? -1 : 1);
    } else if (radial && (inRing || target === root.current) && event.key in ARROW_SLOT) {
      event.preventDefault();
      const index = ARROW_SLOT[event.key] as number;
      const wedge = root.current?.querySelector<HTMLElement>(`[data-slot="${index}"]`);
      // Down from the bottom wedge (or with none there) carries on into the list.
      if (event.key === 'ArrowDown' && (!wedge || target === wedge)) {
        list.current?.querySelector<HTMLElement>(ITEM)?.focus();
      } else wedge?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const first = list.current?.querySelector<HTMLElement>(ITEM);
      if (radial && event.key === 'ArrowUp' && target === first) {
        root.current?.querySelector<HTMLElement>('[data-slot="4"]')?.focus();
      } else move(target?.matches(ITEM) ? target : undefined, step, list.current);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const items = list.current ? [...list.current.querySelectorAll<HTMLElement>(ITEM)] : [];
      (event.key === 'Home' ? items[0] : items[items.length - 1])?.focus();
    }
  };

  const size = RING_OUTER * 2;
  return (
    <div
      ref={root}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      data-marking-menu={radial ? 'radial' : 'list'}
      className="fixed inset-0 z-[60] outline-none"
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {radial && (
        <div
          data-marking-ring
          className="x-marking-in absolute"
          style={{
            left: place.center.x - RING_OUTER,
            top: place.center.y - RING_OUTER,
            width: size,
            height: size,
          }}
        >
          <svg
            aria-hidden
            viewBox={`0 0 ${size} ${size}`}
            width={size}
            height={size}
            className="pointer-events-none absolute inset-0 drop-shadow-[0_14px_20px_rgb(0_0_0/0.35)]"
          >
            {Array.from({ length: SLOT_COUNT }, (_, i) => {
              const slot = slots[i];
              const hot = active === i && slot !== undefined && !slot.disabled;
              return (
                <path
                  // biome-ignore lint/suspicious/noArrayIndexKey: a wedge is its position
                  key={i}
                  d={wedgePath(i)}
                  data-wedge={i}
                  data-active={hot || undefined}
                  style={{
                    fill: hot
                      ? 'color-mix(in srgb, var(--x-accent) 26%, var(--x-raised))'
                      : slot
                        ? 'var(--x-raised)'
                        : 'color-mix(in srgb, var(--x-raised) 60%, transparent)',
                    stroke: hot ? 'var(--x-accent)' : 'var(--x-line)',
                    strokeWidth: 1,
                  }}
                />
              );
            })}
            <circle
              cx={RING_OUTER}
              cy={RING_OUTER}
              r={4}
              style={{ fill: 'var(--x-accent)', opacity: 0.9 }}
            />
          </svg>
          {slots.slice(0, SLOT_COUNT).map((slot, i) => {
            if (!slot) return null;
            const c = slotCenter(i, LABEL_RADIUS);
            return (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: a wedge is its position
                key={i}
                type="button"
                role="menuitem"
                data-slot={i}
                data-marking-slot={slot.id}
                aria-disabled={slot.disabled || undefined}
                aria-keyshortcuts={slot.shortcut}
                title={
                  slot.hint ?? (slot.shortcut ? `${slot.label} (${slot.shortcut})` : undefined)
                }
                onFocus={() => setActive(i)}
                onClick={(event) => {
                  // A mouse click was picked on release (the flick works anywhere in the wedge);
                  // Enter and Space arrive here without a pointer.
                  if (event.detail === 0) pickSlot(i);
                }}
                className={`absolute flex h-12 w-[72px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-input text-center text-[11px] leading-tight text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent ${slot.disabled ? 'opacity-45' : ''}`}
                style={{ left: RING_OUTER + c.x, top: RING_OUTER + c.y }}
              >
                <span className="grid size-4 place-items-center text-muted">{slot.icon}</span>
                <span>{slot.label}</span>
              </button>
            );
          })}
        </div>
      )}
      {rows.length > 0 && (
        // biome-ignore lint/a11y/useSemanticElements: a menu's group of items is role=group, not a form fieldset
        <div
          ref={list}
          role="group"
          aria-label="More"
          data-marking-list
          className="absolute overflow-y-auto rounded-dialog border border-line bg-raised p-1 text-base text-ink shadow-raised"
          style={{
            left: place.list.left,
            top: place.list.top,
            width: place.list.width,
            maxHeight: place.list.height,
          }}
        >
          {rows.map((row) => (
            <div key={row.id} role="none">
              {row.separatorBefore && <hr className="my-1 h-px border-0 bg-line" />}
              <button
                type="button"
                role="menuitem"
                data-marking-entry={row.id}
                aria-disabled={row.disabled || undefined}
                aria-keyshortcuts={row.shortcut}
                title={row.hint}
                onFocus={row.onHighlight}
                onPointerEnter={row.onHighlight}
                onClick={() => pickRow(row)}
                className={`flex h-8 w-full cursor-default items-center gap-2 rounded-input px-2 text-left outline-none hover:bg-accent-soft focus-visible:bg-accent-soft ${row.disabled ? 'text-muted opacity-60' : ''}`}
              >
                <span className="grid w-4 place-items-center text-muted">{row.icon}</span>
                <span className="flex-1 truncate">{row.label}</span>
                {row.shortcut && <kbd className="font-mono text-xs text-muted">{row.shortcut}</kbd>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
