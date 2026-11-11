/**
 * PartDesign bodies with their history (ADR-0144 S5): each body's features,
 * walked in the body's order, are mapped one by one, the design so far is
 * rebuilt in the import's kernel and the body measured against the shape the
 * file stores for that feature (decision 3). Equal: the feature stays. Any
 * other outcome stops the body's history there (`stop`, the one place that
 * decides it; S8 will carry on from the stored shape instead), and what was
 * added for that feature is taken back. A body whose history stopped after
 * at least one feature keeps those features; the importer then brings the
 * body's final shape in as S3 does and takes the rebuilt body out with one
 * Remove (`import.ts`).
 *
 * Linear in the file: the chain is followed once (cycles end it), features
 * are capped per body and per file, and every kernel call runs under the
 * shared budget (`budget.ts`).
 */
import type { Design, SketchHandle } from '@extrudo/api';
import {
  extrudeInputs,
  type FeatureId,
  type GeomRef,
  profileRefId,
  revolveInputs,
  type SketchEntityId,
  sketchEntityRefId,
} from '@extrudo/core';
import type { SketchSolver } from '@extrudo/sketch';
import { insidePolygon, interiorPoint } from '@extrudo/sketch/profiles';
import type { CallOutcome, KernelBudget } from './budget';
import { combined, type Drift, drift, historyDisagreement, saneMeasure } from './check';
import {
  type DecodedFeature,
  decodeFeature,
  type FeatureKind,
  type FeatureRefusal,
} from './features';
import { type FinalShape, linkedObjects } from './final-shapes';
import type { ShapeMeasure } from './import-kernel';
import {
  binaryFormProblem,
  type FcDocument,
  type FcExpression,
  type FcObject,
  storedShapeText,
} from './model';
import { cleanName, clip } from './names';
import { setBodies } from './shapes';
import { decodeSketch } from './sketch-decode';
import { containerChain, forgetRemovedPlanes } from './sketch-place';
import { type AddSketchResult, addSketch, type SketchOutcome } from './sketches';

/** The most features one body's history walks (the library's longest chain is in ADR-0144's S5 amendment). */
export const MAX_BODY_FEATURES = 500;
/** The most features the walk takes over a whole file. */
export const MAX_FILE_FEATURES = 2_000;
/** The most closed regions a profile sketch may have for its faces to be picked (each pick tests every region). */
export const MAX_PROFILE_REGIONS = 1_000;
/** The most bodies one rebuild may answer with: more means the kernel read something it shouldn't have. */
export const MAX_REBUILD_BODIES = 100_000;

/** Why a body's history stopped: a refusal, or what happened when the feature was rebuilt. */
export type HistoryStop =
  | FeatureRefusal
  /** Its chain of features is broken: a feature outside the body, a loop, no tip. */
  | 'chain'
  /** Past `MAX_BODY_FEATURES` or `MAX_FILE_FEATURES`. */
  | 'limit'
  /** The shape the file stores for the feature can't be read (missing, empty, binary, unreadable). */
  | 'stored'
  /** Extrudo refused the feature or it failed when rebuilt. */
  | 'failed'
  /** The rebuilt body is not the stored shape. */
  | 'differs'
  /** The kernel threw, or its answer makes no sense. */
  | 'kernel'
  /** A kernel call ran over its time. */
  | 'time'
  /** The import's time ran out. */
  | 'import-time'
  /** The kernel failed too often. */
  | 'restarts';

/** A feature that came in with its history: rebuilt and equal to the stored shape. */
export interface MappedFeature {
  /** The FreeCAD object's internal name. */
  readonly object: string;
  readonly kind: FeatureKind;
  /** The Extrudo feature it became. */
  readonly feature: string;
  /** The Extrudo sketch its profile is. */
  readonly sketch: string;
  /** Which FreeCAD property each Extrudo input came from (for S10). */
  readonly sources: Readonly<Record<string, string>>;
  /** The feature's expressions, as stored (not evaluated; S10). */
  readonly expressions: readonly FcExpression[];
  /** How far the rebuild is from the stored shape. */
  readonly drift: Drift;
}

