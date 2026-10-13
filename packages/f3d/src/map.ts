/**
 * Maps a decoded f3d design onto an Extrudo design through @extrudo/api:
 * user parameters, sketches (on origin planes or planes offset from them),
 * and extrudes. What has no mapping yet is listed in the report, in timeline
 * order, so the person importing knows what to redo.
 *
 * Frames: the file stores each sketch's sketch-to-model transform (cm). Extrudo
 * sketches sit on fixed origin-plane frames (XZ's normal is −Y there, where
 * the file's is +Y), so every sketch coordinate is carried through model space
 * into the chosen Extrudo plane's frame, and an extrude flips when the two
 * normals point opposite ways.
 */
import {
  Design,
  edgeName,
  type GeomRef,
  type SketchBuilder,
  type SketchHandle,
} from '@extrudo/api';
import {
  type BodyId,
  type ComponentId,
  evaluateParameters,
  faceSketchFrame,
  ORIGIN_PLANES,
  type SketchData,
  updateBody,
} from '@extrudo/core';
import type { SketchSolver } from '@extrudo/sketch';
import {
  detectProfiles,
  insidePolygon,
  interiorPoint,
  type Profile,
} from '@extrudo/sketch/profiles';
import type { AsmSurface } from './asm';
import type { BodyStep } from './brep-step';
import { firstFace } from './chamfer-side';
import { ComponentMapping } from './components';
import type { ProfileOperand, ProfileRegion } from './decode/extrude';
import type { ParameterValue } from './decode/parameters';
import type { RevolveAxis } from './decode/revolve';
import {
  ellipseSweep,
  type SketchCircular,
  type SketchEllipse,
  type SketchLine,
  type SketchPoint,
  type SketchSpline,
  type Vec3,
} from './decode/sketch-geometry';
import type { SketchText } from './decode/text';
import { continues, type EdgeShape, edgeShape } from './edge-shape';
import {
  type CopyContext,
  type MadeCopies,
  mirror,
  pathPattern,
  rectangularPattern,
  splitBody,
  sweep,
  thread,
} from './map-more';
import type {
  F3dCircularPattern,
  F3dDesign,
  F3dEdgeFeature,
  F3dExtrude,
  F3dFace,
  F3dHole,
  F3dOffsetFaces,
  F3dRevolve,
  F3dSketch,
  F3dSketchFeature,
  Matrix,
} from './model';
import { insidePieces, nurbsAt, regionPieces, type SketchPieces, sketchPieces } from './regions';
import {
  addSketchConstraints,
  type ConstraintContext,
  type ConstraintTally,
  newTally,
  quantityOf,
} from './sketch-constraints';

type Vec2 = [number, number];

export interface ImportReport {
  /** Timeline features that became Extrudo features. */
  imported: string[];
  /**
   * Timeline features left out, with why: `reason` in a few plain words for people (at most
   * `MAX_REASON` characters, never a list of curve keys; the app shows it), `detail` the
   * technical text when it says more (bug reports, `corpus.test.ts`; R3-18).
   */
  skipped: SkippedFeature[];
  /** Smaller things that were approximated. */
  notes: string[];
  /** Sketch constraints and dimensions brought over (only with a solver, `ImportOptions.solver`). */
  constraints?: ConstraintTally;
  /** The file's visible bodies, checked against the file's own shapes (set by the body check). */
  bodies?: BodyOutcome[];
  /** Why the check could not run (kernel failed or took too long), when it didn't. */
  bodyCheck?: { error: string };
}

/** What happened to one of the file's visible bodies in the body check. */
export interface BodyOutcome {
  /** `Body3`. */
  name: string;
  /** The Extrudo component's name, for repeated names across components. */
  component?: string;
  outcome: 'editable' | 'frozen' | 'unchecked' | 'missing';
  /**
   * Plain words (at most `MAX_REASON`, like `SkippedFeature.reason`): "the timeline didn't
   * make it", "the timeline made it differently", "its shape uses surfaces Extrudo can't read
   * from the file yet".
   */
  reason?: string;
  /** Technical: dv and db, or the writer's reason (corpus/bug reports only). */
  detail?: string;
}

/**
 * One of the file's visible bodies, as a link to the Extrudo body it became: the writer's own
 * record and name, the Extrudo component the file has it in (`components.of`) and the replayed
 * Extrudo body its creator link points at (`bodyOf`). The hint is only used to find the
 * counterpart of a body that did not pair, never to declare a match.
 */
export interface BodyLink {
  /** The body record. */
  record: number;
  /** `Body<n>`, its number in the file. */
  name: string;
  component?: ComponentId;
  hint?: BodyId;
}

/** A timeline feature the import left out (R3-18). */
export interface SkippedFeature {
  name: string;
  kind: string;
  /** Why, in plain words for people: at most `MAX_REASON` characters. */
  reason: string;
  /** The technical reason, when it is longer than or differs from `reason`. */
  detail?: string;
}

/** The longest reason a person reads in the app's notice (R3-18). */
export const MAX_REASON = 120;

/**
 * Words a skipped feature's raw reason for people (R3-18): a profile region the import could
 * not match becomes "its profile couldn't be matched to Sketch3's curves" (the raw text lists
 * the file's curve keys), a short plain reason stays as it is, and anything longer or
 * technical (a thrown error, a list in braces) becomes a general sentence; the raw text is
 * kept as `detail` whenever it differs.
 */
export function skippedFeature(name: string, kind: string, raw: string): SkippedFeature {
  const reason = plainReason(raw);
  return reason === raw ? { name, kind, reason } : { name, kind, reason, detail: raw };
}

