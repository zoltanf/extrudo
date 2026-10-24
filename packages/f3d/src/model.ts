/**
 * The decoded design: the records of a design segment assembled into the
 * things a person sees in the file's timeline — parameters, sketches with their
 * plane and geometry, and features with their inputs. Lengths stay in
 * the file's internal centimetres here; the mapper converts.
 */
import { designSegments, type Entries, type SegmentFiles, unzip } from './archive';
import { type AsmCurve, type AsmFace, type AsmSurface, asmFaces, readAsm } from './asm';
import { F3dFormatError, finite, Reader } from './bytes';
import { BODY, type BodyFlags, readBody } from './decode/body';
import { type CombineRead, type MoveRead, readCombine, readMove } from './decode/combine';
import {
  BODY_MOVES,
  componentOfBody,
  componentOfFeature,
  type F3dBodyMove,
  type F3dComponent,
  readBodyMove,
  readComponents,
} from './decode/component';
import {
  readSketchConstraints,
  type SketchDimensionRecord,
  type SketchRelation,
} from './decode/constraints';
import {
  type CopiedObjects,
  MIRROR,
  PATH_PATTERN,
  type PathPatternSpec,
  RECTANGULAR_PATTERN,
  readCopied,
  readCounts,
  readDirections,
  readInstances,
  readMirrorPlane,
  readPathPattern,
} from './decode/copies';
import {
  EDGE_OPERAND,
  EDGE_RECIPE,
  edgeFaces,
  type FaceTag,
  OPERAND_GROUP,
  readEdgeRecipe,
} from './decode/edges';
import {
  type BodyOperation,
  type ExtrudeHead,
  type ProfileOperand,
  readExtrudeHead,
  readProfileOperand,
  SKETCH_PROFILE_OPERAND,
  SketchGoneError,
} from './decode/extrude';
import {
  allParticipants,
  FEATURE_RECORDS,
  readFeatureRecords,
  timelineFeature,
} from './decode/feature-records';
import {
  centresFromCylinders,
  HOLE_PLACEMENT,
  MODEL_PLANE,
  MODEL_POINT,
  type ModelPlane,
  planeThrough,
  readHoleFlipped,
  readHolePlacement,
  readModelPlane,
  readModelPoint,
} from './decode/hole';
import { FEATURE_TYPES } from './decode/index';
import {
  PARAMETER_OWNER,
  PARAMETER_VALUE,
  type ParameterValue,
  parameterValue,
} from './decode/parameters';
import {
  BODY_LINK,
  BODY_OPERAND,
  CIRCULAR_PATTERN,
  PATTERN_COUNT,
  RECORD_REF,
  readRecordRef,
} from './decode/pattern';
import {
  GEOMETRY_OPERAND,
  type RevolveAxis,
  readAxis,
  readRevolveOperation,
} from './decode/revolve';
import { readScope, type Scope } from './decode/scope';
import {
  refAhead,
  SKETCH_CIRCULAR,
  SKETCH_CONIC,
  SKETCH_ELLIPSE,
  SKETCH_LINE,
  SKETCH_LINE_ALT,
  SKETCH_POINT,
  SKETCH_SPLINE,
  type SketchCircular,
  type SketchEllipse,
  type SketchLine,
  type SketchPoint,
  type SketchSpline,
  sketchCircular,
  sketchConic,
  sketchEllipse,
  sketchLine,
  sketchPoint,
  sketchSpline,
  type Vec3,
} from './decode/sketch-geometry';
import { type CurveRef, readPaths, readSweepOperation } from './decode/sweep';
import {
  boxSize,
  oldTextBoxes,
  SKETCH_TEXT,
  SKETCH_TEXT_OLD,
  type SketchText,
  sketchText,
  sketchTextOld,
  TEXT_PROFILE_OPERAND,
} from './decode/text';
import { readThreadSpec, type ThreadSpec } from './decode/thread';
import { TIMELINE, timeline } from './decode/timeline';
import { readTorusHead, torusPlacement } from './decode/torus';
import { Segment } from './segment';

export const SKETCH_CONTAINER = '44A64366-4BD3-4B24-881A-F94C206E8F2D';
export const SKETCH_PLACEMENT = 'F47A46FB-DA27-4AFA-8A72-1B38FA596E23';
/** Timeline items that are not features, by type. */
const TIMELINE_LABELS: Record<string, string> = {
  '54F9ACE8-B5B8-4A6E-B582-64F629511DE4': 'Component',
  '56225BC7-69B7-446A-9AEA-6AA25BC7806E': 'Body to Component',
};

/** Operation ID → feature record (what face tags point at). */
export const OPERATION_TABLE = '5D89B935-3F04-4CAB-81F5-E7B309E7E13F';

/** A 4×4 row-major sketch-to-model transform, translation in cm. */
export type Matrix = number[];
export const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export interface F3dSketch {
  /** The sketch container record. */
  id: number;
  frame: Matrix;
  points: SketchPoint[];
  lines: SketchLine[];
  circulars: SketchCircular[];
  /** Splines and conics. */
  splines: SketchSpline[];
  texts: SketchText[];
  /** Ellipses and elliptical arcs (absent when the sketch has none). */
  ellipses?: SketchEllipse[];
  /** Its geometric constraints and dimensions, as the file stores them. */
  relations?: SketchRelation[];
  dimensions?: SketchDimensionRecord[];
}

interface FeatureBase {
  /** The feature (scope) record. */
  id: number;
  kind: string;
  /** "Sketch1", "Extrude3", or the user's own name. */
  name: string;
  suppressed: boolean;
  /** Parameters this feature owns, by kind ("AlongDistance", "Linear Dimension-2", …). */
  parameters: ParameterValue[];
  /** The component it belongs to (component record), when the file says. */
  component?: number;
}

export interface F3dSketchFeature extends FeatureBase {
  type: 'sketch';
  sketch: F3dSketch;
}

export interface F3dExtrude extends FeatureBase, ExtrudeHead {
  type: 'extrude';
  profiles: ProfileOperand[];
  /** Body faces it names, in reference order: the start face, the face it goes up to. */
  faces: F3dFace[];
  /** The bodies it joins, cuts or intersects (body records); empty: none named. */
  participants: number[];
  /** A profile operand names a sketch the file no longer holds (deleted after the extrude). */
  sketchGone?: true;
}

/** A face an edge lies on: its tags, and what the B-rep says it is. */
export interface F3dFace {
  tags: FaceTag[];
  /** The timeline feature that made the face (from its first tag). */
  feature?: number;
  /**
   * The face's surface in model space, cm, when the B-rep still has it: in
   * the state the feature picked it in, as near as the streams keep it.
   */
  surface?: AsmSurface;
  /**
   * A face a mirror or pattern copied: the copying feature (record) and the
   * instance's code; `feature` and `surface` are then the face it copies.
   */
  instance?: { pattern: number; code: number };
  /** A copy's own surface, where the copy is (`surface` is the copied face's). */
  own?: AsmSurface;
  /**
   * The face's other surfaces in the states of the body the B-rep streams
   * keep (an offset moved it before or after the feature picked it), nearest
   * that state first; none when every state has `surface`.
   */
  states?: AsmSurface[];
  /** The solved body's surface of the face, where `surface` is another state's. */
  solved?: AsmSurface;
}

