import {
  type BodyId,
  type Component,
  type EvaluateResult,
  ExprError,
  type ExtrudoDocument,
  evaluateParameters,
  formatQuantity,
  LENGTH,
  type SessionStore,
} from '@extrudo/core';
import type { MeshOptions } from '@extrudo/kernel';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExpressionInput } from '../parameters/ExpressionInput';
import type { BodyEntry } from '../shell/bodies';
import { Choice, Hint, Radio } from '../sketch/ExportSketchDialog';
import {
  ANGLE_RANGE,
  DEFLECTION_RANGE,
  type ExportBody,
  initialBodies,
  RESOLUTIONS,
  type Resolution,
} from './modelExport';

/**
 * The fields Export model and Export as script share (ADR-0088 §9): the bodies list, the
 * resolution choice, and the hooks behind them.
 */

const DEGREE = Math.PI / 180;
const RESOLUTION_LABELS: Record<Exclude<Resolution, 'custom'>, string> = {
  coarse: 'Coarse',
  medium: 'Medium',
  fine: 'Fine',
};

export interface BodyRows {
  all: ExportBody[];
  groups: { component: Component; bodies: ExportBody[] }[];
  loose: ExportBody[];
}

/** The body entries as export rows, grouped by component (their names travel with them). */
export function useBodyRows(
  bodies: readonly BodyEntry[],
  components: ExtrudoDocument['components'],
): BodyRows {
  return useMemo(() => {
    const names = new Map((components ?? []).map((c) => [c.id, c.name]));
    const groups: { component: Component; bodies: ExportBody[] }[] = (components ?? []).map(
      (component) => ({ component, bodies: [] }),
    );
    const byId = new Map(groups.map((g) => [g.component.id, g]));
    const loose: ExportBody[] = [];
    const all: ExportBody[] = bodies.map((body) => {
      const name = body.component === undefined ? undefined : names.get(body.component);
      const entry: ExportBody = {
        id: body.id,
        meta: body.meta,
        ...(body.mesh !== undefined && { mesh: body.mesh }),
        ...(body.component !== undefined &&
          name !== undefined && { component: { id: body.component, name } }),
      };
      const group = body.component === undefined ? undefined : byId.get(body.component);
      if (group) group.bodies.push(entry);
      else loose.push(entry);
      return entry;
    });
    return { all, groups: groups.filter((g) => g.bodies.length > 0), loose };
  }, [bodies, components]);
}

export interface ChosenBodies {
  chosen: ReadonlySet<BodyId>;
  toggle(id: BodyId): void;
  toggleMany(ids: readonly BodyId[], on: boolean): void;
}

/**
 * The chosen bodies. Each new `request` (a dialog opening) starts from its bodies, the
 * selection, or every shown body; `undefined` is a closed dialog.
 */
