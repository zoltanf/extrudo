/**
 * New drawing (P6-24, mock-up 2, plan §4.5): what the sheet starts with, its paper and
 * orientation, the title block, the bodies, the scale and the projection angle. Create
 * Drawing adds the sheet, with its views, as one undo step ("New drawing") and opens it;
 * Cancel or Esc changes nothing.
 *
 * - **Start with**: Standard views (front, top, the side and an isometric, laid out for the
 *   projection angle at the largest standard scale that fits), One view (the sheet's scale
 *   fitted to the front view; Base View then runs to place it), or Empty sheet. A design
 *   with no shown body starts with Empty sheet.
 * - **Bodies**: All shown, or one body; **Scale**: "Fit the sheet · 1:2" or a standard one.
 *   The fitted scale and the layout come from the views' quick lines (`plan`), measured
 *   whenever a choice changes; Create waits for them.
 *
 * Test hooks: the dialog "New drawing", the radio group "Start with" (radios "Standard
 * views", "One view", "Empty sheet"), the selects "Paper", "Title block", "Bodies" and
 * "Scale", the radio groups "Orientation" and "Views are laid out", the summary
 * `[data-new-sheets-summary]`, the buttons "Cancel" and "Create Drawing".
 */
import type { BodyId, Sheet, SheetPaper, SheetScale } from '@extrudo/core';
import { useEffect, useState } from 'react';
import { Button, Dialog, DialogClose, Select } from '../design-system';
import { Segmented } from './controls';
import {
  type NewSheetOptions,
  PAPER_CHOICES,
  PAPER_LABELS,
  SHEET_DEFAULTS,
  type SheetTitleChoice,
} from './defaults';
import type { SheetStart, SheetStartPlan, SheetStartRequest } from './standardViews';

/** The standard scales the Scale menu offers besides the fitted one (as `views.ts` has them). */
const SCALES: readonly SheetScale[] = [
  [5, 1],
  [2, 1],
  [1, 1],
  [1, 2],
  [1, 5],
  [1, 10],
  [1, 20],
  [1, 50],
];
const scaleText = ([a, b]: SheetScale) => `${a}:${b}`;

export interface NewSheetsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The bodies at the marker that are shown, by name, in the browser's order. */
  bodies: readonly { id: BodyId; name: string }[];
  /** Measures and lays out the views for a start (lazily loaded); `undefined`: none to draw. */
  plan?(start: SheetStart, request: SheetStartRequest): Promise<SheetStartPlan | undefined>;
  onCreate(options: Required<NewSheetOptions>, start: SheetStart, plan?: SheetStartPlan): void;
}

const STARTS: { value: SheetStart; label: string; hint: string; picture: string }[] = [
  {
    value: 'standard',
    label: 'Standard views',
    hint: 'Front, top, side and an isometric, scaled to fit.',
    picture: 'M8 8h26v14H8ZM8 30h26v18H8ZM42 8h14v14H42ZM60 34l10-6 8 5v10l-10 6-8-5Z',
  },
  {
    value: 'one',
    label: 'One view',
    hint: 'Place a base view yourself and build from it.',
    picture: 'M22 14h40v28H22Z',
  },
  {
    value: 'empty',
    label: 'Empty sheet',
    hint: 'Just the border and the title block.',
    picture: 'M50 40h30v12H50Z',
  },
];