/** An edge, as the two faces it runs between and the faces that end it. */
export interface F3dEdge {
  faces: [F3dFace, F3dFace];
  bounds: F3dFace[];
  /**
   * The edges the file's B-rep streams hold between those two faces, each
   * as some state of the design had it (the streams keep earlier states
   * too): its curve and its vertices, cm. Distinct ones only.
   */
  known?: KnownEdge[];
}

export interface KnownEdge {
  curve: AsmCurve;
  points: [number, number, number][];
}

export interface F3dEdgeSet {
  edges: F3dEdge[];
  /** Fillet radius or chamfer distance. */
  size?: ParameterValue;
  /** A chamfer's second distance or angle. */
  size2?: ParameterValue;
}

export interface F3dEdgeFeature extends FeatureBase {
  type: 'fillet' | 'chamfer';
  sets: F3dEdgeSet[];
  /** The surfaces of the B-rep faces it made (tagged with its operations), cm. */
  made?: AsmSurface[];
}

export interface F3dRevolve extends FeatureBase {
  type: 'revolve';
  operation: BodyOperation;
  /** The bodies it joins, cuts or intersects (body records); empty: none named. */
  participants: number[];
  profiles: ProfileOperand[];
  axis?: RevolveAxis;
}

export interface F3dHole extends FeatureBase {
  type: 'hole';
  /** The plane of the face the holes start on, model space. */
  plane?: ModelPlane;
  /** Hole centres in model space, cm. */
  centres: Vec3[];
  /** Drills along the plane's normal (x × y), not against it. */
  flipped: boolean;
}

export interface F3dCircularPattern extends FeatureBase {
  type: 'circular-pattern';
  /** What it repeats: features, or faces (not read further). */
  objects: 'features' | 'faces';
  /** The features it repeats, by record. */
  features: number[];
  axis?: RevolveAxis;
  count?: ParameterValue;
}

export interface F3dOffsetFaces extends FeatureBase {
  type: 'offset-faces';
  /** The faces it moves, each named by its recipe's first face. */
  faces: F3dFace[];
  distance?: ParameterValue;
}

export interface F3dDeleteFaces extends FeatureBase {
  type: 'delete-faces';
  /** The faces it deletes, each named by its recipe's first face. */
  faces: F3dFace[];
}

export interface F3dMirror extends FeatureBase, CopiedObjects {
  type: 'mirror';
  /** The mirror plane, model space. */
  plane?: ModelPlane;
}

export interface F3dRectangularPattern extends FeatureBase, CopiedObjects {
  type: 'rectangular-pattern';
  /** Its directions in order (the second makes a grid). */
  directions: RevolveAxis[];
  /** `countU`, then `CountV`. */
  counts: ParameterValue[];
}

export interface F3dSweep extends FeatureBase {
  type: 'sweep';
  operation: BodyOperation;
  profiles: ProfileOperand[];
  /** Per path (a second one is a guide rail), the sketch curves it runs along. */
  paths: CurveRef[][];
  /** A path names a body edge (or the profile is a face). */
  pathEdges: boolean;
  /** The bodies it joins, cuts or intersects (body records); empty: none named. */
  participants: number[];
}

export interface F3dPathPattern extends FeatureBase, CopiedObjects, PathPatternSpec {
  type: 'path-pattern';
  count?: ParameterValue;
}

export interface F3dSplit extends FeatureBase {
  type: 'split';
  /** The bodies it splits, by body record. */
  bodies: number[];
  /** Its splitting plane, model space (missing: it splits with a face, not read). */
  plane?: ModelPlane;
}

export interface F3dThread extends FeatureBase {
  type: 'thread';
  spec: ThreadSpec;
  /** The faces it threads, each named by its recipe's first face. */
  faces: F3dFace[];
}

export interface F3dTorus extends FeatureBase {
  type: 'torus';
  operation: BodyOperation;
  /** Model space, cm; the axis a unit direction (its sense does not matter). */
  centre: Vec3;
  axis: Vec3;
  /** The bodies it joins, cuts or intersects (body records); empty: none named. */
  participants: number[];
}

export interface F3dCombine extends FeatureBase, CombineRead {
  type: 'combine';
}

export interface F3dMove extends FeatureBase, MoveRead {
  type: 'move';
}

export interface F3dOther extends FeatureBase {
  type: 'other';
}

export type F3dFeature =
  | F3dSketchFeature
  | F3dExtrude
  | F3dRevolve
  | F3dHole
  | F3dEdgeFeature
  | F3dCircularPattern
  | F3dOffsetFaces
  | F3dDeleteFaces
  | F3dMirror
  | F3dRectangularPattern
  | F3dSweep
  | F3dSplit
  | F3dPathPattern
  | F3dThread
  | F3dTorus
  | F3dCombine
  | F3dMove
  | F3dOther;

/** A body of the design: its number, whether it is shown, the feature that made it. */
export interface F3dBody extends BodyFlags {
  /** The body record. */
  id: number;
  /** The timeline feature that made it, by record. */
  creator?: number;
  /**
   * The operation IDs the operation table maps to the creator: the B-rep's face
   * tags name the faces that feature made by these, so they tell which solid of
   * the body's stream is the body.
   */
  ops?: number[];
  /** The component it is in (component record), when the file says. */
  component?: number;
}

export interface F3dDesign {
  parameters: ParameterValue[];
  userParameters: ParameterValue[];
  features: F3dFeature[];
  bodies: F3dBody[];
  /** The components, the root (the design itself) first. */
  components?: F3dComponent[];
  /** The "Body to Component" items, in timeline order. */
  bodyMoves?: F3dBodyMove[];
  /** Records the reader could not decode, with why. */
  problems: string[];
  /** How many parameter value records failed to decode (their features fall back to defaults). */
  unreadParameters: number;
}

/** Every local reference found in a byte range (by shape, left to right). */
export function refsIn(seg: Segment, start: number, end: number): number[] {
  const r = new Reader(seg.bulk, start, end);
  const out: number[] = [];
  while (r.pos < end) {
    const id = refAhead(seg, r);
    if (id !== undefined) {
      r.ref();
      out.push(id);
    } else r.pos++;
  }
  return out;
}

function firstRefOfType(
  seg: Segment,
  start: number,
  end: number,
  guid: string,
): number | undefined {
  return refsIn(seg, start, end).find((id) => seg.typeOf(id)?.guid === guid);
}

function readPlacement(seg: Segment, id: number): Matrix {
  const r = seg.reader(id);
  r.zeros(2);
  if (r.u8() === 1) return IDENTITY;
  const m: Matrix = [];
  for (let i = 0; i < 16; i++) m.push(r.f64());
  finite(`Placement #${id}`, m);
  return m;
}

/** Reads every design segment of a `.f3d` file; the active design's is read. */
export function readF3d(bytes: Uint8Array): F3dDesign {
  return readF3dEntries(unzip(bytes));
}

/**
 * The design segment to read among an archive's. A file can carry more than
 * one: the active design lives under the asset folder marked `[Active]`, while
 * `Animation/` and `Simulation …/` assets have their own design segments whose
 * timelines are empty. Without an `[Active]` folder, the first segment is the
 * design.
 */
export function activeDesignSegment(segments: SegmentFiles[]): SegmentFiles | undefined {
  return segments.find((s) => s.folder.includes('[Active]/')) ?? segments[0];
}

