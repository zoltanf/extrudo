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
  type AttachmentId,
  extrudeInputs,
  type FeatureId,
  type GeomRef,
  importInputs,
  profileRefId,
  removeAttachment,
  revolveInputs,
  type SketchEntityId,
  sketchEntityRefId,
} from '@extrudo/core';
import type { SketchSolver } from '@extrudo/sketch';
import { insidePolygon } from '@extrudo/sketch/profiles';
import { MAX_ATTACHMENTS_BYTES } from '@extrudo/storage';
import type { CallOutcome, KernelBudget } from './budget';
import {
  combined,
  type Drift,
  drift,
  historyDisagreement,
  saneMeasure,
  untouchedDisagreement,
} from './check';
import { addDressUp, type ReferenceTally } from './dressups';
import {
  type DecodedDressUp,
  type DecodedFeature,
  type DecodedHole,
  type DecodedTransform,
  decodeFeature,
  FEATURE_TYPES,
  type FeatureKind,
  type FeatureRefusal,
  MAX_TRANSFORM_INSTANCES,
  MAX_TRANSFORM_STEPS,
} from './features';
import { type FinalShape, linkedObjects } from './final-shapes';
import { addHole } from './holes';
import type { RebuildResult, ShapeMeasure } from './import-kernel';
import {
  binaryFormProblem,
  type FcDocument,
  type FcExpression,
  type FcObject,
  type FcPlacement,
  storedShapeText,
} from './model';
import { cleanName, clip } from './names';
import { addStepAttachment, attachmentBytes, convertStored, setBodies } from './shapes';
import { type DecodedSketch, decodeSketch } from './sketch-decode';
import { containerChain, forgetRemovedPlanes } from './sketch-place';
import { type AddSketchResult, addSketch, type SketchOutcome } from './sketches';
import { type Repeated, TransformMapper } from './transforms';

/** An object name from the file, for a detail: cleaned and cut like any name the import writes. */
const named = (name: string) => cleanName(name, name);

/** The most features one body's history walks (the library's longest chain is in ADR-0144's S5 amendment). */
export const MAX_BODY_FEATURES = 500;
/** The most features the walk takes over a whole file. */
export const MAX_FILE_FEATURES = 2_000;
/**
 * The most drawn (not construction) curves a profile sketch may have: it
 * bounds the region detection and the face picking below. The library's
 * largest has 25; ordinary parts (a vent of 60 slots, 240 curves; a plate of
 * 250 holes) need hundreds. Measured unloaded at 500 (ADR-0144's S5
 * amendment): a grid of crossing lines 1.1 s and 485 MB, concentric circles
 * 2.1 s and 410 MB; at 1,000 both pass 5 s, the grid in the region detection.
 */
export const MAX_PROFILE_CURVES = 500;
/** The most closed regions a profile sketch may have for its faces to be picked (each pick tests every region). */
export const MAX_PROFILE_REGIONS = 1_000;
/**
 * The most stored-shape steps one body may take (S8). Each step is a whole
 * body's STEP in the design and a conversion; the library's most is in
 * ADR-0144's S8 amendment. Past it the body ends as it did before S8: its
 * final shape comes in, with `limit`.
 */
export const MAX_BODY_STEPS = 8;
/**
 * The most stored-shape text the steps of one import may convert in all (S8):
 * a run whose features each fail after their base came in converts once per
 * feature tried, so this bounds the work by the input, not only by the clock
 * (each text is at most `MAX_STORED_BREP_BYTES`, 32 MB).
 */
export const MAX_STEP_TEXT_BYTES = 256 * 1024 * 1024;
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
  | 'restarts'
  /** A dress-up's edge or face has no counterpart on the rebuilt body, or several (S6). */
  | 'reference';

/** A feature that came in with its history: rebuilt and equal to the stored shape. */
export interface MappedFeature {
  /** The FreeCAD object's internal name. */
  readonly object: string;
  readonly kind: FeatureKind;
  /** The Extrudo feature it became. */
  readonly feature: string;
  /** The Extrudo sketch its profile is (not for a fillet or chamfer). */
  readonly sketch?: string;
  /** A fillet's or chamfer's: how its edges were found on the rebuilt body (S6). */
  readonly references?: ReferenceTally;
  /** Which FreeCAD property each Extrudo input came from (for S10). */
  readonly sources: Readonly<Record<string, string>>;
  /** The feature's expressions, as stored (not evaluated; S10), at most `MAX_FEATURE_EXPRESSIONS`. */
  readonly expressions: readonly FcExpression[];
  /** How many expressions past `MAX_FEATURE_EXPRESSIONS` were left out (S10 must know). */
  readonly expressionsDropped?: number;
  /** How far the rebuild is from the stored shape. */
  readonly drift: Drift;
  /** Further Extrudo features it became (S7: a MultiTransform of two mirrors is two). */
  readonly extra?: readonly string[];
  /** Construction features made for its references (S7). */
  readonly constructions?: number;
  /** It held only at its second attempt (S7: the other sense or the other hole cut). */
  readonly secondAttempt?: true;
  /** A hole whose thread the file has but doesn't model: it came in plain (S7). */
  readonly threadLost?: true;
  /** A hole's centres (S7). */
  readonly centres?: number;
}

/** A FreeCAD feature named in the report: internal name, cleaned label, type. */
export interface FeatureNamed {
  readonly object: string;
  readonly name: string;
  readonly type: string;
}

/**
 * A stored-shape step (S8): a run of features that didn't hold, after which
 * the stored shape of the run's last feature took the body's place (one
 * Remove of what was rebuilt, one `import` of that shape) and the walk went
 * on from it.
 */
export interface HistoryStep {
  /** The run's features, in order: the first didn't hold for `reason`, the rest didn't either or weren't tried. */
  readonly features: readonly FeatureNamed[];
  readonly reason: HistoryStop;
  readonly detail?: string;
  readonly drift?: Drift;
  readonly references?: ReferenceTally;
  /** The FreeCAD feature whose stored shape the `import` holds (the run's last). */
  readonly shape: string;
  /** The `import` feature. */
  readonly feature: string;
  /** The Remove that took out the body's Extrudo bodies before the step; none when it had none. */
  readonly remove?: string;
  /** How many of `mapped` came before the step (they stay in the timeline but no longer shape the body). */
  readonly after: number;
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
    /** A fillet's or chamfer's: how its edges were found, as far as the lookup went. */
    readonly references?: ReferenceTally;
  };
  /** The Extrudo bodies the mapped features made, when some did. */
  readonly bodies: readonly string[];
  /** The sketches imported for the mapped features (S4's outcomes, bindings included). */
  readonly sketches: readonly SketchOutcome[];
  /** Features tried a second time after the first failed the check with `differs` (S7). */
  readonly secondAttempts: number;
  /** The stored-shape steps the body took, in order (S8). */
  readonly steps: readonly HistoryStep[];
  /** How many features held after its last step (all of `mapped` when it took none). */
  readonly heldAfterLastStep: number;
}

