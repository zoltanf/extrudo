/**
 * Small controls of the drawing's panels and dialogs (P6-24): a segmented choice, a switch,
 * and a text field that commits on Enter or blur and reverts on Esc. Numbers never use the
 * text field: they are `ExpressionInput`s (CLAUDE.md hard rule).
 */
import { type ReactNode, type Ref, useState } from 'react';
import { TextInput } from '../design-system';

/** A few exclusive choices side by side (mock-up 2's "Landscape | Portrait"). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
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
}: {
  label: string;
  value: string;
  onCommit(value: string): string | undefined;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  maxLength?: number;
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
        onBlur={commit}
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