function plainReason(raw: string): string {
  const unmatched = /^profile region \{.*?\} not found in (.+?) \(it has \d+/s.exec(raw);
  if (unmatched) return `its profile couldn't be matched to ${unmatched[1]}'s curves`;
  if (raw.length <= MAX_REASON && !/[{}]/.test(raw)) return raw;
  return "it couldn't be rebuilt in Extrudo";
}

export interface ImportResult {
  design: Design;
  report: ImportReport;
  /** The file's preview PNG, when it has a usable one (only `importF3d` sets it). */
  preview?: Uint8Array;
  /**
   * One link per file body (record, name, component, hint). `f3dToDesign` always builds them;
   * `importF3d` returns them only with `{ bodies: true }`.
   */
  bodies?: BodyLink[];
  /** The B-rep writer's steps (record, name, component, step/reason); only with `{ bodies: true }`. */
  steps?: BodyStep[];
}

type ReadonlyVec3 = readonly [number, number, number];
const dot = (a: ReadonlyVec3, b: ReadonlyVec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const EPS = 1e-6;

export interface SketchEntry {
  handle: SketchHandle;
  placement: Placement;
  /** Extrudo curve ID → f3d curve tag. */
  tags: Map<string, bigint>;
  /** Extrudo curve ID → the f3d line, circle or arc it was drawn from. */
  curves: Map<string, SketchLine | SketchCircular>;
  /** f3d text record → Extrudo text entity ID. */
  texts: Map<number, string>;
  source: F3dSketch;
  /** The file's curve tags its features' profiles run along (never construction). */
  profileCurves: Set<string>;
  /** Its curves cut at their crossings, as the file names regions (made when first needed). */
  pieces?: SketchPieces;
}

/** An extrude that was imported: what naming its faces needs. */
interface ImportedExtrude {
  id: string;
  sketch: SketchEntry;
  /** The Extrudo curves around the regions it extruded. */
  curves: string[];
  oneSided: boolean;
  /** Which way its side 1 runs along the file's sketch normal: 1 or −1. */
  side1: number;
}

/**
 * An imported fillet or chamfer: the Extrudo name and the geometry of each
 * f3d edge it rounds, in the file's order. Extrudo names the face made from
 * an edge `<op>:<feature>:from:(<edge name>)`. The file's face token is often
 * the edge's place in that order, but not always (it counts other faces
 * too), so a face is matched to the edge nearest a point on it where one is
 * known.
 */
interface ImportedRound {
  op: 'fillet' | 'chamfer';
  id: string;
  edges: (string | undefined)[];
  shapes: (EdgeShape | undefined)[];
}

/** A revolve that was imported: what naming its faces needs. */
interface ImportedRevolve {
  id: string;
  sketch: SketchEntry;
  /** The Extrudo curves around the regions it turned. */
  curves: string[];
  /** The file's axis, model space (cm), unit direction. */
  axis: { point: Vec3; direction: Vec3 };
  /** Its turn in radians (2π: a full one, without caps). */
  angle: number;
}

/** What naming faces of earlier features needs, by f3d feature record. */
interface FaceNaming {
  extrudes: Map<number, ImportedExtrude>;
  revolves: Map<number, ImportedRevolve>;
  rounds: Map<number, ImportedRound>;
  /**
   * Imported mirrors and patterns, by f3d record: Extrudo names a copied
   * face `<op>:<feature>:<label>:from:(<name>)` (a mirror's has no label);
   * `label` turns the file's instance code into Extrudo's label.
   */
  copies: Map<number, MadeCopies>;
  holes: Map<number, ImportedHole>;
}

/** An imported hole: where its holes are and their sizes, for naming their faces. */
interface ImportedHole {
  id: string;
  /** Per hole, its centre on the face (model space, cm) and its sketch point's entity ID. */
  centres: { at: Vec3; point: string }[];
  /** The way it drills, model space, unit. */
  down: Vec3;
  /** cm. */
  diameter: number;
  depth?: number;
  cbDiameter?: number;
  cbDepth?: number;
  csDiameter?: number;
}

/** Where an f3d sketch lands in Extrudo: a plane and a 2D map into its frame. */
interface Placement {
  plane: GeomRef;
  /** f3d sketch (u, v) in cm → Extrudo plane (x, y) in mm. */
  map: (u: number, v: number) => Vec2;
  /** The 2D map mirrors (arcs change direction). */
  mirrored: boolean;
  /** The file's sketch normal points against the Extrudo plane's. */
  opposite: boolean;
}

/** The kind of a parameter's unit, as Extrudo stores it; undefined for one Extrudo has no kind for. */
function unitKind(unit: string): 'length' | 'angle' | 'unitless' | undefined {
  if (unit === '') return 'unitless';
  if (['mm', 'cm', 'm', 'in', 'ft'].includes(unit)) return 'length';
  if (unit === 'deg' || unit === 'rad') return 'angle';
  return undefined;
}

/** The file's units in an expression are Extrudo's too, except a few spellings. */
function numberExpression(value: number, unit: string): string {
  const v = Number(value.toPrecision(12));
  if (unit === 'deg') return `${Number(((value * 180) / Math.PI).toPrecision(12))} deg`;
  if (unit === '' || unit === 'Text') return `${v}`;
  // Lengths are stored in cm.
  return `${Number((value * 10).toPrecision(12))} mm`;
}

/** Extrudo's bundled fonts this import draws text in (`@extrudo/fonts`), by ID. */
const FONTS = {
  sans: { id: 'inter-regular@1', family: 'Inter' },
  bold: { id: 'inter-bold@1', family: 'Inter Bold' },
  serif: { id: 'noto-serif-regular@1', family: 'Noto Serif' },
  mono: { id: 'jetbrains-mono-regular@1', family: 'JetBrains Mono' },
  stencil: { id: 'allerta-stencil-regular@1', family: 'Allerta Stencil' },
};

/** Capital height over font size: Arial's, the usual font in .f3d files (and near most sans faces). */
const CAP_HEIGHT = 0.716;

/** The bundled font nearest an f3d font family: Inter unless it is a serif, mono or stencil face. */
function fontFor(family: string): { id: string; family: string } {
  const f = family.toLowerCase();
  if (/mono|courier|consol|menlo/.test(f)) return FONTS.mono;
  if (/stencil/.test(f)) return FONTS.stencil;
  if (/times|georgia|garamond|cambria|serif/.test(f) && !/sans/.test(f)) return FONTS.serif;
  if (/bold|black|heavy/.test(f)) return FONTS.bold;
  return FONTS.sans;
}

/** What the new design is stamped with (the app passes a fresh ID and its version). */
export interface ImportOptions {
  id?: string;
  appVersion?: string;
  /**
   * A sketch solver (planegcs), to bring the file's sketch constraints and
   * dimensions over: each is checked against it so imported geometry never
   * moves. Without one, sketches keep only the joins of shared points.
   */
  solver?: SketchSolver;
  /**
   * Also run the B-rep writer on the entry list the importer already has, and return it with
   * the body links: `importF3d` sets this; it keeps a 100 MB file from being unzipped and
   * decoded twice.
   */
  bodies?: boolean;
}

export function f3dToDesign(
  f3d: F3dDesign,
  name: string,
  options: ImportOptions = {},
): ImportResult {
  const report: ImportReport = { imported: [], skipped: [], notes: [] };
  const d = Design.create({
    name,
    units: 'mm',
    ...(options.id ? { id: options.id as never } : {}),
    ...(options.appVersion ? { appVersion: options.appVersion } : {}),
  });
  const userNames = new Set<string>();
  const components = new ComponentMapping(d, f3d, report);

  // User parameters, in the order they were made.
  for (const p of [...f3d.userParameters].sort((a, b) => a.number - b.number)) {
    const unit = p.text === undefined ? unitKind(p.unit) : undefined;
    try {
      d.parameter(p.name, p.text !== undefined ? `'${p.text}'` : p.expression, {
        ...(p.comment ? { comment: p.comment } : {}),
        ...(unit ? { unit } : {}),
      });
      userNames.add(p.name);
    } catch (error) {
      // An expression Extrudo does not read: keep the value.
      try {
        d.parameter(p.name, numberExpression(p.value, p.unit), {
          ...(p.comment ? { comment: p.comment } : {}),
          ...(unit ? { unit } : {}),
        });
        userNames.add(p.name);
        report.notes.push(
          `Parameter ${p.name}: "${p.expression}" kept as its value (${(error as Error).message}).`,
        );
      } catch (inner) {
        report.notes.push(`Parameter ${p.name} skipped: ${(inner as Error).message}`);
      }
    }
  }

  // The file's sketch constraints and dimensions, vetted by the solver.
  let constraints: ConstraintContext | undefined;
  if (options.solver) {
    // Expressions may name the user parameters Extrudo evaluates as the file did.
    const values = new Map<string, ReturnType<typeof quantityOf> & {}>();
    const evaluated = evaluateParameters(d.doc).parameters;
    for (const p of f3d.userParameters) {
      const q = quantityOf(p);
      const got = evaluated.get(p.name)?.result;
      if (q && got?.ok && Math.abs(got.value - q.value) <= 1e-9 * (1 + Math.abs(q.value)))
        values.set(p.name, q);
    }
    // Names the file gives its own parameters stay free for them; Extrudo's
    // own new names (a text's height, a dimension whose file name can't be
    // taken) count on from past the last of them.
    let next = 1;
    for (const p of f3d.parameters) {
      // A safe integer only: past 2^53, counting on from it would stand still.
      const n = /^d(\d{1,9})$/.exec(p.name);
      if (n) next = Math.max(next, Number(n[1]) + 1);
    }
    const taken = new Set(userNames);
    constraints = {
      solver: options.solver,
      values,
      taken,
      tally: newTally(),
      freeName: () => {
        while (taken.has(`d${next}`)) next++;
        const name = `d${next++}`;
        taken.add(name);
        return name;
      },
    };
    report.constraints = constraints.tally;
  }
  const known = (n: string) => userNames.has(n) || (constraints?.taken.has(n) ?? false);

  /**
   * An input's expression: the file's own when it only names user parameters
   * and imported sketch dimensions (so the design stays driven by them), its
   * value otherwise — a feature's own parameters (`d12`) have no Extrudo
   * counterpart yet.
   */
  const expressionOf = (p: ParameterValue, negate = false): string => {
    const names = p.expression.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    const units = new Set(['mm', 'cm', 'm', 'in', 'ft', 'deg', 'rad', 'um', 'mil']);
    const own = names.every((n) => units.has(n) || known(n));
    if (own && names.some((n) => known(n))) return negate ? `-(${p.expression})` : p.expression;
    return numberExpression(negate ? -p.value : p.value, p.unit);
  };

  const sketches = new Map<number, SketchEntry>();
  const extrudes = new Map<number, ImportedExtrude>();
  const naming: FaceNaming = {
    extrudes,
    revolves: new Map(),
    rounds: new Map(),
    copies: new Map(),
    holes: new Map(),
  };
  /** f3d feature record → the Extrudo feature a pattern can replay for it. */
  const replayable = new Map<number, { id: string; name: string }>();
  // Extrudo names a body after the feature that made it — and, of several, by
  // an order the file's need not share — so an f3d body is known here only as
  // the only body of an imported feature.
  const bodyRecords = new Map(f3d.bodies.map((b) => [b.id, b]));
  const madeBy = new Map<number, number>();
  for (const body of f3d.bodies)
    if (body.creator !== undefined) madeBy.set(body.creator, (madeBy.get(body.creator) ?? 0) + 1);
  const bodyOf = (record: number): { id: BodyId; index: number; by: string } | undefined => {
    const body = bodyRecords.get(components.aliases.get(record) ?? record);
    if (body?.creator === undefined || madeBy.get(body.creator) !== 1) return undefined;
    const made = replayable.get(body.creator);
    return made ? { id: `${made.id}:0` as BodyId, index: body.index, by: made.name } : undefined;
  };
  /** A feature's participant bodies as Extrudo references, when every one is known. */
  const participants = (records: number[]): GeomRef[] | undefined => {
    const ids = records.map((r) => bodyOf(r)?.id);
    if (ids.length === 0 || ids.some((id) => id === undefined)) return undefined;
    return ids.map((id) => ({ kind: 'body', id: id as string }));
  };
  // Curves the file's own profiles run along are never construction geometry,
  // whatever the flag reading says.
  const profileCurves = new Map<number, Set<string>>();
  for (const f of f3d.features) {
    if (f.type !== 'extrude' && f.type !== 'sweep') continue;
    for (const operand of f.profiles) {
      const set = profileCurves.get(operand.sketch) ?? new Set<string>();
      for (const r of operand.regions ?? [])
        for (const t of [...r.outer, ...r.inner].flat()) set.add(String(t));
      profileCurves.set(operand.sketch, set);
    }
  }

  /**
   * A copy of a sketch on a plane `cm` along its normal: where an extrude
   * with a start offset begins (Extrudo's extrude starts on its sketch).
   */
  const moved = new Map<string, SketchEntry | undefined>();
  const movedSketch = (entry: SketchEntry, cm: number, name: string): SketchEntry | undefined => {
    const key = `${entry.source.id}@${cm}`;
    if (moved.has(key)) return moved.get(key);
    const m = [...entry.source.frame];
    m[3] = (m[3] as number) + cm * (m[2] as number);
    m[7] = (m[7] as number) + cm * (m[6] as number);
    m[11] = (m[11] as number) + cm * (m[10] as number);
    const placement = placeSketch(d, m, report, name, entry.source.texts.length > 0);
    let made: SketchEntry | undefined;
    if (placement) {
      const source = { ...entry.source, frame: m };
      const copy: F3dSketchFeature = {
        type: 'sketch',
        id: -1,
        kind: 'Sketch',
        name,
        suppressed: false,
        parameters: [],
        sketch: source,
      };
      const tags = new Map<string, bigint>();
      const curves = new Map<string, SketchLine | SketchCircular>();
      const texts = new Map<number, string>();
      const used = profileCurves.get(source.id) ?? new Set<string>();
      const handle = d.sketch(
        placement.plane,
        (k) => drawSketch(k, copy, placement, { tags, curves, texts }, used, report),
        { name },
      );
      made = { handle, placement, tags, curves, texts, source, profileCurves: used };
    }
    moved.set(key, made);
    return made;
  };

  for (const feature of f3d.features) {
    components.enter(feature);
    if (feature.suppressed) {
      report.skipped.push({
        name: feature.name,
        kind: feature.kind,
        reason: 'suppressed in the file',
      });
      continue;
    }
    try {
      if (feature.type === 'sketch') {
        const placement = placeSketch(
          d,
          feature.sketch.frame,
          report,
          feature.name,
          feature.sketch.texts.length > 0,
        );
        if (!placement) {
          report.skipped.push({
            name: feature.name,
            kind: 'Sketch',
            reason: 'its plane is not along an origin axis',
          });
          continue;
        }
        const tags = new Map<string, bigint>();
        const curves = new Map<string, SketchLine | SketchCircular>();
        const texts = new Map<number, string>();
        const used = profileCurves.get(feature.sketch.id) ?? new Set<string>();
        const handle = d.sketch(
          placement.plane,
          (k) =>
            drawSketch(k, feature, placement, { tags, curves, texts }, used, report, constraints),
          {
            name: feature.name,
          },
        );
        sketches.set(feature.sketch.id, {
          handle,
          placement,
          tags,
          curves,
          texts,
          source: feature.sketch,
          profileCurves: used,
        });
        report.imported.push(feature.name);
      } else if (
        feature.type === 'extrude' &&
        feature.profiles.length === 0 &&
        feature.faces.length > 0 &&
        feature.start !== 'face' &&
        !feature.parameters.some((p) => p.kind === 'Side1Offset')
      ) {
        // Faces as the profile (press-pull).
        const made = faceExtrude(d, feature, naming, expressionOf, participants, report);
        if (typeof made === 'string')
          report.skipped.push(skippedFeature(feature.name, 'Extrude', made));
        else {
          replayable.set(feature.id, { id: made.id, name: feature.name });
          report.imported.push(feature.name);
        }
      } else if (feature.type === 'extrude') {
        const made = extrude(
          d,
          feature,
          sketches,
          naming,
          expressionOf,
          movedSketch,
          participants,
          report,
        );
        if (typeof made === 'string')
          report.skipped.push(skippedFeature(feature.name, 'Extrude', made));
        else {
          extrudes.set(feature.id, made);
          replayable.set(feature.id, { id: made.id, name: feature.name });
          report.imported.push(feature.name);
        }
      } else if (feature.type === 'hole') {
        const made = hole(d, feature, expressionOf, report);
        if (typeof made === 'string')
          report.skipped.push(skippedFeature(feature.name, 'Hole', made));
        else {
          replayable.set(feature.id, { id: made.id, name: feature.name });
          naming.holes.set(feature.id, made);
          report.imported.push(feature.name);
        }
      } else if (feature.type === 'revolve') {
        const made = revolve(d, feature, sketches, expressionOf, participants, report);
        if (typeof made === 'string')
          report.skipped.push(skippedFeature(feature.name, 'Revolve', made));
        else {
          naming.revolves.set(feature.id, made);
          replayable.set(feature.id, { id: made.id, name: feature.name });
          report.imported.push(feature.name);
        }
      } else if (feature.type === 'offset-faces') {
        const reason = offsetFaces(d, feature, naming, expressionOf, report);
        if (reason) report.skipped.push(skippedFeature(feature.name, feature.kind, reason));
        else report.imported.push(feature.name);
      } else if (feature.type === 'circular-pattern') {
        const made = circularPattern(d, feature, replayable, sketches, expressionOf, report);
        if (typeof made === 'string')
          report.skipped.push(skippedFeature(feature.name, feature.kind, made));
        else {
          // The file numbers instances from 1, the original; Extrudo from 0.
          const label = (code: number) => (code >= 2 ? String(code - 1) : undefined);
          naming.copies.set(feature.id, { op: 'pattern', id: made.id, label });
          report.imported.push(feature.name);
        }
      } else if (feature.type === 'thread') {
        const { major, minor, external } = feature.spec;
        const crest = { radius: (external ? major : minor) / 2, slack: major - minor };
        const reason = thread(
          d,
          feature,
          (face) => {
            const id = faceName(face, naming, undefined, crest);
            return id ? { id, radius: sideRadius(id, naming) } : undefined;
          },
          expressionOf,
          report,
        );
        if (reason) report.skipped.push(skippedFeature(feature.name, feature.kind, reason));
        else report.imported.push(feature.name);
      } else if (feature.type === 'sweep') {
        const made = sweep(d, feature, sketches, expressionOf, participants, report);
        if (typeof made === 'string')
          report.skipped.push(skippedFeature(feature.name, feature.kind, made));
        else {
          replayable.set(feature.id, { id: made.id, name: feature.name });
          report.imported.push(feature.name);
        }
      } else if (
        feature.type === 'mirror' ||
        feature.type === 'rectangular-pattern' ||
        feature.type === 'path-pattern' ||
        feature.type === 'split'
      ) {
        const context: CopyContext = {
          made: replayable,
          sketches,
          expressionOf,
          bodies: participants,
          report,
        };
        if (feature.type === 'split') {
          const reason = splitBody(d, feature, context);
          if (reason) report.skipped.push(skippedFeature(feature.name, feature.kind, reason));
          else report.imported.push(feature.name);
        } else {
          const made =
            feature.type === 'mirror'
              ? mirror(d, feature, context)
              : feature.type === 'path-pattern'
                ? pathPattern(d, feature, context)
                : rectangularPattern(d, feature, context);
          if (typeof made === 'string')
            report.skipped.push(skippedFeature(feature.name, feature.kind, made));
          else {
            naming.copies.set(feature.id, made);
            report.imported.push(feature.name);
          }
        }
      } else if (feature.type === 'fillet' || feature.type === 'chamfer') {
        const made = edgeTreatment(d, feature, naming, expressionOf, report);
        if (typeof made === 'string')
          report.skipped.push(skippedFeature(feature.name, feature.kind, made));
        else {
          naming.rounds.set(feature.id, made);
          report.imported.push(feature.name);
        }
      } else if (feature.kind === 'Component' || feature.kind === 'CreateComponent') {
        // An Extrudo component already stands for it; its features follow on this timeline.
        report.imported.push(feature.name);
      } else if (components.isBodyMove(feature)) {
        const reason = components.bodyMove(feature, bodyOf);
        if (reason) report.skipped.push(skippedFeature(feature.name, feature.kind, reason));
        else report.imported.push(feature.name);
      } else {
        report.skipped.push({
          name: feature.name,
          kind: feature.kind,
          reason: 'not supported yet',
        });
      }
    } catch (error) {
      report.skipped.push(skippedFeature(feature.name, feature.kind, (error as Error).message));
    }
  }
  components.enter(undefined);
  // Bodies hidden in the file stay hidden (a STEP export of the same design leaves them out too)
  // — unless a body that can be seen (shown, in a shown component) came from a
  // feature not imported (its shape may be the hidden one's moved on; a Body to
  // Component's copy is already the body it took, see ComponentMapping), or a
  // later join here takes every body it meets (the file's named bodies it joins
  // were not known), which may have merged a shown one in.
  const shownElsewhere = f3d.bodies.some(
    (b) =>
      components.seen(b) &&
      !components.aliases.has(b.id) &&
      (b.creator === undefined || !replayable.has(b.creator)),
  );
  const order = new Map(d.toJSON().features.map((f, i) => [f.id as string, i]));
  let lastOpenJoin = -1;
  d.toJSON().features.forEach((f, i) => {
    const inputs = f.inputs as Record<string, { value?: unknown; refs?: unknown[] } | undefined>;
    const join =
      (f.type === 'extrude' || f.type === 'revolve') && inputs.operation?.value === 'join';
    if (join && !inputs.bodies?.refs?.length) lastOpenJoin = i;
  });
  for (const body of shownElsewhere ? [] : f3d.bodies) {
    const known = components.shown(body) ? undefined : bodyOf(body.id);
    if (!known || (order.get(known.id.split(':')[0] as string) ?? 0) < lastOpenJoin) continue;
    d.state.dispatch(
      updateBody({ id: known.id, changes: { name: `Body${known.index}`, visible: false } }),
    );
    report.notes.push(`Body${known.index} (made by ${known.by}) is hidden, as in the file.`);
  }
  components.finish(bodyOf);
  // One link per **visible** file body, aligned with the B-rep writer's steps (`bodiesStep`):
  // the Extrudo component the file has it in, and the replayed body its creator link points at.
  // The index alone is not unique across components, so the record is carried too.
  const bodies: BodyLink[] = [];
  for (const body of f3d.bodies) {
    if (!body.visible) continue;
    const component = components.of(body.component)?.id;
    const hint = bodyOf(body.id)?.id;
    bodies.push({
      record: body.id,
      name: `Body${body.index}`,
      ...(component !== undefined ? { component } : {}),
      ...(hint !== undefined ? { hint } : {}),
    });
  }
  return { design: d, report, bodies };
}

/** The Extrudo frame of a sketch plane: its origin, axes and normal (mm). */
interface PlaneFrame {
  origin: ReadonlyVec3;
  x: ReadonlyVec3;
  y: ReadonlyVec3;
  normal: ReadonlyVec3;
}

/** Planes made for sketches so far, per design: two sketches on one plane share it. */
const madePlanes = new WeakMap<Design, Map<string, GeomRef>>();
const planeKey = (...values: number[]) => values.map((v) => Number(v.toPrecision(9))).join(',');

/**
 * Picks the Extrudo plane for an f3d sketch frame: an origin plane, or one
 * moved along its normal, for a sketch parallel to one; for a sketch plane
 * along an origin axis, a plane turned about that axis from an origin plane
 * (and moved along its normal). A construction plane's frame follows its
 * normal alone (`faceSketchFrame`), which here is the file's sketch normal.
 */
export function placeSketch(
  d: Design,
  m: Matrix,
  report: ImportReport,
  name: string,
  /** Never mirror the sketch (text reads backwards in a mirror): face the file's normal instead. */
  unmirrored = false,
): Placement | undefined {
  const X: Vec3 = [m[0] as number, m[4] as number, m[8] as number];
  const Y: Vec3 = [m[1] as number, m[5] as number, m[9] as number];
  const N: Vec3 = [m[2] as number, m[6] as number, m[10] as number];
  const O: Vec3 = [(m[3] as number) * 10, (m[7] as number) * 10, (m[11] as number) * 10];
  const made = madePlanes.get(d) ?? new Map<string, GeomRef>();
  madePlanes.set(d, made);
  const placed = (plane: GeomRef, f: PlaneFrame): Placement => {
    const map = (u: number, v: number): Vec2 => {
      const w: Vec3 = [
        O[0] + 10 * (u * X[0] + v * Y[0]) - f.origin[0],
        O[1] + 10 * (u * X[1] + v * Y[1]) - f.origin[1],
        O[2] + 10 * (u * X[2] + v * Y[2]) - f.origin[2],
      ];
      return [dot(w, f.x), dot(w, f.y)];
    };
    // The 2D map's determinant: (X·x)(Y·y) − (Y·x)(X·y).
    const det = dot(X, f.x) * dot(Y, f.y) - dot(Y, f.x) * dot(X, f.y);
    return { plane, map, mirrored: det < 0, opposite: dot(N, f.normal) < 0 };
  };
  /** The plane `base` (normal `n`) moved along `n` to the sketch's origin. */
  const moved = (base: GeomRef, n: Vec3, from: string): GeomRef => {
    const offset = dot(O, n);
    if (Math.abs(offset) <= 1e-7) return base;
    const key = `${base.id}@${planeKey(offset)}`;
    let plane = made.get(key);
    if (!plane) {
      const p = d.offsetPlane(
        { plane: base, distance: `${Number(offset.toPrecision(12))} mm` },
        { name: `${name} plane` },
      );
      plane = { kind: 'plane', id: p.id };
      made.set(key, plane);
    }
    report.notes.push(`${name}: drawn on a plane ${Number(offset.toFixed(4))} mm from ${from}.`);
    return plane;
  };
  for (const p of ORIGIN_PLANES) {
    const n = p.frame.normal as Vec3;
    if (Math.abs(Math.abs(dot(N, n)) - 1) > EPS) continue;
    const frame = { origin: scale(n, dot(O, n)), x: p.frame.x, y: p.frame.y, normal: n };
    if (unmirrored && placed({ kind: 'plane', id: p.id }, frame).mirrored) break;
    return placed(moved({ kind: 'plane', id: p.id }, n, p.label), frame);
  }
  for (const [axis, a] of ORIGIN_AXES) {
    if (Math.abs(dot(N, a)) > EPS) continue;
    // Turned right-handed about the axis from an origin plane through it:
    // that plane's normal goes to N.
    const base = ORIGIN_PLANES.find((p) => Math.abs(dot(p.frame.normal as Vec3, a)) < EPS);
    if (!base) continue;
    const zero = base.frame.normal as Vec3;
    const angle = (Math.atan2(dot(N, cross(a, zero)), dot(N, zero)) * 180) / Math.PI;
    const key = `${axis}:${planeKey(angle)}`;
    let turned = made.get(key);
    if (!turned) {
      const p = d.planeAtAngle(
        {
          axis: { kind: 'axis', id: axis },
          plane: { kind: 'plane', id: base.id },
          angle: `${Number(angle.toPrecision(12))} deg`,
        },
        { name: `${name} plane` },
      );
      turned = { kind: 'plane', id: p.id };
      made.set(key, turned);
    }
    const plane = moved(turned, N, `a plane at ${Number(angle.toFixed(4))}° to ${base.label}`);
    return placed(plane, faceSketchFrame(scale(N, dot(O, N)), N));
  }
  return undefined;
}

/**
 * Draws an f3d sketch's curves, texts and points, noting the f3d tag of
 * every curve and the record of every text it makes.
 */
function drawSketch(
  k: SketchBuilder,
  feature: F3dSketchFeature,
  placement: Placement,
  made: {
    tags: Map<string, bigint>;
    curves: Map<string, SketchLine | SketchCircular>;
    texts: Map<number, string>;
  },
  profileCurves: Set<string>,
  report: ImportReport,
  constraints?: ConstraintContext,
): void {
  const { tags, curves } = made;
  const s: F3dSketch = feature.sketch;
  const points = new Map<number, SketchPoint>(s.points.map((p) => [p.id, p]));
  const at = (id: number, fallback: Vec3): Vec2 => {
    const p = points.get(id)?.at ?? fallback;
    return placement.map(p[0], p[1]);
  };
  /** A point of an ellipse at parameter angle `t`, `scale` times as far from its centre. */
  const mapped = (e: SketchEllipse, t: number, scale = 1): Vec2 => {
    const [c, s2] = [Math.cos(t) * scale, Math.sin(t) * scale];
    return placement.map(
      e.center[0] + e.major[0] * e.majorRadius * c + e.minor[0] * e.minorRadius * s2,
      e.center[1] + e.major[1] * e.majorRadius * c + e.minor[1] * e.minorRadius * s2,
    );
  };
  /** Extrudo point handles per f3d point: joined by coincident constraints. */
  const joined = new Map<number, ReturnType<SketchBuilder['point']>[]>();
  const join = (sourcePoint: number, handle: ReturnType<SketchBuilder['point']>) => {
    const list = joined.get(sourcePoint) ?? [];
    list.push(handle);
    joined.set(sourcePoint, list);
  };
  const used = new Set<number>();
  const setConstruction = (id: string) => {
    const tag = tags.get(id);
    if (tag !== undefined && profileCurves.has(String(tag))) return;
    const e = k.data.entities[id as keyof typeof k.data.entities] as
      | { construction?: boolean }
      | undefined;
    if (e && 'construction' in e) e.construction = true;
  };

  for (const l of s.lines) {
    const a = at(l.startPoint, l.start);
    const b = at(l.endPoint, l.end);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) continue;
    const h = k.line(a, b);
    join(l.startPoint, h.start);
    join(l.endPoint, h.end);
    used.add(l.startPoint).add(l.endPoint);
    if (l.tag !== undefined) tags.set(h.id, l.tag);
    curves.set(h.id, l);
    if (l.construction) setConstruction(h.id);
  }
  for (const c of s.circulars) {
    const center = at(c.centerPoint, c.center);
    const r = c.radius * 10;
    used.add(c.centerPoint);
    if (
      c.startPoint === undefined ||
      c.endPoint === undefined ||
      Math.abs(c.endAngle - c.startAngle) >= 2 * Math.PI - 1e-9
    ) {
      const h = k.circle(center, r);
      join(c.centerPoint, h.center);
      if (c.tag !== undefined) tags.set(h.id, c.tag);
      curves.set(h.id, c);
      if (c.construction) setConstruction(h.id);
      continue;
    }
    const start = arcEnd(c, c.startAngle, placement);
    const end = arcEnd(c, c.endAngle, placement);
    // Counter-clockwise about the arc's own normal in the file; the 2D map may
    // mirror it. Extrudo's arc always runs counter-clockwise from its stored
    // start (`reversed` only says it was drawn the other way, and keeps
    // `h.start` at the file's start), so a clockwise one is stored end first.
    const ccw = c.normal[2] >= 0 !== placement.mirrored;
    const h = ccw
      ? k.arcCentered(center, start, end)
      : k.arcCentered(center, end, start, { reversed: true });
    join(c.centerPoint, h.center);
    join(c.startPoint, h.start);
    join(c.endPoint, h.end);
    used.add(c.startPoint).add(c.endPoint);
    if (c.tag !== undefined) tags.set(h.id, c.tag);
    curves.set(h.id, c);
    if (c.construction) setConstruction(h.id);
  }
  for (const c of s.splines) {
    if (c.rho !== undefined) {
      const [p0, p1, p2] = c.poles as [Vec3, Vec3, Vec3];
      const start = at(c.startPoint ?? -1, p0);
      const end = at(c.endPoint ?? -1, p2);
      const h = k.conic(start, at(c.shoulderPoint ?? -1, p1), end, c.rho);
      const [hs, hm, he] = h.points;
      for (const [source, handle] of [
        [c.startPoint, hs],
        [c.shoulderPoint, hm],
        [c.endPoint, he],
      ] as const)
        if (source !== undefined && handle) {
          join(source, handle);
          used.add(source);
        }
      if (c.tag !== undefined) tags.set(h.id, c.tag);
      continue;
    }
    const shape = splineShape(c, placement);
    const first = shape.points[0] as Vec2;
    const last = shape.points.at(-1) as Vec2;
    // The ends sit on the file's own points, so neighbouring curves meet exactly.
    if (c.startPoint !== undefined) shape.points[0] = at(c.startPoint, c.poles[0] as Vec3);
    if (c.endPoint !== undefined && !shape.closed)
      shape.points[shape.points.length - 1] = at(c.endPoint, c.poles.at(-1) as Vec3);
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-9 && !shape.closed) continue;
    const h =
      shape.mode === 'control'
        ? k.splineControl(shape.points, shape.knots ? { knots: shape.knots } : {})
        : k.spline(shape.points, shape.closed ? { closed: true } : {});
    const ends = [h.points[0], shape.closed ? h.points[0] : h.points.at(-1)];
    if (c.startPoint !== undefined && ends[0]) {
      join(c.startPoint, ends[0]);
      used.add(c.startPoint);
    }
    if (c.endPoint !== undefined && ends[1] && !shape.closed) {
      join(c.endPoint, ends[1]);
      used.add(c.endPoint);
    }
    if (c.tag !== undefined) tags.set(h.id, c.tag);
    if (c.construction) setConstruction(h.id);
  }
  // Elliptical arcs: Extrudo's ellipse is whole, so an arc is drawn as exact
  // conics (rational quadratics), one per quarter turn at most, joined end to end.
  for (const e of s.ellipses ?? []) {
    const t0 = e.startAngle;
    const sweep = ellipseSweep(e);
    const n = Math.max(1, Math.ceil(sweep / (Math.PI / 2) - 1e-9));
    const step = sweep / n;
    let previous: ReturnType<SketchBuilder['point']> | undefined;
    for (let i = 0; i < n; i++) {
      const [a, b] = [t0 + i * step, t0 + (i + 1) * step];
      const p0 = i === 0 && e.startPoint !== undefined ? at(e.startPoint, e.center) : mapped(e, a);
      const p2 = i === n - 1 && e.endPoint !== undefined ? at(e.endPoint, e.center) : mapped(e, b);
      // The tangents at the two ends meet at the shoulder: the circle's corner
      // point, scaled by 1 / cos(step / 2), carried by the ellipse's axes.
      const shoulder = mapped(e, (a + b) / 2, 1 / Math.cos(step / 2));
      const w = Math.cos(step / 2);
      const h = k.conic(p0, shoulder, p2, w / (1 + w));
      const [hs, , he] = h.points;
      if (i === 0 && e.startPoint !== undefined && hs) {
        join(e.startPoint, hs);
        used.add(e.startPoint);
      }
      if (i === n - 1 && e.endPoint !== undefined && he) {
        join(e.endPoint, he);
        used.add(e.endPoint);
      }
      if (previous && hs) k.coincident(previous, hs);
      previous = he;
      if (e.tag !== undefined) tags.set(h.id, e.tag);
    }
  }
  for (const t of s.texts) {
    const base = [Math.cos(t.angle), Math.sin(t.angle)] as const;
    const up = [-base[1], base[0]] as const;
    if (t.old) {
      const at = oldTextAnchor(t);
      const font = fontFor(t.font);
      const flip = t.old.mirrored ? -1 : 1;
      const h = k.text(
        placement.map(at.u, at.v),
        placement.map(at.u + flip * up[0] * t.height, at.v + flip * up[1] * t.height),
        { text: t.text, font: font.id, align: at.align },
        { upright: false, ...(constraints ? { height: false } : {}) },
      );
      if (constraints) textHeight(k, h, constraints.freeName());
      made.texts.set(t.id, h.id);
      report.notes.push(
        `${feature.name}: text "${t.text}" in ${t.font} is drawn in ${font.family}${at.guessed ? ', placed by its box corner (its alignment is not read)' : ''}${t.old.mirrored ? ', turned instead of mirrored' : ''}.`,
      );
      continue;
    }
    // The file's height is the font size and its box's bottom edge the
    // baseline; Extrudo's height is the capitals'. Centred in the box: the
    // font is Extrudo's own, so the width differs, and centring keeps the
    // text where it was.
    const u = t.at[0] + (base[0] * t.width) / 2;
    const v = t.at[1] + (base[1] * t.width) / 2;
    const cap = t.height * CAP_HEIGHT;
    const font = fontFor(t.font);
    const h = k.text(
      placement.map(u, v),
      placement.map(u + up[0] * cap, v + up[1] * cap),
      { text: t.text, font: font.id, align: 'center' },
      { upright: false, ...(constraints ? { height: false } : {}) },
    );
    if (constraints) textHeight(k, h, constraints.freeName());
    made.texts.set(t.id, h.id);
    report.notes.push(`${feature.name}: text "${t.text}" in ${t.font} is drawn in ${font.family}.`);
  }
  // Points on their own (hole centres, reference points), except the
  // projected origin every sketch has.
  let origin: SketchPoint | undefined;
  for (const p of s.points) {
    const xy = placement.map(p.at[0], p.at[1]);
    const isOrigin = Math.hypot(xy[0], xy[1]) < 1e-9 && p.tag === 100n;
    if (isOrigin) origin = p;
    if (used.has(p.id)) continue;
    if (isOrigin) continue;
    join(p.id, k.point(xy));
  }
  // An f3d point shared by several curves is one point; Extrudo gives each
  // curve its own, held together.
  let skipped = 0;
  for (const list of joined.values()) {
    const first = list[0];
    if (!first) continue;
    for (const other of list.slice(1)) {
      try {
        k.coincident(first, other);
      } catch {
        skipped++;
      }
    }
  }
  if (skipped) report.notes.push(`${feature.name}: ${skipped} coincident constraints left out.`);
  if (!constraints) return;
  // The projected origin is fixed in the file: a point there (made when only
  // a constraint or dimension names it) is fixed here.
  if (origin && ((s.relations ?? []).length > 0 || (s.dimensions ?? []).length > 0)) {
    const at = origin;
    const mentioned = [...(s.relations ?? []), ...(s.dimensions ?? [])].some((c) =>
      c.loci.some((l) => l.id === at.id),
    );
    if (!joined.has(at.id) && mentioned) join(at.id, k.point(placement.map(at.at[0], at.at[1])));
    const first = joined.get(at.id)?.[0];
    if (first) k.fix(first);
  }
  const ids = new Map<number, string>();
  for (const [id, curve] of curves) ids.set(curve.id, id);
  const note = addSketchConstraints(
    k,
    s,
    {
      points: new Map([...joined].map(([p, handles]) => [p, handles.map((h) => h.id)])),
      curves: ids,
      map: placement.map,
    },
    constraints,
    feature.name,
  );
  if (note) report.notes.push(note);
}

