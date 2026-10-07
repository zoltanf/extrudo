import {
  type BodyId,
  type DocumentStore,
  type EvaluateResult,
  ExprError,
  evaluateParameters,
  formatQuantity,
  LENGTH,
  type ModelStore,
  type SessionStore,
} from '@extrudo/core';
import { isExportCancelled, type MeshOptions } from '@extrudo/kernel';
import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Button, Dialog, DialogClose, IconButton, Select } from '../design-system';
import { ExpressionInput } from '../parameters/ExpressionInput';
import type { FileAccess } from '../platform/files';
import type { Preferences } from '../platform/preferences';
import type { OpenInSlicer, SlicerId } from '../platform/slicer';
import { SLICERS } from '../platform/slicer';
import type { BodyEntry } from '../shell/bodies';
import { Choice, Hint, Radio } from '../sketch/ExportSketchDialog';
import {
  ANGLE_RANGE,
  DEFLECTION_RANGE,
  type ExportBody,
  formatBytes,
  handToSlicer,
  initialBodies,
  type MeshedBodies,
  type ModelExporter,
  type ModelFormat,
  meshBodies,
  meshFile,
  openBodies,
  RESOLUTIONS,
  type Resolution,
  stepFile,
  stlBytes,
} from './modelExport';

/** Opens the dialog; `bodies` picks them (a body's menu), else the selection or all shown. */
export interface ModelExportRequest {
  bodies?: readonly BodyId[];
  /** The Send to Slicer tile (P6-02): the slicer button is the primary action. */
  slicer?: boolean;
}

export interface ExportModelDialogProps {
  store: DocumentStore;
  session: SessionStore;
  model: ModelStore<unknown>;
  /** The model's live bodies, in browser order. */
  bodies: readonly BodyEntry[];
  /** The project's kernel; without one nothing can be exported. */
  kernel: ModelExporter | undefined;
  request: ModelExportRequest | undefined;
  files: FileAccess;
  preferences: Preferences;
  /**
   * Opens the exported file in a slicer (P4-08, ADR-0062). Absent in the web
   * app, where a slicer can't reach a local design: the dialog then shows no
   * slicer controls at all.
   */
  openInSlicer?: OpenInSlicer;
  /**
   * Which slicers are installed (P6-02, desktop only). Asked once when the dialog
   * opens; the others are disabled. Without it every slicer is offered as before.
   */
  installedSlicers?: () => Promise<readonly SlicerId[]>;
  onClose(): void;
  notify?(tone: 'info' | 'error', text: string): void;
}

/** What the dialog remembers between exports (preference `export.model`). */
interface Remembered {
  format: ModelFormat;
  resolution: Resolution;
  /** Custom deviation and angle, as typed. */
  deviation: string;
  angle: string;
  /** The slicer last used (P6-02). */
  slicer?: SlicerId;
}

const PREFERENCE = 'export.model';
const DEFAULTS: Remembered = {
  format: '3mf',
  resolution: 'medium',
  deviation: '0.02 mm',
  angle: '15 deg',
};
const RESOLUTION_LABELS: Record<Exclude<Resolution, 'custom'>, string> = {
  coarse: 'Coarse',
  medium: 'Medium',
  fine: 'Fine',
};
const DEGREE = Math.PI / 180;

/**
 * Export (P2-12, FR-IO-02..04): bodies as 3MF (objects with names, colours
 * and millimetres), binary STL or STEP AP242. Mesh formats are tessellated
 * in the kernel at a preset or custom deviation; the summary shows the
 * triangle count and whether every mesh is closed and manifold before the
 * file is saved.
 *
 * On a platform with `openInSlicer` (the desktop build, P4-08, ADR-0062) the
 * same bytes can go straight to a slicer; in the browser there is nothing to
 * show there.
 */
export function ExportModelDialog(props: ExportModelDialogProps) {
  return (
    <Dialog
      open={props.request !== undefined}
      onOpenChange={(value) => {
        if (!value) props.onClose();
      }}
      size="small"
      title="Export model"
      description="Bodies as 3MF, STL or STEP, in millimetres."
      actions={
        <DialogClose asChild>
          <IconButton label="Close">
            <X size={18} strokeWidth={1.75} />
          </IconButton>
        </DialogClose>
      }
    >
      <ExportModelForm {...props} />
    </Dialog>
  );
}