/** Reads the active design from an archive that is already unzipped. */
export function readF3dEntries(entries: Entries): F3dDesign {
  const first = activeDesignSegment(designSegments(entries));
  if (!first) throw new F3dFormatError('No design in this file.');
  return readSegment(new Segment(first.meta, first.bulk), brepFaces(entries, first.folder));
}

/**
 * The tagged faces of every B-rep stream of the design, the solved ones
 * (`.smb`) first. Keyed by `token@design`.
 */
export function brepFaces(entries: Entries, folder: string): Map<string, AsmFace[]> {
  const asset = folder.slice(0, folder.lastIndexOf('/'));
  const out = new Map<string, AsmFace[]>();
  const names = [...entries.keys()]
    .filter((n) => n.startsWith(`${asset}/Breps.BlobParts/`) && /\.smbh?$/.test(n))
    .sort((a, b) => Number(a.endsWith('h')) - Number(b.endsWith('h')));
  for (const name of names) {
    try {
      for (const face of asmFaces(readAsm(entries.get(name) as Uint8Array))) {
        for (const tag of face.tags) {
          const key = `${tag.token}@${tag.design}`;
          const list = out.get(key) ?? [];
          list.push(face);
          out.set(key, list);
        }
      }
    } catch {
      // a stream this reader does not follow: its faces stay unknown
    }
  }
  return out;
}

