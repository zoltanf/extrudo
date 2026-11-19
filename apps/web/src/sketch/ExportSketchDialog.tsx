import { type DocumentStore, type FeatureId, readSketch } from '@extrudo/core';
import { num } from '@extrudo/io';
import { X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { Button, Dialog, DialogClose, IconButton } from '../design-system';
import type { FileAccess } from '../platform';
import {
  type ExportContent,
  type ExportFormat,
  sketchExport,
  sketchExportFile,
} from './exportFile';
import { fontsStore } from './fonts';
import { sketchProfilesFound } from './profiles';

export interface ExportRequest {
  sketch: FeatureId;
  /** Profiles selected in the sketch (region IDs): offered, and chosen first. */
  selected: readonly string[];
}

export interface ExportSketchDialogProps {
  store: DocumentStore;
  /** The sketch to export; the dialog is open while there is one. */
  request: ExportRequest | undefined;
  files: FileAccess;
  onClose(): void;
}

/**
 * Export Sketch (P1-13, FR-SK-15/16): SVG or DXF, of the sketch's curves
 * (construction optional) or its profiles, at 1 unit = 1 mm. Shows the size
 * before saving and says so when there's nothing to export.
 */
export function ExportSketchDialog({ store, request, files, onClose }: ExportSketchDialogProps) {
  const doc = useStore(store, (s) => s.doc);
  const feature = request && doc.features.find((f) => f.id === request.sketch);
  const sketch = feature && readSketch(feature);
  const selected = request?.selected ?? [];

  const [format, setFormat] = useState<ExportFormat>('svg');
  const [content, setContent] = useState<ExportContent>('curves');
  const [construction, setConstruction] = useState(false);
  // The profiles are looked up once per version of the sketch's data, when first needed:
  // a result too large to keep isn't found again on each render.
  const data = sketch?.data;
  const fonts = useStore(fontsStore, (s) => s.version);
  const found = useMemo(() => {
    let result: ReturnType<typeof sketchProfilesFound> | undefined;
    return () => {
      if (data) result ??= sketchProfilesFound(data, fonts);
      return result;
    };
  }, [data, fonts]);
  // Each request starts from its selection: selected profiles if there are any,
  // unless the sketch's profiles can't be found, when they would export nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new request chooses again.
  useEffect(() => {
    if (!request) return;
    const usable = request.selected.length > 0 && !found()?.refused;
    setContent(usable ? 'selected' : 'curves');
  }, [request]);

  const name = feature?.name;
  const exported = useMemo(
    () =>
      data && name !== undefined
        ? sketchExport(data, name, {
            content,
            construction,
            selected,
            ...(content !== 'curves' && { profiles: found()?.profiles ?? [] }),
          })
        : undefined,
    [data, name, content, construction, selected, found],
  );
  const size = exported?.bounds;
  const noun =
    content === 'curves'
      ? exported?.count === 1
        ? 'curve'
        : 'curves'
      : exported?.count === 1
        ? 'profile'
        : 'profiles';
  // Asked only for profiles: exporting curves needs no detection.
  const refused = content !== 'curves' ? found()?.refused : undefined;
  const empty =
    content === 'curves'
      ? 'This sketch has no curves to export.'
      : refused
        ? `${refused} All curves can still be exported.`
        : 'This sketch has no closed profiles. Close a shape to make one.';

  const save = () => {
    if (!exported || !feature || !size) return;
    const file = sketchExportFile(exported, format, { project: doc.name, sketch: feature.name });
    files.download(file.blob, file.name);
    onClose();
  };

  return (
    <Dialog
      open={request !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="small"
      title="Export sketch"
      description={feature ? `${feature.name}, at 1 unit = 1 mm.` : undefined}
      actions={
        <DialogClose asChild>
          <IconButton label="Close">
            <X size={18} strokeWidth={1.75} />
          </IconButton>
        </DialogClose>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Choice legend="Format">
          <Radio name="format" checked={format === 'svg'} onChange={() => setFormat('svg')}>
            SVG <Hint>laser cutters, vinyl, slicers</Hint>
          </Radio>
          <Radio name="format" checked={format === 'dxf'} onChange={() => setFormat('dxf')}>
            DXF <Hint>R12, for CAD and CNC</Hint>
          </Radio>
        </Choice>
        <Choice legend="Contents">
          <Radio
            name="content"
            checked={content === 'curves'}
            onChange={() => setContent('curves')}
          >
            All curves
          </Radio>
          <label
            className={`ml-7 flex h-6 items-center gap-2 text-sm ${content === 'curves' ? '' : 'opacity-45'}`}
          >
            <input
              type="checkbox"
              checked={construction}
              disabled={content !== 'curves'}
              onChange={(e) => setConstruction(e.target.checked)}
              className="accent-(--x-accent)"
            />
            Include construction geometry
          </label>
          <Radio
            name="content"
            checked={content === 'profiles'}
            onChange={() => setContent('profiles')}
          >
            All profiles <Hint>closed regions, filled, with holes</Hint>
          </Radio>
          {selected.length > 0 && (
            <Radio
              name="content"
              checked={content === 'selected'}
              onChange={() => setContent('selected')}
            >
              Selected {selected.length === 1 ? 'profile' : `profiles (${selected.length})`}
            </Radio>
          )}
        </Choice>

        <p className="min-h-5 text-sm" aria-live="polite" data-export-summary>
          {size ? (
            <span className="text-muted">
              {exported?.count} {noun},{' '}
              <span className="text-ink tabular-nums">
                {num(size.maxX - size.minX, 2)} × {num(size.maxY - size.minY, 2)} mm
              </span>
            </span>
          ) : (
            <span className="text-error">{empty}</span>
          )}
        </p>

        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button type="submit" variant="primary" disabled={!size}>
            Export {format.toUpperCase()}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** A fieldset of options with a legend (the export dialogs). */
export function Choice({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 font-semibold">{legend}</legend>
      {children}
    </fieldset>
  );
}

export function Radio({
  name,
  checked,
  onChange,
  children,
}: {
  name: string;
  checked: boolean;
  onChange(): void;
  children: ReactNode;
}) {
  return (
    <label className="flex h-7 cursor-pointer items-center gap-2 rounded-input px-1 hover:bg-accent-soft">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="accent-(--x-accent)"
      />
      <span>{children}</span>
    </label>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <span className="ml-1 text-sm text-muted">{children}</span>;
}