export function useChosenBodies(
  bodies: readonly BodyEntry[],
  session: SessionStore,
  request: { bodies?: readonly BodyId[] } | undefined,
): ChosenBodies {
  const [chosen, setChosen] = useState<ReadonlySet<BodyId>>(new Set());
  const bodiesRef = useRef(bodies);
  bodiesRef.current = bodies;
  useEffect(() => {
    if (!request) return;
    const selection = session.getState().selection;
    setChosen(new Set(initialBodies(bodiesRef.current, selection, request.bodies)));
  }, [request, session]);
  const toggle = (id: BodyId) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleMany = (ids: readonly BodyId[], on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  return { chosen, toggle, toggleMany };
}

/** Evaluates a custom deviation (length) or angle expression, within the meshing ranges. */
export function useResolutionEvaluate(doc: ExtrudoDocument) {
  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  const docSettings = doc.settings;
  return useCallback(
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
}

export interface ResolutionSettings {
  resolution: Resolution;
  /** Custom deviation and angle, as typed. */
  deviation: string;
  angle: string;
}

/** The meshing options the settings describe; undefined while a custom value is invalid. */
export function useTessellation(
  settings: ResolutionSettings,
  evaluate: ReturnType<typeof useResolutionEvaluate>,
): MeshOptions | undefined {
  return useMemo(() => {
    if (settings.resolution !== 'custom') return RESOLUTIONS[settings.resolution];
    const deviation = evaluate(settings.deviation, 'length');
    const angle = evaluate(settings.angle, 'angle');
    if (!deviation.ok || !angle.ok) return undefined;
    return { linearDeflection: deviation.value, angularDeflection: angle.value * DEGREE };
  }, [settings, evaluate]);
}

export interface BodiesFieldProps extends ChosenBodies {
  rows: BodyRows;
  /** Whether a body can go into the chosen format at all (default: all can). */
  exportable?: (body: ExportBody) => boolean;
  /** "Keep components together" (shown while a chosen body has a component); absent hides it. */
  keepTogether?: { checked: boolean; onChange(): void };
  /** A note under the list (the STEP one). */
  note?: string | undefined;
}

/** The Bodies fieldset: components with tri-state boxes, the bodies, "All bodies". */
export function BodiesField({
  rows,
  chosen,
  toggle,
  toggleMany,
  exportable = () => true,
  keepTogether,
  note,
}: BodiesFieldProps) {
  const allBodies = rows.all;
  const groupState = (list: readonly ExportBody[]) => {
    const on = list.filter((b) => chosen.has(b.id) && exportable(b)).length;
    if (on === 0) return 'false' as const;
    return on === list.length ? ('true' as const) : ('mixed' as const);
  };
  const bodyRow = (body: ExportBody) => (
    <label
      key={body.id}
      className={`flex h-7 shrink-0 items-center gap-2 rounded-input px-1 ${
        !exportable(body) ? 'opacity-60' : 'cursor-pointer hover:bg-accent-soft'
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
      <span className={`truncate ${body.meta.visible ? '' : 'text-muted'}`}>{body.meta.name}</span>
      {!body.meta.visible && <Hint>hidden</Hint>}
      {!exportable(body) && <Hint>Meshes can't go into a STEP file</Hint>}
    </label>
  );
  const all = allBodies.length > 0 && allBodies.every((b) => chosen.has(b.id));
  const anyComponent = allBodies.some(
    (b) => chosen.has(b.id) && exportable(b) && b.component !== undefined,
  );
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 flex w-full items-center justify-between font-semibold">
        Bodies
      </legend>
      <div className="flex max-h-40 flex-col overflow-y-auto" data-export-bodies>
        {rows.groups.map((group) => (
          <div
            key={group.component.id}
            className="flex flex-col"
            data-export-component={group.component.name}
          >
            <label className="flex h-7 shrink-0 items-center gap-2 rounded-input px-1 font-medium">
              <input
                type="checkbox"
                aria-label={`${group.component.name} (component)`}
                aria-checked={groupState(group.bodies)}
                checked={groupState(group.bodies) === 'true'}
                ref={(el) => {
                  if (el) el.indeterminate = groupState(group.bodies) === 'mixed';
                }}
                onChange={() =>
                  toggleMany(
                    group.bodies.map((b) => b.id),
                    groupState(group.bodies) !== 'true',
                  )
                }
                className="accent-(--x-accent)"
              />
              <span className="truncate">{group.component.name}</span>
            </label>
            <div className="flex flex-col pl-5">{group.bodies.map(bodyRow)}</div>
          </div>
        ))}
        {rows.loose.map(bodyRow)}
      </div>
      {allBodies.length > 1 && (
        <label className="flex h-7 cursor-pointer items-center gap-2 px-1 text-sm text-muted">
          <input
            type="checkbox"
            checked={all}
            onChange={() =>
              toggleMany(
                allBodies.map((b) => b.id),
                !all,
              )
            }
            className="accent-(--x-accent)"
          />
          All bodies
        </label>
      )}
      {anyComponent && keepTogether && (
        <label className="flex h-7 cursor-pointer items-center gap-2 px-1 text-sm text-muted">
          <input
            type="checkbox"
            checked={keepTogether.checked}
            onChange={keepTogether.onChange}
            className="accent-(--x-accent)"
          />
          Keep components together
        </label>
      )}
      {note && <p className="text-sm text-muted">{note}</p>}
    </fieldset>
  );
}

export interface ResolutionFieldProps extends ResolutionSettings {
  doc: ExtrudoDocument;
  evaluate: ReturnType<typeof useResolutionEvaluate>;
  /** The radios' group name. */
  name: string;
  onChange(change: Partial<ResolutionSettings>): void;
}

/** Coarse, Medium, Fine or Custom, with the custom deviation and angle. */
export function ResolutionField({
  doc,
  evaluate,
  name,
  resolution,
  deviation,
  angle,
  onChange,
}: ResolutionFieldProps) {
  const lengthSettings = { ...doc.settings, precision: Math.max(doc.settings.precision, 3) };
  return (
    <Choice legend="Resolution">
      {(Object.keys(RESOLUTION_LABELS) as (keyof typeof RESOLUTION_LABELS)[]).map((r) => (
        <Radio
          key={r}
          name={name}
          checked={resolution === r}
          onChange={() => onChange({ resolution: r })}
        >
          {RESOLUTION_LABELS[r]}{' '}
          <Hint>
            {formatQuantity(RESOLUTIONS[r].linearDeflection, LENGTH, lengthSettings)},{' '}
            {Math.round(RESOLUTIONS[r].angularDeflection / DEGREE)}°
          </Hint>
        </Radio>
      ))}
      <Radio
        name={name}
        checked={resolution === 'custom'}
        onChange={() => onChange({ resolution: 'custom' })}
      >
        Custom
      </Radio>
      {resolution === 'custom' && (
        <div className="ml-7 grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2">
          <span className="pt-1 text-sm text-muted">Deviation</span>
          <ExpressionInput
            label="Deviation"
            value={deviation}
            evaluate={(expr) => evaluate(expr, 'length')}
            format={(r) => formatQuantity(r.value, r.dim, lengthSettings)}
            onCommit={(next) => onChange({ deviation: next })}
          />
          <span className="pt-1 text-sm text-muted">Angle</span>
          <ExpressionInput
            label="Angle"
            value={angle}
            evaluate={(expr) => evaluate(expr, 'angle')}
            format={(r) => formatQuantity(r.value, r.dim, doc.settings)}
            onCommit={(next) => onChange({ angle: next })}
          />
        </div>
      )}
    </Choice>
  );
}
