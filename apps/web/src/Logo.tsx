/** The Extrudo mark (docs/05-brand.md §2): a dashed sketch square becoming an amber solid. */
export function LogoMark({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Extrudo logo">
      <path d="M10 24 24 10H52L38 24Z" fill="#FFC76A" />
      <path d="M38 24 52 10V38L38 52Z" fill="#E0922A" />
      <rect
        x="10"
        y="24"
        width="28"
        height="28"
        rx="1"
        fill="rgba(90,169,255,0.16)"
        stroke="#5AA9FF"
        strokeWidth="2"
        strokeDasharray="3.2 2.6"
      />
      {[
        [10, 24],
        [38, 24],
        [10, 52],
        [38, 52],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.2" fill="#5AA9FF" />
      ))}
    </svg>
  );
}
