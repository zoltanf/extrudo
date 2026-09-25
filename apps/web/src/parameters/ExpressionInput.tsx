import type { EvaluateResult } from '@extrudo/core';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { Message } from './Message';

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
  const backdrop = useRef<HTMLDivElement>(null);
  const messageId = useId();

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

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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

  return (
    <div className={`expr-input${error ? ' has-error' : ''} ${className ?? ''}`}>
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
          type="text"
          className="expr-text"
          value={draft}
          data-keep-escape={draft !== value || undefined}
          spellCheck={false}
          autoComplete="off"
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={messageId}
          placeholder={placeholder}
          onChange={(event) => {
            const next = event.target.value;
            setEditing(true);
            setDraft(next);
            onDraftChange?.(next, evaluate(next).ok);
          }}
          onFocus={() => setEditing(true)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          onScroll={(event) => {
            if (backdrop.current) backdrop.current.scrollLeft = event.currentTarget.scrollLeft;
          }}
        />
      </div>
      <div id={messageId} className="expr-message" aria-live="polite">
        {pending ? '' : result.ok ? `= ${format(result)}` : <Message text={result.error.message} />}
      </div>
    </div>
  );
}