/** A text's height dimension, named so it takes none of the file's own parameter names. */
function textHeight(k: SketchBuilder, h: ReturnType<SketchBuilder['text']>, name: string): void {
  const at = (id: string) => {
    const p = k.data.entities[id as keyof typeof k.data.entities] as { x: number; y: number };
    return [p.x, p.y] as const;
  };
  const [a, b] = [at(h.anchor.id), at(h.top.id)];
  k.dimension(
    [h.anchor, h.top],
    `${Number(Math.hypot(b[0] - a[0], b[1] - a[1]).toPrecision(12))} mm`,
    {
      name,
    },
  );
}

/** The file's line advance for Arial, in capital heights (1.15 em over a 0.716 em capital). */
const OLD_TEXT_LINE = 1.15 / CAP_HEIGHT;

/**
 * Where an older text's first baseline starts (sketch frame, cm) and how it
 * aligns there, from its box and alignment codes: horizontally 1 left, 3
 * centre; vertically 1 the capitals' top at the box's top, 3 the lines'
 * middle at the box's (both checked on the B-rep). Others, or no box: the
 * box's corner.
 */
function oldTextAnchor(t: SketchText): {
  u: number;
  v: number;
  align: 'left' | 'center';
  guessed: boolean;
} {
  const old = t.old as NonNullable<SketchText['old']>;
  const [w, h] = old.box ?? [0, 0];
  const lines = t.text.split('\n').length;
  const block = t.height * (1 + (lines - 1) * OLD_TEXT_LINE);
  const known =
    old.box !== undefined && [1, 3].includes(old.horizontal) && [1, 3].includes(old.vertical);
  const x = known && old.horizontal === 3 ? w / 2 : 0;
  const y = !known ? 0 : old.vertical === 1 ? h - t.height : (h + block) / 2 - t.height;
  const flip = old.mirrored ? -1 : 1;
  const base = [Math.cos(t.angle), Math.sin(t.angle)] as const;
  const up = [-base[1] * flip, base[0] * flip] as const;
  return {
    u: t.at[0] + base[0] * x + up[0] * y,
    v: t.at[1] + base[1] * x + up[1] * y,
    align: known && old.horizontal === 3 ? 'center' : 'left',
    guessed: !known,
  };
}

