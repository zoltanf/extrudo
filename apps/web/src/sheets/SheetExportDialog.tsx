/**
 * Export drawing (P6-24, mock-up 4, plan §4.5), with what exists in slice S1: the sheets as
 * checkboxes, PDF (one file, a page per chosen sheet) or SVG (one file per sheet), the file
 * name and a summary line. The format is remembered (`export.sheets`). PNG, DXF, the line
 * colour and the sticky-note and shaded-view switches come with the slices that need them.
 *
 * Before a file is written the chosen sheets' views are drawn exactly from the model (S2),
 * one at a time: the summary says how far ("Drawing the views · 2 of 4"), and Cancel stops
 * it before the next view (nothing is written).
 *
 * Test hooks: the dialog "Export drawing", a checkbox per sheet named "n · name", the radio
 * group "Format" ("PDF", "SVG"), the textbox "File name", `[data-sheet-export-summary]`, the
 * buttons "Cancel" and "Export".
 */
import type { BodyId, ExtrudoDocument, SheetId } from '@extrudo/core';
import { isSheetViewsCancelled } from '@extrudo/kernel';
import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, DialogClose, TextInput } from '../design-system';
import type { FileAccess } from '../platform/files';
import type { Preferences } from '../platform/preferences';
import { Segmented } from './controls';
import { sizeLabel } from './defaults';
import {
  defaultExportName,
  exportSheets,
  SHEET_EXPORT_KEY,
  type SheetExportFormat,
  sheetExportPlan,
} from './exportSheets';
import type { SheetViewsKernel } from './viewRunner';

/** What opened the dialog: every sheet (Export PDF), or the sheets given (Export This Sheet). */
export interface SheetExportRequest {
  ids?: readonly SheetId[];
}

export interface SheetExportDialogProps {
  request: SheetExportRequest | undefined;
  doc: ExtrudoDocument;
  files: Pick<FileAccess, 'download'>;
  /** The views' model: the project's kernel and the bodies at the marker. */
  views?: { kernel: SheetViewsKernel; bodies(): readonly BodyId[] };
  preferences: Preferences;
  notify(tone: 'info' | 'error', text: string): void;
  onClose(): void;
}

const FORMATS: { value: SheetExportFormat; label: string; hint: string }[] = [
  { value: 'pdf', label: 'PDF', hint: 'For printing and sharing. Lines stay sharp at any size.' },
  {
    value: 'svg',
    label: 'SVG',
    hint: 'One file per sheet, for drawing programs, laser cutters and the web.',
  },
];

const num = (n: number) => String(Math.round(n * 1000) / 1000);

export function SheetExportDialog({
  request,
  doc,
  files,
  preferences,
  notify,
  onClose,
  views,
}: SheetExportDialogProps) {
  const sheets = doc.sheets ?? [];
  const [chosen, setChosen] = useState<ReadonlySet<SheetId>>(new Set());
  const [format, setFormat] = useState<SheetExportFormat>('pdf');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState<{ done: number; total: number }>();
  // Each opening starts from what it was asked for, and the remembered format.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on opening only.
  useEffect(() => {
    if (!request) return;
    setChosen(new Set(request.ids ?? sheets.map((s) => s.id)));
    setName(defaultExportName(doc, request.ids));
    const stored = preferences.get<{ format?: string }>(SHEET_EXPORT_KEY, {});
    setFormat(stored.format === 'svg' ? 'svg' : 'pdf');
  }, [request]);
  const plan = useMemo(
    () => sheetExportPlan(doc, chosen, format, name.trim() || doc.name),
    [doc, chosen, format, name],
  );
  const toggle = (id: SheetId, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    setChosen(next);
  };
  const hint = FORMATS.find((f) => f.value === format)?.hint;
  const many = plan.sheets.length > 1;
  return (
    <Dialog
      open={request !== undefined}
      onOpenChange={(open) => {
        if (open) return;
        // Closing while the views are drawn stops them before the next one.
        if (busy) views?.kernel.cancelSheetViews();
        onClose();
      }}
      title="Export drawing"
      size="medium"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (plan.sheets.length === 0 || busy) return;
          setBusy(true);
          preferences.set(SHEET_EXPORT_KEY, { format });
          exportSheets(
            doc,
            files,
            plan,
            format,
            views && {
              kernel: views.kernel,
              bodies: views.bodies(),
              onProgress: (done, total) => setDrawing(total > 0 ? { done, total } : undefined),
            },
          )
            .then(() => onClose())
            .catch((error: unknown) => {
              if (isSheetViewsCancelled(error)) return;
              notify(
                'error',
                `The drawing couldn't be exported: ${error instanceof Error ? error.message : String(error)}`,
              );
            })
            .finally(() => {
              setBusy(false);
              setDrawing(undefined);
            });
        }}
      >
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-5">
          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="mb-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
              Sheets
            </legend>
            {sheets.map((sheet, index) => (
              <label
                key={sheet.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-control border border-line px-2.5 py-1.5 has-checked:border-accent has-checked:bg-accent-soft"
              >
                <input
                  type="checkbox"
                  checked={chosen.has(sheet.id)}
                  onChange={(event) => toggle(sheet.id, event.target.checked)}
                  aria-label={`${index + 1} · ${sheet.name}`}
                  className="accent-(--x-accent)"
                />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {index + 1} · {sheet.name}
                  </span>
                  <span className="block truncate text-sm text-muted">
                    {sizeLabel(sheet.size)} {sheet.orientation} · {num(sheet.scale[0])}:
                    {num(sheet.scale[1])}
                  </span>
                </span>
              </label>
            ))}
            <span className="text-sm text-muted">
              {format === 'svg'
                ? 'Each sheet becomes a file of its own.'
                : many
                  ? 'The sheets go into one file, in this order.'
                  : 'One page.'}
            </span>
          </fieldset>
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">
                Format
              </span>
              <Segmented<SheetExportFormat>
                label="Format"
                value={format}
                options={FORMATS}
                onChange={setFormat}
              />
              <span className="text-sm text-muted">{hint}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted">File name</span>
              <span className="flex items-center gap-1">
                <TextInput
                  aria-label="File name"
                  value={name}
                  maxLength={200}
                  onChange={(event) => setName(event.target.value)}
                />
                <span className="font-mono text-sm text-muted">.{format}</span>
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-line pt-3">
          <span
            className={`min-w-0 flex-1 text-sm ${plan.sheets.length === 0 ? 'text-error' : 'text-muted'}`}
            data-sheet-export-summary=""
            aria-live="polite"
          >
            {drawing && busy
              ? `Drawing the views · ${Math.min(drawing.done + 1, drawing.total)} of ${drawing.total}`
              : plan.summary}
          </span>
          <DialogClose asChild>
            <Button>
              Cancel <span className="font-mono text-xs text-muted">Esc</span>
            </Button>
          </DialogClose>
          <Button type="submit" variant="primary" disabled={plan.sheets.length === 0 || busy}>
            Export
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