/** What happened to one PartDesign body. */
export interface BodyHistory {
  /** The body's internal name and its name in the design. */
  readonly object: string;
  readonly name: string;
  /** The solid features in its chain (up to its tip). */
  readonly features: number;
  /** The features that came in with their history, in order. */
  readonly mapped: readonly MappedFeature[];
  /** Where the history stopped and why; absent when every feature came in. */
  readonly stop?: {
    readonly object: string;
    readonly type: string;
    readonly reason: HistoryStop;
    readonly detail?: string;
    /** For `differs`: how far the rebuilt body was from the stored shape. */
    readonly drift?: Drift;
  };
  /** The Extrudo bodies the mapped features made, when some did. */
  readonly bodies: readonly string[];
  /** The sketches imported for the mapped features (S4's outcomes, bindings included). */
  readonly sketches: readonly SketchOutcome[];
}

export interface BodyWalkOptions {
  readonly budget: KernelBudget;
  /** Vets sketch constraints (S4); without one no constraint is imported. */
  readonly solver?: SketchSolver;
  /** Hears each feature walked. */
  readonly onStep?: () => void;
  readonly maxBodyFeatures?: number;
  readonly maxFileFeatures?: number;
}

/** A body's chain of solid features up to its tip, following `BaseFeature`, or why there is none. */
export function bodyChain(
  doc: FcDocument,
  body: FcObject,
):
  | {
      readonly features: readonly FcObject[];
      /** The solid outside the body its first feature builds on (the body's own `BaseFeature`). */
      readonly startsFrom?: string;
    }
  | { readonly broken: string } {
  const group = body.properties.Group?.value ?? body.properties.Model?.value;
  const members = new Set(group ? linkedObjects(group) : []);
  const tip = body.properties.Tip?.value;
  const tipName = tip?.kind === 'link' ? tip.object : undefined;
  if (tipName === undefined) return { broken: 'it has no tip' };
  // The solid the body starts from (`BaseFeature` of the body itself) ends the chain.
  const start = body.properties.BaseFeature?.value;
  const outside = start?.kind === 'link' ? start.object : undefined;
  const out: FcObject[] = [];
  const seen = new Set<string>();
  // Members only, each once: at most the group's size, whatever the links say.
  let startsFrom: string | undefined;
  for (let name: string | undefined = tipName; name !== undefined; ) {
    if (out.length > 0 && name === outside) {
      startsFrom = name;
      break;
    }
    if (seen.has(name)) return { broken: 'its features lead back to themselves' };
    seen.add(name);
    const o = doc.byName.get(name);
    if (!o) return { broken: `its feature ${name} isn't in the file` };
    if (!members.has(name)) return { broken: `its feature ${name} is not in the body` };
    out.push(o);
    const base = o.properties.BaseFeature?.value;
    if (base !== undefined && base.kind !== 'link')
      return { broken: `the feature before ${name} can't be read` };
    name = base?.object;
  }
  return { features: out.reverse(), ...(startsFrom ? { startsFrom } : {}) };
}

/** The B-rep text a feature stores, or why there is none (the reader's problems as the detail). */
function storedText(doc: FcDocument, o: FcObject): { text: string } | { detail: string } {
  const before = doc.problems.length;
  const text = storedShapeText(doc, o);
  const said = doc.problems.splice(before);
  if (text !== undefined) return { text };
  return {
    detail: said.includes(binaryFormProblem(`${o.name}.Shape`))
      ? "its stored shape is in FreeCAD's binary form"
      : said.join(' ') || 'it stores no shape',
  };
}

/** Whether a rebuild's reply has the shape it must (types, finite measures, counts in range). */
function saneRebuild(reply: unknown): reply is {
  ids: string[];
  bodies: Record<string, ShapeMeasure>;
  failed: { feature: string; message: string }[];
} {
  if (typeof reply !== 'object' || reply === null) return false;
  const r = reply as { ids?: unknown; bodies?: unknown; failed?: unknown };
  if (!Array.isArray(r.ids) || r.ids.length > MAX_REBUILD_BODIES) return false;
  if (!r.ids.every((id) => typeof id === 'string')) return false;
  if (typeof r.bodies !== 'object' || r.bodies === null) return false;
  const ids = new Set(r.ids as string[]);
  for (const [id, m] of Object.entries(r.bodies)) if (!ids.has(id) || !saneMeasure(m)) return false;
  if (!Array.isArray(r.failed) || r.failed.length > MAX_REBUILD_BODIES) return false;
  return r.failed.every(
    (f) =>
      typeof f === 'object' &&
      f !== null &&
      typeof (f as { feature?: unknown }).feature === 'string' &&
      typeof (f as { message?: unknown }).message === 'string',
  );
}