/** An arc's end point in the Extrudo plane, from its angle about its own axes. */
function arcEnd(c: SketchCircular, angle: number, placement: Placement): Vec2 {
  const n = c.normal;
  const x = c.xAxis;
  // y = n × x
  const y: Vec3 = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
  const u = c.center[0] + c.radius * (Math.cos(angle) * x[0] + Math.sin(angle) * y[0]);
  const v = c.center[1] + c.radius * (Math.cos(angle) * x[1] + Math.sin(angle) * y[1]);
  return placement.map(u, v);
}

interface SplineShape {
  mode: 'control' | 'fit';
  points: Vec2[];
  /** A control spline's own clamped knots, 0 to 1 (absent: a single Bézier span). */
  knots?: number[];
  /** A fit spline that runs back round to its first point. */
  closed?: boolean;
}

/**
 * An f3d spline as Extrudo draws it. Extrudo's control splines are clamped,
 * non-rational cubics: such an f3d spline keeps its poles and knots (scaled
 * to 0..1); a single quadratic span is raised to the same curve as a cubic;
 * anything else (rational, other degrees, unclamped) becomes a fit spline
 * through points along it.
 */
function splineShape(c: SketchSpline, placement: Placement): SplineShape {
  const p = c.degree;
  const poles = c.poles.map((q) => placement.map(q[0], q[1]));
  const k = c.knots;
  const rational = c.weights.some((w) => Math.abs(w - (c.weights[0] as number)) > 1e-12);
  const clamped =
    k.slice(0, p + 1).every((x) => x === k[0]) && k.slice(-p - 1).every((x) => x === k.at(-1));
  if (!rational && clamped && p === 3) {
    const a = k[0] as number;
    const span = (k.at(-1) as number) - a;
    const knots = k.map((x) => Math.min(1, Math.max(0, (x - a) / span)));
    return poles.length === 4
      ? { mode: 'control', points: poles }
      : { mode: 'control', points: poles, knots };
  }
  if (!rational && clamped && p === 2 && poles.length === 3) {
    const [a, b, d] = poles as [Vec2, Vec2, Vec2];
    const third = (x: Vec2, y: Vec2): Vec2 => [
      x[0] + (2 / 3) * (y[0] - x[0]),
      x[1] + (2 / 3) * (y[1] - x[1]),
    ];
    return { mode: 'control', points: [a, third(a, b), third(d, b), d] };
  }
  const t0 = k[p] as number;
  const t1 = k[poles.length] as number;
  const n = Math.max(8, 4 * (poles.length - p));
  const points: Vec2[] = [];
  for (let i = 0; i <= n; i++) points.push(nurbsAt(c, poles, t0 + ((t1 - t0) * i) / n));
  const first = points[0] as Vec2;
  const last = points.at(-1) as Vec2;
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-7) {
    points.pop();
    return { mode: 'fit', points, closed: true };
  }
  return { mode: 'fit', points };
}

const keyOf = (tags: bigint[]) => [...new Set(tags.map(String))].sort().join(',');

