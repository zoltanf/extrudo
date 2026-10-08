import { X } from 'lucide-react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { Button, IconButton } from '../design-system';
import { type Box, toolOrTabSelector, useTargetBox } from './anchor';
import { TUTORIAL_FINISH, TUTORIAL_STEPS, textParts } from './tutorial';
import type { Tutorial } from './useTutorial';

const WIDTH = 288;
const MARGIN = 8;
/** Gap between the pointed-at control and the card. */
const GAP = 12;

/** `**bold**` in a step's text. */
export function StepText({ text }: { text: string }) {
  return (
    <>
      {textParts(text).map((part, i) =>
        part.bold ? (
          // The text never reorders, so its index is a stable key.
          // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
          <strong key={i} className="font-semibold text-ink">
            {part.text}
          </strong>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * The tutorial's card (P3-12, UI spec §7): which step of five, what to do, and
 * a ring round the toolbar control to use, with the card hanging under it. It
 * never blocks the app (it isn't modal and takes no focus): the tour moves on
 * by itself when the design has what the step asks for. Esc closes it while
 * focus is in the card; the whole card is a polite live region, so a screen
 * reader hears each new step.
 */
export function TutorialCard({ tutorial }: { tutorial: Tutorial }) {
  const { open, step, finished, index, facts } = tutorial;
  const target = step?.target(facts);
  const box = useTargetBox(open && target ? toolOrTabSelector(target, facts.mode) : undefined);
  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    tutorial.close();
  };

  return (
    <>
      {box && (
        <div
          aria-hidden="true"
          data-tutorial-ring={target}
          className="pointer-events-none fixed z-30 rounded-control outline-2 outline-offset-2 outline-accent motion-safe:animate-pulse"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        />
      )}
      <section
        aria-label="Tutorial"
        data-tutorial-step={finished ? 'finished' : step?.id}
        onKeyDown={onKeyDown}
        className="fixed z-30 flex flex-col gap-2 rounded-dialog border border-accent/50 bg-raised p-3.5 text-ink shadow-raised"
        style={placement(box)}
      >
        {box && (
          <span
            aria-hidden="true"
            className="absolute -top-1.5 size-3 rotate-45 border-t border-l border-accent/50 bg-raised"
            style={{ left: arrowLeft(box) }}
          />
        )}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">
            {finished ? 'All done' : `Step ${index + 1} of ${TUTORIAL_STEPS.length}`}
          </span>
          <span className="flex gap-1" aria-hidden="true">
            {TUTORIAL_STEPS.map((s, i) => (
              <span
                key={s.id}
                className={`size-1.5 rounded-full ${i < index || finished ? 'bg-accent' : i === index ? 'bg-ink' : 'bg-line'}`}
              />
            ))}
          </span>
          <IconButton label="Close tutorial" className="ml-auto size-6" onClick={tutorial.close}>
            <X size={14} />
          </IconButton>
        </div>
        <div aria-live="polite" aria-atomic="true" className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-[-0.01em]">
            {finished ? 'You made a box' : step?.title}
          </h2>
          <p className="text-sm text-muted">
            <StepText text={finished ? TUTORIAL_FINISH : (step?.text(facts) ?? '')} />
          </p>
        </div>
        <div className="mt-1 flex justify-end gap-2">
          {finished ? (
            <Button variant="primary" onClick={tutorial.close}>
              Keep designing
            </Button>
          ) : (
            <Button variant="ghost" onClick={tutorial.skip}>
              Skip step
            </Button>
          )}
        </div>
      </section>
    </>
  );
}

/** The card hangs under the control it points at, or sits over the timeline's corner. */
function placement(box: Box | undefined): CSSProperties {
  if (!box) return { width: WIDTH, left: 272, bottom: 96 };
  const left = Math.min(
    Math.max(box.left + box.width / 2 - WIDTH / 2, MARGIN),
    window.innerWidth - WIDTH - MARGIN,
  );
  return { width: WIDTH, left, top: box.top + box.height + GAP };
}

/** Where the card's notch points: the middle of the control, inside the card's edges. */
function arrowLeft(box: Box): number {
  const left = Math.min(
    Math.max(box.left + box.width / 2 - WIDTH / 2, MARGIN),
    window.innerWidth - WIDTH - MARGIN,
  );
  return Math.min(Math.max(box.left + box.width / 2 - left - 6, 14), WIDTH - 26);
}
