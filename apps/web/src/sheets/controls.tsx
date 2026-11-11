/**
 * Small controls of the drawing's panels and dialogs (P6-24): a segmented choice, a switch,
 * and a text field (one line, or several: `CommitArea`) that commits on Enter or blur and
 * reverts on Esc, and the choice of a text field in braces to insert (`FieldInsert`, S5). Numbers
 * never use the text field: they are `ExpressionInput`s (CLAUDE.md hard rule).
 */
import { type ExtrudoDocument, SHEET_FIELDS, type SheetFieldName } from '@extrudo/core';
import { type ReactNode, type Ref, useRef, useState } from 'react';
import { fieldClass, Select, TextInput } from '../design-system';

/** A few exclusive choices side by side (mock-up 2's "Landscape | Portrait"). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  /** `name`: the accessible name when the label is shortened ("Horiz." for "Horizontal"). */
  options: readonly { value: T; label: string; name?: string }[];
  onChange(value: T): void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex h-8 gap-0.5 rounded-input border border-line bg-bg p-0.5"
    >
      {options.map((option) => (
        // biome-ignore lint/a11y/useSemanticElements: a segmented control, styled as one row of buttons
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-label={option.name}
          title={option.name}
          onClick={() => option.value !== value && onChange(option.value)}
          className="min-w-0 flex-1 truncate rounded-[5px] px-1 text-xs text-muted hover:text-ink aria-checked:bg-accent-soft aria-checked:font-semibold aria-checked:text-accent"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const SWITCH =
  'ml-auto h-3.5 w-6 shrink-0 cursor-pointer appearance-none rounded-full bg-muted/40 bg-[radial-gradient(circle,white_4.5px,transparent_5px)] bg-size-[14px_14px] bg-position-[left_center] bg-no-repeat transition-[background-color,background-position] duration-150 checked:bg-accent checked:bg-position-[right_center] disabled:cursor-default disabled:opacity-40 motion-reduce:transition-none';

/** An on/off row: its text, then the switch (`role="switch"`). */
export function Switch({
  checked,
  onChange,
  disabled = false,
  children,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
  children: string;
}) {
  return (
    <label
      className={`flex h-7 min-w-0 items-center gap-2 rounded-input ${disabled ? 'text-muted' : 'cursor-pointer'}`}
    >
      <span className="min-w-0 truncate">{children}</span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={children}
        className={SWITCH}
      />
    </label>
  );
}

/**
 * A text that is written when Enter is pressed or the field is left, and put back on Esc.
 * `onCommit` returns why the text can't be taken, shown under the field.
 */
export function CommitField({
  label,
  value,
  onCommit,
  placeholder,
  inputRef,
  maxLength,
  onCaret,
}: {
  label: string;
  value: string;
  onCommit(value: string): string | undefined;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  maxLength?: number;
  /** Where the caret was when the field was left (a field inserted next goes there). */
  onCaret?(at: number): void;
}) {
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState<string>();
  const shown = draft ?? value;
  const commit = () => {
    if (draft === undefined || draft === value) {
      setDraft(undefined);
      setError(undefined);
      return;
    }
    const problem = onCommit(draft);
    setError(problem);
    if (!problem) setDraft(undefined);
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <TextInput
        ref={inputRef}
        aria-label={label}
        value={shown}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={error !== undefined || undefined}
        {...(error && { 'aria-description': error })}
        // Esc puts the text back before anything else hears it.
        data-keep-escape={draft !== undefined ? '' : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          onCaret?.(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape' && draft !== undefined) {
            event.preventDefault();
            event.stopPropagation();
            setDraft(undefined);
            setError(undefined);
          }
        }}
        className="h-7"
      />
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}

/** A label and its control in the panels' two columns. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="truncate pt-1 text-sm text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </>
  );
}

/**
 * A text of several lines, with the same keys as typing on the sheet (`SheetTextEditor`):
 * Enter writes it, Shift+Enter starts a new line, Esc puts it back; leaving it writes it too.
 * `onCommit` returns why the text can't be taken, shown under the field.
 */
export function CommitArea({
  label,
  value,
  onCommit,
  maxLength,
  fields,
}: {
  label: string;
  value: string;
  onCommit(value: string): string | undefined;
  maxLength?: number;
  /** Text fields in braces it offers to insert at the caret (S5): written at once. */
  fields?: readonly FieldChoice[];
}) {
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState<string>();
  const caret = useRef<number>(undefined);
  const shown = draft ?? value;
  const insert = (token: string) => {
    const at = Math.min(caret.current ?? shown.length, shown.length);
    const next = shown.slice(0, at) + token + shown.slice(at);
    caret.current = at + token.length;
    const problem = onCommit(next);
    setError(problem);
    if (!problem) setDraft(undefined);
  };
  const commit = () => {
    if (draft === undefined || draft === value) {
      setDraft(undefined);
      setError(undefined);
      return;
    }
    const problem = onCommit(draft);
    setError(problem);
    if (!problem) setDraft(undefined);
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <textarea
        aria-label={label}
        value={shown}
        maxLength={maxLength}
        rows={Math.min(6, Math.max(2, shown.split('\n').length))}
        aria-invalid={error !== undefined || undefined}
        {...(error && { 'aria-description': error })}
        data-keep-escape={draft !== undefined ? '' : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          caret.current = event.currentTarget.selectionStart ?? undefined;
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape' && draft !== undefined) {
            event.preventDefault();
            event.stopPropagation();
            setDraft(undefined);
            setError(undefined);
          }
        }}
        className={`${fieldClass} h-auto min-h-14 resize-y py-1 text-sm`}
      />
      {error && <p className="text-sm text-error">{error}</p>}
      {fields && <FieldInsert choices={fields} onInsert={insert} />}
    </div>
  );
}

/** A text field in braces a person can insert: what is written, and what it says. */
export interface FieldChoice {
  token: string;
  label: string;
}

const FIELD_LABEL: Readonly<Record<SheetFieldName, string>> = {
  name: 'Design name',
  sheet: 'Sheet number',
  sheets: 'Number of sheets',
  scale: 'Sheet scale',
  date: "Today's date",
  version: 'Newest saved version',
};

/**
 * The fields a sheet text can hold (core's `SHEET_FIELDS`), then one `{= name}` per parameter
 * of the design: filled each time the sheet is drawn, never stored filled.
 */
export function sheetFieldChoices(doc: Pick<ExtrudoDocument, 'parameters'>): FieldChoice[] {
  return [
    ...SHEET_FIELDS.map((name) => ({ token: `{${name}}`, label: FIELD_LABEL[name] })),
    ...doc.parameters.map((p) => ({ token: `{= ${p.name}}`, label: `Parameter ${p.name}` })),
  ];
}

/**
 * "Insert field": a choice of `choices`; choosing one inserts its token (the field reads it
 * back as typed while it is edited, filled on the sheet).
 *
 * Test hook: the combobox "Insert field".
 */
export function FieldInsert({
  choices,
  onInsert,
}: {
  choices: readonly FieldChoice[];
  onInsert(token: string): void;
}) {
  return (
    <Select
      aria-label="Insert field"
      value=""
      onChange={(event) => {
        const token = event.target.value;
        if (token) onInsert(token);
      }}
      className="h-7 text-sm"
    >
      <option value="">Insert field…</option>
      {choices.map((c) => (
        <option key={c.token} value={c.token}>
          {c.token} · {c.label}
        </option>
      ))}
    </Select>
  );
}
