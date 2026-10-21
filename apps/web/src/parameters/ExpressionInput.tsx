import type { EvaluateResult } from '@extrudo/core';
import { Popover } from 'radix-ui';
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { matching, type NameEntry, type Word, wordAt } from './completion';
import { useExpressionNames } from './expressionNames';
import { Message } from './Message';

/** The open completion list: the word it completes, the names, the one picked with the arrows (-1: none). */
interface Completion {
  word: Word;
  items: NameEntry[];
  active: number;
}

export interface ExpressionInputProps {
  /** The committed expression. */
  value: string;
  /** Called with a valid, changed expression on Enter or blur. */
  onCommit(expression: string): void;
  /** Evaluates a draft in context: the unit it needs, the parameters in scope, cycles. */
  evaluate(expression: string): EvaluateResult;
  /** Formats a valid result for display ("40.00 mm"). */
  format(result: Extract<EvaluateResult, { ok: true }>): string;
  /** Called on every keystroke, for forms that submit the draft themselves. */
  onDraftChange?(expression: string, valid: boolean): void;
  /** Accessible name of the field. */
  label: string;
  /** With a placeholder, an empty field counts as "not filled in yet" rather than an error. */
  placeholder?: string;
  className?: string;
}

/**
 * The one numeric input (CLAUDE.md hard rule): takes an expression, shows its
 * evaluated value live, and marks errors with a red underline under the part
 * that is wrong plus the message (UI spec §3.4). Enter or blur commits a
 * valid expression; Esc goes back to the committed one. An invalid draft is
 * never committed.
 *
 * Typing a name lists the parameters in scope that contain it (ADR-0096):
 * ↑/↓ pick, Tab or Enter inserts, Esc closes the list first, Ctrl+Space opens
 * it on an empty word. Enter without a pick commits as usual.
 */
