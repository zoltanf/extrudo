/**
 * Typing on the sheet where the text is (P6-24 S4, plan §4.2, §4.5): a new text, leader note
 * or sticky note after its click, or a double-click on one. The same keys for all three:
 * **Enter** finishes, **Shift+Enter** starts a new line, **Esc** leaves it as it was (a new
 * one is not made); leaving the field (a click elsewhere) finishes too. A finished new item is
 * one undo step; an edit is one `updateSheetItem` step, none when nothing changed.
 *
 * The field sits in the paper's own millimetres (`--sheet-mm`, the px per mm the canvas writes
 * with the zoom), with the sheet's letters (Inter) at the item's size, its first baseline on
 * the drawn text's, so what is typed is where it will be drawn. A sticky note's field fills the
 * note in its colour.
 *
 * Test hooks: the textbox "Text on the sheet" (`data-sheet-editor` the kind).
 */
import type { SheetItemId, Vec2 } from '@extrudo/core';
import { useLayoutEffect, useRef, useState } from 'react';

/** Inter's cap height and ascender less descender, in ems (the sheet's letters). */
const CAP_EM = 0.7275;
const HALF_SPREAD = (0.96875 - 0.2421875) / 2;
/** Baseline to baseline, in letter heights (`@extrudo/sheets`' `LINE_SPACING`). */
const LINE_SPACING = 1.6;
/** The paper's ink and white (both themes: the paper is white). */
const INK = '#15171c';
const PAPER = '#ffffff';

/** What is being typed, and where. */
export interface SheetTextEdit {
  kind: 'text' | 'leader' | 'sticky';
  /** The item edited; absent for a new one (it is made on Enter). */
  id?: SheetItemId;
  /** Where the first line's baseline starts, sheet mm. */
  baseline: Vec2;
  /** The letters' cap height, mm. */
  size: number;
  /** A sticky note's box and colour, sheet mm: the field fills it. */
  note?: { at: Vec2; size: Vec2; fill: string; padding: number };
  /** A text's wrap width, mm (absent: one line per typed line). */
  width?: number;
  text: string;
}

const mm = (n: number) => `calc(var(--sheet-mm, 1px) * ${Math.round(n * 1000) / 1000})`;

/** Where the field's top goes for its first baseline to sit at `y`, mm. */
function topFor(y: number, size: number): number {
  const font = size / CAP_EM;
  return y - (LINE_SPACING * size) / 2 - HALF_SPREAD * font;
}

export function SheetTextEditor({
  edit,
  onCommit,
  onCancel,
}: {
  edit: SheetTextEdit;
  /** The typed text, when it was finished (Enter, or leaving the field). */
  onCommit(text: string): void;
  onCancel(): void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(edit.text);
  const ended = useRef(false);
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  const end = (commit: boolean) => {
    if (ended.current) return;
    ended.current = true;
    if (commit) onCommit(text);
    else onCancel();
  };
  const { size, note } = edit;
  const font = size / CAP_EM;
  const top = topFor(edit.baseline[1], size);
  const common = {
    fontFamily: 'Inter, sans-serif',
    fontSize: mm(font),
    lineHeight: mm(LINE_SPACING * size),
    color: INK,
    pointerEvents: 'auto',
  } as const;
  const area = (
    <textarea
      ref={field}
      aria-label="Text on the sheet"
      data-sheet-editor={edit.kind}
      data-keep-escape=""
      value={text}
      rows={1}
      spellCheck
      onChange={(event) => setText(event.target.value)}
      onBlur={() => end(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          end(false);
        } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          end(true);
        }
      }}
      className="absolute m-0 resize-none border-0 p-0 outline-none [field-sizing:content]"
      style={
        note
          ? {
              ...common,
              left: mm(note.padding),
              top: mm(top - note.at[1]),
              width: mm(note.size[0] - 2 * note.padding),
              maxHeight: mm(note.size[1] - (top - note.at[1])),
              background: 'transparent',
              overflow: 'hidden',
            }
          : {
              ...common,
              left: mm(edit.baseline[0]),
              top: mm(top),
              ...(edit.width !== undefined
                ? { width: mm(edit.width), whiteSpace: 'pre-wrap' as const }
                : { minWidth: mm(Math.max(30, 8 * size)), whiteSpace: 'pre' as const }),
              background: PAPER,
              overflow: 'hidden',
              boxShadow: '0 0 0 1px var(--x-accent)',
              borderRadius: 1,
            }
      }
    />
  );
  return (
    <div
      className="absolute inset-0"
      style={{ pointerEvents: 'none' }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {note ? (
        <div
          className="absolute"
          style={{
            left: mm(note.at[0]),
            top: mm(note.at[1]),
            width: mm(note.size[0]),
            height: mm(note.size[1]),
            background: note.fill,
            borderRadius: mm(1.5),
            boxShadow: '0 0 0 1px var(--x-accent)',
            pointerEvents: 'auto',
          }}
        >
          {area}
        </div>
      ) : (
        area
      )}
    </div>
  );
}