export interface BodyWalkOptions {
  readonly budget: KernelBudget;
  /** Vets sketch constraints (S4); without one no constraint is imported. */
  readonly solver?: SketchSolver;
  /** Hears each feature walked. */
  readonly onStep?: () => void;
  readonly maxBodyFeatures?: number;
  readonly maxFileFeatures?: number;
  /**
   * Prefer an origin axis or plane where a transform's reference coincides
   * with one (default); tests turn it off to reach the sketch lines, the
   * matched edges and the construction features.
   */
  readonly originFirst?: boolean;
  /** Hears how far each other body moved between two rebuilds (tests and the library run). */
  readonly onUntouched?: (d: Drift) => void;
  /** `MAX_BODY_STEPS` and `MAX_STEP_TEXT_BYTES`, for tests. */
  readonly maxSteps?: number;
  readonly maxStepTextBytes?: number;
  /** Receives the bytes of the attachments the steps add (S8): the caller writes them with the design. */
  readonly files?: Map<AttachmentId, Uint8Array>;
}

/** Reasons that end a body however its features go on: its chain, the walk's limits, the budget (S8). */
const ENDS_BODY: ReadonlySet<HistoryStop> = new Set(['chain', 'restarts', 'import-time']);

/** The attachments the design's `import` features use. */
function importFiles(design: Design): Set<string> {
  const out = new Set<string>();
  for (const f of design.doc.features)
    if (f.type === 'import') {
      const file = (f.inputs as { file?: { id?: unknown } }).file?.id;
      if (typeof file === 'string') out.add(file);
    }
  return out;
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
    if (!o) return { broken: `its feature ${named(name)} isn't in the file` };
    if (!members.has(name)) return { broken: `its feature ${named(name)} is not in the body` };
    out.push(o);
    const base = o.properties.BaseFeature?.value;
    if (base !== undefined && base.kind !== 'link')
      return { broken: `the feature before ${named(name)} can't be read` };
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

/** A rebuild's reply once checked: body IDs of the document's features, measures by ID. */
interface SaneRebuild {
  readonly ids: readonly string[];
  readonly bodies: ReadonlyMap<string, ShapeMeasure>;
  readonly failed: readonly { readonly feature: string; readonly message: string }[];
}

/** The longest body ID a reply may name (a feature ID, a colon, a body number). */
export const MAX_BODY_ID_LENGTH = 200;
const BODY_ID = /^(.+):(\d{1,9})$/;

/**
 * A rebuild's reply checked, or `undefined` when it makes no sense: every
 * body ID `<ID of a feature in the document sent>:<whole number>` and at most
 * `MAX_BODY_ID_LENGTH` long, at most `MAX_REBUILD_BODIES` of them, every
 * measure keyed by one of them (own keys only) and sane, every failure a
 * feature ID and a message. The kernel's strings are never used to index a
 * plain object.
 */
export function saneRebuild(
  reply: unknown,
  features: ReadonlySet<string>,
): SaneRebuild | undefined {
  if (typeof reply !== 'object' || reply === null) return undefined;
  const r = reply as { ids?: unknown; bodies?: unknown; failed?: unknown };
  if (!Array.isArray(r.ids) || r.ids.length > MAX_REBUILD_BODIES) return undefined;
  const ids: string[] = [];
  for (const id of r.ids) {
    if (typeof id !== 'string' || id.length > MAX_BODY_ID_LENGTH) return undefined;
    const m = BODY_ID.exec(id);
    if (!m || !features.has(m[1] as string)) return undefined;
    ids.push(id);
  }
  if (typeof r.bodies !== 'object' || r.bodies === null || Array.isArray(r.bodies))
    return undefined;
  const known = new Set(ids);
  const keys = Object.keys(r.bodies);
  if (keys.length > ids.length) return undefined;
  const bodies = new Map<string, ShapeMeasure>();
  for (const key of keys) {
    if (!known.has(key)) return undefined;
    const m = (r.bodies as Record<string, unknown>)[key];
    if (!Object.hasOwn(r.bodies, key) || !saneMeasure(m)) return undefined;
    bodies.set(key, m);
  }
  if (!Array.isArray(r.failed) || r.failed.length > MAX_REBUILD_BODIES) return undefined;
  const failed: { feature: string; message: string }[] = [];
  for (const f of r.failed) {
    if (typeof f !== 'object' || f === null) return undefined;
    const { feature, message } = f as { feature?: unknown; message?: unknown };
    if (typeof feature !== 'string' || typeof message !== 'string') return undefined;
    failed.push({ feature, message: clip(message) });
  }
  return { ids, bodies, failed };
}

/** The most expressions kept per mapped feature (the library's most on one PartDesign feature is 2). */
export const MAX_FEATURE_EXPRESSIONS = 64;

/** A feature's expressions on the properties its inputs came from, at most `MAX_FEATURE_EXPRESSIONS`. */
function expressionsOf(
  f: FcObject,
  sources: Readonly<Record<string, string>>,
): { expressions: FcExpression[]; expressionsDropped?: number } {
  const used = new Set(Object.values(sources));
  const all = f.expressions.filter((e) => used.has(e.path.split('.')[0] as string));
  const expressions = all.slice(0, MAX_FEATURE_EXPRESSIONS);
  const dropped = all.length - expressions.length;
  return { expressions, ...(dropped > 0 ? { expressionsDropped: dropped } : {}) };
}

type Pt = readonly [number, number];

/** Where a ring's edges cross the horizontal line at `y` (a height through no vertex). */
function crossingsAt(ring: readonly Pt[], y: number): number[] {
  const xs: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j] as Pt;
    const [bx, by] = ring[i] as Pt;
    if (ay > y !== by > y) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
  }
  return xs.sort((m, n) => m - n);
}

/** How many scan lines a region's interior point tries. */
const SCAN_LINES = 8;

/**
 * A point inside a region (its outer ring less its holes), from at most
 * `SCAN_LINES` horizontal lines between distinct vertex heights near the
 * middle of the region: each costs the rings' vertices once, so a region is
 * linear in its size. (`interiorPoint` in `@extrudo/sketch` tries every height,
 * the square of the vertices, which a ring of large circles makes seconds.)
 */