export function readSegment(seg: Segment, faces: Map<string, AsmFace[]> = new Map()): F3dDesign {
  const problems: string[] = [];
  const tryDecode = <T>(what: string, f: () => T): T | undefined => {
    try {
      return f();
    } catch (error) {
      problems.push(`${what}: ${(error as Error).message}`);
      return undefined;
    }
  };
  // A record's references, each once and in order, read once: the copying
  // features' walks go several levels deep, and a file may name a record many times.
  const distinctRefs = new Map<number, number[]>();
  const insideOnce = (ref: number): number[] => {
    let refs = distinctRefs.get(ref);
    if (!refs) {
      const f = seg.frame(ref);
      refs = [...new Set(refsIn(seg, f.start, f.end))];
      distinctRefs.set(ref, refs);
    }
    return refs;
  };

  // A record's references, or none (with a problem) when the record can't be
  // framed: one bad record leaves out what names it, not the whole import.
  const refsOf = (id: number): number[] =>
    tryDecode(`record #${id}`, () => {
      const f = seg.frame(id);
      return refsIn(seg, f.start, f.end);
    }) ?? [];

  // Each feature's scope read once, however many times the file names it.
  const scopes = new Map<number, Scope | Error>();
  const scopeOf = (id: number): Scope => {
    let scope = scopes.get(id);
    if (!scope) {
      try {
        scope = readScope(seg, id);
      } catch (error) {
        scope = error as Error;
      }
      scopes.set(id, scope);
    }
    if (scope instanceof Error) throw scope;
    return scope;
  };

  // Parameters, and which feature owns each (owner record → its first reference).
  const parameters: ParameterValue[] = [];
  let unreadParameters = 0;
  for (const id of seg.idsOf(PARAMETER_VALUE)) {
    const p = tryDecode(`parameter #${id}`, () => parameterValue.decode(seg, id));
    if (p) parameters.push(p);
    else unreadParameters++;
  }
  const scopeOfOwner = new Map<number, number>();
  for (const id of seg.idsOf(PARAMETER_OWNER)) {
    const scope = refsOf(id)[0];
    if (scope !== undefined) scopeOfOwner.set(id, scope);
  }
  const byScope = new Map<number, ParameterValue[]>();
  for (const p of parameters) {
    const scope = p.owner !== undefined ? scopeOfOwner.get(p.owner) : undefined;
    if (scope === undefined) continue;
    const list = byScope.get(scope) ?? [];
    list.push(p);
    byScope.set(scope, list);
  }

  // Sketch geometry, grouped by the sketch each record names as its owner.
  const sketches = new Map<number, F3dSketch>();
  const sketchOf = (id: number): F3dSketch => {
    let s = sketches.get(id);
    if (!s) {
      const f = tryDecode(`sketch #${id}`, () => seg.frame(id));
      const placement = f?.base
        ? firstRefOfType(seg, f.base.start, f.base.end, SKETCH_PLACEMENT)
        : undefined;
      const frame =
        placement !== undefined
          ? (tryDecode(`placement #${placement}`, () => readPlacement(seg, placement)) ?? IDENTITY)
          : IDENTITY;
      s = { id, frame, points: [], lines: [], circulars: [], splines: [], texts: [] };
      sketches.set(id, s);
    }
    return s;
  };
  for (const id of seg.idsOf(SKETCH_POINT)) {
    const p = tryDecode(`point #${id}`, () => sketchPoint.decode(seg, id));
    if (p?.owner !== undefined && seg.typeOf(p.owner)?.guid === SKETCH_CONTAINER)
      sketchOf(p.owner).points.push(p);
  }
  for (const id of [...seg.idsOf(SKETCH_LINE), ...seg.idsOf(SKETCH_LINE_ALT)]) {
    const l = tryDecode(`line #${id}`, () => sketchLine.decode(seg, id));
    if (l?.owner !== undefined) sketchOf(l.owner).lines.push(l);
  }
  for (const id of seg.idsOf(SKETCH_CIRCULAR)) {
    const c = tryDecode(`circle #${id}`, () => sketchCircular.decode(seg, id));
    if (c?.owner !== undefined) sketchOf(c.owner).circulars.push(c);
  }
  for (const id of seg.idsOf(SKETCH_SPLINE)) {
    const c = tryDecode(`spline #${id}`, () => sketchSpline.decode(seg, id));
    if (c?.owner !== undefined) sketchOf(c.owner).splines.push(c);
  }
  for (const id of seg.idsOf(SKETCH_TEXT)) {
    const t = tryDecode(`text #${id}`, () => sketchText.decode(seg, id));
    if (t?.owner !== undefined) sketchOf(t.owner).texts.push(t);
  }
  const boxes = oldTextBoxes(seg, refsOf);
  for (const id of seg.idsOf(SKETCH_TEXT_OLD)) {
    const t = tryDecode(`text #${id}`, () => sketchTextOld.decode(seg, id));
    const box = boxes.get(id);
    if (t?.old && box) t.old.box = boxSize(t, box);
    if (t?.owner !== undefined) sketchOf(t.owner).texts.push(t);
  }
  for (const id of seg.idsOf(SKETCH_ELLIPSE)) {
    const e = tryDecode(`ellipse #${id}`, () => sketchEllipse.decode(seg, id));
    if (e?.owner === undefined) continue;
    const s = sketchOf(e.owner);
    s.ellipses ??= [];
    s.ellipses.push(e);
  }
  for (const id of seg.idsOf(SKETCH_CONIC)) {
    const c = tryDecode(`conic #${id}`, () => sketchConic.decode(seg, id));
    if (c?.owner !== undefined) sketchOf(c.owner).splines.push(c);
  }

  // Constraints and dimensions, in the sketch their points and curves are in.
  const geometryOwner = new Map<number, number>();
  for (const s of sketches.values())
    for (const g of [...s.points, ...s.lines, ...s.circulars, ...s.splines, ...(s.ellipses ?? [])])
      geometryOwner.set(g.id, s.id);
  const constraints = readSketchConstraints(seg, parameters, (r) => geometryOwner.get(r), problems);
  for (const [id, c] of constraints) {
    const s = sketches.get(id);
    if (s) Object.assign(s, c);
  }

  // Face tags name the feature that made a face by its operation ID; the
  // operation table maps those IDs to feature records.
  const operations = new Map<number, number[]>();
  const budget = { left: OPERATION_TABLE_BUDGET };
  for (const id of seg.idsOf(OPERATION_TABLE)) {
    const table = tryDecode(`operation table #${id}`, () => readOperationTable(seg, id, budget));
    for (const [op, records] of table ?? []) operations.set(op, records);
  }

  // The timeline, in order.
  // Each item once: a file that repeats an id must not run its decode again.
  const timelineItems = new Set<number>();
  for (const id of seg.idsOf(TIMELINE)) {
    const t = tryDecode(`timeline #${id}`, () => timeline.decode(seg, id));
    for (const item of t?.items ?? []) timelineItems.add(item);
  }
  const items = [...timelineItems];
  // A feature acting in several components keeps a record per component; the
  // timeline names its first.
  const firstRecord = new Map<number, number>();
  for (const id of seg.idsOf(FEATURE_RECORDS))
    for (const [record, first] of tryDecode(`feature records #${id}`, () =>
      readFeatureRecords(seg, id),
    ) ?? [])
      firstRecord.set(record, first);
  const furtherRecords = new Map<number, number[]>();
  for (const [record, first] of firstRecord) {
    const list = furtherRecords.get(first) ?? [];
    list.push(record);
    furtherRecords.set(first, list);
  }
  // An operation can list several records; the timeline feature among them made the face,
  // or the timeline feature whose record in another component it is.
  const onTimeline = timelineItems;
  const featureOf = (design: number): number | undefined =>
    timelineFeature(operations.get(design), onTimeline, firstRecord);
  /** The bodies a feature names, with those its records in other components name. */
  const participantsAll = (scope: Scope): number[] =>
    allParticipants(
      participantsOf(seg, scope),
      (furtherRecords.get(scope.id) ?? []).map((record) => {
        const other = tryDecode(`feature #${record}`, () => scopeOf(record));
        return other ? participantsOf(seg, other) : [];
      }),
    );
  // The body faces a feature names through its operand groups: each face
  // operand's recipe lists the face first, then its neighbours.
  const faceOperands = (scope: Scope): F3dFace[] => {
    const out: F3dFace[] = [];
    for (const group of scope.refs) {
      if (seg.typeOf(group)?.guid !== OPERAND_GROUP) continue;
      for (const recipe of recipesIn(seg, group)) {
        const first = tryDecode(`face #${recipe}`, () => readEdgeRecipe(seg, recipe))?.faces[0];
        if (first) out.push(faceOf(first.tags, faces, featureOf, instances));
      }
    }
    return out;
  };
  // Feature record → the surfaces of the B-rep faces tagged with its operations.
  // `own`: not the copies a mirror or pattern made of them.
  // Indexed once (record → operations, operation → faces), so each call costs
  // what it returns rather than a pass over every operation and face.
  let madeIndex:
    | { ops: Map<number, number[]>; faces: Map<number, AsmFace[]>; order: Map<AsmFace, number> }
    | undefined;
  const madeBy = (record: number, own = false): AsmSurface[] => {
    if (!madeIndex) {
      madeIndex = { ops: new Map(), faces: new Map(), order: new Map() };
      for (const [op, records] of operations)
        for (const r of new Set(records)) {
          const of = madeIndex.ops.get(r) ?? [];
          of.push(op);
          madeIndex.ops.set(r, of);
        }
      for (const list of faces.values())
        for (const face of list) {
          if (madeIndex.order.has(face)) continue;
          madeIndex.order.set(face, madeIndex.order.size);
          for (const op of new Set(face.tags.map((t) => Math.abs(t.design)))) {
            const of = madeIndex.faces.get(op) ?? [];
            of.push(face);
            madeIndex.faces.set(op, of);
          }
        }
    }
    const index = madeIndex;
    const out = new Set<AsmFace>();
    for (const op of index.ops.get(record) ?? [])
      for (const face of index.faces.get(op) ?? [])
        if (!(own && face.tags.some((t) => instances.has(Math.abs(t.design))))) out.add(face);
    return [...out]
      .sort((a, b) => (index.order.get(a) ?? 0) - (index.order.get(b) ?? 0))
      .map((face) => face.surface);
  };
  // Instance operation id → instance code, over every copying feature.
  const instances = new Map<number, number>();
  for (const guid of [MIRROR, RECTANGULAR_PATTERN, CIRCULAR_PATTERN, PATH_PATTERN])
    for (const id of seg.idsOf(guid)) {
      const scope = tryDecode(`feature #${id}`, () => scopeOf(id));
      const found = scope
        ? tryDecode(`instances #${id}`, () => readInstances(seg, scope, insideOnce))
        : undefined;
      for (const [op, code] of found ?? []) instances.set(op, code);
    }
  const features: F3dFeature[] = [];
  for (const id of items) {
    const type = seg.typeOf(id);
    if (!type || !FEATURE_TYPES[type.guid]) {
      const scope = tryDecode(`feature #${id}`, () => scopeOf(id));
      const label = type ? TIMELINE_LABELS[type.guid] : undefined;
      features.push({
        type: 'other',
        id,
        kind: scope?.kind ?? label ?? type?.guid ?? '?',
        name: scope ? nameOf(scope) : (label ?? 'Timeline item'),
        // A body move keeps no history state: none doesn't mean suppressed there.
        suppressed: scope ? scope.state === null && !BODY_MOVES.has(type?.guid ?? '') : false,
        parameters: byScope.get(id) ?? [],
      });
      continue;
    }
    const scope = tryDecode(`feature #${id}`, () => scopeOf(id));
    if (!scope) continue;
    // Sketches have no history state of their own; a feature without one is suppressed.
    const isSketch = FEATURE_TYPES[type.guid] === 'Sketch';
    const base = {
      id,
      kind: scope.kind,
      name: nameOf(scope),
      suppressed: !isSketch && scope.state === null,
      parameters: byScope.get(id) ?? [],
    };
    if (FEATURE_TYPES[type.guid] === 'Sketch') {
      const container = firstRefOfType(seg, scope.start, scope.end, SKETCH_CONTAINER);
      if (container === undefined) {
        problems.push(`sketch #${id}: no sketch container`);
        continue;
      }
      features.push({ type: 'sketch', ...base, sketch: sketchOf(container) });
    } else if (FEATURE_TYPES[type.guid] === 'Extrude') {
      const head = tryDecode(`extrude #${id}`, () => readExtrudeHead(seg, scope));
      if (!head) {
        features.push({ type: 'other', ...base });
        continue;
      }
      const profiles: ProfileOperand[] = [];
      let sketchGone = false;
      for (const ref of scope.refs) {
        const t = seg.typeOf(ref)?.guid;
        if (t === SKETCH_PROFILE_OPERAND) {
          // A deleted sketch is no decoding problem: the extrude is skipped for it.
          const p = tryDecode(`profile #${ref}`, () => {
            try {
              return readProfileOperand(seg, ref);
            } catch (error) {
              if (!(error instanceof SketchGoneError)) throw error;
              sketchGone = true;
              return undefined;
            }
          });
          if (p) profiles.push(p);
        } else if (t === TEXT_PROFILE_OPERAND) {
          const p = tryDecode(`text profile #${ref}`, () => readTextOperand(seg, ref));
          if (p) profiles.push(p);
        }
      }
      // A face operand's recipe lists the face first, then its neighbours.
      const named: F3dFace[] = [];
      for (const group of scope.refs) {
        if (seg.typeOf(group)?.guid !== OPERAND_GROUP) continue;
        for (const recipe of recipesIn(seg, group)) {
          const first = tryDecode(`face #${recipe}`, () => readEdgeRecipe(seg, recipe))?.faces[0];
          if (first) named.push(faceOf(first.tags, faces, featureOf, instances));
        }
      }
      // A start on a plane (an origin or construction plane) rather than a body
      // face: a geometry operand holding the plane in model space.
      const upTo = base.parameters.some((p) => /^Side[12]Offset$/.test(p.kind));
      if (head.start === 'face' && named.length === 0 && !upTo) {
        const plane = tryDecode(`extrude start plane #${id}`, () => startPlane(seg, scope.refs));
        if (plane) named.push(plane);
      }
      features.push({
        type: 'extrude',
        ...base,
        ...head,
        profiles,
        faces: named,
        participants: participantsAll(scope),
        ...(sketchGone ? { sketchGone: true as const } : {}),
      });
    } else if (FEATURE_TYPES[type.guid] === 'Revolve') {
      const operation = tryDecode(`revolve #${id}`, () => readRevolveOperation(seg, scope));
      if (!operation) {
        features.push({ type: 'other', ...base });
        continue;
      }
      const profiles: ProfileOperand[] = [];
      let axis: RevolveAxis | undefined;
      for (const ref of scope.refs) {
        const t = seg.typeOf(ref)?.guid;
        if (t === SKETCH_PROFILE_OPERAND) {
          const p = tryDecode(`profile #${ref}`, () => readProfileOperand(seg, ref));
          if (p) profiles.push(p);
        } else if (t === GEOMETRY_OPERAND && !axis) {
          axis = tryDecode(`axis #${ref}`, () => {
            const f = seg.frame(ref);
            return readAxis(seg, refsIn(seg, f.start, f.end));
          });
        }
      }
      features.push({
        type: 'revolve',
        ...base,
        operation,
        profiles,
        participants: participantsAll(scope),
        ...(axis ? { axis } : {}),
      });
    } else if (FEATURE_TYPES[type.guid] === 'Hole') {
      const centres: Vec3[] = [];
      let plane: ModelPlane | undefined;
      let placed: Vec3 | undefined;
      const inside = refsOf;
      for (const ref of scope.refs) {
        const t = seg.typeOf(ref)?.guid;
        if (t === GEOMETRY_OPERAND)
          for (const q of inside(ref))
            if (seg.typeOf(q)?.guid === MODEL_POINT) {
              const c = tryDecode(`hole centre #${q}`, () => readModelPoint(seg, q));
              if (c) centres.push(c);
            }
        if (t === HOLE_PLACEMENT && !plane) {
          for (const g of inside(ref))
            if (seg.typeOf(g)?.guid === GEOMETRY_OPERAND)
              for (const q of inside(g))
                if (seg.typeOf(q)?.guid === MODEL_PLANE)
                  plane ??= tryDecode(`hole plane #${q}`, () => readModelPlane(seg, q));
          // A body face instead: the placement's point and normal, where the face the
          // recipe names is a plane through that point square to that normal.
          const at = plane
            ? undefined
            : tryDecode(`hole placement #${ref}`, () => readHolePlacement(seg, ref));
          if (at) {
            const recipe = recipesIn(seg, ref)[0];
            const first =
              recipe === undefined
                ? undefined
                : tryDecode(`face #${recipe}`, () => readEdgeRecipe(seg, recipe))?.faces[0];
            const s = first ? faceOf(first.tags, faces, featureOf, instances).surface : undefined;
            if (s?.kind === 'plane' && onPlane(s, at.point, at.normal)) {
              plane = planeThrough(at.point, at.normal);
              placed = at.point;
            }
          }
        }
      }
      // Placed by distances to edges: no centre point; its own cylinders show where
      // (else the placement's point, on a body face).
      const diameter = base.parameters.find((p) => p.kind === 'HoleDiameter')?.value;
      if (centres.length === 0 && plane && diameter)
        centres.push(...centresFromCylinders(madeBy(id, true), plane, diameter / 2));
      if (centres.length === 0 && placed) centres.push(placed);
      const flipped = readHoleFlipped(seg, scope);
      features.push({ type: 'hole', ...base, centres, flipped, ...(plane ? { plane } : {}) });
    } else if (FEATURE_TYPES[type.guid] === 'CircularPattern') {
      const inside = refsOf;
      const repeated: number[] = [];
      let objects: F3dCircularPattern['objects'] = 'features';
      let axis: RevolveAxis | undefined;
      let count: ParameterValue | undefined;
      for (const ref of scope.refs) {
        const t = seg.typeOf(ref)?.guid;
        if (t === GEOMETRY_OPERAND) {
          const refs = inside(ref);
          // A feature it repeats names the body it acted on; the axis does not.
          if (refs.some((r) => seg.typeOf(r)?.guid === BODY_LINK)) {
            for (const r of refs)
              if (seg.typeOf(r)?.guid === RECORD_REF) {
                const record = tryDecode(`record #${r}`, () => readRecordRef(seg, r));
                if (record !== undefined && !repeated.includes(record)) repeated.push(record);
              }
          } else axis ??= tryDecode(`axis #${ref}`, () => readAxis(seg, refs));
        } else if (t === PATTERN_COUNT) {
          const value = inside(ref).find((r) => seg.typeOf(r)?.guid === PARAMETER_VALUE);
          if (value !== undefined)
            count ??= tryDecode(`count #${value}`, () => parameterValue.decode(seg, value));
        } else if (t === EDGE_OPERAND || t === BODY_OPERAND) objects = 'faces';
      }
      features.push({
        type: 'circular-pattern',
        ...base,
        objects,
        features: repeated,
        ...(axis ? { axis } : {}),
        ...(count ? { count } : {}),
      });
    } else if (FEATURE_TYPES[type.guid] === 'OffsetFaces') {
      // Its face operands sit in an operand group; each recipe names the face first.
      const distance = base.parameters.find((p) => p.kind === 'distance');
      features.push({
        type: 'offset-faces',
        ...base,
        faces: faceOperands(scope),
        ...(distance ? { distance } : {}),
      });
    } else if (FEATURE_TYPES[type.guid] === 'DeleteFaces') {
      // Like Offset faces: an operand group of face operands, each recipe naming
      // the face first. No distance (nothing else understood: FORMAT.md).
      features.push({ type: 'delete-faces', ...base, faces: faceOperands(scope) });
    } else if (FEATURE_TYPES[type.guid] === 'Mirror') {
      const inside = insideOnce;
      const copied = tryDecode(`mirror #${id}`, () => readCopied(seg, scope, inside));
      if (!copied) {
        features.push({ type: 'other', ...base });
        continue;
      }
      const plane = tryDecode(`mirror plane #${id}`, () => readMirrorPlane(seg, scope, inside));
      features.push({ type: 'mirror', ...base, ...copied, ...(plane ? { plane } : {}) });
    } else if (FEATURE_TYPES[type.guid] === 'RectangularPattern') {
      const inside = insideOnce;
      const copied = tryDecode(`pattern #${id}`, () => readCopied(seg, scope, inside));
      if (!copied) {
        features.push({ type: 'other', ...base });
        continue;
      }
      features.push({
        type: 'rectangular-pattern',
        ...base,
        ...copied,
        directions: tryDecode(`directions #${id}`, () => readDirections(seg, scope, inside)) ?? [],
        counts: tryDecode(`counts #${id}`, () => readCounts(seg, scope, inside)) ?? [],
      });
    } else if (FEATURE_TYPES[type.guid] === 'Thread') {
      const spec = tryDecode(`thread #${id}`, () => readThreadSpec(seg, scope));
      const threaded: F3dFace[] = [];
      for (const group of scope.refs) {
        if (seg.typeOf(group)?.guid !== OPERAND_GROUP) continue;
        for (const recipe of tryDecode(`thread faces #${group}`, () => recipesIn(seg, group)) ??
          []) {
          const first = tryDecode(`face #${recipe}`, () => readEdgeRecipe(seg, recipe))?.faces[0];
          if (first) threaded.push(faceOf(first.tags, faces, featureOf, instances));
        }
      }
      if (spec) features.push({ type: 'thread', ...base, spec, faces: threaded });
      else features.push({ type: 'other', ...base });
    } else if (FEATURE_TYPES[type.guid] === 'PathPattern') {
      const inside = insideOnce;
      const spec = tryDecode(`path pattern #${id}`, () => readPathPattern(seg, scope, inside));
      const count = tryDecode(`count #${id}`, () => readCounts(seg, scope, inside))?.[0];
      const copied = tryDecode(`path pattern #${id}`, () => readCopied(seg, scope, inside));
      if (spec && copied)
        features.push({
          type: 'path-pattern',
          ...base,
          ...copied,
          ...spec,
          ...(count ? { count } : {}),
        });
      else features.push({ type: 'other', ...base });
    } else if (FEATURE_TYPES[type.guid] === 'Split') {
      const inside = insideOnce;
      const bodies = tryDecode(`split #${id}`, () => readCopied(seg, scope, inside))?.bodies;
      if (!bodies) {
        features.push({ type: 'other', ...base });
        continue;
      }
      const plane = tryDecode(`split plane #${id}`, () => readMirrorPlane(seg, scope, inside));
      features.push({ type: 'split', ...base, bodies, ...(plane ? { plane } : {}) });
    } else if (FEATURE_TYPES[type.guid] === 'Sweep') {
      const operation = tryDecode(`sweep #${id}`, () => readSweepOperation(seg, scope));
      if (!operation) {
        features.push({ type: 'other', ...base });
        continue;
      }
      const inside = insideOnce;
      const profiles: ProfileOperand[] = [];
      for (const group of scope.refs)
        if (seg.typeOf(group)?.guid === OPERAND_GROUP)
          for (const ref of tryDecode(`sweep #${id}`, () => inside(group)) ?? [])
            if (seg.typeOf(ref)?.guid === SKETCH_PROFILE_OPERAND) {
              const p = tryDecode(`profile #${ref}`, () => readProfileOperand(seg, ref));
              if (p) profiles.push(p);
            }
      const read = tryDecode(`sweep #${id}`, () => ({
        ...readPaths(seg, scope, inside),
        participants: participantsAll(scope),
      }));
      if (!read) {
        features.push({ type: 'other', ...base });
        continue;
      }
      features.push({
        type: 'sweep',
        ...base,
        operation,
        profiles,
        paths: read.paths,
        pathEdges: read.edges,
        participants: read.participants,
      });
    } else if (FEATURE_TYPES[type.guid] === 'Fillet' || FEATURE_TYPES[type.guid] === 'Chamfer') {
      const kind = FEATURE_TYPES[type.guid] === 'Fillet' ? 'fillet' : 'chamfer';
      const sets = tryDecode(`${kind} #${id}`, () =>
        readEdgeSets(seg, scope, base.parameters, kind, faces, featureOf, instances),
      );
      if (!sets) features.push({ type: 'other', ...base });
      else {
        const made = madeBy(id);
        features.push({ type: kind, ...base, sets, ...(made.length > 0 ? { made } : {}) });
      }
    } else if (FEATURE_TYPES[type.guid] === 'Combine') {
      const combine = tryDecode(`combine #${id}`, () => readCombine(seg, scope, insideOnce));
      features.push(
        combine ? { type: 'combine', ...base, ...combine } : { type: 'other', ...base },
      );
    } else if (FEATURE_TYPES[type.guid] === 'Move') {
      const move = tryDecode(`move #${id}`, () => readMove(seg, scope, insideOnce));
      features.push(move ? { type: 'move', ...base, ...move } : { type: 'other', ...base });
    } else if (FEATURE_TYPES[type.guid] === 'TorusPrimitive') {
      const torus = tryDecode(`torus #${id}`, () =>
        readTorus(seg, scope, madeBy(id), insideOnce, participantsAll(scope)),
      );
      features.push(torus ? { type: 'torus', ...base, ...torus } : { type: 'other', ...base });
    } else features.push({ type: 'other', ...base });
  }

  // Bodies, and the feature that made each (from the links features keep to them).
  const creators = new Map<number, number>();
  for (const id of seg.idsOf(BODY_LINK)) {
    const refs = refsOf(id);
    const at = refs.findIndex((r) => seg.typeOf(r)?.guid === BODY);
    const body = refs[at];
    const by = refs[at + 1];
    if (body !== undefined && by !== undefined && !creators.has(body)) creators.set(body, by);
  }
  // Record → the operation IDs that name it, for the creators' face tags.
  const opsOf = new Map<number, number[]>();
  // Each operation is one map key, so a record collects an operation once.
  for (const [op, records] of operations)
    for (const r of new Set(records)) {
      const list = opsOf.get(r) ?? [];
      list.push(op);
      opsOf.set(r, list);
    }
  const bodies: F3dBody[] = [];
  for (const id of seg.idsOf(BODY)) {
    const flags = tryDecode(`body #${id}`, () => readBody(seg, id));
    if (!flags) continue;
    const creator = creators.get(id);
    const ops = creator !== undefined ? opsOf.get(creator) : undefined;
    bodies.push({
      id,
      ...flags,
      ...(creator !== undefined ? { creator } : {}),
      ...(ops ? { ops: [...ops] } : {}),
    });
  }

  // Components: which one each feature and body belongs to, and the bodies moved between them.
  const tree = tryDecode('components', () => readComponents(seg));
  const bodyMoves: F3dBodyMove[] = [];
  if (tree) {
    for (const f of features) {
      const component = tryDecode(`feature #${f.id}`, () => componentOfFeature(seg, tree, f.id));
      if (component !== undefined) f.component = component;
      if (BODY_MOVES.has(seg.typeOf(f.id)?.guid ?? '')) {
        const move = tryDecode(`body move #${f.id}`, () => readBodyMove(seg, tree, f.id));
        if (move) bodyMoves.push(move);
      }
    }
    for (const b of bodies) {
      const component = tryDecode(`body #${b.id}`, () => componentOfBody(seg, tree, b.id));
      if (component !== undefined) b.component = component;
    }
  }

  return {
    parameters,
    userParameters: parameters.filter((p) => p.user),
    features,
    bodies,
    ...(tree ? { components: tree.components } : {}),
    bodyMoves,
    problems,
    unreadParameters,
  };
}

