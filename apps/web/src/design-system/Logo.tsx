/**
 * The Extrudo mark and wordmark (docs/05-brand.md §2). Colours come from the
 * `--x-logo-*` tokens, so the mark follows the theme (dark and light files in
 * docs/brand/).
 */
export function LogoMark({ size = 64, title = 'Extrudo logo' }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title}>
      <path d="M10 24 24 10H52L38 24Z" fill="var(--x-logo-top)" />
      <path d="M38 24 52 10V38L38 52Z" fill="var(--x-logo-side)" />
      <rect
        x="10"
        y="24"
        width="28"
        height="28"
        rx="1"
        fill="var(--x-logo-sketch-fill)"
        stroke="var(--x-logo-sketch)"
        strokeWidth="2"
        strokeDasharray="3.2 2.6"
      />
      {[
        [10, 24],
        [38, 24],
        [10, 52],
        [38, 52],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.2" fill="var(--x-logo-sketch)" />
      ))}
    </svg>
  );
}

/** `extrudo` in Instrument Sans 600, −0.04em, ending in the amber square. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-semibold tracking-[-0.04em] leading-none after:ml-[0.07em] after:inline-block after:size-[0.15em] after:rounded-[0.03em] after:bg-accent after:content-[''] ${className}`}
    >
      extrudo
    </span>
  );
}