/** Adds an extrude; returns why not when it cannot. */
function extrude(
  d: Design,
  f: F3dExtrude,
  sketches: Map<number, SketchEntry>,
  naming: FaceNaming,
  expressionOf: (p: ParameterValue, negate?: boolean) => string,
  movedSketch: (entry: SketchEntry, cm: number, name: string) => SketchEntry | undefined,
  participants: (records: number[]) => GeomRef[] | undefined,
  report: ImportReport,
): string | ImportedExtrude {
  if (!f.solid) return 'surface extrudes are not supported';
  if (f.profiles.length === 0) return 'its profile is a face, not a sketch profile';
  const param = (kind: string) => f.parameters.find((p) => p.kind === kind);
  // Extrudo's extrude starts on its sketch: a start offset, or a start face
  // parallel to the sketch, takes the profiles from a copy of their sketch
  // that far along its normal (cm).
  const offset = param('ProfileOffset');
  const startFace = f.start === 'face' ? f.faces[0] : undefined;
  const toFace = param('Side1Offset') ? f.faces[startFace ? 1 : 0] : undefined;
  let faceNote = false;
  const shiftFor = (own: SketchEntry): number => {
    let cm = offset ? offset.value : 0;
    if (startFace) {
      const at = planeOffset(startFace, own.source.frame);
      if (at === undefined) faceNote = true;
      else cm += at;
    }
    return Math.abs(cm) > 1e-9 ? cm : 0;
  };
  const selected = selectProfiles(
    f.profiles,
    (operand) => {
      const own = sketches.get(operand.sketch);
      if (!own) return 'its sketch was not imported';
      const shift = shiftFor(own);
      const sketch = shift ? movedSketch(own, shift, `${f.name} start`) : own;
      return sketch ?? 'its offset start plane is not along an origin axis';
    },
    (text) => report.notes.push(`${f.name}: ${text}`),
  );
  if (typeof selected === 'string') return selected;
  const { profiles, entry } = selected;
  const placement = entry.placement;
  if (faceNote)
    report.notes.push(`${f.name}: starts from a face; imported from the profile plane.`);

  const along = param('AlongDistance');
  const against = param('AgainstDistance');
  const symmetric = param('SymmetricDistance') ?? param('Distance');
  const taper = param('TaperAngle');
  const taper2 = param('Side2TaperAngle');

  // Side 1 runs along the file's sketch normal, reversed by the flag or a
  // negative distance; Extrudo's runs along its plane's normal unless flipped.
  const negative = (along?.value ?? 0) < 0;
  const flip = placement.opposite !== (f.reversed !== negative);
  const inputs: Record<string, unknown> = { profiles, operation: f.operation };
  if (f.direction === 'one-side' && toFace) {
    // Up to a face: a plane parallel to the start becomes the distance to it
    // (past it by the offset); another face is named if it can be.
    const past = param('Side1Offset')?.value ?? 0;
    const to = planeOffset(toFace, entry.source.frame);
    if (to !== undefined) {
      const total = to + Math.sign(to) * past;
      if (Math.abs(total) < 1e-9) return 'it goes up to a face in its own plane';
      inputs.distance = numberExpression(Math.abs(total), 'cm');
      if (placement.opposite !== total < 0) inputs.flip = true;
      report.notes.push(`${f.name}: up to a face, imported as a distance.`);
    } else {
      const name = faceName(toFace, naming);
      if (!name) return 'it goes up to a face that could not be found';
      inputs.extent = 'to-object';
      inputs.toObject = { kind: 'face', id: name };
      if (Math.abs(past) > 1e-12) inputs.offset = numberExpression(past, 'cm');
    }
  } else if (f.direction === 'one-side') {
    if (along) inputs.distance = expressionOf(along, negative);
    else inputs.extent = 'through-all';
  } else if (f.direction === 'two-sides') {
    inputs.direction = 'two-sides';
    // Each side: a distance, up to a face (its offset parameter and the next
    // face operand), or through everything.
    const face2 = param('Side2Offset')
      ? f.faces[(startFace ? 1 : 0) + (toFace ? 1 : 0)]
      : undefined;
    const sides = [
      {
        dist: along,
        face: toFace,
        past: param('Side1Offset'),
        keys: ['extent', 'distance', 'toObject', 'offset'],
      },
      {
        dist: against,
        face: face2,
        past: param('Side2Offset'),
        keys: ['extent2', 'distance2', 'toObject2', 'offset2'],
      },
    ] as const;
    for (const [i, side] of sides.entries()) {
      const [extent, distance, toObject, past] = side.keys;
      if (side.dist)
        inputs[distance] = expressionOf(side.dist, i === 0 ? negative : side.dist.value < 0);
      else if (side.face) {
        const name = faceName(side.face, naming);
        if (!name) return `its side ${i + 1} goes up to a face that could not be found`;
        inputs[extent] = 'to-object';
        inputs[toObject] = { kind: 'face', id: name };
        if (side.past && Math.abs(side.past.value) > 1e-12)
          inputs[past] = numberExpression(side.past.value, 'cm');
      } else inputs[extent] = 'through-all';
    }
    if (taper2 && Math.abs(taper2.value) > 1e-12) inputs.taper2 = expressionOf(taper2);
  } else {
    inputs.direction = 'symmetric';
    const dist = symmetric ?? along;
    if (!dist) inputs.extent = 'through-all';
    else inputs.distance = expressionOf(dist, dist.value < 0);
  }
  if (taper && Math.abs(taper.value) > 1e-12) inputs.taper = expressionOf(taper);
  if (flip && !(f.direction === 'one-side' && toFace)) inputs.flip = true;
  // The bodies the file joined, cut or intersected; Extrudo's default is every one it meets.
  const bodies = f.operation === 'new-body' ? undefined : participants(f.participants);
  if (bodies) inputs.bodies = bodies;
  const made = d.extrude(inputs as Parameters<Design['extrude']>[0], { name: f.name });
  return {
    id: made.id,
    sketch: entry,
    curves: regionCurves(entry, profiles),
    oneSided: f.direction === 'one-side',
    side1: f.reversed !== negative ? -1 : 1,
  };
}

/**
 * Adds an extrude of body faces (press-pull): both the file and Extrudo sweep a
 * flat face along its outward normal, the file's side 1 against it when
 * reversed or given a negative distance. Returns why not when it cannot.
 */
function faceExtrude(
  d: Design,
  f: F3dExtrude,
  naming: FaceNaming,
  expressionOf: (p: ParameterValue, negate?: boolean) => string,
  participants: (records: number[]) => GeomRef[] | undefined,
  report: ImportReport,
): string | { id: string } {
  if (!f.solid) return 'surface extrudes are not supported';
  if (f.direction !== 'one-side') return `a ${f.direction} extrude of faces is not supported yet`;
  const profiles: GeomRef[] = [];
  for (const face of f.faces) {
    const id = faceName(face, naming);
    if (id && !profiles.some((p) => p.id === id)) profiles.push({ kind: 'face', id });
  }
  if (profiles.length === 0) return 'its profile is a face that could not be named';
  if (profiles.length < new Set(f.faces.map((x) => JSON.stringify(x.tags))).size)
    report.notes.push(`${f.name}: some of the faces it extrudes could not be named.`);
  const param = (kind: string) => f.parameters.find((p) => p.kind === kind);
  const along = param('AlongDistance');
  const taper = param('TaperAngle');
  const negative = (along?.value ?? 0) < 0;
  const inputs: Record<string, unknown> = { profiles, operation: f.operation };
  if (along) inputs.distance = expressionOf(along, negative);
  else inputs.extent = 'through-all';
  if (taper && Math.abs(taper.value) > 1e-12) inputs.taper = expressionOf(taper);
  if (f.reversed !== negative) inputs.flip = true;
  const bodies = f.operation === 'new-body' ? undefined : participants(f.participants);
  if (bodies) inputs.bodies = bodies;
  const made = d.extrude(inputs as Parameters<Design['extrude']>[0], { name: f.name });
  return { id: made.id };
}

/** The Extrudo curves around the chosen regions of a sketch. */
function regionCurves(entry: SketchEntry, profiles: GeomRef[]): string[] {
  const chosen = new Set(profiles.map((p) => p.id));
  const curves = new Set<string>();
  for (const region of entry.handle.regions) {
    if (!chosen.has(`${entry.handle.id}/${region.id}`)) continue;
    for (const loop of [region.outer, ...region.holes])
      for (const e of loop.edges) curves.add(e.curve);
  }
  return [...curves];
}

/**
 * The technical reason a profile region wasn't found: the curve keys the file names it by and
 * the first regions the sketch has. A person reads `skippedFeature`'s wording of it instead.
 */
export function unmatchedRegion(
  sketch: string,
  wanted: readonly string[],
  count: number,
  have: readonly string[],
): string {
  return `profile region {${wanted.join('|')}} not found in ${sketch} (it has ${count}: ${have.map((k) => `{${k}}`).join(' ')})`;
}

/** The Extrudo profiles a feature's profile operands select, and the sketch they are in. */
export function selectProfiles(
  operands: ProfileOperand[],
  sketchOf: (operand: ProfileOperand) => SketchEntry | string,
  note: (text: string) => void = () => {},
): { profiles: GeomRef[]; entry: SketchEntry } | string {
  const profiles: GeomRef[] = [];
  let entry: SketchEntry | undefined;
  for (const operand of operands) {
    const sketch = sketchOf(operand);
    if (typeof sketch === 'string') return sketch;
    entry ??= sketch;
    if (operand.text !== undefined) {
      const text = sketch.texts.get(operand.text);
      if (!text) return 'its text was not imported';
      profiles.push({ kind: 'sketchEntity', id: `${sketch.handle.id}/${text}` });
      continue;
    }
    const regions = sketch.handle.regions;
    if (!operand.regions) {
      profiles.push(...sketch.handle.profiles());
      continue;
    }
    const present = new Set([...sketch.tags.values()].map(String));
    const before = profiles.length;
    let lost = 0;
    // A group's outline is the union of its other regions: wanted only where
    // one of those cannot be found exactly.
    const exact = new Map(
      operand.regions.map((want) => [want, exactRegions(sketch, regions, want)]),
    );
    const whole = new Set(
      operand.regions.filter((want) => !want.outline && !exact.get(want)).map((want) => want.group),
    );
    // …and when found, it stands in for them.
    const covered = new Set(
      operand.regions
        .filter((want) => want.outline && whole.has(want.group) && exact.get(want))
        .map((want) => want.group),
    );
    for (const want of operand.regions) {
      if (want.outline && !whole.has(want.group)) continue;
      if (!want.outline && !exact.get(want) && covered.has(want.group)) continue;
      const found = exact.get(want);
      const how = found ? 'exact' : want.outline ? 'outline skipped' : 'by curves';
      regionStats[how] = (regionStats[how] ?? 0) + 1;
      if (found) {
        for (const ref of found) if (!profiles.some((p) => p.id === ref.id)) profiles.push(ref);
        continue;
      }
      if (want.outline) continue;
      const refs = matchRegions(sketch.handle, regions, sketch.tags, want);
      if (refs.length === 0) {
        // Every curve around it was deleted after the pick: the file lost this
        // region too, and the operand's other regions make the profile.
        if (!want.outer.flat().some((t) => present.has(String(t)))) {
          lost++;
          continue;
        }
        const have = regions
          .map((r) =>
            keyOf(
              r.outer.edges
                .map((e) => sketch.tags.get(e.curve))
                .filter((t): t is bigint => t !== undefined),
            ),
          )
          .slice(0, 8);
        return unmatchedRegion(
          sketch.handle.name,
          want.outer.map((l) => keyOf(l)),
          regions.length,
          have,
        );
      }
      for (const ref of refs) if (!profiles.some((p) => p.id === ref.id)) profiles.push(ref);
    }
    if (lost && profiles.length === before)
      return 'the curves around its profile regions were deleted';
    if (lost) note(`${lost} profile region(s) left out: their curves were deleted in the file.`);
  }
  return entry ? { profiles, entry } : 'no profile';
}

/**
 * Holes at their centres: a sketch of the centre points on the plane of the
 * face they start on (when Extrudo can place a sketch there), and one hole
 * feature drilling into that face. Returns the feature made, or why not.
 */
