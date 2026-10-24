import {
  type DocumentStore,
  type ModelStore,
  RENDER_FINISH_INFO,
  RENDER_FINISHES,
  RENDER_PRESET_INFO,
  RENDER_PRESETS,
  RENDER_QUALITIES,
  RENDER_SIZES,
  type RenderEngine,
  type RenderFinish,
  type RenderPreset,
  type RenderQuality,
  type RenderSettings,
  type SessionStore,
  setRenderSettings,
  type ViewCamera,
} from '@extrudo/core';
import { isExportCancelled, RESOLUTIONS } from '@extrudo/kernel';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useStore } from 'zustand';
import { Button, Dialog, DialogClose, IconButton, Select } from '../design-system';
import { type MeshedBodies, type ModelExporter, meshBodies } from '../export/modelExport';
import type { FileAccess } from '../platform/files';
import {
  BLENDER_DOWNLOAD_URL,
  BLENDER_MIN_VERSION,
  type BlenderRenderer,
  type BlenderStatus,
  type PictureRenderer,
  type RenderProgress,
} from '../platform/render';
import type { BodyEntry } from '../shell/bodies';
import { type EtaStart, etaText, remainingSeconds } from './eta';
import {
  buildAppJob,
  buildRenderJob,
  commonFinish,
  currentRenderSettings,
  engineOf,
  finishOf,
  jobCamera,
  renderFileName,
  settingsChanged,
  withEngine,
  withFinish,
  withFinishForAll,
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
  /** The app's own renderer (ADR-0101 §6): always there, the default engine. */
  appRender: PictureRenderer;
  /** Blender, where the platform can run it (the desktop app); absent on the web. */
  render?: BlenderRenderer;
  /** The viewport's camera now, as a named view's camera. */
  viewportCamera: () => ViewCamera;
  /** The bottom of the visible bodies (z, mm), for the "from below" warning; undefined when unknown. */
  groundLevel?: () => number | undefined;
  /** Opens a link in the system browser (`Platform.openLink`). */
  openLink?(url: string): void;
  onClose(): void;
  notify?(tone: 'info' | 'error', text: string): void;
}

/**
 * Render Picture (P6-15, ADR-0101 §1, §6): a presentable picture of the design,
 * rendered by the app itself or, on the desktop by choice, by Blender. Choices are kept in the design's
 * `render` section when they changed; the picture is not stored.
 */
export function RenderDialog(props: RenderDialogProps) {
  // Closing is refused while a render runs (Esc and the overlay included): Cancel stops it.
  const [busy, setBusy] = useState(false);
  // The form is narrow; the picture gets a wide dialog.
  const [picture, setPicture] = useState(false);
  return (
    <Dialog
      open={props.request !== undefined}
      onOpenChange={(value) => {
        if (!value && !busy) props.onClose();
      }}
      size={picture ? 'large' : 'small'}
      title="Render picture"
      description="A presentable picture of the design."
      actions={
        <DialogClose asChild>
          <IconButton label="Close" disabled={busy}>
            <X size={18} strokeWidth={1.75} />
          </IconButton>
        </DialogClose>
      }
    >
      <RenderForm {...props} onBusy={setBusy} onPicture={setPicture} />
    </Dialog>
  );
}

type Stage =
  | { kind: 'form' }
  | { kind: 'meshing'; done: number; total: number }
  | { kind: 'rendering'; progress: RenderProgress | undefined; eta?: string }
  | { kind: 'result'; blob: Blob; url: string };

