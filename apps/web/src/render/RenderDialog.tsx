import {
  type DocumentStore,
  type ModelStore,
  RENDER_FINISH_INFO,
  RENDER_FINISHES,
  RENDER_PRESET_INFO,
  RENDER_PRESETS,
  RENDER_QUALITIES,
  RENDER_SIZES,
  type RenderFinish,
  type RenderPreset,
  type RenderQuality,
  type RenderSettings,
  type SessionStore,
  setRenderSettings,
  type ViewCamera,
} from '@extrudo/core';
import { isExportCancelled, RESOLUTIONS } from '@extrudo/kernel';
import { X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Button, Dialog, DialogClose, IconButton, Select } from '../design-system';
import { type MeshedBodies, type ModelExporter, meshBodies } from '../export/modelExport';
import type { FileAccess } from '../platform/files';
import {
  BLENDER_DOWNLOAD_URL,
  BLENDER_MIN_VERSION,
  type BlenderRenderer,
  type BlenderStatus,
  type RenderProgress,
} from '../platform/render';
import type { BodyEntry } from '../shell/bodies';
import { Choice, Hint, Radio } from '../sketch/ExportSketchDialog';
import {
  buildRenderJob,
  currentRenderSettings,
  finishOf,
  jobCamera,
  renderFileName,
  settingsChanged,
  withFinish,
} from './renderJob';

/** Opens the dialog (no options yet). */
export type RenderRequest = Record<string, never>;

export interface RenderDialogProps {
  store: DocumentStore;
  session: SessionStore;
  model: ModelStore<unknown>;
  /** The model's live bodies, in browser order. */
  bodies: readonly BodyEntry[];
  /** The project's kernel; without one nothing can be rendered. */
  kernel: ModelExporter | undefined;
  request: RenderRequest | undefined;
  files: FileAccess;
  render: BlenderRenderer;
  /** The viewport's camera now, as a named view's camera. */
  viewportCamera: () => ViewCamera;
  /** Opens a link in the system browser (`Platform.openLink`). */
  openLink?(url: string): void;
  onClose(): void;
  notify?(tone: 'info' | 'error', text: string): void;
}

/**
 * Render Picture (P6-13, ADR-0101 §1): a presentable picture of the design,
 * rendered by Blender on this computer. Choices are kept in the design's
 * `render` section when they changed; the picture is not stored.
 */
export function RenderDialog(props: RenderDialogProps) {
  // Closing is refused while a render runs (Esc and the overlay included): Cancel stops it.
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={props.request !== undefined}
      onOpenChange={(value) => {
        if (!value && !busy) props.onClose();
      }}
      size="small"
      title="Render picture"
      description="A picture of the design, rendered by Blender on this computer."
      actions={
        <DialogClose asChild>
          <IconButton label="Close" disabled={busy}>
            <X size={18} strokeWidth={1.75} />
          </IconButton>
        </DialogClose>
      }
    >
      <RenderForm {...props} onBusy={setBusy} />
    </Dialog>
  );
}

type Stage =
  | { kind: 'form' }
  | { kind: 'meshing'; done: number; total: number }
  | { kind: 'rendering'; progress: RenderProgress | undefined }
  | { kind: 'result'; blob: Blob; url: string };

const PHASES: Record<RenderProgress['phase'], string> = {
  starting: 'Starting Blender…',
  importing: 'Importing…',
  rendering: 'Rendering…',
  saving: 'Saving…',
};
const QUALITY_HINTS: Record<RenderQuality, string> = {
  draft: 'Seconds, rough',
  standard: 'A minute or two',
  high: 'Several minutes, finest',
};
const QUALITY_LABELS: Record<RenderQuality, string> = {
  draft: 'Draft',
  standard: 'Standard',
  high: 'High',
};

export function phaseText(progress: RenderProgress | undefined): string {
  if (!progress) return PHASES.starting;
  if (progress.phase !== 'rendering') return PHASES[progress.phase];
  return `Rendering… ${Math.round(progress.fraction * 100)} %`;
}

const sizeValue = (w: number, h: number) => `${w}x${h}`;
const sizeLabel = (w: number, h: number) => `${w} × ${h}`;