export function ExpressionInput({
  value,
  onCommit,
  onDraftChange,
  evaluate,
  format,
  label,
  placeholder,
  className,
}: ExpressionInputProps) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const [completion, setCompletion] = useState<Completion>();
  const backdrop = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const caretAfterInsert = useRef<number>(undefined);
  const inScope = useRef(new Map<string, boolean>());
  const names = useExpressionNames();
  const messageId = useId();
  const listId = useId();

  // Follow outside changes (undo, another field) while not editing.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const result = evaluate(draft);
  const pending = draft === '' && placeholder !== undefined;
  const error = result.ok || pending ? undefined : result.error;

  // An invalid draft stays in the field (still "editing") so it can be fixed.
  const commit = () => {
    if (!result.ok) return;
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };

  // In scope for this field: the field's own evaluation knows the name and it
  // doesn't lead back to the field. Asked once per name while focused.
  const usable = (name: string) => {
    let ok = inScope.current.get(name);
    if (ok === undefined) {
      const probe = evaluate(name);
      ok = probe.ok || (probe.error.code !== 'unknown-name' && probe.error.code !== 'cycle');
      inScope.current.set(name, ok);
    }
    return ok;
  };

  // An empty word opens the list only when asked for (Ctrl+Space).
  const suggest = (text: string, caret: number, asked = false) => {
    const word = wordAt(text, caret);
    const items =
      word && (asked || word.text !== '')
        ? matching(word.text, names()).filter((entry) => usable(entry.name))
        : [];
    // A name typed out in full, with nothing longer to offer, needs no list.
    const done = !asked && items.length === 1 && items[0]?.name === word?.text;
    setCompletion(word && items.length > 0 && !done ? { word, items, active: -1 } : undefined);
  };

  const change = (next: string) => {
    setEditing(true);
    setDraft(next);
    onDraftChange?.(next, evaluate(next).ok);
  };

  const insert = (entry: NameEntry) => {
    if (!completion) return;
    const { start, end } = completion.word;
    caretAfterInsert.current = start + entry.name.length;
    setCompletion(undefined);
    change(draft.slice(0, start) + entry.name + draft.slice(end));
  };

  useLayoutEffect(() => {
    const caret = caretAfterInsert.current;
    if (caret === undefined) return;
    caretAfterInsert.current = undefined;
    input.current?.setSelectionRange(caret, caret);
  });

  // Keys the open list takes; true when it took this one.
  const listKey = (event: KeyboardEvent<HTMLInputElement>, list: Completion) => {
    const count = list.items.length;
    const pick = (active: number) => {
      event.preventDefault();
      setCompletion({ ...list, active });
      document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
    };
    switch (event.key) {
      case 'ArrowDown':
        pick((list.active + 1) % count);
        return true;
      case 'ArrowUp':
        pick(list.active <= 0 ? count - 1 : list.active - 1);
        return true;
      case 'Tab': {
        // A word that already is the first name moves on, like a field without a list.
        const entry = list.items[list.active] ?? list.items[0];
        if (event.shiftKey || !entry || (list.active < 0 && entry.name === list.word.text)) {
          return false;
        }
        event.preventDefault();
        insert(entry);
        return true;
      }
      case 'Enter': {
        const entry = list.items[list.active];
        if (!entry) return false;
        event.preventDefault();
        insert(entry);
        return true;
      }
      case 'Escape':
        // Before the dialog or the sketch editor sees it.
        event.preventDefault();
        event.stopPropagation();
        setCompletion(undefined);
        return true;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'Home':
      case 'End':
        setCompletion(undefined);
        return false;
      default:
        return false;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (completion && listKey(event, completion)) return;
    if (event.key === ' ' && event.ctrlKey) {
      event.preventDefault();
      const field = event.currentTarget;
      suggest(field.value, field.selectionStart ?? field.value.length, true);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      // Blurring commits.
      if (result.ok) event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      // With a change, Esc reverts the field; a dialog skips fields marked
      // `data-keep-escape` (see Dialog). Without one, Esc closes the dialog.
      setDraft(value);
      setEditing(false);
    }
  };

  const { start = 0, end = 0 } = error?.span ?? {};
  // An empty range (for example, missing text at the end) underlines one space.
  const shown = end > start ? draft : `${draft} `;
  const markEnd = end > start ? end : start + 1;

  const activeId =
    completion && completion.active >= 0 ? `${listId}-${completion.active}` : undefined;

  return (
    <div className={`expr-input${error ? ' has-error' : ''} ${className ?? ''}`}>
      <Popover.Root
        open={completion !== undefined}
        onOpenChange={(open) => {
          if (!open) setCompletion(undefined);
        }}
      >
        <Popover.Anchor asChild>
          <div className="expr-field">
            <div className="expr-backdrop" ref={backdrop} aria-hidden="true">
              {error ? (
                <>
                  {shown.slice(0, start)}
                  <span className="expr-error-range">{shown.slice(start, markEnd)}</span>
                  {shown.slice(markEnd)}
                </>
              ) : (
                draft
              )}
            </div>
            <input
              ref={input}
              type="text"
              className="expr-text"
              value={draft}
              data-keep-escape={draft !== value || completion !== undefined || undefined}
              spellCheck={false}
              autoComplete="off"
              aria-label={label}
              aria-invalid={error ? true : undefined}
              aria-describedby={messageId}
              aria-autocomplete="list"
              aria-controls={completion ? listId : undefined}
              aria-activedescendant={activeId}
              placeholder={placeholder}
              onChange={(event) => {
                const next = event.target.value;
                change(next);
                suggest(next, event.target.selectionStart ?? next.length);
              }}
              onFocus={() => {
                setEditing(true);
                inScope.current.clear();
              }}
              onBlur={() => {
                setCompletion(undefined);
                commit();
              }}
              onKeyDown={onKeyDown}
              onScroll={(event) => {
                if (backdrop.current) backdrop.current.scrollLeft = event.currentTarget.scrollLeft;
              }}
            />
          </div>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            id={listId}
            role="listbox"
            aria-label={`Parameters for ${label}`}
            side="bottom"
            align="start"
            sideOffset={2}
            collisionPadding={8}
            className="z-50 max-h-60 min-w-(--radix-popover-trigger-width) overflow-auto rounded-input border border-line bg-raised p-1 font-mono text-sm text-ink shadow-raised"
            // The field keeps the focus and handles every key, Esc included.
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => event.preventDefault()}
          >
            {completion?.items.map((entry, i) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the field drives the keyboard
              <div
                key={entry.name}
                id={`${listId}-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={i === completion.active}
                className={`cursor-default whitespace-nowrap rounded-input px-2 py-0.5 hover:bg-accent-soft ${i === completion.active ? 'bg-accent-soft' : ''}`}
                // Keep the focus (and the edit) in the field.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insert(entry)}
              >
                {entry.name}
                {entry.value !== undefined && <span className="text-muted"> = {entry.value}</span>}
              </div>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <div id={messageId} className="expr-message" aria-live="polite">
        {pending ? '' : result.ok ? `= ${format(result)}` : <Message text={result.error.message} />}
      </div>
    </div>
  );
}