/**
 * The operation table: after the prologue, one or two lists, the last of
 * which maps operation IDs to records — u32 n × (u64 operation, u64 record),
 * or in newer files u32 n × (u64 operation, u32 m, m × u64 records) — then
 * u32 k, k × u64 (not read) and the closing reference. Found by shape: the
 * longest list that the trailer ends exactly and whose records exist, but
 * for a few (an operation can name a record the file no longer has).
 */
const OPERATION_TABLE_BUDGET = 1_000_000;

/**
 * The entry reads the operation-table search may take over a whole segment
 * (`budget.left` counts down across its tables).
 */
function readOperationTable(
  seg: Segment,
  id: number,
  budget: { left: number },
): Map<number, number[]> {
  const f = seg.frame(id);
  const endsHere = (r: Reader): boolean => {
    if (r.remaining < 4) return false;
    const k = r.u32();
    if (k * 8 > r.remaining) return false;
    r.skip(8 * k);
    return r.ref() !== null && r.done;
  };
  let best: Map<number, number[]> | undefined;
  let size = -1;
  // Every offset is tried, so the entries read across them are budgeted: the
  // files' tables cost at most about 1,300 entry reads, a crafted record could
  // cost its length squared.
  for (let at = f.start; at + 4 <= f.end; at++) {
    for (const lists of [false, true]) {
      const r = new Reader(seg.bulk, at, f.end);
      const n = r.u32();
      if (n <= size || n * 16 > r.remaining) continue;
      try {
        const table = new Map<number, number[]>();
        let ok = true;
        let missing = 0;
        for (let i = 0; i < n && ok; i++) {
          if (--budget.left < 0)
            throw new F3dFormatError('the operation table takes too long to find');
          const op = r.u64();
          const m = lists ? r.u32() : 1;
          if (m === 0 || m * 8 > r.remaining) ok = false;
          const records: number[] = [];
          for (let j = 0; j < m && ok; j++) records.push(r.u64());
          const found = records.filter((x) => seg.has(x));
          if (found.length < records.length) missing++;
          ok &&= 4 * missing <= n;
          table.set(op, found);
        }
        if (ok && endsHere(r)) {
          best = table;
          size = n;
        }
      } catch (error) {
        if (budget.left < 0) throw error;
        // not a table at this offset
      }
    }
  }
  if (!best) throw new F3dFormatError('no operation table found');
  return best;
}