/** The dialog's body, without the dialog around it (the unit test renders this). */
export function RenderForm({
  store,
  model,
  bodies,
  kernel,
  request,
  files,
  render,
  viewportCamera,
  openLink,
  onClose,
  onBusy,
  notify = () => {},
}: RenderDialogProps & { onBusy?(busy: boolean): void }) {
  const doc = useStore(store, (s) => s.doc);
  const status = useStore(model, (s) => s.status);
  const open = request !== undefined;
  const stored = useMemo(() => currentRenderSettings(doc), [doc]);
  const [chosen, setChosen] = useState<RenderSettings>(stored);
  const [blender, setBlender] = useState<BlenderStatus>();
  const [stage, setStage] = useState<Stage>({ kind: 'form' });
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string }>();
  const cancelled = useRef(false);
  const running = useRef(false);
  const url = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    let current = true;
    render.status().then(
      (s) => current && setBlender(s),
      () => current && setBlender({ state: 'missing' }),
    );
    return () => {
      current = false;
    };
  }, [open, render]);

  // A closed dialog stops what runs and lets the picture go.
  useEffect(
    () => () => {
      if (running.current) render.cancel();
      cancelled.current = true;
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [render],
  );

  const shown = useMemo(() => bodies.filter((b) => b.display === 'shown' && !b.pending), [bodies]);
  // Saving the render settings changes the document without changing any body, so only a
  // running recompute makes the model wait.
  const current = status === 'ready';
  const busy = stage.kind === 'meshing' || stage.kind === 'rendering';
  useEffect(() => {
    onBusy?.(busy);
    return () => onBusy?.(false);
  }, [busy, onBusy]);

  let blocker: string | undefined;
  if (!kernel) blocker = "The kernel isn't running.";
  else if (shown.length === 0) blocker = 'Nothing to render: every body is hidden.';
  else if (!current) blocker = 'Waiting for the model to finish computing…';
  const canRender = blender?.state === 'found' && blocker === undefined;

  const update = (change: Partial<RenderSettings>) => setChosen((c) => ({ ...c, ...change }));

  const start = async () => {
    if (!canRender || !kernel) return;
    setMessage(undefined);
    // One undo step, and nothing when the choices are what is stored.
    if (settingsChanged(stored, chosen)) {
      store.getState().dispatch(setRenderSettings({ render: chosen }));
    }
    cancelled.current = false;
    running.current = true;
    setStage({ kind: 'meshing', done: 0, total: shown.length });
    try {
      let meshed: MeshedBodies;
      try {
        meshed = await meshBodies(
          kernel,
          shown.map(({ id, meta }) => ({ id, meta })),
          RESOLUTIONS.medium,
          (done, total) => {
            if (cancelled.current) return false;
            setStage({ kind: 'meshing', done, total });
            return true;
          },
        );
      } catch (error) {
        if (cancelled.current || isExportCancelled(error)) {
          setMessage({ tone: 'info', text: 'Render cancelled.' });
        } else {
          setMessage({
            tone: 'error',
            text: error instanceof Error ? error.message : String(error),
          });
        }
        setStage({ kind: 'form' });
        return;
      }
      if (cancelled.current) {
        setMessage({ tone: 'info', text: 'Render cancelled.' });
        setStage({ kind: 'form' });
        return;
      }
      setStage({ kind: 'rendering', progress: undefined });
      const job = buildRenderJob(doc.name, meshed, chosen, jobCamera(chosen, doc, viewportCamera));
      const result = await render.render(job, (progress) =>
        setStage({ kind: 'rendering', progress }),
      );
      if (result.ok) {
        const blob = new Blob([result.png as Uint8Array<ArrayBuffer>], { type: 'image/png' });
        const picture = URL.createObjectURL(blob);
        url.current = picture;
        setStage({ kind: 'result', blob, url: picture });
      } else {
        setMessage(
          result.cancelled
            ? { tone: 'info', text: 'Render cancelled.' }
            : { tone: 'error', text: result.message },
        );
        setStage({ kind: 'form' });
      }
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
      setStage({ kind: 'form' });
    } finally {
      running.current = false;
    }
  };

  const cancel = () => {
    cancelled.current = true;
    if (stage.kind === 'rendering') render.cancel();
  };

  const again = () => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = undefined;
    setMessage(undefined);
    setStage({ kind: 'form' });
  };

  if (stage.kind === 'result') {
    const { blob, url: src } = stage;
    // The text names what the picture is, so it says "picture".
    const altText = `Rendered picture of ${doc.name}`;
    const copy = async () => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        notify('info', 'Copied');
      } catch {
        notify('error', "Couldn't copy");
      }
    };
    return (
      <div className="flex flex-col gap-4">
        <img
          src={src}
          alt={altText}
          className="max-h-[60vh] w-full rounded-input border border-line object-contain"
        />
        <div className="flex justify-end gap-2">
          <Button onClick={again}>Render again</Button>
          <Button onClick={() => void copy()}>Copy</Button>
          <Button
            variant="primary"
            onClick={() => files.download(blob, renderFileName(doc.name, chosen.preset))}
          >
            Save PNG…
          </Button>
        </div>
      </div>
    );
  }

  const views = doc.views;
  const cameraValue =
    chosen.camera.kind === 'view'
      ? views.some((v) => v.id === (chosen.camera as { id: string }).id)
        ? `view:${chosen.camera.id}`
        : 'auto'
      : chosen.camera.kind;
  const onCamera = (value: string) =>
    update({
      camera:
        value === 'auto' || value === 'current'
          ? { kind: value }
          : { kind: 'view', id: value.slice(5) as (typeof views)[number]['id'] },
    });
  const sizes = RENDER_SIZES.some(([w, h]) => w === chosen.width && h === chosen.height)
    ? RENDER_SIZES
    : [...RENDER_SIZES, [chosen.width, chosen.height] as const];

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <BlenderLine status={blender} openLink={openLink} />

      <fieldset className="flex flex-col gap-1" disabled={busy}>
        <legend className="mb-1 font-semibold">Scene</legend>
        <PresetCards value={chosen.preset} onChange={(preset) => update({ preset })} />
      </fieldset>

      <fieldset className="flex flex-col gap-1" disabled={busy}>
        <legend className="mb-1 font-semibold">Bodies</legend>
        {shown.length === 0 && <p className="text-sm text-muted">No bodies are shown.</p>}
        {shown.map((body) => (
          <div key={body.id} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full border border-line"
              style={{ background: body.meta.color ?? 'var(--x-body-default)' }}
            />
            <span className="min-w-0 flex-1 truncate">{body.meta.name}</span>
            <Select
              aria-label={`Finish of ${body.meta.name}`}
              className="w-36"
              value={finishOf(chosen, body.id)}
              onChange={(event) =>
                setChosen((c) => withFinish(c, body.id, event.target.value as RenderFinish))
              }
            >
              {RENDER_FINISHES.map((finish) => (
                <option key={finish} value={finish} title={RENDER_FINISH_INFO[finish].hint}>
                  {RENDER_FINISH_INFO[finish].label}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </fieldset>

      <fieldset className="grid grid-cols-2 gap-3 text-sm" disabled={busy}>
        <div className="flex flex-col gap-1">
          <span className="text-muted">Camera</span>
          <Select
            aria-label="Camera"
            value={cameraValue}
            onChange={(event) => onCamera(event.target.value)}
          >
            <option value="auto">Automatic</option>
            <option value="current">Current view</option>
            {views.map((view) => (
              <option key={view.id} value={`view:${view.id}`}>
                {view.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted">Size</span>
          <Select
            aria-label="Size"
            value={sizeValue(chosen.width, chosen.height)}
            onChange={(event) => {
              const [w, h] = event.target.value.split('x').map(Number);
              update({ width: w as number, height: h as number });
            }}
          >
            {sizes.map(([w, h]) => (
              <option key={sizeValue(w, h)} value={sizeValue(w, h)}>
                {sizeLabel(w, h)}
              </option>
            ))}
          </Select>
        </div>
      </fieldset>

      <fieldset disabled={busy}>
        <Choice legend="Quality">
          {RENDER_QUALITIES.map((quality) => (
            <Radio
              key={quality}
              name="render-quality"
              checked={chosen.quality === quality}
              onChange={() => update({ quality })}
            >
              {QUALITY_LABELS[quality]} <Hint>{QUALITY_HINTS[quality]}</Hint>
            </Radio>
          ))}
        </Choice>
      </fieldset>

      {stage.kind === 'meshing' && (
        <Progress
          label="Preparing the model… "
          text={`Preparing the model… ${stage.done}/${stage.total}`}
          fraction={stage.total > 0 ? stage.done / stage.total : undefined}
        />
      )}
      {stage.kind === 'rendering' && (
        <Progress
          label="Rendering"
          text={phaseText(stage.progress)}
          fraction={stage.progress?.fraction}
        />
      )}
      {message && (
        <p
          className={`text-sm ${message.tone === 'error' ? 'text-error' : 'text-muted'}`}
          aria-live="polite"
          data-render-message
        >
          {message.text}
        </p>
      )}
      {blocker && !busy && (
        <p className="text-sm text-muted" data-render-blocker>
          {blocker}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {busy ? (
          <Button onClick={cancel}>Cancel</Button>
        ) : (
          <Button onClick={onClose}>Cancel</Button>
        )}
        <Button type="submit" variant="primary" disabled={!canRender || busy}>
          Render
        </Button>
      </div>
    </form>
  );
}

function BlenderLine({
  status,
  openLink,
}: {
  status: BlenderStatus | undefined;
  openLink: ((url: string) => void) | undefined;
}) {
  if (!status) return <p className="text-sm text-muted">Looking for Blender…</p>;
  if (status.state === 'found') {
    return (
      <p className="text-sm text-muted" data-blender="found">
        Blender {status.version} found.
      </p>
    );
  }
  if (status.state === 'too-old') {
    return (
      <p className="text-sm text-error" data-blender="too-old">
        Blender {status.version} is too old: {BLENDER_MIN_VERSION} or newer is needed.
      </p>
    );
  }
  return (
    <p className="text-sm text-error" data-blender="missing">
      Blender isn't installed, or isn't where the app looks. Install it from{' '}
      <a
        href={BLENDER_DOWNLOAD_URL}
        className="underline"
        onClick={(event) => {
          if (!openLink) return;
          event.preventDefault();
          openLink(BLENDER_DOWNLOAD_URL);
        }}
      >
        blender.org
      </a>{' '}
      or set its path in Settings › Desktop.
    </p>
  );
}

/** The four scene cards, one radio group: arrows move and select. */
function PresetCards({
  value,
  onChange,
}: {
  value: RenderPreset;
  onChange(preset: RenderPreset): void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent, from: number) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const to = (from + step + RENDER_PRESETS.length) % RENDER_PRESETS.length;
    onChange(RENDER_PRESETS[to] as RenderPreset);
    refs.current[to]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Scene" className="grid grid-cols-4 gap-2">
      {RENDER_PRESETS.map((preset, i) => {
        const on = preset === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: cards in a radio group, arrows move (ADR-0101 §1)
          <button
            key={preset}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(preset)}
            onKeyDown={(event) => move(event, i)}
            className={`flex flex-col items-start gap-1 rounded-input border p-2 text-left text-sm ${on ? 'border-accent bg-accent-soft' : 'border-line hover:bg-accent-soft'}`}
          >
            <span className="font-semibold">{RENDER_PRESET_INFO[preset].label}</span>
            <span className="text-xs text-muted">{RENDER_PRESET_INFO[preset].hint}</span>
          </button>
        );
      })}
    </div>
  );
}

function Progress({
  label,
  text,
  fraction,
}: {
  label: string;
  text: string;
  fraction: number | undefined;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div
        role="progressbar"
        aria-label={label.trim()}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(fraction !== undefined && { 'aria-valuenow': Math.round(fraction * 100) })}
        className="h-1 overflow-hidden rounded-full bg-accent-soft"
      >
        <div
          className={`h-full rounded-full bg-accent ${fraction === undefined ? 'w-1/3 animate-pulse' : 'transition-[width] duration-(--x-fast)'}`}
          style={fraction === undefined ? undefined : { width: `${Math.max(4, fraction * 100)}%` }}
        />
      </div>
      <p className="text-sm text-muted" aria-live="polite" data-render-progress>
        {text}
      </p>
    </div>
  );
}
