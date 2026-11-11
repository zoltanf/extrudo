/**
 * New drawing (P6-24, mock-up 2, plan §4.5), with what exists in slice S1: an empty sheet,
 * its paper and orientation, the title block and the projection angle. Create Drawing adds
 * the sheet as one undo step ("New drawing") and opens it; Cancel or Esc changes nothing.
 * Standard views, One view and the views' bodies and scale join with the view tools (S2).
 *
 * Test hooks: the dialog "New drawing", the select "Paper", the radio groups "Orientation"
 * and "Views are laid out", the select "Title block", the summary `[data-new-sheets-summary]`,
 * the buttons "Cancel" and "Create Drawing".
 */
import type { Sheet, SheetPaper } from '@extrudo/core';
import { useState } from 'react';
import { Button, Dialog, DialogClose, Select } from '../design-system';
import { Segmented } from './controls';
import {
  type NewSheetOptions,
  PAPER_CHOICES,
  PAPER_LABELS,
  SHEET_DEFAULTS,
  type SheetTitleChoice,
} from './defaults';

export interface NewSheetsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreate(options: Required<NewSheetOptions>): void;
}

export function NewSheetsDialog({ open, onOpenChange, onCreate }: NewSheetsDialogProps) {
  const [paper, setPaper] = useState<SheetPaper>(SHEET_DEFAULTS.size);
  const [orientation, setOrientation] = useState<Sheet['orientation']>(SHEET_DEFAULTS.orientation);
  const [titleBlock, setTitleBlock] = useState<SheetTitleChoice>(SHEET_DEFAULTS.titleBlock);
  const [projection, setProjection] = useState<Sheet['projection']>(SHEET_DEFAULTS.projection);
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
          onCreate({ size: paper, orientation, titleBlock, projection });
        }}
      >
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
          <span className="min-w-0 flex-1 text-sm text-muted" data-new-sheets-summary>
            One empty {PAPER_LABELS[paper]} {orientation} sheet
            {titleBlock === 'none' ? ', no title block' : ''}.
          </span>
          <DialogClose asChild>
            <Button>
              Cancel <span className="font-mono text-xs text-muted">Esc</span>
            </Button>
          </DialogClose>
          <Button type="submit" variant="primary">
            Create Drawing
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