/**
 * The sketch's regions FreeCAD makes faces of: inside an odd number of
 * outer loops (Bullseye, `AllowMultiFace`), or exactly one (the first level).
 */
export function profileRefs(handle: SketchHandle, multiFace: boolean): GeomRef[] | string {
  const regions = handle.regions.filter((r) => !r.text);
  if (regions.length > MAX_PROFILE_REGIONS)
    return `its sketch has ${regions.length} closed regions, more than ${MAX_PROFILE_REGIONS}`;
  const out: GeomRef[] = [];
  for (const r of regions) {
    const p = interiorPoint(
      r.outer.polygon,
      r.holes.map((h) => h.polygon),
    );
    if (!p) continue;
    const depth = regions.filter((q) => insidePolygon(q.outer.polygon, p)).length;
    if (multiFace ? depth % 2 === 1 : depth === 1)
      out.push({ kind: 'profile', id: profileRefId(handle.id, r.id) });
  }
  return out;
}

/** A number for an expression: 15 significant digits. */
const literal = (v: number) => `${Number(v.toPrecision(15))}`;

/** The outcome kinds a kernel call stops a history with. */
const callStop = (o: Exclude<CallOutcome<unknown>, { kind: 'done' }>): HistoryStop => o.kind;

/**
 * Walks the PartDesign bodies among `shapes`, in document order, adding the
 * features that come in with their history to `design`. Returns one history
 * per body. Never throws for anything the file holds.
 */