const PHASES: Record<RenderProgress['phase'], string> = {
  starting: 'Starting…',
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

/** Whether `camera` looks from below `ground` (the model's bottom, mm); never for the automatic camera (pure). */
export function viewFromBelow(camera: ViewCamera | undefined, ground: number | undefined): boolean {
  return camera !== undefined && ground !== undefined && camera.position[2] < ground;
}

export function phaseText(
  progress: RenderProgress | undefined,
  engine: RenderEngine = 'app',
  eta?: string,
): string {
  const phase = progress?.phase ?? 'starting';
  if (phase === 'starting' && engine === 'blender') return 'Starting Blender…';
  if (progress?.phase !== 'rendering') return PHASES[phase];
  const percent = `Rendering… ${Math.round(progress.fraction * 100)} %`;
  return eta ? `${percent} · ${eta}` : percent;
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
  appRender,
  render,
  viewportCamera,
  groundLevel,
  openLink,
  onClose,
  onBusy,
  onPicture,
  notify = () => {},
}: RenderDialogProps & { onBusy?(busy: boolean): void; onPicture?(shown: boolean): void }) {
  const doc = useStore(store, (s) => s.doc);
  const status = useStore(model, (s) => s.status);
  const open = request !== undefined;
  const stored = useMemo(() => currentRenderSettings(doc), [doc]);
  const [chosen, setChosen] = useState<RenderSettings>(stored);
  const [blender, setBlender] = useState<BlenderStatus>();
  const [stage, setStage] = useState<Stage>({ kind: 'form' });
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string }>();
  // The picture fits the dialog, or shows at its real size (scroll to pan).
  const [zoomed, setZoomed] = useState(false);
  // Where the click landed on the fitted picture (0–1): the zoomed one scrolls there.
  const anchor = useRef<[number, number]>([0.5, 0.5]);
  const frame = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const el = frame.current;
    const img = el?.querySelector('img');
    if (!zoomed || !el || !img) return;
    const [fx, fy] = anchor.current;
    el.scrollLeft = fx * img.offsetWidth - el.clientWidth / 2;
    el.scrollTop = fy * img.offsetHeight - el.clientHeight / 2;
  }, [zoomed]);
  const toggleZoom = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.querySelector('img')?.getBoundingClientRect();
    const unit = (v: number) => Math.min(1, Math.max(0, v));
    // A keyboard activation has no position: the middle.
    anchor.current =
      !zoomed && event.detail > 0 && rect && rect.width > 0 && rect.height > 0
        ? [
            unit((event.clientX - rect.left) / rect.width),
            unit((event.clientY - rect.top) / rect.height),
          ]
        : [0.5, 0.5];
    setZoomed(!zoomed);
  };
  const cancelled = useRef(false);
  // The engine of the running render, for Cancel.
  const running = useRef<PictureRenderer<never> | undefined>(undefined);
  const url = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!open || !render) return;
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
      running.current?.cancel();
      cancelled.current = true;
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  const shown = useMemo(() => bodies.filter((b) => b.display === 'shown' && !b.pending), [bodies]);
  const shownIds = useMemo(() => shown.map((b) => b.id), [shown]);
  // One finish for every body is the usual case; the per-body list is opened on
  // request, and stays open while the finishes differ.
  const common = commonFinish(chosen, shownIds);
  const [perBody, setPerBody] = useState(false);
  const listOpen = perBody || common === undefined;
  const [sceneOpen, setSceneOpen] = useState(true);
  // Saving the render settings changes the document without changing any body, so only a
  // running recompute makes the model wait.
  const current = status === 'ready';
  const busy = stage.kind === 'meshing' || stage.kind === 'rendering';
  useEffect(() => {
    onBusy?.(busy);
    return () => onBusy?.(false);
  }, [busy, onBusy]);
  const picture = stage.kind === 'result';
  useEffect(() => {
    onPicture?.(picture);
    return () => onPicture?.(false);
  }, [picture, onPicture]);

  let blocker: string | undefined;
  if (!kernel) blocker = "The kernel isn't running.";
  else if (shown.length === 0) blocker = 'Nothing to render: every body is hidden.';
  else if (!current) blocker = 'Waiting for the model to finish computing…';
  // Blender is only chosen when it was found, so the app or a found Blender renders.
  const engine = engineOf(chosen, blender);
  const canRender = blocker === undefined;

  const update = (change: Partial<RenderSettings>) => setChosen((c) => ({ ...c, ...change }));

  const start = async () => {
    if (!canRender || !kernel) return;
    setMessage(undefined);
    // One undo step, and nothing when the choices are what is stored.
    if (settingsChanged(stored, chosen)) {
      store.getState().dispatch(setRenderSettings({ render: chosen }));
    }
    cancelled.current = false;
    const engineRunning = engine === 'blender' && render ? render : appRender;
    running.current = engineRunning;
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
      const camera = jobCamera(chosen, doc, viewportCamera);
      let etaStart: EtaStart | undefined;
      const onProgress = (progress: RenderProgress) => {
        let eta: string | undefined;
        if (progress.phase === 'rendering') {
          const now = performance.now();
          etaStart ??= { at: now, fraction: progress.fraction };
          const seconds = remainingSeconds(etaStart, now, progress.fraction);
          if (seconds !== undefined) eta = etaText(seconds);
        }
        setStage({ kind: 'rendering', progress, ...(eta && { eta }) });
      };
      const result =
        engineRunning === render
          ? await render.render(buildRenderJob(doc.name, meshed, chosen, camera), onProgress)
          : await appRender.render(buildAppJob(doc.name, meshed, chosen, camera), onProgress);
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
      running.current = undefined;
    }
  };

  const cancel = () => {
    cancelled.current = true;
    if (stage.kind === 'rendering') running.current?.cancel();
  };

  const again = () => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = undefined;
    setMessage(undefined);
    setZoomed(false);
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
        <button
          type="button"
          aria-pressed={zoomed}
          aria-label={
            zoomed
              ? 'Zoom out: fit the picture to the window'
              : 'Zoom in: show the picture at its real size'
          }
          title={zoomed ? 'Zoom out' : 'Zoom in'}
          ref={frame}
          onClick={toggleZoom}
          className={`max-h-[75vh] overflow-auto rounded-input border border-line ${zoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'}`}
        >
          <img
            src={src}
            alt={altText}
            className={zoomed ? 'max-w-none' : 'max-h-[75vh] w-full object-contain'}
          />
        </button>
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
  // A camera below the model's bottom renders without the floor (ADR-0101 §6.6): say so first.
  const fromBelow = viewFromBelow(jobCamera(chosen, doc, viewportCamera), groundLevel?.());
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
  const cameraLabel =
    chosen.camera.kind === 'view'
      ? (views.find((v) => v.id === (chosen.camera as { id: string }).id)?.name ?? 'Automatic')
      : chosen.camera.kind === 'current'
        ? 'Current view'
        : 'Automatic';
  const sceneSummary = [
    RENDER_PRESET_INFO[chosen.preset].label,
    cameraLabel,
    sizeLabel(chosen.width, chosen.height),
    QUALITY_LABELS[chosen.quality],
  ].join(' · ');

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      {render && (
        <div className="flex flex-col gap-1">
          <EngineChoice
            value={engine}
            blenderFound={blender?.state === 'found'}
            disabled={busy}
            onChange={(next) => setChosen((c) => withEngine(c, next))}
          />
          <BlenderLine status={blender} openLink={openLink} />
        </div>
      )}

      <Section
        label="Scene"
        open={sceneOpen}
        onToggle={() => setSceneOpen(!sceneOpen)}
        summary={sceneSummary}
        disabled={busy}
      >
        <PresetCards value={chosen.preset} onChange={(preset) => update({ preset })} />
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <span className="text-muted">Camera</span>
            <Select
              aria-label="Camera"
              value={cameraValue}
              onChange={(event) => onCamera(event.target.value)}
            >
              <option value="current">Current view</option>
              <option value="auto">Automatic</option>
              {views.map((view) => (
                <option key={view.id} value={`view:${view.id}`}>
                  {view.name}
                </option>
              ))}
            </Select>
            {fromBelow && (
              <p className="text-xs text-muted" data-render-below>
                This view looks from below, so the picture leaves out the floor.
              </p>
            )}
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
        </div>
        <div
          role="radiogroup"
          aria-label="Quality"
          className="flex flex-wrap items-center gap-x-1 gap-y-0 text-sm"
        >
          <span className="mr-1 text-muted">Quality</span>
          {RENDER_QUALITIES.map((quality) => (
            <label
              key={quality}
              className="flex h-7 cursor-pointer items-center gap-1.5 rounded-input px-1 hover:bg-accent-soft"
            >
              <input
                type="radio"
                name="render-quality"
                checked={chosen.quality === quality}
                onChange={() => update({ quality })}
                className="accent-(--x-accent)"
              />
              {QUALITY_LABELS[quality]}
            </label>
          ))}
          <span className="ml-auto text-muted" data-quality-hint>
            {QUALITY_HINTS[chosen.quality]}
          </span>
        </div>
      </Section>

      <fieldset className="flex flex-col gap-1" disabled={busy}>
        <legend className="mb-1 font-semibold">Bodies</legend>
        {shown.length === 0 && <p className="text-sm text-muted">No bodies are shown.</p>}
        {shown.length === 1 && shown[0] && (
          <FinishRow body={shown[0]} chosen={chosen} setChosen={setChosen} />
        )}
        {shown.length > 1 && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">All {shown.length} bodies</span>
              <div className="w-36 shrink-0">
                <Select
                  aria-label="Finish of all bodies"
                  value={common ?? 'mixed'}
                  onChange={(event) =>
                    setChosen((c) =>
                      withFinishForAll(c, shownIds, event.target.value as RenderFinish),
                    )
                  }
                >
                  {common === undefined && (
                    <option value="mixed" disabled>
                      Mixed
                    </option>
                  )}
                  {RENDER_FINISHES.map((finish) => (
                    <option key={finish} value={finish} title={RENDER_FINISH_INFO[finish].hint}>
                      {RENDER_FINISH_INFO[finish].label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {common !== undefined && (
              <button
                type="button"
                className="flex h-7 items-center gap-1 self-start rounded-input pr-1 text-sm text-muted hover:bg-accent-soft"
                aria-expanded={listOpen}
                onClick={() => setPerBody(!listOpen)}
              >
                {listOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {listOpen ? 'Hide the list' : 'Set per body…'}
              </button>
            )}
            {listOpen && (
              <div className="flex max-h-52 flex-col gap-1 overflow-y-auto pr-1">
                {shown.map((body) => (
                  <FinishRow key={body.id} body={body} chosen={chosen} setChosen={setChosen} />
                ))}
              </div>
            )}
          </>
        )}
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
          text={phaseText(
            stage.progress,
            running.current === render ? 'blender' : 'app',
            stage.eta,
          )}
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

/** A collapsible group: its heading is the toggle; collapsed, a summary stands in. */
function Section({
  label,
  open,
  onToggle,
  summary,
  disabled,
  children,
}: {
  label: string;
  open: boolean;
  onToggle(): void;
  /** Collapsed, this line stands in for the children. */
  summary: string;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2" data-section={label.toLowerCase()}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="-ml-1 flex h-7 items-center gap-1 self-start rounded-input px-1 text-left font-semibold hover:bg-accent-soft"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {label}
        {!open && <span className="ml-2 truncate font-normal text-sm text-muted">{summary}</span>}
      </button>
      {open && (
        <fieldset className="flex flex-col gap-3" aria-label={label} disabled={disabled}>
          {children}
        </fieldset>
      )}
    </div>
  );
}

/** One body: its colour dot, its name and its finish. */
function FinishRow({
  body,
  chosen,
  setChosen,
}: {
  body: BodyEntry;
  chosen: RenderSettings;
  setChosen: (update: (c: RenderSettings) => RenderSettings) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full border border-line"
        style={{ background: body.meta.color ?? 'var(--x-body-default)' }}
      />
      <span className="min-w-0 flex-1 truncate">{body.meta.name}</span>
      {/* The select is `w-full` by itself: a box of its own keeps the name's room. */}
      <div className="w-36 shrink-0">
        <Select
          aria-label={`Finish of ${body.meta.name}`}
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
    </div>
  );
}

const ENGINE_LABELS: Record<RenderEngine, string> = { app: 'In the app', blender: 'Blender' };

/** "Render with": the app or Blender (ADR-0101 §6.1); Blender only when it was found. */
function EngineChoice({
  value,
  blenderFound,
  disabled,
  onChange,
}: {
  value: RenderEngine;
  blenderFound: boolean;
  disabled: boolean;
  onChange(engine: RenderEngine): void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Render with"
      className="flex flex-wrap items-center gap-x-1 gap-y-0 text-sm"
    >
      <span className="mr-1 font-semibold">Render with</span>
      {(['app', 'blender'] as const).map((engine) => {
        const off = disabled || (engine === 'blender' && !blenderFound);
        return (
          <label
            key={engine}
            className={`flex h-7 items-center gap-1.5 rounded-input px-1 ${off ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-accent-soft'}`}
          >
            <input
              type="radio"
              name="render-engine"
              checked={value === engine}
              disabled={off}
              onChange={() => onChange(engine)}
              className="accent-(--x-accent)"
            />
            {ENGINE_LABELS[engine]}
          </label>
        );
      })}
    </div>
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