function insidePoint(outer: readonly Pt[], holes: readonly (readonly Pt[])[]): Pt | undefined {
  const ys = [...new Set(outer.map((p) => p[1]))].sort((m, n) => m - n);
  const holeYs = new Set(holes.flatMap((h) => h.map((p) => p[1])));
  const middle = Math.floor(ys.length / 2);
  for (let k = 0; k < SCAN_LINES; k++) {
    // Alternate around the middle: m, m+1, m-1, m+2 ...
    const at = middle + (k % 2 === 0 ? k / 2 : -(k + 1) / 2);
    const lo = ys[at - 1];
    const hi = ys[at];
    if (lo === undefined || hi === undefined || hi - lo <= 1e-9) continue;
    const y = (lo + hi) / 2;
    if (holeYs.has(y)) continue;
    const outerX = crossingsAt(outer, y);
    if (outerX.length < 2 || outerX.length % 2 !== 0) continue;
    const blocked = holes.flatMap((h) => {
      const xs = crossingsAt(h, y);
      const spans: [number, number][] = [];
      for (let i = 0; i + 1 < xs.length; i += 2) spans.push([xs[i] as number, xs[i + 1] as number]);
      return spans;
    });
    let best: { x: number; width: number } | undefined;
    for (let i = 0; i + 1 < outerX.length; i += 2) {
      // The free parts of [x0, x1] once the holes' spans are taken out.
      let free: [number, number][] = [[outerX[i] as number, outerX[i + 1] as number]];
      for (const [b0, b1] of blocked)
        free = free.flatMap(([f0, f1]): [number, number][] =>
          b1 <= f0 || b0 >= f1
            ? [[f0, f1]]
            : [
                ...(b0 > f0 ? [[f0, b0] as [number, number]] : []),
                ...(b1 < f1 ? [[b1, f1] as [number, number]] : []),
              ],
        );
      for (const [f0, f1] of free)
        if (f1 - f0 > 1e-9 && (!best || f1 - f0 > best.width))
          best = { x: (f0 + f1) / 2, width: f1 - f0 };
    }
    if (best) return [best.x, y];
  }
  return undefined;
}

const boxOf = (ring: readonly Pt[]) => {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
};

/**
 * The sketch's regions FreeCAD makes faces of: inside an odd number of
 * outer loops (Bullseye, `AllowMultiFace`), or exactly one (the first level).
 * Bounded by `MAX_PROFILE_CURVES` (the caller's) and `MAX_PROFILE_REGIONS`:
 * a point per region from a few scan lines, and a loop's containment tested
 * only where its box holds the point.
 */