export function NewSheetsDialog({
  open,
  onOpenChange,
  bodies,
  plan,
  onCreate,
}: NewSheetsDialogProps) {
  const [paper, setPaper] = useState<SheetPaper>(SHEET_DEFAULTS.size);
  const [orientation, setOrientation] = useState<Sheet['orientation']>(SHEET_DEFAULTS.orientation);
  const [titleBlock, setTitleBlock] = useState<SheetTitleChoice>(SHEET_DEFAULTS.titleBlock);
  const [projection, setProjection] = useState<Sheet['projection']>(SHEET_DEFAULTS.projection);
  const [start, setStart] = useState<SheetStart>('empty');
  const [body, setBody] = useState<BodyId | 'all'>('all');
  const [scale, setScale] = useState<string>('fit');
  const [planned, setPlanned] = useState<{ key: string; plan: SheetStartPlan | undefined }>();
  // Each opening starts from the views when there is something to draw.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on opening only.
  useEffect(() => {
    if (!open) return;
    setStart(bodies.length > 0 && plan ? 'standard' : 'empty');
    setBody('all');
    setScale('fit');
  }, [open]);
  const chosenScale = SCALES.find((s) => scaleText(s) === scale);
  const request: SheetStartRequest = {
    size: paper,
    orientation,
    titleBlock,
    projection,
    ...(body !== 'all' && { bodies: [body] }),
    ...(chosenScale && { scale: chosenScale }),
  };
  const key = JSON.stringify([start, request]);
  useEffect(() => {
    if (!open || start === 'empty' || !plan) return;
    let live = true;
    void plan(start, JSON.parse(key)[1] as SheetStartRequest).then(
      (result) => live && setPlanned({ key, plan: result }),
      () => live && setPlanned({ key, plan: undefined }),
    );
    return () => {
      live = false;
    };
  }, [open, key, start, plan]);
  const current = planned?.key === key ? planned : undefined;
  const waiting = start !== 'empty' && current === undefined;
  const nothing = start !== 'empty' && current !== undefined && current.plan === undefined;
  const sheetText = `one ${PAPER_LABELS[paper]} ${orientation} sheet`;
  const count = body === 'all' ? bodies.length : 1;
  const of = `${count} ${count === 1 ? 'body' : 'bodies'}`;
  const summary =
    start === 'empty'
      ? `One empty ${PAPER_LABELS[paper]} ${orientation} sheet${titleBlock === 'none' ? ', no title block' : ''}.`
      : waiting
        ? 'Measuring the views…'
        : nothing
          ? 'Nothing to draw yet: no shown body, or the model is still being computed.'
          : start === 'standard'
            ? `4 views of ${of} on ${sheetText}.`
            : `One view of ${of} to place on ${sheetText}.`;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New drawing"
      description="Sheets of the design to print or send, made from the model."
      size="medium"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (waiting || nothing) return;
          onCreate({ size: paper, orientation, titleBlock, projection }, start, current?.plan);
        }}
      >
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">
            Start with
          </span>
          <div role="radiogroup" aria-label="Start with" className="flex gap-2.5">
            {STARTS.map((choice) => (
              // biome-ignore lint/a11y/useSemanticElements: a card that is one of three choices
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={start === choice.value}
                aria-label={choice.label}
                disabled={choice.value !== 'empty' && (bodies.length === 0 || !plan)}
                onClick={() => setStart(choice.value)}
                className="flex min-w-0 flex-1 flex-col gap-2 rounded-control border border-line bg-bg p-2.5 text-left hover:border-muted disabled:opacity-40 aria-checked:border-accent aria-checked:bg-accent-soft"
              >
                <svg
                  viewBox="0 0 84 56"
                  aria-hidden="true"
                  className="h-auto w-full rounded-[3px] bg-white"
                >
                  <path
                    d={choice.picture}
                    fill="none"
                    stroke={choice.value === 'empty' ? '#939cad' : '#15171c'}
                    strokeWidth={choice.value === 'empty' ? 1 : 1.4}
                  />
                </svg>
                <span>
                  <span className="block font-semibold">{choice.label}</span>
                  <span className="block text-sm text-muted">{choice.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted">Sheet size</span>
            <Select
              aria-label="Paper"
              value={paper}
              onChange={(event) => setPaper(event.target.value as SheetPaper)}
            >
              {PAPER_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted">Orientation</span>
            <Segmented<Sheet['orientation']>
              label="Orientation"
              value={orientation}
              options={[
                { value: 'landscape', label: 'Landscape' },
                { value: 'portrait', label: 'Portrait' },
              ]}
              onChange={setOrientation}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted">Title block</span>
            <Select
              aria-label="Title block"
              value={titleBlock}
              onChange={(event) => setTitleBlock(event.target.value as SheetTitleChoice)}
            >
              <option value="simple">Simple</option>
              <option value="full">Full</option>
              <option value="none">None</option>
            </Select>
          </div>
          {start !== 'empty' && (
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted">Bodies</span>
              <Select
                aria-label="Bodies"
                value={body}
                onChange={(event) => setBody(event.target.value as BodyId | 'all')}
              >
                <option value="all">All shown ({bodies.length})</option>
                {bodies.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {start !== 'empty' && (
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted">Scale</span>
              <Select
                aria-label="Scale"
                value={scale}
                onChange={(event) => setScale(event.target.value)}
              >
                <option value="fit">
                  Fit the sheet{current?.plan ? ` · ${scaleText(current.plan.fit)}` : ''}
                </option>
                {SCALES.map((s) => (
                  <option key={scaleText(s)} value={scaleText(s)}>
                    {scaleText(s)}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted">Views are laid out</span>
            <Segmented<Sheet['projection']>
              label="Views are laid out"
              value={projection}
              options={[
                { value: 'first', label: 'First angle' },
                { value: 'third', label: 'Third angle' },
              ]}
              onChange={setProjection}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-line pt-3">
          <span
            className={`min-w-0 flex-1 text-sm ${nothing ? 'text-error' : 'text-muted'}`}
            data-new-sheets-summary
            aria-live="polite"
          >
            {summary}
          </span>
          <DialogClose asChild>
            <Button>
              Cancel <span className="font-mono text-xs text-muted">Esc</span>
            </Button>
          </DialogClose>
          <Button type="submit" variant="primary" disabled={waiting || nothing}>
            Create Drawing
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