export async function importBodies(
  doc: FcDocument,
  shapes: readonly FinalShape[],
  design: Design,
  options: BodyWalkOptions,
): Promise<BodyHistory[]> {
  const { budget } = options;
  const maxBody = options.maxBodyFeatures ?? MAX_BODY_FEATURES;
  const maxFile = options.maxFileFeatures ?? MAX_FILE_FEATURES;
  const histories: BodyHistory[] = [];
  /** Every Extrudo body the last rebuild had. */
  let known: string[] = [];
  let walked = 0;

  for (const shape of shapes) {
    if (shape.kind !== 'body' || shape.object.type !== 'PartDesign::Body') continue;
    const body = shape.object;
    const name = cleanName(shape.name, body.name);
    const chain = bodyChain(doc, body);
    const features = 'features' in chain ? chain.features : [];
    const mapped: MappedFeature[] = [];
    const sketchOutcomes: SketchOutcome[] = [];
    /** Bodies of other FreeCAD bodies: never this body's. */
    const settled = new Set(known);
    let mine: string[] = [];
    let stopped: BodyHistory['stop'];
    /** The one place that decides where a body's history stops (S8 carries on instead). */
    const stop = (o: FcObject | undefined, reason: HistoryStop, detail?: string, off?: Drift) => {
      stopped = {
        object: o?.name ?? body.name,
        type: o?.type ?? body.type,
        reason,
        ...(detail ? { detail: clip(detail) } : {}),
        ...(off ? { drift: off } : {}),
      };
    };
    if ('broken' in chain) stop(undefined, 'chain', chain.broken);
    /** The sketches imported for this body's kept features, by FreeCAD name. */
    const sketches = new Map<string, Extract<AddSketchResult, { imported: true }>>();

    for (let i = 0; i < features.length && !stopped; i++) {
      const f = features[i] as FcObject;
      if (i >= maxBody || walked >= maxFile) {
        stop(f, 'limit', `more than ${i >= maxBody ? maxBody : maxFile} features`);
        break;
      }
      walked++;
      options.onStep?.();
      const frame = containerChain(doc, f);
      if (!frame) {
        stop(f, 'chain', 'its containers hold each other in a loop');
        break;
      }
      const sketchObject = sketchOfFeature(doc, f);
      const decodedSketch = sketchObject ? decodeSketch(sketchObject) : undefined;
      const decoded = decodeFeature(doc, f, {
        body,
        moved: frame.moved,
        ...(decodedSketch ? { sketch: decodedSketch } : {}),
      });
      if (!decoded.ok) {
        stop(f, decoded.reason, decoded.detail);
        break;
      }
      const feature = decoded.feature;
      if (i === 0 && 'startsFrom' in chain && chain.startsFrom) {
        stop(f, 'chain', `it builds on ${chain.startsFrom}, a solid outside the body`);
        break;
      }
      const additive = feature.kind === 'pad' || feature.kind === 'revolution';
      if (!additive && mine.length === 0) {
        stop(f, 'no-base', 'there is nothing before it to cut');
        break;
      }
      const stored = storedText(doc, f);
      if (!('text' in stored)) {
        stop(f, 'stored', stored.detail);
        break;
      }

      // Everything this feature adds is one transaction, taken back if it doesn't hold.
      const before = new Set(design.doc.features.map((x) => x.id));
      design.state.beginTransaction(`Import ${cleanName(f.label, f.name)}`);
      let committed = false;
      try {
        const added = addFeature(doc, design, f, feature, sketches, mine, options.solver);
        if ('stop' in added) {
          stop(f, added.stop, added.detail);
          break;
        }
        const measuredStored = await budget.call(
          () => budget.kernel.measureStoredShape(stored.text, frame.chain),
          saneMeasure,
        );
        if (measuredStored.kind !== 'done') {
          stop(
            f,
            callStop(measuredStored),
            'detail' in measuredStored ? measuredStored.detail : undefined,
          );
          break;
        }
        const rebuilt = await budget.call(
          () => budget.kernel.rebuild(design.toJSON(), new Map(), [...settled]),
          saneRebuild,
        );
        if (rebuilt.kind !== 'done') {
          stop(f, callStop(rebuilt), 'detail' in rebuilt ? rebuilt.detail : undefined);
          break;
        }
        const r = rebuilt.value;
        const fresh = new Set(design.doc.features.map((x) => x.id).filter((id) => !before.has(id)));
        const failure = r.failed.find((x) => fresh.has(x.feature as FeatureId));
        if (failure) {
          stop(f, 'failed', failure.message);
          break;
        }
        const now = r.ids.filter((id) => !settled.has(id));
        const measures = now.map((id) => r.bodies[id]);
        if (measures.some((m) => m === undefined)) {
          stop(f, 'kernel', "the kernel didn't measure every body");
          break;
        }
        const rebuiltBody = combined(measures as ShapeMeasure[]);
        const wrong = historyDisagreement(rebuiltBody, measuredStored.value);
        if (wrong) {
          stop(f, 'differs', wrong, drift(rebuiltBody, measuredStored.value));
          break;
        }
        design.state.commitTransaction();
        committed = true;
        known = [...r.ids];
        mine = now;
        if (added.newSketch) sketchOutcomes.push(added.newSketch.outcome);
        mapped.push({
          object: f.name,
          kind: feature.kind,
          feature: added.feature,
          sketch: added.sketch,
          sources: feature.sources,
          expressions: f.expressions.filter((e) =>
            Object.values(feature.sources).includes(e.path.split('.')[0] as string),
          ),
          drift: drift(rebuiltBody, measuredStored.value),
        });
      } finally {
        if (!committed) {
          design.state.cancelTransaction();
          forgetRemovedPlanes(design);
          for (const [key, s] of sketches)
            if (!design.doc.features.some((x) => x.id === s.id)) sketches.delete(key);
        }
      }
    }
    if (features.length === 0 && !stopped) stop(undefined, 'chain', 'it has no features');
    histories.push({
      object: body.name,
      name,
      features: features.length,
      mapped,
      ...(stopped ? { stop: stopped } : {}),
      bodies: mapped.length > 0 ? mine : [],
      sketches: sketchOutcomes,
    });
    if (!stopped && mine.length > 0) setBodies(design, mine, shape, name);
  }
  return histories;
}

/** The sketch object a feature's profile names, if it is one. */
function sketchOfFeature(doc: FcDocument, f: FcObject): FcObject | undefined {
  const v = f.properties.Profile?.value ?? f.properties.Sketch?.value;
  const name = v?.kind === 'linkSub' || v?.kind === 'link' ? v.object : undefined;
  const o = name === undefined ? undefined : doc.byName.get(name);
  return o?.type.startsWith('Sketcher::SketchObject') ? o : undefined;
}

type Added =
  | { stop: HistoryStop; detail: string }
  | {
      feature: string;
      sketch: string;
      newSketch?: Extract<AddSketchResult, { imported: true }>;
    };