/**
 * A text-profile operand: its sketch, by record number as a sketch-profile
 * operand names it, and the text, by a record reference (`90055C05…`).
 */
function readTextOperand(seg: Segment, id: number): ProfileOperand {
  const { sketch } = readProfileOperand(seg, id);
  const f = seg.frame(id);
  for (const r of refsIn(seg, f.start, f.end))
    if (seg.typeOf(r)?.guid === RECORD_REF) {
      const text = readRecordRef(seg, r);
      const kind = seg.typeOf(text)?.guid;
      if (kind === SKETCH_TEXT || kind === SKETCH_TEXT_OLD) return { id, sketch, text };
    }
  throw new F3dFormatError(`Text profile #${id}: no text of this kind.`);
}

/**
 * A torus primitive's operation, place and bodies: its matrix taken from the
 * frame of the plane its geometry operand holds. Where the B-rep keeps a
 * torus the feature made, one of them must be on that centre and axis, or
 * the reading is refused.
 */
function readTorus(
  seg: Segment,
  scope: Scope,
  made: AsmSurface[],
  inside: (id: number) => number[],
  participants: number[],
): Omit<F3dTorus, keyof FeatureBase | 'type'> {
  const { operation, matrix } = readTorusHead(seg, scope);
  const operand = scope.refs.find((r) => seg.typeOf(r)?.guid === GEOMETRY_OPERAND);
  const record =
    operand === undefined
      ? undefined
      : inside(operand).find((q) => seg.typeOf(q)?.guid === MODEL_PLANE);
  if (record === undefined) throw new F3dFormatError(`Torus #${scope.id}: no plane.`);
  const placed = torusPlacement(readModelPlane(seg, record), matrix);
  if (!placed) throw new F3dFormatError(`Torus #${scope.id}: its plane or axis is degenerate.`);
  const { centre: C, axis: A } = placed;
  const tori = made.filter((s) => s.kind === 'torus');
  const same = (s: (typeof tori)[number]) =>
    Math.hypot(s.center[0] - C[0], s.center[1] - C[1], s.center[2] - C[2]) < 1e-6 &&
    Math.abs(Math.abs(s.axis[0] * A[0] + s.axis[1] * A[1] + s.axis[2] * A[2]) - 1) < 1e-6;
  if (tori.length > 0 && !tori.some(same))
    throw new F3dFormatError(`Torus #${scope.id}: its B-rep torus is elsewhere.`);
  return { operation, centre: C, axis: A, participants };
}