export function profileRefs(handle: SketchHandle, multiFace: boolean): GeomRef[] | string {
  const regions = handle.regions.filter((r) => !r.text);
  if (regions.length > MAX_PROFILE_REGIONS)
    return `its sketch has ${regions.length} closed regions, more than ${MAX_PROFILE_REGIONS}`;
  const boxes = regions.map((r) => boxOf(r.outer.polygon));
  const out: GeomRef[] = [];
  regions.forEach((r) => {
    const p = insidePoint(
      r.outer.polygon,
      r.holes.map((h) => h.polygon),
    );
    if (!p) return;
    let depth = 0;
    regions.forEach((q, k) => {
      const b = boxes[k] as ReturnType<typeof boxOf>;
      if (p[0] < b.x0 || p[0] > b.x1 || p[1] < b.y0 || p[1] > b.y1) return;
      if (insidePolygon(q.outer.polygon, p as [number, number])) depth++;
    });
    if (multiFace ? depth % 2 === 1 : depth === 1)
      out.push({ kind: 'profile', id: profileRefId(handle.id, r.id) });
  });
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
  const maxSteps = options.maxSteps ?? MAX_BODY_STEPS;
  const maxStepText = options.maxStepTextBytes ?? MAX_STEP_TEXT_BYTES;
  const files = options.files ?? new Map<AttachmentId, Uint8Array>();
  /** The stored-shape text the steps converted so far, in all. */
  let stepText = 0;
  const histories: BodyHistory[] = [];
  /** Every Extrudo body the last rebuild had. */
  let known: string[] = [];
  let walked = 0;
  /** The body each FreeCAD feature and sketch was walked for: one object, one body, once per file. */
  const owner = new Map<string, string>();
  const decodedSketches = new Map<string, DecodedSketch>();
  /** The kernel's restarts when a feature last held: a dress-up describes that rebuild's bodies. */
  let restartsAtHold = -1;
  /** Every body's measure when it was last rebuilt and held: the check that a feature left other bodies alone (S7). */
  const lastMeasures = new Map<string, ShapeMeasure>();
  /** Any sketch of the file, decoded once per import. */
  const sketchOf = (name: string): DecodedSketch | undefined => {
    let d = decodedSketches.get(name);
    if (d) return d;
    const o = doc.byName.get(name);
    if (!o?.type.startsWith('Sketcher::SketchObject')) return undefined;
    d = decodeSketch(o);
    decodedSketches.set(name, d);
    return d;
  };

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
    let secondAttempts = 0;
    /** This body's mapped features by FreeCAD name: what a transform's originals become. */
    const mappedBy = new Map<string, { feature: string; kind: FeatureKind }>();
    /** The sketch axes a transform of this body names, drawn when their sketch comes in (S7). */
    const wantedAxes = axesWanted(doc, features, maxBody);
    /** The stored-shape steps taken (S8), and the run of features that didn't hold since the last feature that did. */
    const taken: StepState[] = [];
    let run: Run | undefined;
    /** The feature that made the body (`new-body`) before any step: a transform repeating it repeats the body (S7). */
    let bodyMaker: string | undefined;
    /** Whether the feature being walked has been accounted for (held, failed or joined a run). */
    let noted = false;
    /**
     * The one place that decides what happens when a feature doesn't hold
     * (S8): it joins the run of features that didn't, whose last stored shape
     * stands in once a feature after it is tried (`ensureBase`). Its chain,
     * the walk's limits and the budget (`end`, `ENDS_BODY`) end the body.
     */
    const stop = (
      o: FcObject | undefined,
      reason: HistoryStop,
      detail?: string,
      off?: Drift,
      references?: ReferenceTally,
      end = false,
    ) => {
      noted = true;
      const record: NonNullable<BodyHistory['stop']> = {
        object: o?.name ?? body.name,
        type: o?.type ?? body.type,
        reason,
        ...(detail ? { detail: clip(detail) } : {}),
        ...(off ? { drift: off } : {}),
        ...(references ? { references } : {}),
      };
      if (end || !o || ENDS_BODY.has(reason)) {
        stopped = record;
        return;
      }
      if (run) {
        run.features.push(o);
        run.pending = true;
      } else run = { features: [o], first: record, pending: true };
    };
    if ('broken' in chain) stop(undefined, 'chain', chain.broken);
    /** The sketches imported for this body's kept features, by FreeCAD name. */
    const sketches = new Map<string, Extract<AddSketchResult, { imported: true }>>();
    /**
     * The Extrudo features that shape the body now, which a reference must
     * name one of: the last step's `import` and the features that held after
     * it (every mapped feature before any step). A superseded step's and the
     * features before the last step don't count (S8).
     */
    const own = (): Set<string> => {
      const last = taken.at(-1);
      return new Set([
        ...(last ? [last.feature] : []),
        ...mapped.slice(last?.after ?? 0).map((m) => m.feature),
      ]);
    };

    /** One feature: mapped, rebuilt and checked, or `stop` called. */
    const walk = async (f: FcObject, i: number): Promise<void> => {
      const frame = containerChain(doc, f);
      if (!frame) {
        stop(f, 'chain', 'its containers hold each other in a loop');
        return;
      }
      const sketchObject = sketchOfFeature(doc, f);
      // Each sketch is decoded once per import (the axis lookup here and addSketch share it).
      let decodedSketch = sketchObject ? decodedSketches.get(sketchObject.name) : undefined;
      if (sketchObject && !decodedSketch) {
        decodedSketch = decodeSketch(sketchObject);
        decodedSketches.set(sketchObject.name, decodedSketch);
      }
      const previous = features[i - 1]?.name;
      const decoded = decodeFeature(doc, f, {
        body,
        moved: frame.moved,
        ...(decodedSketch ? { sketch: decodedSketch } : {}),
        ...(previous !== undefined ? { previous } : {}),
        sketchOf,
      });
      if (!decoded.ok) {
        stop(f, decoded.reason, decoded.detail);
        return;
      }
      // A feature about to be tried after a run: the run's stored shape comes in first (S8).
      if (!(await ensureBase(f))) return;
      const feature = decoded.feature;
      if (feature.kind === 'fillet' || feature.kind === 'chamfer') {
        await walkDressUp(f, feature, frame.chain);
        return;
      }
      if (
        feature.kind === 'linear' ||
        feature.kind === 'polar' ||
        feature.kind === 'mirrored' ||
        feature.kind === 'multi'
      ) {
        await walkTransform(f, feature, frame.chain, i);
        return;
      }
      // A sketch is imported for one body only: another body's sketch is not tried again.
      const of = owner.get(feature.sketch);
      if (of !== undefined && of !== body.name) {
        stop(
          f,
          'chain',
          `its sketch ${named(feature.sketch)} belongs to another body, ${named(of)}`,
        );
        return;
      }
      owner.set(feature.sketch, body.name);
      const drawnCurves = (decodedSketch?.geometry ?? []).filter(
        (g) => g !== undefined && !g.construction && g.internal === 0 && g.kind !== 'point',
      ).length;
      if (drawnCurves > MAX_PROFILE_CURVES) {
        stop(
          f,
          'sketch',
          `its sketch draws ${drawnCurves} curves, more than ${MAX_PROFILE_CURVES}`,
        );
        return;
      }
      if (i === 0 && 'startsFrom' in chain && chain.startsFrom) {
        stop(f, 'chain', `it builds on ${named(chain.startsFrom)}, a solid outside the body`);
        return;
      }
      const additive = feature.kind === 'pad' || feature.kind === 'revolution';
      if (!additive && mine.length === 0) {
        stop(f, 'no-base', 'there is nothing before it to cut');
        return;
      }
      if (feature.kind === 'hole') {
        await walkHole(f, feature, frame.chain, decodedSketch);
        return;
      }
      await holdAll(f, frame.chain, feature, [
        async () =>
          addFeature(
            doc,
            design,
            f,
            feature,
            sketches,
            mine,
            options.solver,
            decodedSketch,
            wantedAxes,
          ),
      ]);
    };

    /** A hole: its sketch, its centres as the sketch's points; counterbore, then countersink where the file doesn't say. */
    const walkHole = async (
      f: FcObject,
      feature: DecodedHole,
      chain: readonly FcPlacement[],
      decodedSketch: DecodedSketch | undefined,
    ): Promise<void> => {
      const cuts = feature.cuts;
      await holdAll(
        f,
        chain,
        feature,
        cuts.map((cut) => async (): Promise<Added> => {
          const got = sketchFor(
            doc,
            design,
            feature.sketch,
            sketches,
            options.solver,
            decodedSketch,
            wantedAxes,
          );
          if ('stop' in got) return got;
          const added = addHole(
            design,
            feature,
            got.sketch,
            decodedSketch ?? (sketchOf(feature.sketch) as DecodedSketch),
            cut,
            cleanName(f.label, f.name),
          );
          if ('stop' in added) return added;
          return {
            feature: added.feature,
            sketch: got.sketch.id,
            ...(got.newSketch ? { newSketch: got.newSketch } : {}),
            centres: added.centres,
            ...(feature.threadLost ? { threadLost: true as const } : {}),
          };
        }),
        true,
      );
    };

    /** A pattern, mirror or MultiTransform: its originals as this body's features, its references found. */
    const walkTransform = async (
      f: FcObject,
      feature: DecodedTransform,
      chain: readonly FcPlacement[],
      i: number,
    ): Promise<void> => {
      const ids: string[] = [];
      for (const name of feature.originals) {
        const m = mappedBy.get(name);
        const at = features.findIndex((x) => x.name === name);
        const why =
          m !== undefined
            ? REPEATABLE.has(m.kind)
              ? undefined
              : `it repeats ${named(name)}, a ${m.kind === 'fillet' || m.kind === 'chamfer' ? 'dress-up' : 'pattern or mirror'}, which Extrudo can't repeat`
            : at > i
              ? `it repeats ${named(name)}, which comes after it`
              : owner.has(name) && owner.get(name) !== body.name
                ? `it repeats ${named(name)}, a feature of another body`
                : at < 0
                  ? `it repeats ${named(name)}, which is not a feature of this body`
                  : `it repeats ${named(name)}, which didn't come in`;
        if (why) {
          stop(f, 'original', why);
          return;
        }
        ids.push((m as { feature: string }).feature);
      }
      // A hole repeats all its centres, and a hole's cut costs about two pockets' (ADR-0144's S7
      // amendment): each centre counts twice in the instance cap.
      const weight = feature.originals.reduce((n, name) => {
        const centres = mapped.find((x) => x.object === name)?.centres;
        return n + (centres === undefined ? 1 : HOLE_CENTRE_WEIGHT * centres);
      }, 0);
      if (feature.instances * weight > MAX_TRANSFORM_INSTANCES) {
        stop(
          f,
          'limit',
          `it makes ${feature.instances * weight} instances (a hole counts each of its centres twice), more than ${MAX_TRANSFORM_INSTANCES}`,
        );
        return;
      }
      // A MultiTransform's steps are its own: one object, one body, once per file.
      if (feature.kind === 'multi')
        for (const child of feature.children) {
          const of = owner.get(child);
          if (of !== undefined && of !== f.name) {
            stop(f, 'multi-transform', `its step ${named(child)} belongs to another feature`);
            return;
          }
          owner.set(child, f.name);
        }
      const steps = feature.kind === 'multi' ? feature.steps : [feature];
      const matches = steps.some((s) =>
        (s.kind === 'linear' ? [s.first.reference, s.second?.reference] : [s.reference]).some(
          (r) => r?.kind === 'element',
        ),
      );
      if (matches && budget.restarts !== restartsAtHold) {
        stop(f, 'kernel', 'the kernel was replaced since its body was last rebuilt');
        return;
      }
      // The body's first feature made the body: Extrudo has no tool of it to replay. When the
      // originals are every feature so far, the body itself is what is repeated (joined).
      const first = bodyMaker;
      let what: Repeated = { features: ids };
      if (first !== undefined && ids.includes(first)) {
        // After a step the body is the stored shape's, not the first feature's (S8).
        if (taken.length > 0) {
          stop(
            f,
            'original',
            `it repeats ${named(mapped[0]?.object ?? '')}, the feature its body started from, and a stored shape has taken the body's place since`,
          );
          return;
        }
        const all = new Set(mapped.map((m) => m.feature));
        if (ids.length !== all.size || !ids.every((id) => all.has(id))) {
          stop(
            f,
            'original',
            `it repeats ${named(mapped[0]?.object ?? '')}, the feature its body starts from, with others but not all of them`,
          );
          return;
        }
        what = { bodies: [...mine] };
      }
      const walkedNames = new Set(features.slice(0, i).map((x) => x.name));
      await holdAll(
        f,
        chain,
        feature,
        [
          async (): Promise<Added> => {
            const mapper = new TransformMapper({
              doc,
              design,
              budget,
              body,
              sketches,
              sketchOf,
              mine,
              own: own(),
              walked: walkedNames,
              name: cleanName(f.label, f.name),
              ...(options.originFirst === false ? { originFirst: false } : {}),
            });
            const added = await mapper.add(feature, what);
            const references = mapper.references;
            if ('stop' in added)
              return {
                stop: added.stop,
                detail: added.detail,
                ...(added.references ? { references: added.references } : {}),
              };
            return {
              feature: added.feature,
              ...(added.extra ? { extra: added.extra } : {}),
              ...(references ? { references } : {}),
              ...(mapper.constructions > 0 ? { constructions: mapper.constructions } : {}),
            };
          },
        ],
        true,
      );
    };

    /** A fillet or chamfer: its base's stored shape described, its edges found, then held as any feature. */
    const walkDressUp = async (
      f: FcObject,
      feature: DecodedDressUp,
      chain: readonly FcPlacement[],
    ): Promise<void> => {
      const base = doc.byName.get(feature.base) as FcObject;
      const baseStored = storedText(doc, base);
      if (!('text' in baseStored)) {
        stop(f, 'stored', `its base's ${baseStored.detail}`);
        return;
      }
      if (budget.restarts !== restartsAtHold) {
        stop(f, 'kernel', 'the kernel was replaced since its body was last rebuilt');
        return;
      }
      await holdAll(f, chain, feature, [
        async () => {
          const added = await addDressUp(design, feature, {
            budget,
            baseText: baseStored.text,
            chain,
            mine,
            own: own(),
            name: cleanName(f.label, f.name),
          });
          return 'stop' in added
            ? {
                stop: added.stop,
                detail: added.detail,
                ...(added.references ? { references: added.references } : {}),
              }
            : { feature: added.feature, references: added.references };
        },
      ]);
    };

    /** Why one attempt at a feature didn't hold. */
    type Failure = {
      reason: HistoryStop;
      /** Not a reading of the file a second attempt could change (another body touched). */
      final?: true;
      detail?: string;
      drift?: Drift;
      references?: ReferenceTally;
    };

    /**
     * Adds a feature (`add`) in one transaction, rebuilds, and keeps it only
     * when the rebuilt body is the shape the file stores for it. `others`: the
     * feature joins or cuts whatever it touches (a pattern's replay, a hole),
     * so the other FreeCAD bodies' Extrudo bodies are measured too and must be
     * as they were. Returns why it didn't hold, or nothing when it held.
     */
    const hold = (
      f: FcObject,
      chain: readonly FcPlacement[],
      feature: DecodedFeature,
      add: () => Promise<Added>,
      others: boolean,
      second: boolean,
    ): Promise<Failure | undefined> =>
      check(f, chain, add, others, (added, d) => {
        if (run?.pending) throw new Error('a feature held on a run whose shape had not come in');
        // A feature held: the run before it (if any) is over, its step stays.
        run = undefined;
        if (mine.length === 0 && taken.length === 0) bodyMaker ??= added.feature;
        if (added.newSketch) sketchOutcomes.push(added.newSketch.outcome);
        mappedBy.set(f.name, { feature: added.feature, kind: feature.kind });
        mapped.push({
          object: f.name,
          kind: feature.kind,
          feature: added.feature,
          ...(added.sketch !== undefined ? { sketch: added.sketch } : {}),
          ...(added.references ? { references: added.references } : {}),
          sources: feature.sources,
          ...expressionsOf(f, feature.sources),
          drift: d,
          ...(added.extra ? { extra: added.extra } : {}),
          ...(added.constructions ? { constructions: added.constructions } : {}),
          ...(added.centres !== undefined ? { centres: added.centres } : {}),
          ...(added.threadLost ? { threadLost: true as const } : {}),
          ...(second ? { secondAttempt: true as const } : {}),
        });
      });

    /**
     * Adds what `add` adds in one transaction, rebuilds, and keeps it only
     * when the FreeCAD body's rebuilt bodies measure as `f`'s stored shape
     * (`measured`, else measured here from the text). `others`: the other
     * FreeCAD bodies' Extrudo bodies are measured too and must be as they
     * were. `held` hears what was kept. Returns why it didn't hold, or
     * nothing when it held. A feature (`hold`) and a stored-shape step
     * (`applyStep`) are kept by this one check.
     */
    const check = async (
      f: FcObject,
      chain: readonly FcPlacement[],
      add: () => Promise<Added>,
      others: boolean,
      held: (added: Extract<Added, { feature: string }>, d: Drift) => void,
      measured?: ShapeMeasure,
      file?: () => { id: AttachmentId; bytes: Uint8Array } | undefined,
    ): Promise<Failure | undefined> => {
      const stored = measured ? undefined : storedText(doc, f);
      if (stored && !('text' in stored)) return { reason: 'stored', detail: stored.detail };

      // Everything this feature adds is one transaction, taken back if it doesn't hold.
      const before = new Set(design.doc.features.map((x) => x.id));
      design.state.beginTransaction(`Import ${cleanName(f.label, f.name)}`);
      let committed = false;
      try {
        const added = await add();
        const adding = file?.();
        if ('stop' in added)
          return {
            reason: added.stop,
            detail: added.detail,
            ...(added.references ? { references: added.references } : {}),
          };
        const measuredStored: CallOutcome<ShapeMeasure> = measured
          ? { kind: 'done', value: measured }
          : await budget.call(
              () => budget.kernel.measureStoredShape((stored as { text: string }).text, chain),
              saneMeasure,
            );
        if (measuredStored.kind !== 'done')
          return {
            reason: callStop(measuredStored),
            ...('detail' in measuredStored && measuredStored.detail
              ? { detail: measuredStored.detail }
              : {}),
          };
        // The body IDs a reply may name: `<feature of the document sent>:<n>`.
        let sentFeatures = new Set<string>();
        const skip = others ? [] : [...settled];
        const rebuilt = await budget.call(
          () => {
            const sent = design.toJSON();
            sentFeatures = new Set(sent.features.map((x) => x.id));
            // The steps' files so far, and the one the step at hand adds (S8).
            const sending = new Map(files);
            if (adding) sending.set(adding.id, adding.bytes);
            return budget.kernel.rebuild(sent, sending, skip);
          },
          (reply: unknown): reply is RebuildResult =>
            saneRebuild(reply, sentFeatures) !== undefined,
        );
        if (rebuilt.kind !== 'done')
          return {
            reason: callStop(rebuilt),
            ...('detail' in rebuilt && rebuilt.detail ? { detail: rebuilt.detail } : {}),
          };
        const r = saneRebuild(rebuilt.value, sentFeatures) as SaneRebuild;
        const fresh = new Set(design.doc.features.map((x) => x.id).filter((id) => !before.has(id)));
        const failure = r.failed.find((x) => fresh.has(x.feature as FeatureId));
        if (failure) return { reason: 'failed', detail: failure.message };
        const now = r.ids.filter((id) => !settled.has(id));
        const measures = now.map((id) => r.bodies.get(id));
        if (measures.some((m) => m === undefined))
          return { reason: 'kernel', detail: "the kernel didn't measure every body" };
        if (others) {
          // What the feature touched beyond its own body: every other body as it was.
          for (const id of settled) {
            const was = lastMeasures.get(id);
            if (was === undefined) continue;
            const is = r.bodies.get(id);
            if (!r.ids.includes(id) || is === undefined)
              return {
                reason: 'differs',
                detail: 'it took away a body of another FreeCAD body',
                final: true,
              };
            options.onUntouched?.(drift(is, was));
            const why = untouchedDisagreement(is, was);
            if (why)
              return {
                reason: 'differs',
                detail: `it changed a body of another FreeCAD body: ${why}`,
                final: true,
              };
          }
        }
        const rebuiltBody = combined(measures as ShapeMeasure[]);
        const wrong = historyDisagreement(rebuiltBody, measuredStored.value);
        if (wrong)
          return {
            reason: 'differs',
            detail: wrong,
            drift: drift(rebuiltBody, measuredStored.value),
            ...(added.references ? { references: added.references } : {}),
          };
        design.state.commitTransaction();
        committed = true;
        held(added, drift(rebuiltBody, measuredStored.value));
        restartsAtHold = budget.restarts;
        known = [...r.ids];
        mine = now;
        for (const id of now) lastMeasures.set(id, r.bodies.get(id) as ShapeMeasure);
        return undefined;
      } finally {
        if (!committed) {
          design.state.cancelTransaction();
          forgetRemovedPlanes(design);
          for (const [key, s] of sketches)
            if (!design.doc.features.some((x) => x.id === s.id)) sketches.delete(key);
        }
      }
    };

    /**
     * Holds a feature, trying the next of `attempts` only after one failed
     * the check with `differs` (S7: at most two, for a sense or a hole's cut
     * the file doesn't say, each a whole transaction; never for a tolerance or
     * a reference match). Stops the body when none holds.
     */
    const holdAll = async (
      f: FcObject,
      chain: readonly FcPlacement[],
      feature: DecodedFeature,
      attempts: readonly (() => Promise<Added>)[],
      others = false,
    ): Promise<void> => {
      for (let k = 0; k < attempts.length; k++) {
        const failed = await hold(
          f,
          chain,
          feature,
          attempts[k] as () => Promise<Added>,
          others,
          k > 0,
        );
        if (!failed) return;
        if (
          failed.reason === 'differs' &&
          !failed.final &&
          k + 1 < attempts.length &&
          !budget.broken
        ) {
          secondAttempts++;
          continue;
        }
        stop(f, failed.reason, failed.detail, failed.drift, failed.references);
        return;
      }
    };

    /**
     * Before a feature after a run is tried: the run's last stored shape takes
     * the body's place (`applyStep`). True when it did (or there was no run);
     * false when `f` joined the run untried (that shape can't come in, so the
     * run reaches on to the next feature whose shape can) or the body ended.
     */
    const ensureBase = async (f: FcObject): Promise<boolean> => {
      if (!run?.pending) return true;
      const outcome = await applyStep(run);
      if (outcome === 'held') return true;
      noted = true;
      if (outcome === 'out') run.features.push(f);
      return false;
    };

    /** Ends the body for a reason no step can carry it over (S8's caps, the budget). */
    const endIn = (r: Run, reason: HistoryStop, detail: string): 'ended' => {
      const first = r.features[0] as FcObject;
      stop(first, reason, detail, undefined, undefined, true);
      return 'ended';
    };

    /**
     * The stored-shape step (S8): in one transaction, a Remove of the FreeCAD
     * body's Extrudo bodies so far (none when it has none) and an `import` of
     * the run's last stored shape, through S3's conversion, checks and
     * limits; rebuilt, the import must measure as the stored shape does
     * (S5's tolerances) and the other FreeCAD bodies must be untouched (S7).
     * A run that already has a step moves it forward instead: its `import`
     * and attachment are replaced, its Remove stays.
     */
    const applyStep = async (r: Run): Promise<'held' | 'out' | 'ended'> => {
      const target = r.features.at(-1) as FcObject;
      if (budget.broken) return endIn(r, 'restarts', 'the geometry kernel failed too often');
      if (budget.left() <= 0) return endIn(r, 'import-time', 'the import ran out of time');
      if (!r.step && taken.length >= maxSteps)
        return endIn(r, 'limit', `the body would take more than ${maxSteps} stored-shape steps`);
      const stored = storedText(doc, target);
      if (!('text' in stored)) return 'out';
      if (stepText + stored.text.length > maxStepText)
        return endIn(
          r,
          'limit',
          `its steps would convert more than ${Math.round(maxStepText / (1024 * 1024))} MB of stored shapes`,
        );
      stepText += stored.text.length;
      const frame = containerChain(doc, target);
      if (!frame) return 'out';
      const conv = await convertStored(budget, stored.text, frame.chain);
      if (conv.kind === 'out') {
        if (conv.reason === 'restarts' || conv.reason === 'import-time')
          return endIn(r, conv.reason, conv.detail ?? 'the import ran out of time');
        return 'out';
      }
      const replaced = r.step?.attachment;
      const existing = Object.entries(design.doc.attachments ?? {}).find(
        ([id, a]) => a.sha256 === conv.sha256 && id !== replaced,
      )?.[0] as AttachmentId | undefined;
      if (
        existing === undefined &&
        attachmentBytes(design, replaced) + conv.bytes.length > MAX_ATTACHMENTS_BYTES
      )
        return 'out';
      const label = cleanName(target.label, target.name);
      const before = { mine: [...mine], known: [...known] };
      let attachment: AttachmentId | undefined;
      let remove: string | undefined;
      let dropped: AttachmentId | undefined;
      const failure = await check(
        target,
        frame.chain,
        async () => {
          if (r.step) {
            // The step moves forward: the run's later shape replaces its import and file.
            design.remove(r.step.feature);
            if (!importFiles(design).has(r.step.attachment)) {
              design.state.dispatch(removeAttachment({ id: r.step.attachment }));
              dropped = r.step.attachment;
            }
          } else if (mine.length > 0)
            remove = design.add(
              'remove',
              { bodies: mine.map((id) => ({ kind: 'body', id })) },
              { name: `Remove ${name}` },
            ).id;
          attachment =
            existing ??
            (Object.entries(design.doc.attachments ?? {}).find(
              ([, a]) => a.sha256 === conv.sha256,
            )?.[0] as AttachmentId | undefined) ??
            addStepAttachment(design, label, conv.sha256, conv.bytes.length);
          const added = design.add('import', importInputs({ file: attachment, up: 'z' }), {
            name: `Import ${label}`,
          });
          return { feature: added.id };
        },
        true,
        (added) => {
          const a = attachment as AttachmentId;
          if (dropped !== undefined) files.delete(dropped);
          if (!files.has(a) && existing === undefined) files.set(a, conv.bytes);
          const step: StepState = r.step ?? {
            features: [],
            first: r.first,
            feature: '',
            attachment: a,
            shape: '',
            after: mapped.length,
            before,
            ...(remove !== undefined ? { remove } : {}),
          };
          step.features = [...r.features];
          step.feature = added.feature;
          step.attachment = a;
          step.shape = target.name;
          if (!r.step) {
            taken.push(step);
            r.step = step;
          }
          r.pending = false;
        },
        conv.read,
        () =>
          attachment !== undefined && !files.has(attachment)
            ? { id: attachment, bytes: conv.bytes }
            : undefined,
      );
      if (!failure) return 'held';
      if (ENDS_BODY.has(failure.reason))
        return endIn(r, failure.reason, failure.detail ?? 'the import ran out of time');
      return 'out';
    };

    /**
     * Takes a run's step out again when the run reaches the body's end (the
     * tip, or a limit): the body then ends as it did before S8, its final
     * shape brought in by the shapes import, with nothing of the step left.
     */
    const undoStep = (step: StepState) => {
      design.transaction('Take back a stored-shape step', () => {
        design.remove(step.feature);
        if (step.remove !== undefined) design.remove(step.remove);
        if (!importFiles(design).has(step.attachment)) {
          design.state.dispatch(removeAttachment({ id: step.attachment }));
          files.delete(step.attachment);
        }
      });
      taken.pop();
      mine = step.before.mine;
      known = step.before.known;
      // The kernel's last rebuild had the step: nothing may describe it again.
      restartsAtHold = -1;
    };

    for (let i = 0; i < features.length && !stopped; i++) {
      const f = features[i] as FcObject;
      if (i >= maxBody || walked >= maxFile) {
        stop(
          f,
          'limit',
          `more than ${i >= maxBody ? maxBody : maxFile} features`,
          undefined,
          undefined,
          true,
        );
        break;
      }
      // Nothing of a feature runs once the kernel has failed too often or the time is up.
      if (budget.broken) {
        stop(f, 'restarts', 'the geometry kernel failed too often');
        break;
      }
      if (budget.left() <= 0) {
        stop(f, 'import-time', 'the import ran out of time');
        break;
      }
      // A feature of another body (a chain that crosses bodies) is never mapped twice.
      const other = owner.get(f.name);
      if (other !== undefined && other !== body.name) {
        stop(f, 'chain', `it is a feature of another body, ${named(other)}`);
        break;
      }
      owner.set(f.name, body.name);
      walked++;
      options.onStep?.();
      noted = false;
      try {
        await walk(f, i);
      } catch (error) {
        // Nothing a feature's own work throws ends the import: it doesn't hold.
        if (!noted)
          stop(f, 'failed', `importing it failed: ${(error as Error)?.message ?? String(error)}`);
      }
    }
    if (features.length === 0 && !stopped) stop(undefined, 'chain', 'it has no features');
    // A run that reaches the body's end: its shape is the body's final one, which the shapes
    // import brings in as it did before S8; a step the run had taken goes again.
    const open = run as Run | undefined;
    if (open?.pending) {
      if (open.step) undoStep(open.step);
      if (!stopped) stopped = open.first;
    }
    histories.push({
      object: body.name,
      name,
      features: features.length,
      mapped,
      ...(stopped ? { stop: stopped } : {}),
      bodies: mapped.length > 0 || taken.length > 0 ? mine : [],
      sketches: sketchOutcomes,
      secondAttempts,
      steps: taken.map(
        (st): HistoryStep => ({
          features: st.features.map((x) => ({
            object: x.name,
            name: cleanName(x.label, x.name),
            type: x.type,
          })),
          reason: st.first.reason,
          ...(st.first.detail ? { detail: st.first.detail } : {}),
          ...(st.first.drift ? { drift: st.first.drift } : {}),
          ...(st.first.references ? { references: st.first.references } : {}),
          shape: st.shape,
          feature: st.feature,
          ...(st.remove !== undefined ? { remove: st.remove } : {}),
          after: st.after,
        }),
      ),
      heldAfterLastStep: mapped.length - (taken.at(-1)?.after ?? 0),
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

/** A stored-shape step while the walk runs (S8). */
interface StepState {
  features: FcObject[];
  readonly first: NonNullable<BodyHistory['stop']>;
  feature: string;
  attachment: AttachmentId;
  shape: string;
  readonly after: number;
  readonly remove?: string;
  /** The body's Extrudo bodies and the last rebuild's before it: what taking it back restores. */
  readonly before: { readonly mine: string[]; readonly known: string[] };
}

/** Features that didn't hold since the last one that did (S8). */
interface Run {
  readonly features: FcObject[];
  /** Why the first didn't hold. */
  readonly first: NonNullable<BodyHistory['stop']>;
  /** Its last feature's shape hasn't taken the body's place yet. */
  pending: boolean;
  /** The step it took, when one came in. */
  step?: StepState;
}

type Added =
  | { stop: HistoryStop; detail: string; references?: ReferenceTally }
  | {
      feature: string;
      sketch?: string;
      newSketch?: Extract<AddSketchResult, { imported: true }>;
      references?: ReferenceTally;
      extra?: readonly string[];
      constructions?: number;
      centres?: number;
      threadLost?: true;
    };

/**
 * What one centre of a hole among a transform's originals counts for in
 * `MAX_TRANSFORM_INSTANCES`: 500 overlapping hole cuts took 50 s, 250 took
 * 19 s, as 500 overlapping pockets do (ADR-0144's S7 amendment).
 */
export const HOLE_CENTRE_WEIGHT = 2;

/** The features a pattern or mirror can repeat: Extrudo replays their tools (`PATTERNABLE_FEATURE_TYPES`). */
const REPEATABLE: ReadonlySet<FeatureKind> = new Set([
  'pad',
  'pocket',
  'revolution',
  'groove',
  'hole',
]);

const TRANSFORM_KINDS = new Set<FeatureKind>(['linear', 'polar', 'mirrored', 'multi']);
const REFERENCE_PROPERTIES = ['Direction', 'Direction2', 'Axis', 'MirrorPlane'];

/**
 * The sketch axes (`H_Axis`, `V_Axis`) a body's transforms and their steps
 * name, by sketch: drawn when the sketch is added, so a pattern can step
 * along them (decision 8: never by editing the sketch afterwards).
 */
function axesWanted(
  doc: FcDocument,
  features: readonly FcObject[],
  max: number,
): Map<string, Set<'h' | 'v'>> {
  const out = new Map<string, Set<'h' | 'v'>>();
  const look = (o: FcObject) => {
    for (const name of REFERENCE_PROPERTIES) {
      const v = o.properties[name]?.value;
      if (v?.kind !== 'linkSub' || !v.object) continue;
      // What the decode takes: one sub-element (several are refused).
      const subs = v.subs.filter((x) => x.name !== '');
      if (subs.length !== 1) continue;
      const sub = subs[0]?.name;
      const axis = sub === 'H_Axis' ? 'h' : sub === 'V_Axis' ? 'v' : undefined;
      if (!axis) continue;
      const set = out.get(v.object) ?? new Set();
      set.add(axis);
      out.set(v.object, set);
    }
  };
  // The features the walk can reach: the body's cap bounds the scan as it bounds the walk.
  for (const f of features.slice(0, max)) {
    const kind = Object.hasOwn(FEATURE_TYPES, f.type) ? FEATURE_TYPES[f.type] : undefined;
    if (!kind || !TRANSFORM_KINDS.has(kind)) continue;
    look(f);
    const steps = f.properties.Transformations?.value;
    if (steps?.kind !== 'linkList') continue;
    // Bounded like the decode: a MultiTransform has at most a few steps.
    for (const name of steps.objects.slice(0, MAX_TRANSFORM_STEPS)) {
      const child = doc.byName.get(name);
      if (child) look(child);
    }
  }
  return out;
}

/** The feature's sketch: imported once per body, with the axes the body's features need drawn. */
function sketchFor(
  doc: FcDocument,
  design: Design,
  name: string,
  sketches: Map<string, Extract<AddSketchResult, { imported: true }>>,
  solver: SketchSolver | undefined,
  decoded: DecodedSketch | undefined,
  wanted: ReadonlyMap<string, ReadonlySet<'h' | 'v'>>,
  wantsAxis?: 'h' | 'v',
):
  | {
      sketch: Extract<AddSketchResult, { imported: true }>;
      newSketch?: Extract<AddSketchResult, { imported: true }>;
    }
  | { stop: HistoryStop; detail: string } {
  const sketch = sketches.get(name);
  if (sketch && wantsAxis && !sketch.axes[wantsAxis])
    return {
      stop: 'axis',
      detail: 'its axis is a sketch axis of a sketch already imported without it',
    };
  if (sketch) return { sketch };
  const object = doc.byName.get(name) as FcObject;
  const axes = new Set(wanted.get(name) ?? []);
  if (wantsAxis) axes.add(wantsAxis);
  const result = addSketch(design, doc, object, {
    ...(solver ? { solver } : {}),
    ...(decoded ? { decoded } : {}),
    name: cleanName(object.label, object.name),
    ...(axes.size > 0 ? { axes: [...axes].sort() } : {}),
  });
  if (!result.imported)
    return { stop: 'sketch', detail: `its sketch was not imported: ${result.reason}` };
  sketches.set(name, result);
  return { sketch: result, newSketch: result };
}

/** Adds the feature's sketch (once per sketch) and the feature itself, or says why it can't. */
function addFeature(
  doc: FcDocument,
  design: Design,
  f: FcObject,
  feature: Extract<DecodedFeature, { kind: 'pad' | 'pocket' | 'revolution' | 'groove' }>,
  sketches: Map<string, Extract<AddSketchResult, { imported: true }>>,
  mine: readonly string[],
  solver: SketchSolver | undefined,
  decoded: DecodedSketch | undefined,
  wanted: ReadonlyMap<string, ReadonlySet<'h' | 'v'>>,
): Added {
  const wantsAxis =
    (feature.kind === 'revolution' || feature.kind === 'groove') &&
    feature.axis.kind === 'sketch-axis'
      ? feature.axis.axis
      : undefined;
  const got = sketchFor(doc, design, feature.sketch, sketches, solver, decoded, wanted, wantsAxis);
  if ('stop' in got) return got;
  const { sketch, newSketch } = got;
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