function hole(
  d: Design,
  f: F3dHole,
  expressionOf: (p: ParameterValue, negate?: boolean) => string,
  report: ImportReport,
): string | ImportedHole {
  if (!f.plane) return 'its face was not found';
  if (f.centres.length === 0) return 'its centres were not found';
  const { origin: O, x: X, y: Y } = f.plane;
  const N = cross(X, Y);
  const m: Matrix = [
    X[0],
    Y[0],
    N[0],
    O[0],
    X[1],
    Y[1],
    N[1],
    O[1],
    X[2],
    Y[2],
    N[2],
    O[2],
    0,
    0,
    0,
    1,
  ];
  const placement = placeSketch(d, m, report, `${f.name} face`);
  if (!placement) return 'its face is not along an origin axis';
  const points: ReturnType<SketchBuilder['point']>[] = [];
  d.sketch(
    placement.plane,
    (k) => {
      for (const c of f.centres) {
        const w = sub(c, O);
        points.push(k.point(placement.map(dot(w, X), dot(w, Y))));
      }
    },
    { name: `${f.name} centres` },
  );
  const param = (kind: string) => f.parameters.find((p) => p.kind === kind);
  const inputs: Record<string, unknown> = {
    plane: placement.plane,
    points: points.map((p) => p.ref()),
    extent: 'blind',
  };
  const set = (input: string, kind: string) => {
    const p = param(kind);
    if (p) inputs[input] = expressionOf(p);
  };
  set('diameter', 'HoleDiameter');
  set('depth', 'HoleDepth');
  // A flat bottom is 180° in the file, 0° in Extrudo.
  const tip = param('TipAngle');
  if (tip) inputs.tipAngle = tip.value >= Math.PI - 1e-9 ? '0 deg' : expressionOf(tip);
  if (param('CSDiameter')) {
    inputs.type = 'countersink';
    set('csDiameter', 'CSDiameter');
    set('csAngle', 'CSAngle');
  } else if (param('CBDiameter')) {
    inputs.type = 'counterbore';
    set('cbDiameter', 'CBDiameter');
    set('cbDepth', 'CBDepth');
  }
  // Extrudo drills against its plane's normal; the file against N, unless flipped.
  if (placement.opposite !== f.flipped) inputs.flip = true;
  const id = d.hole(inputs as Parameters<Design['hole']>[0], { name: f.name }).id;
  const size = (kind: string) => param(kind)?.value;
  const n = scale(N, 1 / norm(N));
  return {
    id,
    centres: f.centres.map((at, i) => ({
      at,
      point: (points[i]?.ref().id ?? '').split('/').pop() as string,
    })),
    down: f.flipped ? n : scale(n, -1),
    diameter: size('HoleDiameter') ?? 0,
    ...(size('HoleDepth') !== undefined ? { depth: size('HoleDepth') } : {}),
    ...(size('CBDiameter') !== undefined ? { cbDiameter: size('CBDiameter') } : {}),
    ...(size('CBDepth') !== undefined ? { cbDepth: size('CBDepth') } : {}),
    ...(size('CSDiameter') !== undefined ? { csDiameter: size('CSDiameter') } : {}),
  };
}

/**
 * The name of a face of an imported hole, `hole:<id>:side:<point>.<role>`:
 * the hole whose axis the face's surface is on (or, for a flat face, whose
 * axis the face crosses nearest the hint), and the role by its shape and
 * size — a cylinder the wall or a counterbore's wall, a cone a countersink
 * or the drill point, a plane square to the axis a counterbore's floor or a
 * flat bottom.
 */
function holeFaceName(s: AsmSurface, h: ImportedHole, hint?: Vec3): string | undefined {
  const tol = 1e-4;
  const D = h.down;
  const name = (c: { point: string }, role: string) => `hole:${h.id}:side:${c.point}.${role}`;
  if (s.kind === 'cone') {
    const axis = scale(s.axis, 1 / norm(s.axis));
    if (norm(cross(axis, D)) > 1e-6) return miss('hole face: not along the hole');
    const c = h.centres.find((x) => norm(cross(sub(x.at, s.center), axis)) < tol);
    if (!c) return miss('hole face: on no hole axis');
    const r = (at: Vec3) => s.radius + s.slope * dot(sub(at, s.center), axis);
    const near = (a: number, b: number | undefined) => b !== undefined && Math.abs(a - b / 2) < tol;
    if (s.slope === 0 || s.cylinder) {
      if (near(s.radius, h.diameter)) return name(c, 'wall');
      if (near(s.radius, h.cbDiameter)) return name(c, 'cbwall');
      return miss('hole face: cylinder of another size');
    }
    // A countersink's cone has the countersink's radius at the face; the drill point does not.
    return name(c, near(r(c.at), h.csDiameter) ? 'cone' : 'tip');
  }
  if (s.kind === 'plane') {
    if (norm(cross(s.normal, D)) > 1e-6) return miss('hole face: plane not square to the hole');
    const depth = dot(sub(s.point, h.centres[0]?.at ?? s.point), D);
    const across = (x: { at: Vec3 }) => norm(cross(sub(hint ?? s.point, x.at), D));
    const c =
      h.centres.length === 1
        ? h.centres[0]
        : hint
          ? [...h.centres].sort((a, b) => across(a) - across(b))[0]
          : undefined;
    if (!c) return miss('hole face: which hole');
    if (h.cbDepth !== undefined && Math.abs(depth - h.cbDepth) < tol) return name(c, 'cbfloor');
    if (h.depth !== undefined && Math.abs(depth - h.depth) < tol) return name(c, 'floor');
    return miss('hole face: plane at another depth');
  }
  return miss('hole face: surface');
}

const ORIGIN_AXES: [string, Vec3][] = [
  ['origin:x', [1, 0, 0]],
  ['origin:y', [0, 1, 0]],
  ['origin:z', [0, 0, 1]],
];

/**
 * An Extrudo reference for an f3d axis: an origin axis, or a line of an
 * imported sketch (`only`: of that sketch alone); with the sign of its
 * direction against the file's.
 */
export function axisRef(
  axis: RevolveAxis,
  sketches: Map<number, SketchEntry>,
  only?: SketchEntry,
): { ref: GeomRef; sign: number } | undefined {
  const { point: P, direction: D } = axis;
  const u = scale(D, 1 / norm(D));
  for (const [id, a] of ORIGIN_AXES)
    if (norm(cross(u, a)) < 1e-9 && norm(cross(P, a)) < 1e-6)
      return { ref: { kind: 'axis', id }, sign: Math.sign(dot(u, a)) };
  const entry = axis.sketch !== undefined ? sketches.get(axis.sketch) : undefined;
  if (!entry || axis.tag === undefined || (only && entry !== only)) return undefined;
  const tag = String(axis.tag);
  const line = entry.source.lines.find((l) => String(l.tag) === tag);
  const id = [...entry.tags].find(([, t]) => String(t) === tag)?.[0];
  if (!line || !id) return undefined;
  const m = entry.source.frame;
  const along = sub(toModel(m, line.end), toModel(m, line.start));
  return {
    ref: { kind: 'sketchEntity', id: `${entry.handle.id}/${id}` },
    sign: Math.sign(dot(along, u)),
  };
}

/**
 * A revolve about an origin axis, or about a line of its own sketch. The
 * angle turns right-handed about the file's axis direction, as about
 * Extrudo's; a full turn has no direction. Returns the feature made, or why
 * not.
 */
function revolve(
  d: Design,
  f: F3dRevolve,
  sketches: Map<number, SketchEntry>,
  expressionOf: (p: ParameterValue, negate?: boolean) => string,
  participants: (records: number[]) => GeomRef[] | undefined,
  report: ImportReport,
): string | ImportedRevolve {
  if (!f.axis) return 'its axis was not found';
  if (f.profiles.length === 0) return 'its profile is a face, not a sketch profile';
  const selected = selectProfiles(
    f.profiles,
    (operand) => sketches.get(operand.sketch) ?? 'its sketch was not imported',
    (text) => report.notes.push(`${f.name}: ${text}`),
  );
  if (typeof selected === 'string') return selected;
  const { profiles, entry } = selected;
  const m = entry.source.frame;
  const O: Vec3 = [m[3] as number, m[7] as number, m[11] as number];
  const N: Vec3 = [m[2] as number, m[6] as number, m[10] as number];
  const { point: P, direction: D } = f.axis;
  const u = scale(D, 1 / norm(D));
  if (Math.abs(dot(sub(P, O), N)) > 1e-6 || Math.abs(dot(u, N)) > 1e-6)
    return "its axis is not in its profile's plane";
  const axis = axisRef(f.axis, sketches, entry);
  if (!axis) return 'its axis is not an origin axis or a line of its sketch';
  const along = f.parameters.find((p) => p.kind === 'AlongAngle');
  const negative = (along?.value ?? 0) < 0;
  const inputs: Record<string, unknown> = { profiles, axis: axis.ref, operation: f.operation };
  if (along) inputs.angle = expressionOf(along, negative);
  if (axis.sign < 0 !== negative) inputs.flip = true;
  const bodies = f.operation === 'new-body' ? undefined : participants(f.participants);
  if (bodies) inputs.bodies = bodies;
  const made = d.revolve(inputs as Parameters<Design['revolve']>[0], { name: f.name });
  return {
    id: made.id,
    sketch: entry,
    curves: regionCurves(entry, profiles),
    axis: { point: P, direction: u },
    angle: along ? Math.abs(along.value) : 2 * Math.PI,
  };
}

/**
 * A circular pattern of features: the tools of the imported features it
 * repeats, replayed round an origin axis or a sketch line and joined or cut
 * as each feature was. Features Extrudo does not replay (fillets, chamfers)
 * or did not import are left out with a note.
 */
function circularPattern(
  d: Design,
  f: F3dCircularPattern,
  made: Map<number, { id: string; name: string }>,
  sketches: Map<number, SketchEntry>,
  expressionOf: (p: ParameterValue, negate?: boolean) => string,
  report: ImportReport,
): string | { id: string } {
  if (f.objects !== 'features' || f.features.length === 0)
    return 'it repeats faces (only features are imported)';
  if (!f.axis) return 'its axis was not found';
  if (!f.count) return 'its count was not found';
  const features: GeomRef[] = [];
  let left = 0;
  for (const record of f.features) {
    const feature = made.get(record);
    if (feature) features.push({ kind: 'feature', id: feature.id });
    else left++;
  }
  if (features.length === 0) return 'none of the features it repeats was imported';
  if (left)
    report.notes.push(
      `${f.name}: ${left} of the ${f.features.length} features it repeats left out (not imported, or a fillet or chamfer).`,
    );
  const axis = axisRef(f.axis, sketches);
  if (!axis) return 'its axis is not an origin axis or a sketch line';
  const angle = f.parameters.find((p) => p.kind === 'TotalAngle');
  const inputs: Record<string, unknown> = {
    objects: 'features',
    features,
    axis: axis.ref,
    count: expressionOf(f.count),
  };
  if (angle) inputs.angle = expressionOf(angle, axis.sign < 0);
  return d.circularPattern(inputs as Parameters<Design['circularPattern']>[0], { name: f.name });
}

/**
 * How far along a sketch's normal a face's plane lies from the sketch plane
 * (cm), when the face is a plane parallel to it.
 */