/**
 * The bodies a feature's operand groups name through body operands, by body
 * record (a body link names the body record first).
 */
function participantsOf(seg: Segment, scope: Scope): number[] {
  const out: number[] = [];
  const inside = (id: number) => {
    const f = seg.frame(id);
    return refsIn(seg, f.start, f.end);
  };
  for (const group of scope.refs) {
    if (seg.typeOf(group)?.guid !== OPERAND_GROUP) continue;
    for (const member of inside(group)) {
      if (seg.typeOf(member)?.guid !== BODY_OPERAND) continue;
      for (const link of inside(member)) {
        if (seg.typeOf(link)?.guid !== BODY_LINK) continue;
        const body = inside(link).find((r) => seg.typeOf(r)?.guid === BODY);
        if (body !== undefined && !out.includes(body)) out.push(body);
      }
    }
  }
  return out;
}

/** The recipes an operand group's edge or face operands point to. */
function recipesIn(seg: Segment, group: number): number[] {
  const f = seg.frame(group);
  const out: number[] = [];
  for (const member of refsIn(seg, f.start, f.end)) {
    if (seg.typeOf(member)?.guid !== EDGE_OPERAND) continue;
    const m = seg.frame(member);
    const recipe = refsIn(seg, m.start, m.end).find((r) => seg.typeOf(r)?.guid === EDGE_RECIPE);
    if (recipe !== undefined) out.push(recipe);
  }
  return out;
}

/** A B-rep plane through `p` (cm) square to the unit `n`, either way round, within 1e-6. */
function onPlane(s: { point: Vec3; normal: Vec3 }, p: Vec3, n: Vec3): boolean {
  const len = Math.hypot(...s.normal);
  if (!(len > 1e-12)) return false;
  const along = (s.normal[0] * n[0] + s.normal[1] * n[1] + s.normal[2] * n[2]) / len;
  const off = (p[0] - s.point[0]) * n[0] + (p[1] - s.point[1]) * n[1] + (p[2] - s.point[2]) * n[2];
  return Math.abs(Math.abs(along) - 1) < 1e-6 && Math.abs(off) < 1e-6;
}

