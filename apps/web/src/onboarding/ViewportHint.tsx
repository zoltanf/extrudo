import { toolSelector, useTargetBox } from './anchor';
import { StepText } from './TutorialCard';

/** Where the hint's card starts: right of the browser's default width, under the toolbar. */
const CARD_LEFT = 288;
const CARD_GAP = 20;

/**
 * The hint over an empty design (P3-12, UI spec §7): where to start, with a
 * dashed arrow from the words up to the Create Sketch tile. It shows while the
 * design has no features and goes with the first one; it takes no clicks.
 */
export function ViewportHint({ show }: { show: boolean }) {
  const box = useTargetBox(show ? toolSelector('sketch') : undefined);
  if (!show || !box) return null;
  const tileX = box.left + box.width / 2;
  // The arrow ends just under the tile's group label, in the gap above the browser's header.
  const tileY = box.top + box.height + 16;
  const cardTop = tileY + CARD_GAP;
  const startY = cardTop + 16;
  return (
    <div
      role="note"
      aria-label="How to start"
      data-viewport-hint=""
      className="pointer-events-none fixed inset-0 z-20"
    >
      <svg aria-hidden="true" className="absolute inset-0 size-full overflow-visible">
        <defs>
          <marker
            id="hint-arrowhead"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path
              d="M1 1 L9 5 L1 9"
              fill="none"
              stroke="var(--x-accent)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        </defs>
        <path
          d={`M ${CARD_LEFT - 6} ${startY} C ${CARD_LEFT - 110} ${startY}, ${tileX + 10} ${startY - 4}, ${tileX} ${tileY}`}
          fill="none"
          stroke="var(--x-accent)"
          strokeWidth="2"
          strokeDasharray="2 7"
          strokeLinecap="round"
          markerEnd="url(#hint-arrowhead)"
        />
      </svg>
      <p
        className="absolute rounded-control border border-line bg-raised px-3 py-1.5 text-sm text-ink shadow-raised"
        style={{ left: CARD_LEFT, top: cardTop }}
      >
        <StepText text="Start with a sketch: press **Create Sketch** and pick a plane." />
      </p>
    </div>
  );
}