/** The dialog's body, without the dialog around it (the unit test renders this). */
export function ExportModelForm({
  store,
  session,
  model,
  bodies,
  kernel,
  request,
  files,
  preferences,
  openInSlicer,
  installedSlicers,
  onClose,
  notify = () => {},
}: ExportModelDialogProps) {
  const doc = useStore(store, (s) => s.doc);
  const status = useStore(model, (s) => s.status);
  const computedDoc = useStore(model, (s) => s.doc);
  const open = request !== undefined;

  const [settings, setSettings] = useState<Remembered>(() => ({
    ...DEFAULTS,
    ...preferences.get<Partial<Remembered>>(PREFERENCE, {}),
  }));
  const update = (change: Partial<Remembered>) =>
    setSettings((current) => {
      const next = { ...current, ...change };
      preferences.set(PREFERENCE, next);
      return next;
    });

  // Each request starts from its bodies, the selection, or every shown body.
  const [chosen, setChosen] = useState<ReadonlySet<BodyId>>(new Set());
  const bodiesRef = useRef(bodies);
  bodiesRef.current = bodies;
  useEffect(() => {
    if (!request) return;
    const selection = session.getState().selection;
    setChosen(new Set(initialBodies(bodiesRef.current, selection, request.bodies)));
  }, [request, session]);

  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  const docSettings = doc.settings;
  const evaluate = useCallback(
    (expression: string, unit: 'length' | 'angle'): EvaluateResult => {
      const result = evaluation.evaluate(expression, unit);
      if (!result.ok) return result;
      const [min, max] =
        unit === 'length'
          ? [DEFLECTION_RANGE.min, DEFLECTION_RANGE.max]
          : [ANGLE_RANGE.min / DEGREE, ANGLE_RANGE.max / DEGREE];
      if (result.value >= min && result.value <= max) return result;
      const text = (v: number) => formatQuantity(v, result.dim, { ...docSettings, precision: 3 });
      const span = { start: 0, end: expression.length };
      return { ok: false, error: new ExprError(`Between ${text(min)} and ${text(max)}.`, span) };
    },
    [evaluation, docSettings],
  );

  const tessellation = useMemo<MeshOptions | undefined>(() => {
    if (settings.resolution !== 'custom') return RESOLUTIONS[settings.resolution];
    const deviation = evaluate(settings.deviation, 'length');
    const angle = evaluate(settings.angle, 'angle');
    if (!deviation.ok || !angle.ok) return undefined;
    return { linearDeflection: deviation.value, angularDeflection: angle.value * DEGREE };
  }, [settings, evaluate]);

  // A STEP file holds exact geometry, so a mesh body is out of it (P4-06,
  // ADR-0066 §3): its checkbox is off and disabled while STEP is the format,
  // and it comes back when a mesh format is picked again.
  const inStep = settings.format === 'step';
  const selected = useMemo<ExportBody[]>(
    () => bodies.filter((b) => chosen.has(b.id) && (settings.format !== 'step' || !b.mesh)),
    [bodies, chosen, settings.format],
  );
  /** Whether a body can go into the chosen format at all. */
  const exportable = (body: ExportBody) => settings.format !== 'step' || !body.mesh;
  const current = status === 'ready' && computedDoc === doc;
  const meshFormat = settings.format !== 'step';

  // Mesh formats are meshed as soon as the choice settles: the summary counts triangles and
  // checks every mesh, and Export saves the same meshes.
  const [meshed, setMeshed] = useState<{ key: string; result: MeshedBodies }>();
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  // Which slicers are installed (P6-02): asked once per opening; undefined while it runs, and
  // for a platform that can't say (every slicer is then offered).
  const [installed, setInstalled] = useState<readonly SlicerId[]>();
  useEffect(() => {
    if (!open || !installedSlicers) return;
    let current = true;
    installedSlicers().then(
      (ids) => current && setInstalled(ids),
      () => current && setInstalled([]),
    );
    return () => {
      current = false;
    };
  }, [open, installedSlicers]);
  const slicer = chooseSlicer(installed, settings.slicer);
  /** Bodies meshed so far of the run for `key` (P3-13). */
  const [progress, setProgress] = useState<{ key: string; done: number; total: number }>();
  const key = JSON.stringify([selected.map((b) => b.id), tessellation]);
  useEffect(() => {
    setProblem(undefined);
    if (!open || !meshFormat || !kernel || !current || !tessellation || selected.length === 0) {
      return;
    }
    if (meshed?.key === key) return;
    // Another choice, closing the dialog (Cancel) or a new model stops this run in the
    // kernel before its next body, so a fine export of a big model doesn't hold it up.
    let cancelled = false;
    const timer = setTimeout(() => {
      meshBodies(kernel, selected, tessellation, (done, total) => {
        if (cancelled) return false;
        setProgress({ key, done, total });
        return true;
      }).then(
        (result) => {
          if (!cancelled) setMeshed({ key, result });
        },
        (error: unknown) => {
          if (cancelled || isExportCancelled(error)) return;
          setProblem(error instanceof Error ? error.message : String(error));
        },
      );
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, meshFormat, kernel, current, tessellation, selected, key, meshed?.key]);
  // A closed dialog lets its meshes go.
  useEffect(() => {
    if (!open) setMeshed(undefined);
  }, [open]);
  const ready = meshFormat ? (meshed?.key === key ? meshed.result : undefined) : undefined;

  const count = `${selected.length} ${selected.length === 1 ? 'body' : 'bodies'}`;
  let summary: { text: string; tone: 'muted' | 'error' | 'warning' };
  if (!kernel) summary = { text: "The kernel isn't running.", tone: 'error' };
  else if (bodies.length === 0) {
    summary = { text: 'There are no bodies to export. Extrude a sketch first.', tone: 'error' };
  } else if (selected.length === 0) summary = { text: 'Choose a body to export.', tone: 'error' };
  else if (problem) summary = { text: problem, tone: 'error' };
  else if (!current)
    summary = { text: 'Waiting for the model to finish computing…', tone: 'muted' };
  else if (!meshFormat) {
    summary =
      selected.length === bodies.length
        ? { text: `${count}, exact geometry in millimetres (AP242)`, tone: 'muted' }
        : {
            text: `${selected.length} of ${bodies.length} bodies: a STEP file holds exact geometry, so the meshes are left out.`,
            tone: 'warning',
          };
  } else if (!tessellation) summary = { text: 'Fix the custom resolution.', tone: 'error' };
  else if (!ready) {
    const at = progress?.key === key && progress.total > 1 ? progress : undefined;
    summary = {
      text: at ? `Meshing ${count}… ${at.done} of ${at.total} done` : `Meshing ${count}…`,
      tone: 'muted',
    };
  } else {
    const open = openBodies(ready);
    const triangles = ready.triangles.toLocaleString('en-US');
    const size = settings.format === 'stl' ? `, ${formatBytes(stlBytes(ready.triangles))}` : '';
    summary =
      open.length === 0
        ? { text: `${count}, ${triangles} triangles${size}, watertight`, tone: 'muted' }
        : {
            text: `${count}, ${triangles} triangles${size}. Not closed: ${open.join(', ')}. Slicers will try to repair ${open.length === 1 ? 'it' : 'them'}.`,
            tone: 'warning',
          };
  }
  const canExport =
    !!kernel &&
    selected.length > 0 &&
    current &&
    !busy &&
    !problem &&
    (meshFormat ? ready !== undefined : true);

  /** The file the choices describe, as Export writes it. */
  const build = async () =>
    settings.format === 'step'
      ? await stepFile(kernel as ModelExporter, selected, doc.name)
      : meshFile(ready as MeshedBodies, settings.format, doc.name);

  const save = async () => {
    if (!canExport || !kernel) return;
    setBusy(true);
    try {
      const file = await build();
      files.download(file.blob, file.name);
      if (meshFormat && ready && openBodies(ready).length > 0) {
        notify('info', "Some meshes aren't closed; your slicer will try to repair them.");
      }
      onClose();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  // The slicer hand-off (P4-08, ADR-0062): the same bytes, no download. The dialog stays open
  // so another slicer can be tried.
  const launch = async () => {
    if (!canExport || !kernel || !openInSlicer || noSlicer) return;
    setBusy(true);
    try {
      const message = await handToSlicer(openInSlicer, await build(), settings.format, slicer);
      if (message === undefined) update({ slicer });
      setProblem(message);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const noSlicer = installed !== undefined && installed.length === 0;
  const slicerFirst = request?.slicer === true && openInSlicer !== undefined;

  const toggle = (id: BodyId) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const all = bodies.length > 0 && bodies.every((b) => chosen.has(b.id));
  const lengthSettings = { ...doc.settings, precision: Math.max(doc.settings.precision, 3) };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (slicerFirst) void launch();
        else void save();
      }}
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 flex w-full items-center justify-between font-semibold">
          Bodies
        </legend>
        <div className="flex max-h-40 flex-col overflow-y-auto" data-export-bodies>
          {bodies.map((body) => (
            <label
              key={body.id}
              className={`flex h-7 shrink-0 items-center gap-2 rounded-input px-1 ${
                inStep && body.mesh ? 'opacity-60' : 'cursor-pointer hover:bg-accent-soft'
              }`}
            >
              <input
                type="checkbox"
                checked={chosen.has(body.id) && exportable(body)}
                disabled={!exportable(body)}
                onChange={() => toggle(body.id)}
                className="accent-(--x-accent)"
              />
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full border border-line"
                style={{ background: body.meta.color ?? 'var(--x-body-default)' }}
              />
              <span className={`truncate ${body.meta.visible ? '' : 'text-muted'}`}>
                {body.meta.name}
              </span>
              {!body.meta.visible && <Hint>hidden</Hint>}
              {!exportable(body) && <Hint>Meshes can't go into a STEP file</Hint>}
            </label>
          ))}
        </div>
        {bodies.length > 1 && (
          <label className="flex h-7 cursor-pointer items-center gap-2 px-1 text-sm text-muted">
            <input
              type="checkbox"
              checked={all}
              onChange={() => setChosen(all ? new Set() : new Set(bodies.map((b) => b.id)))}
              className="accent-(--x-accent)"
            />
            All bodies
          </label>
        )}
        {inStep && bodies.some((b) => b.mesh) && (
          <p className="text-sm text-muted">
            Mesh bodies go into STL and 3MF, not into a STEP file.
          </p>
        )}
      </fieldset>

      <Choice legend="Format">
        <Radio
          name="model-format"
          checked={settings.format === '3mf'}
          onChange={() => update({ format: '3mf' })}
        >
          3MF <Hint>for slicers: names, colours, units</Hint>
        </Radio>
        <Radio
          name="model-format"
          checked={settings.format === 'stl'}
          onChange={() => update({ format: 'stl' })}
        >
          STL <Hint>binary, opens anywhere</Hint>
        </Radio>
        <Radio
          name="model-format"
          checked={settings.format === 'step'}
          onChange={() => update({ format: 'step' })}
        >
          STEP <Hint>exact geometry for CAD</Hint>
        </Radio>
      </Choice>

      {meshFormat && (
        <Choice legend="Resolution">
          {(Object.keys(RESOLUTION_LABELS) as (keyof typeof RESOLUTION_LABELS)[]).map((r) => (
            <Radio
              key={r}
              name="model-resolution"
              checked={settings.resolution === r}
              onChange={() => update({ resolution: r })}
            >
              {RESOLUTION_LABELS[r]}{' '}
              <Hint>
                {formatQuantity(RESOLUTIONS[r].linearDeflection, LENGTH, lengthSettings)},{' '}
                {Math.round(RESOLUTIONS[r].angularDeflection / DEGREE)}°
              </Hint>
            </Radio>
          ))}
          <Radio
            name="model-resolution"
            checked={settings.resolution === 'custom'}
            onChange={() => update({ resolution: 'custom' })}
          >
            Custom
          </Radio>
          {settings.resolution === 'custom' && (
            <div className="ml-7 grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2">
              <span className="pt-1 text-sm text-muted">Deviation</span>
              <ExpressionInput
                label="Deviation"
                value={settings.deviation}
                evaluate={(expr) => evaluate(expr, 'length')}
                format={(r) => formatQuantity(r.value, r.dim, lengthSettings)}
                onCommit={(deviation) => update({ deviation })}
              />
              <span className="pt-1 text-sm text-muted">Angle</span>
              <ExpressionInput
                label="Angle"
                value={settings.angle}
                evaluate={(expr) => evaluate(expr, 'angle')}
                format={(r) => formatQuantity(r.value, r.dim, doc.settings)}
                onCommit={(angle) => update({ angle })}
              />
            </div>
          )}
        </Choice>
      )}

      {meshFormat && !ready && !problem && current && tessellation && selected.length > 0 && (
        <MeshingBar progress={progress?.key === key ? progress : undefined} />
      )}
      <p className="min-h-5 text-sm" aria-live="polite" data-export-summary={summary.text}>
        <span
          className={
            summary.tone === 'error'
              ? 'text-error'
              : summary.tone === 'warning'
                ? 'text-warning'
                : 'text-muted'
          }
        >
          {summary.text}
        </span>
      </p>

      {openInSlicer && (
        <SlicerRow
          installed={installed}
          selected={slicer}
          onSelect={(id) => update({ slicer: id })}
          disabled={!canExport || busy || noSlicer}
          primary={slicerFirst}
          onLaunch={() => void launch()}
        />
      )}

      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant={slicerFirst ? 'secondary' : 'primary'} disabled={!canExport}>
          Export {settings.format === '3mf' ? '3MF' : settings.format.toUpperCase()}
        </Button>
      </div>
    </form>
  );
}

/**
 * How far meshing is (P3-13): a bar by bodies done, or a moving one while the
 * first body (or the only one) is meshed. The dialog's Cancel stops it.
 */
function MeshingBar({ progress }: { progress?: { done: number; total: number } | undefined }) {
  const known = progress && progress.total > 1;
  const share = known ? progress.done / progress.total : undefined;
  return (
    <div
      role="progressbar"
      aria-label="Meshing"
      aria-valuemin={0}
      aria-valuemax={known ? progress.total : undefined}
      aria-valuenow={known ? progress.done : undefined}
      data-export-progress={known ? `${progress.done}/${progress.total}` : 'busy'}
      className="h-1 overflow-hidden rounded-full bg-accent-soft"
    >
      <div
        className={`h-full rounded-full bg-accent ${share === undefined ? 'w-1/3 animate-pulse' : 'transition-[width] duration-(--x-fast)'}`}
        style={share === undefined ? undefined : { width: `${Math.max(4, share * 100)}%` }}
      />
    </div>
  );
}

export const NO_SLICER_HINT =
  'No slicer found. Install PrusaSlicer, OrcaSlicer, Bambu Studio or Cura.';

/**
 * The slicer the select shows (P6-02): the remembered one while it is installed, else the
 * first installed, else PrusaSlicer (the select is then all disabled). While the list is
 * unknown, or on a platform that can't tell, every slicer counts as installed.
 */
export function chooseSlicer(
  installed: readonly SlicerId[] | undefined,
  remembered: SlicerId | undefined,
): SlicerId {
  const first = SLICERS[0]?.id ?? 'prusaslicer';
  if (!installed) return remembered ?? first;
  if (remembered && installed.includes(remembered)) return remembered;
  return SLICERS.find((option) => installed.includes(option.id))?.id ?? first;
}

/** The slicer select and its button; `installed` undefined offers every slicer. */
export function SlicerRow({
  installed,
  selected,
  onSelect,
  disabled,
  primary,
  onLaunch,
}: {
  installed: readonly SlicerId[] | undefined;
  selected: SlicerId;
  onSelect(id: SlicerId): void;
  disabled: boolean;
  primary: boolean;
  onLaunch(): void;
}) {
  const none = installed !== undefined && installed.length === 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-2">
        <span className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="text-muted">Slicer</span>
          <Select
            aria-label="Slicer"
            value={selected}
            onChange={(event) => onSelect(event.target.value as SlicerId)}
          >
            {SLICERS.map((option) => {
              const missing = installed !== undefined && !installed.includes(option.id);
              return (
                <option key={option.id} value={option.id} disabled={missing}>
                  {missing ? `${option.label} (not found)` : option.label}
                </option>
              );
            })}
          </Select>
        </span>
        <Button
          type="button"
          variant={primary ? 'primary' : 'secondary'}
          disabled={disabled}
          title={none ? NO_SLICER_HINT : 'Hand this file to the slicer without saving it first.'}
          onClick={onLaunch}
        >
          Open in slicer
        </Button>
      </div>
      {none && (
        <p className="text-sm text-muted" data-slicer-hint>
          {NO_SLICER_HINT}
        </p>
      )}
    </div>
  );
}