/** A face named by its tags: the feature that made it and, from the B-rep, its surface. */
function faceOf(
  tags: FaceTag[],
  faces: Map<string, AsmFace[]>,
  featureOf: (design: number) => number | undefined,
  instances?: Map<number, number>,
): F3dFace {
  const first = tags[0];
  const design = first ? Math.abs(first.designs[0] ?? -1) : -1;
  const out: F3dFace = { tags };
  const feature = design >= 0 ? featureOf(design) : undefined;
  if (feature !== undefined) out.feature = feature;
  const [, patternOp = -1, instanceOp = -1] = first?.designs ?? [];
  const code = patternOp > 0 && instanceOp > 0 ? instances?.get(instanceOp) : undefined;
  const pattern = code !== undefined ? featureOf(patternOp) : undefined;
  const candidates = first ? (faces.get(`${first.token}@${design}`) ?? []) : [];
  if (code !== undefined && pattern !== undefined) {
    // A copy: named after the face it copies, whose surface is the one without the pattern's tag.
    out.instance = { pattern, code };
    const source = candidates.find((f) => !f.tags.some((t) => t.design === patternOp));
    if (source) out.surface = source.surface;
    const own = candidates.find((f) => f.tags.some((t) => t.design === instanceOp));
    if (own) out.own = own.surface;
    return out;
  }
  const states = statesOf(tags, candidates);
  const [found] = states;
  if (found) out.surface = found.surface;
  const solved = candidates[0];
  if (solved && solved !== found) out.solved = solved.surface;
  const seen = new Set(found ? [JSON.stringify(found.surface)] : []);
  const others: AsmSurface[] = [];
  for (const state of states) {
    const key = JSON.stringify(state.surface);
    if (state.surface.kind === 'other' || seen.has(key)) continue;
    seen.add(key);
    others.push(state.surface);
  }
  if (others.length > 0) out.states = others;
  return out;
}

/**
 * A face's states the B-rep streams hold, the one a reference means first. A
 * face keeps a tag per operation that made or later changed it (an offset, a
 * deletion beside it); a recipe's tags list those the face had when the
 * feature picked it, and the streams keep earlier states of the body next to
 * the solved one. The state whose tags differ least from the recipe's is the
 * face as the feature saw it (a later offset may have moved the solved one);
 * on a tie the first, the solved body's. States with a surface this reader
 * knows come first.
 */
function statesOf(tags: FaceTag[], candidates: AsmFace[]): AsmFace[] {
  if (candidates.length < 2) return candidates;
  const want = new Set(tags.flatMap((t) => t.designs.map((d) => `${t.token}@${d}`)));
  const apart = (c: AsmFace) => {
    const have = new Set(c.tags.map((t) => `${t.token}@${t.design}`));
    let n = c.surface.kind === 'other' ? candidates.length * 1e6 : 0;
    for (const k of have) if (!want.has(k)) n++;
    for (const k of want) if (!have.has(k)) n++;
    return n;
  };
  return candidates
    .map((c, i) => ({ c, i, n: apart(c) }))
    .sort((a, b) => a.n - b.n || a.i - b.i)
    .map(({ c }) => c);
}

function nameOf(scope: Scope): string {
  return scope.label ?? `${scope.kind}${scope.ordinal}`;
}

/**
 * A fillet's or chamfer's edge sets: one construction-operand group per set,
 * in reference-table order, paired with the size parameters in order
 * (a fillet: a tangency weight and a radius per set; a chamfer: its distance,
 * or two sizes).
 */
function readEdgeSets(
  seg: Segment,
  scope: Scope,
  parameters: ParameterValue[],
  kind: 'fillet' | 'chamfer',
  faces: Map<string, AsmFace[]>,
  featureOf: (design: number) => number | undefined,
  instances: Map<number, number>,
): F3dEdgeSet[] {
  const groups = scope.refs.filter((r) => seg.typeOf(r)?.guid === OPERAND_GROUP);
  const sizes = [...parameters]
    .sort((a, b) => a.number - b.number)
    .filter((p) => (kind === 'fillet' ? p.kind === 'Radius' : p.kind !== 'TangencyWeight'));
  const face = (tags: FaceTag[]) => faceOf(tags, faces, featureOf, instances);
  /** The B-rep key of the face a recipe's tags name: a copy's own face, else the face itself. */
  const keyOf = (tags: FaceTag[]): string | undefined => {
    const t = tags[0];
    if (!t) return undefined;
    const [design = -1, pattern = -1, instance = -1] = t.designs;
    return pattern > 0 && instance > 0 && instances.has(instance)
      ? `${t.token}@${instance}`
      : `${t.token}@${Math.abs(design)}`;
  };
  const knownBetween = (a: FaceTag[], b: FaceTag[]): KnownEdge[] => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (!ka || !kb) return [];
    const out = new Map<string, KnownEdge>();
    for (const f of faces.get(ka) ?? [])
      for (const e of f.edges) {
        if (!e.across.some((t) => `${t.token}@${t.design}` === kb)) continue;
        const key = `${e.curve.kind}:${e.points
          .map((p) => p.map((x) => x.toFixed(6)).join(','))
          .sort()
          .join(' ')}`;
        if (!out.has(key)) out.set(key, { curve: e.curve, points: e.points });
      }
    return [...out.values()];
  };
  const perSet = kind === 'chamfer' && sizes.length >= 2 * groups.length ? 2 : 1;
  return groups.map((group, i) => {
    const edges: F3dEdge[] = [];
    for (const recipeId of recipesIn(seg, group)) {
      const recipe = edgeFaces(readEdgeRecipe(seg, recipeId).faces);
      if (!recipe) continue;
      const [a, b] = recipe.support;
      const edge: F3dEdge = {
        faces: [face(a.tags), face(b.tags)],
        bounds: recipe.bounds.map((x) => face(x.tags)),
      };
      const known = knownBetween(a.tags, b.tags);
      if (known.length > 0) edge.known = known;
      edges.push(edge);
    }
    const set: F3dEdgeSet = { edges };
    const size = sizes[i * perSet];
    if (size) set.size = size;
    const size2 = perSet === 2 ? sizes[i * perSet + 1] : undefined;
    if (size2) set.size2 = size2;
    return set;
  });
}

/**
 * An extrude's start plane (an origin or construction plane, not a body face):
 * the plane in model space a geometry operand among its references holds, as a
 * face with no tags; undefined when there is none or its axes span no plane.
 */
export function startPlane(seg: Segment, refs: number[]): F3dFace | undefined {
  for (const ref of refs) {
    if (seg.typeOf(ref)?.guid !== GEOMETRY_OPERAND) continue;
    const f = seg.frame(ref);
    const plane = refsIn(seg, f.start, f.end).find((q) => seg.typeOf(q)?.guid === MODEL_PLANE);
    if (plane === undefined) continue;
    const at = readModelPlane(seg, plane);
    const normal = planeNormal(at);
    return normal ? { tags: [], surface: { kind: 'plane', point: at.origin, normal } } : undefined;
  }
  return undefined;
}

/** A model plane's unit normal, x × y; undefined when its axes span no plane. */
function planeNormal({ x, y }: ModelPlane): [number, number, number] | undefined {
  const n: [number, number, number] = [
    x[1] * y[2] - x[2] * y[1],
    x[2] * y[0] - x[0] * y[2],
    x[0] * y[1] - x[1] * y[0],
  ];
  const l = Math.hypot(...n);
  if (!(l > 1e-9)) return undefined;
  return [n[0] / l, n[1] / l, n[2] / l];
}
