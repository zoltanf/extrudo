import { type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react';

/** The lines a toast or a notification history row shows before "Show more" (R3-17). */
export const CLAMP_LINES = 3;

/**
 * A text longer than this starts clamped, before it can be measured (a static render, the
 * first frame): three lines of the widest toast hold about this many characters. In the
 * browser the text's own height decides once it is drawn.
 */
export const CLAMP_GUESS = 160;

/** Whether a text is long enough to clamp before it is measured. */
export function mightOverflow(text: string): boolean {
  return text.length > CLAMP_GUESS || text.split('\n').length > CLAMP_LINES;
}

/**
 * A message clamped to three lines with a "Show more" / "Show less" button (the owner's UI
 * review 3, R3-17): a long notification (an import's report, a list of numbers) no longer
 * fills the view. The whole text is always in the page, so a screen reader reads all of it,
 * and the button (`aria-expanded`, `aria-controls`) shows it all on screen. Words longer than
 * the line break anywhere, so a run without spaces can't widen the toast.
 */
export function ClampedText({
  text,
  prefix,
  suffix,
  className = '',
  onExpand,
}: {
  text: string;
  /** Drawn before the text, inside the clamp (a screen-reader-only tone word). */
  prefix?: ReactNode;
  /** Drawn after the text, inside the clamp (a repeat count). */
  suffix?: ReactNode;
  className?: string;
  /** Show more was pressed (a toast then stays until dismissed). */
  onExpand?(): void;
}) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [long, setLong] = useState(() => mightOverflow(text));
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new text is measured again
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      // A `normal` line height is the font's own, about 1.2 of its size.
      const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
      if (!Number.isFinite(line) || line <= 0) return;
      // The scroll height is the whole text's, clamped or not; half a line's slack covers a
      // `normal` line height that isn't exactly 1.2.
      setLong(el.scrollHeight > line * (CLAMP_LINES + 0.5));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);
  return (
    <span className={`flex min-w-0 flex-col items-start ${className}`}>
      <span
        ref={ref}
        id={id}
        data-clamp-text=""
        data-clamped={long && !expanded ? 'true' : undefined}
        className={`max-w-full [overflow-wrap:anywhere] ${long && !expanded ? 'line-clamp-3' : 'block'}`}
      >
        {prefix}
        {text}
        {suffix}
      </span>
      {long && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => {
            if (!expanded) onExpand?.();
            setExpanded(!expanded);
          }}
          className="mt-0.5 rounded-control font-medium text-accent text-sm hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </span>
  );
}