function planeOffset(face: F3dFace, m: Matrix): number | undefined {
  const s = face.surface;
  if (s?.kind !== 'plane') return undefined;
  const N: Vec3 = [m[2] as number, m[6] as number, m[10] as number];
  if (norm(cross(s.normal, N)) > 1e-6) return undefined;
  const O: Vec3 = [m[3] as number, m[7] as number, m[11] as number];
  return dot(sub(s.point, O), N);
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** An f3d sketch point (cm, sketch frame) in model space (cm). */
function toModel(m: Matrix, p: Vec3): Vec3 {
  const g = (i: number) => m[i] as number;
  return [
    g(0) * p[0] + g(1) * p[1] + g(2) * p[2] + g(3),
    g(4) * p[0] + g(5) * p[1] + g(6) * p[2] + g(7),
    g(8) * p[0] + g(9) * p[1] + g(10) * p[2] + g(11),
  ];
}

/** Why faces could not be named, counted (for the corpus tools). */
export const faceMisses: Record<string, number> = {};
/** For the corpus tools: called with every fillet or chamfer edge as it is named. */
export const edgeTrace: {
  edge?: (row: {
    feature: string;
    edge: F3dEdgeFeature['sets'][number]['edges'][number];
    names: (string | undefined)[];
    why: (string | undefined)[];
    shape?: EdgeShape;
    ref?: GeomRef;
  }) => void;
} = {};
let lastMiss: string | undefined;
const miss = (why: string): undefined => {
  faceMisses[why] = (faceMisses[why] ?? 0) + 1;
  lastMiss = why;
  return undefined;
};

/**
 * The Extrudo name of a face an imported feature made. A fillet's or
 * chamfer's face: from the edge it rounds, by the face's token. An extrude's:
 * an end cap (parallel to the sketch, at the profile plane or not) or the
 * side swept from one of the curves around the extruded regions (a plane
 * through a line's two ends, a cylinder about a circle's or arc's centre).
 */
function faceName(
  face: F3dFace,
  naming: FaceNaming,
  hint?: Vec3,
  /**
   * A thread's face: its crest radius and how far (cm) the cylinder may have
   * moved off its sketch circle; the nearest coaxial circle is taken.
   */
  crest?: { radius: number; slack: number },
): string | undefined {
  if (face.instance) {
    // A copy: named after the face it copies.
    const { instance, ...source } = face;
    const copy = naming.copies.get(instance.pattern);
    if (!copy) return miss('copied by a mirror or pattern not imported');
    const label = copy.label(instance.code);
    if (label === undefined) return miss('copy: instance not known');
    const name = faceName(source, naming, undefined, crest);
    return name && `${copy.op}:${copy.id}:${label === '' ? '' : `${label}:`}from:(${name})`;
  }
  if (face.feature === undefined) return miss('no feature');
  const round = naming.rounds.get(face.feature);
  if (round) {
    const k = Number(face.tags[0]?.token);
    const near = hint ? nearestEdge(round, hint) : undefined;
    const edge =
      near !== undefined ? round.edges[near] : Number.isInteger(k) ? round.edges[k - 1] : undefined;
    if (!edge) return miss(`${round.op} face: its edge has no name`);
    return `${round.op}:${round.id}:from:(${edge})`;
  }
  const hole = naming.holes.get(face.feature);
  if (hole)
    return face.surface ? holeFaceName(face.surface, hole, hint) : miss('face not in the B-rep');
  const rev = naming.revolves.get(face.feature);
  if (rev) return face.surface ? revolveFaceName(face.surface, rev) : miss('face not in the B-rep');
  const ex = naming.extrudes.get(face.feature);
  if (!ex) return miss('feature not an imported extrude, revolve, fillet or chamfer');
  const s = face.surface;
  if (!s) return miss('face not in the B-rep');
  const m = ex.sketch.source.frame;
  const O: Vec3 = [m[3] as number, m[7] as number, m[11] as number];
  const N: Vec3 = [m[2] as number, m[6] as number, m[10] as number];
  const line = (curve: string) => {
    const c = ex.sketch.curves.get(curve);
    return c && !('center' in c) ? c : undefined;
  };
  const circle = (curve: string) => {
    const c = ex.sketch.curves.get(curve);
    return c && 'center' in c ? c : undefined;
  };
  const tol = 1e-5;
  if (s.kind === 'plane') {
    if (norm(cross(s.normal, N)) < 1e-6) {
      const h = dot(sub(s.point, O), N);
      if (ex.oneSided) return `extrude:${ex.id}:cap:${Math.abs(h) < tol ? 'start' : 'end'}`;
      // Two sides: side 1 ends in `cap:end`, side 2 in `cap:start`.
      if (Math.abs(h) < tol) return miss('profile plane of a two-sided extrude');
      return `extrude:${ex.id}:cap:${Math.sign(h) === ex.side1 ? 'end' : 'start'}`;
    }
    const on = (p: Vec3) => Math.abs(dot(sub(toModel(m, p), s.point), s.normal)) < tol;
    const hits = ex.curves.filter((curve) => {
      const l = line(curve);
      return l && on(l.start) && on(l.end);
    });
    const curve = sideCurve(hits, face, hint, (curve, p) => {
      const l = line(curve) as SketchLine;
      const a = toModel(m, l.start);
      const d = sub(toModel(m, l.end), a);
      const t = dot(sub(p, a), d) / dot(d, d);
      return t > -1e-4 && t < 1 + 1e-4;
    });
    return curve ? `extrude:${ex.id}:side:${curve}` : miss('plane side: no curve');
  }
  if (s.kind === 'cone' && norm(cross(s.axis, N)) / norm(s.axis) < 1e-6) {
    // A cylinder, or a cone where the extrude tapers: the curve's radius in the sketch plane.
    const axis = scale(s.axis, 1 / norm(s.axis));
    const gap = (curve: string) => {
      const c = circle(curve);
      if (!c) return Number.POSITIVE_INFINITY;
      const off = sub(toModel(m, c.center), s.center);
      if (norm(cross(off, axis)) >= tol) return Number.POSITIVE_INFINITY;
      return Math.abs(c.radius - ((crest?.radius ?? s.radius) + s.slope * dot(off, axis)));
    };
    const near = ex.curves.filter((curve) => gap(curve) < tol + (crest?.slack ?? 0));
    // A thread's face: the nearest circle alone.
    const hits = crest ? near.sort((a, b) => gap(a) - gap(b)).slice(0, 1) : near;
    const curve = sideCurve(hits, face, hint, (curve, p) => {
      const c = circle(curve) as SketchCircular;
      const span = c.endAngle - c.startAngle;
      if (span >= 2 * Math.PI - 1e-9) return true;
      const dir = (v: Vec3) => sub(toModel(m, v), toModel(m, [0, 0, 0]));
      const x = dir(c.xAxis);
      const y = cross(dir(c.normal), x);
      const w = sub(p, toModel(m, c.center));
      const turn = Math.atan2(dot(w, y), dot(w, x)) - c.startAngle;
      const a = ((turn % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return a < span + 1e-6 || a > 2 * Math.PI - 1e-6;
    });
    return curve ? `extrude:${ex.id}:side:${curve}` : miss('cylinder side: no curve');
  }
  return miss(`surface ${s.kind === 'other' ? s.type : s.kind}`);
}

/** The named edge of a fillet or chamfer nearest a point (cm), by its geometry. */
/** The radius (cm) behind an imported extrude's side face name, or a hole's wall. */
function sideRadius(name: string, naming: FaceNaming): number | undefined {
  const w = /^hole:([^:]+):side:[^.]+\.wall$/.exec(name);
  if (w) for (const h of naming.holes.values()) if (h.id === w[1]) return h.diameter / 2;
  const m = /^extrude:([^:]+):side:(.+)$/.exec(name);
  if (!m) return undefined;
  for (const ex of naming.extrudes.values()) {
    if (ex.id !== m[1]) continue;
    const c = ex.sketch.curves.get(m[2] as string);
    return c && 'center' in c ? c.radius : undefined;
  }
  return undefined;
}

function nearestEdge(round: ImportedRound, p: Vec3): number | undefined {
  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  round.shapes.forEach((shape, i) => {
    if (!shape?.ends || !round.edges[i]) return;
    const [a, b] = shape.ends;
    let d: number;
    if (shape.type === 'line') {
      const ab = sub(b, a);
      const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
      d = norm(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]));
    } else {
      d = Math.min(norm(sub(p, a)), norm(sub(p, b)), norm(sub(p, shape.mid)));
    }
    if (d < bestDistance) [best, bestDistance] = [i, d];
  });
  return best;
}

/**
 * Which of an extrude's curves on a face's surface swept that face. The file
 * gives a face it merged one tag per face merged into it: when it merged all
 * of these curves' sides, Extrudo merged them too and kept the smallest name.
 * Otherwise the one whose stretch holds `hint` (a point on the face, model
 * space, cm), else the first.
 */
function sideCurve(
  hits: string[],
  face: F3dFace,
  hint: Vec3 | undefined,
  holds: (curve: string, p: Vec3) => boolean,
): string | undefined {
  if (hits.length < 2) return hits[0];
  const op = Math.abs(face.tags[0]?.designs[0] ?? Number.NaN);
  const merged = face.tags.filter((t) => Math.abs(t.designs[0] ?? Number.NaN) === op).length;
  if (merged >= hits.length) return [...hits].sort()[0];
  return (hint && hits.find((curve) => holds(curve, hint))) || hits[0];
}

/**
 * The Extrudo name of a face a revolve made from a line of its profile: a
 * plane square to the axis (the line square to it too), a cylinder (the line
 * along it) or a cone about the axis; or, turned less than a full turn, a cap
 * through the axis — the start one in the sketch's plane.
 */
function revolveFaceName(s: AsmSurface, rev: ImportedRevolve): string | undefined {
  const { point: P, direction: u } = rev.axis;
  const m = rev.sketch.source.frame;
  const N: Vec3 = [m[2] as number, m[6] as number, m[10] as number];
  const tol = 1e-5;
  /** A point's place along the axis and its distance from it. */
  const axial = (A: Vec3) => {
    const w = sub(A, P);
    const t = dot(w, u);
    return { t, r: norm(sub(w, scale(u, t))) };
  };
  const full = Math.abs(rev.angle - 2 * Math.PI) < 1e-9;
  if (s.kind === 'plane' && !full && Math.abs(dot(s.normal, u)) < 1e-6) {
    if (Math.abs(dot(sub(P, s.point), s.normal)) > tol) return miss('revolve: plane off the axis');
    // Half a turn ends in the start's plane: the two caps are not told apart.
    if (Math.abs(rev.angle - Math.PI) < 1e-9) return miss('revolve: cap of half a turn');
    return `revolve:${rev.id}:cap:${norm(cross(s.normal, N)) < 1e-6 ? 'start' : 'end'}`;
  }
  const lines = new Map(rev.sketch.source.lines.map((l) => [String(l.tag), l]));
  for (const curve of rev.curves) {
    const l = lines.get(String(rev.sketch.tags.get(curve)));
    if (!l) continue;
    const a = axial(toModel(m, l.start));
    const b = axial(toModel(m, l.end));
    if (s.kind === 'plane') {
      if (norm(cross(s.normal, u)) > 1e-6 || Math.abs(a.t - b.t) > tol) continue;
      if (Math.abs(dot(sub(toModel(m, l.start), s.point), s.normal)) < tol)
        return `revolve:${rev.id}:side:${curve}`;
    } else if (s.kind === 'cone') {
      if (norm(cross(s.axis, u)) / norm(s.axis) > 1e-6) continue;
      if (norm(cross(sub(s.center, P), u)) > tol || Math.abs(a.t - b.t) < tol) continue;
      if (s.cylinder !== Math.abs(a.r - b.r) < tol) continue;
      const at = dot(sub(s.center, P), u);
      const r = a.r + ((b.r - a.r) * (at - a.t)) / (b.t - a.t);
      if (Math.abs(r - s.radius) < tol) return `revolve:${rev.id}:side:${curve}`;
    }
  }
  return miss(`revolve: ${s.kind === 'other' ? s.type : s.kind} side: no curve`);
}

/**
 * Moves the faces that can be named (those an imported extrude made) along
 * their outward normals; returns why not when none can. The file's distance
 * is along the outward normal too.
 */
function offsetFaces(
  d: Design,
  f: F3dOffsetFaces,
  naming: FaceNaming,
  expressionOf: (p: ParameterValue, negate?: boolean) => string,
  report: ImportReport,
): string | undefined {
  if (!f.distance) return 'its distance was not found';
  // The one such offset in the files seen fails in the kernel: its body has a
  // notch across a cylinder's seam, where Offset Face refuses every face.
  if (f.faces.some((face) => face.instance))
    return 'it moves faces a pattern or mirror copied (not imported yet)';
  if (Math.abs(f.distance.value) < 1e-12)
    return 'its distance is 0 (Extrudo refuses an offset that moves nothing)';
  const faces: GeomRef[] = [];
  for (const face of f.faces) {
    const id = faceName(face, naming);
    if (id && !faces.some((r) => r.id === id)) faces.push({ kind: 'face', id });
  }
  if (faces.length === 0)
    return f.faces.length === 0 ? 'no faces' : `none of its ${f.faces.length} faces could be named`;
  const named = f.faces.filter((face) => faceName(face, naming)).length;
  if (named < f.faces.length)
    report.notes.push(
      `${f.name}: ${f.faces.length - named} of ${f.faces.length} faces left out (not made by an imported extrude, fillet or chamfer).`,
    );
  d.offsetFace(
    { faces, distance: expressionOf(f.distance) } as Parameters<Design['offsetFace']>[0],
    {
      name: f.name,
    },
  );
  return undefined;
}

/**
 * Adds a fillet or chamfer on the edges that can be named; returns why not
 * when none can, or the feature and its edges' names (for its faces' names).
 */
function edgeTreatment(
  d: Design,
  f: F3dEdgeFeature,
  naming: FaceNaming,
  expressionOf: (p: ParameterValue, negate?: boolean) => string,
  report: ImportReport,
): string | ImportedRound {
  const inputs: Record<string, unknown> = {};
  const edges: (string | undefined)[] = [];
  const shapes: (EdgeShape | undefined)[] = [];
  let set = 0;
  let total = 0;
  let named = 0;
  for (const s of f.sets) {
    const refs: GeomRef[] = [];
    // Edges held only by a guessed name or one face's, with their shapes.
    const weak = new Map<GeomRef, EdgeShape | undefined>();
    const strong = new Map<GeomRef, EdgeShape | undefined>();
    // A chamfer with two sizes: each edge's two faces, the one its first
    // distance goes on first, when the file's chamfer faces show it.
    const sides = new Map<GeomRef, [string, string]>();
    const pairs = new Map<GeomRef, readonly string[]>();
    const second =
      f.type === 'chamfer' && s.size && s.size2
        ? s.size2.unit === 'deg'
          ? s.size.value * Math.tan(s.size2.value)
          : s.size2.value
        : undefined;
    for (const e of s.edges) {
      total++;
      const shape = edgeShape(e);
      lastMiss = undefined;
      const a = faceName(e.faces[0], naming, shape?.mid);
      const whyA = a ? undefined : lastMiss;
      lastMiss = undefined;
      const b = faceName(e.faces[1], naming, shape?.mid);
      const trace = (ref?: GeomRef) =>
        edgeTrace.edge?.({
          feature: f.name,
          edge: e,
          names: [a, b],
          why: [whyA, b ? undefined : lastMiss],
          ...(shape ? { shape } : {}),
          ...(ref ? { ref } : {}),
        });
      const names = a && b && a !== b ? [a, b] : undefined;
      edges.push(names ? edgeName(names) : undefined);
      shapes.push(shape);
      // A fillet's or chamfer's face name is read off the edge it rounds, as
      // named here; Extrudo may have found that edge by its shape instead,
      // under another name. Such a name alone is too weak to hold the edge
      // (a lost edge fails the whole feature), so it needs the shape too:
      // a line or circle the two surfaces meet in. Ellipses and curves the
      // file's B-rep edges chose help find an edge both faces name, but
      // letting them hold such an edge added whole-feature failures in the
      // files seen (it lay on an earlier round the kernel could not make).
      const guessed = names?.some((n) => /^(fillet|chamfer):/.test(n)) ?? false;
      const sure = !!shape && shape.type !== 'ellipse' && !shape.chosen;
      if (!sure && (!names || guessed)) {
        trace();
        continue;
      }
      // Geometry alone, without a named face beside it, matches some other
      // edge of that kind and size as readily as this one (most such picks
      // in the corpus were wrong): left out.
      const beside = names ?? [...new Set([a, b].filter((x): x is string => !!x))];
      if (beside.length === 0) {
        trace();
        continue;
      }
      // The name, when both faces have one; the geometry always, so Extrudo
      // finds the edge where joins merged or split those faces.
      const id = names ? edgeName(names) : `e[f3d.edge.${f.id}.${total}]`;
      const ref: GeomRef = { kind: 'edge', id };
      if (shape) {
        const { type, at, dir, size } = shape;
        ref.fingerprint = { type, at, dir, size, adj: [...beside].sort() };
      }
      // Two edges can share a name (both between the same two faces, which
      // Extrudo numbers or splits): kept apart by where they are.
      const at = ref.fingerprint?.at;
      const same = (r: GeomRef) =>
        r.id === id &&
        (!at ||
          !r.fingerprint?.at ||
          Math.hypot(...at.map((v, i) => v - (r.fingerprint?.at?.[i] ?? 0))) < 1e-3);
      if (!refs.some(same)) {
        refs.push(ref);
        (guessed || !names ? weak : strong).set(ref, shape);
        if (names) pairs.set(ref, names);
        const k =
          names && shape && second !== undefined && s.size && f.made
            ? firstFace(e, shape, f.made, s.size.value, second)
            : undefined;
        if (a && b && k !== undefined) sides.set(ref, k === 0 ? [a, b] : [b, a]);
      }
      trace(ref);
      named++;
    }
    // The kernel rounds a whole tangent chain whichever of its edges it is
    // given. A weak edge that only continues the chain of an edge held by
    // name adds nothing then, and when it lies on an earlier round the
    // kernel could not make, it is lost and fails this round too: left out.
    const chained = new Set<GeomRef>();
    const holders = [...strong.values()];
    for (let grew = true; grew; ) {
      grew = false;
      for (const [ref, shape] of weak) {
        if (chained.has(ref) || !shape) continue;
        if (holders.some((h) => h && continues(shape, h))) {
          chained.add(ref);
          holders.push(shape);
          grew = true;
        }
      }
    }
    for (const ref of chained) refs.splice(refs.indexOf(ref), 1);
    if (refs.length === 0 || !s.size) continue;
    // Extrudo takes one reference face per set, which must touch each of its
    // edges: the face every edge shown takes its first distance on, or, with
    // the sizes swapped, the face every edge takes its second on. Edges that
    // disagree (a chain round a corner) keep Extrudo's own choice.
    const shown = [...sides.values()];
    const common = (i: 0 | 1) => {
      const face = shown[0]?.[i];
      return face !== undefined &&
        shown.every((x) => x[i] === face) &&
        refs.every((r) => pairs.get(r)?.includes(face))
        ? face
        : undefined;
    };
    const first = common(0);
    const other = first === undefined ? common(1) : undefined;
    if (set >= 32) continue;
    const n = set === 0 ? '' : String(set + 1);
    inputs[`edges${n}`] = refs;
    if (f.type === 'fillet') inputs[`radius${n}`] = expressionOf(s.size);
    else {
      inputs[`distance${n}`] = expressionOf(s.size);
      if (s.size2) {
        const d1 = expressionOf(s.size);
        const d2 = expressionOf(s.size2);
        if (s.size2.unit === 'deg') {
          inputs[`mode${n}`] = 'distance-angle';
          inputs[`angle${n}`] = d2;
          if (other) {
            // The other face's distance, d · tan θ, at 90° − θ to it.
            inputs[`distance${n}`] = `(${d1}) * tan(${d2})`;
            inputs[`angle${n}`] = `90 deg - (${d2})`;
          }
        } else {
          inputs[`mode${n}`] = 'two-distances';
          inputs[`distanceB${n}`] = d2;
          if (other) {
            inputs[`distance${n}`] = d2;
            inputs[`distanceB${n}`] = d1;
          }
        }
        const face = first ?? other;
        if (face) inputs[`face${n}`] = [{ kind: 'face', id: face }];
      }
    }
    set++;
  }
  if (set === 0) return total === 0 ? 'no edges' : `none of its ${total} edges could be named`;
  if (named < total)
    report.notes.push(
      `${f.name}: ${total - named} of ${total} edges left out (their faces could not be named).`,
    );
  // A lost edge (on an earlier round the kernel couldn't make, or a face not
  // imported) leaves that edge out with a warning instead of failing the whole
  // round (ADR-0083's amendment, 2026-10-11).
  inputs.skipLostEdges = true;
  const made =
    f.type === 'fillet'
      ? d.fillet(inputs as Parameters<Design['fillet']>[0], { name: f.name })
      : d.chamfer(inputs as Parameters<Design['chamfer']>[0], { name: f.name });
  return { op: f.type, id: made.id, edges, shapes };
}

/**
 * The Extrudo regions an f3d region covers. The file names a region by the
 * curves along its boundary as they were when it was picked — every curve
 * where collinear ones overlap — and re-finds it after later edits. So the
 * region is rebuilt from those curves alone, and every region of the whole
 * sketch whose inside lies within it is taken: one region usually, several
 * where curves drawn later (or construction lines) cut it up.
 */
/**
 * Regions smaller than this (mm²) are slivers between nearly coincident
 * curves: the kernel's exact arrangement may make no face of them, and a
 * missing profile fails the whole feature.
 */
const SLIVER = 0.01;

/** How profile regions were found, counted (for the corpus tools). */
export const regionStats: Record<string, number> = {
  exact: 0,
  'by curves': 0,
  'outline skipped': 0,
};

/**
 * The Extrudo regions inside an f3d region rebuilt from its pieces of
 * curves (`regions.ts`); undefined when the pieces are not found as the file
 * counted them (the sketch changed after the pick) or enclose no region.
 */
function exactRegions(
  entry: SketchEntry,
  regions: SketchHandle['regions'],
  want: ProfileRegion,
): GeomRef[] | undefined {
  entry.pieces ??= sketchPieces(entry.source, entry.profileCurves);
  const lines = regionPieces(entry.pieces, [...want.outerPieces, ...want.innerPieces]);
  if (!lines) return undefined;
  const mapped = lines.map((line) => line.map(([u, v]) => entry.placement.map(u, v)));
  const out: GeomRef[] = [];
  for (const r of regions) {
    if (r.text !== undefined || Math.abs(r.area) < SLIVER) continue;
    const p = probeOf(r);
    if (p && insidePieces(mapped, p))
      out.push({ kind: 'profile', id: `${entry.handle.id}/${r.id}` });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * A point inside a region, once per region: `interiorPoint` is slow on long
 * spline outlines, and every wanted region tests every region of the sketch.
 */
const probes = new WeakMap<Profile, readonly [number, number] | undefined>();
function probeOf(r: Profile): readonly [number, number] | undefined {
  if (!probes.has(r))
    probes.set(
      r,
      interiorPoint(
        r.outer.polygon,
        r.holes.map((h) => h.polygon),
      ),
    );
  return probes.get(r);
}

function matchRegions(
  handle: SketchHandle,
  regions: SketchHandle['regions'],
  tags: Map<string, bigint>,
  want: ProfileRegion,
): GeomRef[] {
  const data = handle.data;
  const outerTags = new Set(want.outer.flat().map(String));
  const allTags = new Set([...outerTags, ...want.inner.flat().map(String)]);
  // A sketch of the region's own curves (never construction: the file used them).
  const entities: Record<string, unknown> = {};
  for (const [id, tag] of tags) {
    if (!allTags.has(String(tag))) continue;
    const e = data.entities[id as keyof typeof data.entities] as
      | Record<string, unknown>
      | undefined;
    if (!e) continue;
    entities[id] = { ...e, construction: false };
    const refs = [e.start, e.end, e.center, ...((e.points as unknown[] | undefined) ?? [])];
    for (const ref of refs)
      if (typeof ref === 'string' && data.entities[ref as keyof typeof data.entities])
        entities[ref] = data.entities[ref as keyof typeof data.entities];
  }
  const own = detectProfiles({ entities, constraints: {}, dimensions: {} } as SketchData);
  const onOuter = (r: Profile) =>
    r.outer.edges.every((e) => outerTags.has(String(tags.get(e.curve))));
  const region = own.filter(onOuter).sort((a, b) => Math.abs(b.area) - Math.abs(a.area))[0];
  if (!region) return staleRegion(handle, regions, tags, outerTags);
  const holes = region.holes.map((h) => h.polygon);
  const inside = (p: readonly [number, number]) =>
    insidePolygon(region.outer.polygon, p) && !holes.some((h) => insidePolygon(h, p));
  const out: GeomRef[] = [];
  for (const r of regions) {
    if (r.text !== undefined || Math.abs(r.area) < SLIVER) continue;
    const p = probeOf(r);
    if (p && inside(p)) out.push({ kind: 'profile', id: `${handle.id}/${r.id}` });
  }
  return out;
}

/**
 * A region whose curves were edited after it was picked: some of the curves
 * the file lists are gone (redrawn under new IDs), or they no longer close on
 * their own (split, trimmed, filleted, moved). The region of the sketch whose
 * outline runs along the most of the listed curves that are left — at least
 * two of them, or the one left, and at least half — stands in for it; the
 * smallest such region when several do.
 */
function staleRegion(
  handle: SketchHandle,
  regions: SketchHandle['regions'],
  tags: Map<string, bigint>,
  outerTags: Set<string>,
): GeomRef[] {
  const left = new Set([...tags.values()].map(String).filter((t) => outerTags.has(t)));
  if (left.size === 0) return [];
  const need = Math.max(Math.min(2, left.size), Math.ceil(left.size / 2));
  let best: { region: SketchHandle['regions'][number]; covered: number } | undefined;
  for (const r of regions) {
    if (r.text !== undefined) continue;
    const along = new Set(r.outer.edges.map((e) => String(tags.get(e.curve))));
    const covered = [...left].filter((t) => along.has(t)).length;
    if (covered < need) continue;
    if (
      !best ||
      covered > best.covered ||
      (covered === best.covered && Math.abs(r.area) < Math.abs(best.region.area))
    )
      best = { region: r, covered };
  }
  return best ? [{ kind: 'profile', id: `${handle.id}/${best.region.id}` }] : [];
}