/** Adds the feature's sketch (once per sketch) and the feature itself, or says why it can't. */
function addFeature(
  doc: FcDocument,
  design: Design,
  f: FcObject,
  feature: DecodedFeature,
  sketches: Map<string, Extract<AddSketchResult, { imported: true }>>,
  mine: readonly string[],
  solver: SketchSolver | undefined,
): Added {
  const wantsAxis =
    (feature.kind === 'revolution' || feature.kind === 'groove') &&
    feature.axis.kind === 'sketch-axis'
      ? feature.axis.axis
      : undefined;
  let sketch = sketches.get(feature.sketch);
  let newSketch: Extract<AddSketchResult, { imported: true }> | undefined;
  if (sketch && wantsAxis && !sketch.axes[wantsAxis])
    return {
      stop: 'axis',
      detail: 'its axis is a sketch axis of a sketch already imported without it',
    };
  if (!sketch) {
    const object = doc.byName.get(feature.sketch) as FcObject;
    const result = addSketch(design, doc, object, {
      ...(solver ? { solver } : {}),
      name: cleanName(object.label, object.name),
      ...(wantsAxis ? { axes: [wantsAxis] } : {}),
    });
    if (!result.imported)
      return { stop: 'sketch', detail: `its sketch was not imported: ${result.reason}` };
    sketch = result;
    newSketch = result;
    sketches.set(feature.sketch, result);
  }
  const handle = design.feature(sketch.id) as SketchHandle;
  const profiles = profileRefs(handle, feature.multiFace);
  if (typeof profiles === 'string') return { stop: 'sketch', detail: profiles };
  if (profiles.length === 0) return { stop: 'sketch', detail: 'its sketch has no closed profile' };
  const first = mine.length === 0;
  const operation = first
    ? 'new-body'
    : feature.kind === 'pad' || feature.kind === 'revolution'
      ? 'join'
      : 'cut';
  const bodies = first ? {} : { bodies: [...mine] };
  const name = cleanName(f.label, f.name);
  try {
    if (feature.kind === 'pad' || feature.kind === 'pocket') {
      // Pad along the sketch's normal, pocket against it; Reversed turns it; Extrudo's plane may face the other way.
      let along = feature.kind === 'pad' ? 1 : -1;
      if (feature.reversed) along = -along;
      if (sketch.outcome.mirrored) along = -along;
      const side = (s: NonNullable<typeof feature.side2>) =>
        s.extent === 'through-all'
          ? { extent: 'through-all' as const }
          : { extent: 'distance' as const, distance: `${literal(s.length as number)} mm` };
      const one = side(feature.side1);
      const two = feature.side2 ? side(feature.side2) : undefined;
      const inputs = extrudeInputs(profiles, {
        ...(feature.direction !== 'one-side' ? { direction: feature.direction } : {}),
        extent: one.extent,
        ...(one.distance ? { distance: one.distance } : {}),
        ...(two
          ? { extent2: two.extent, ...(two.distance ? { distance2: two.distance } : {}) }
          : {}),
        ...(along < 0 ? { flip: true } : {}),
        operation,
        ...bodies,
      });
      const added = design.add('extrude', inputs, { name });
      return { feature: added.id, sketch: sketch.id, ...(newSketch ? { newSketch } : {}) };
    }
    const turned = feature as Extract<DecodedFeature, { kind: 'revolution' | 'groove' }>;
    const axis = axisRef(sketch, turned.axis);
    if (!axis) return { stop: 'axis', detail: "its axis line didn't come in with the sketch" };
    const inputs = revolveInputs(profiles, axis, {
      ...(turned.symmetric ? { direction: 'symmetric' } : {}),
      angle: `${literal(turned.angle)} deg`,
      ...(turned.reversed ? { flip: true } : {}),
      operation,
      ...bodies,
    });
    const added = design.add('revolve', inputs, { name });
    return { feature: added.id, sketch: sketch.id, ...(newSketch ? { newSketch } : {}) };
  } catch (error) {
    return { stop: 'failed', detail: `Extrudo refused it: ${(error as Error).message}` };
  }
}

/** A revolve axis as an Extrudo reference, or `undefined` when its line wasn't drawn. */
function axisRef(
  sketch: Extract<AddSketchResult, { imported: true }>,
  axis: Extract<DecodedFeature, { kind: 'revolution' | 'groove' }>['axis'],
): GeomRef | undefined {
  if (axis.kind === 'origin') return { kind: 'axis', id: `origin:${axis.axis}` };
  const entity = axis.kind === 'sketch-axis' ? sketch.axes[axis.axis] : sketch.lines[axis.geometry];
  if (entity === undefined) return undefined;
  return { kind: 'sketchEntity', id: sketchEntityRefId(sketch.id, entity as SketchEntityId) };
}
