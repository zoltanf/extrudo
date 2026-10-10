/**
 * The decoded design: the records of a design segment assembled into the
 * things a person sees in Fusion's timeline — parameters, sketches with their
 * plane and geometry, and features with their inputs. Lengths stay in
 * Fusion's internal centimetres here; the mapper converts.
 */
import { designSegments, type Entries, unzip } from './archive';
import { type AsmFace, type AsmSurface, asmFaces, readAsm } from './asm';
import { F3dFormatError, Reader } from './bytes';
import { BODY, type BodyFlags, readBody } from './decode/body';
import {
  EDGE_OPERAND,
  EDGE_RECIPE,
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
} from './decode/extrude';
import {
  HOLE_PLACEMENT,
  MODEL_PLANE,
  MODEL_POINT,
  type ModelPlane,
  readHoleFlipped,
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
  SKETCH_LINE,
  SKETCH_POINT,
  SKETCH_SPLINE,
  type SketchCircular,
  type SketchLine,
  type SketchPoint,
  type SketchSpline,
  sketchCircular,
  sketchConic,
  sketchLine,
  sketchPoint,
  sketchSpline,
  type Vec3,
} from './decode/sketch-geometry';
import { SKETCH_TEXT, type SketchText, sketchText, TEXT_PROFILE_OPERAND } from './decode/text';
import { TIMELINE, timeline } from './decode/timeline';
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
}

/** A face an edge lies on: its tags, and what the B-rep says it is. */
export interface F3dFace {
  tags: FaceTag[];
  /** The timeline feature that made the face (from its first tag). */
  feature?: number;
  /** The face's surface in model space, cm, when the B-rep still has it. */
  surface?: AsmSurface;
}

/** An edge, as the two faces it runs between and the faces that end it. */
export interface F3dEdge {
  faces: [F3dFace, F3dFace];
  bounds: F3dFace[];
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
  | F3dOther;

/** A body of the design: its number, whether it is shown, the feature that made it. */
export interface F3dBody extends BodyFlags {
  /** The body record. */
  id: number;
  /** The timeline feature that made it, by record. */
  creator?: number;
}

export interface F3dDesign {
  parameters: ParameterValue[];
  userParameters: ParameterValue[];
  features: F3dFeature[];
  bodies: F3dBody[];
  /** Records the reader could not decode, with why. */
  problems: string[];
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
  return m;
}

/** Reads every design segment of a `.f3d` file; the first is the design. */
export function readF3d(bytes: Uint8Array): F3dDesign {
  const entries = unzip(bytes);
  const segments = designSegments(entries);
  const first = segments[0];
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

  // Parameters, and which feature owns each (owner record → its first reference).
  const parameters: ParameterValue[] = [];
  for (const id of seg.idsOf(PARAMETER_VALUE)) {
    const p = tryDecode(`parameter #${id}`, () => parameterValue.decode(seg, id));
    if (p) parameters.push(p);
  }
  const scopeOfOwner = new Map<number, number>();
  for (const id of seg.idsOf(PARAMETER_OWNER)) {
    const f = seg.frame(id);
    const scope = refsIn(seg, f.start, f.end)[0];
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
      const f = seg.frame(id);
      const placement = f.base
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
  for (const id of seg.idsOf(SKETCH_LINE)) {
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
  for (const id of seg.idsOf(SKETCH_CONIC)) {
    const c = tryDecode(`conic #${id}`, () => sketchConic.decode(seg, id));
    if (c?.owner !== undefined) sketchOf(c.owner).splines.push(c);
  }

  // Face tags name the feature that made a face by its operation ID; the
  // operation table maps those IDs to feature records.
  const operations = new Map<number, number[]>();
  for (const id of seg.idsOf(OPERATION_TABLE)) {
    const table = tryDecode(`operation table #${id}`, () => readOperationTable(seg, id));
    for (const [op, records] of table ?? []) operations.set(op, records);
  }

  // The timeline, in order.
  const items: number[] = [];
  for (const id of seg.idsOf(TIMELINE)) {
    const t = tryDecode(`timeline #${id}`, () => timeline.decode(seg, id));
    if (t) items.push(...t.items);
  }
  // An operation can list several records; the timeline feature among them made the face.
  const onTimeline = new Set(items);
  const featureOf = (design: number): number | undefined => {
    const records = operations.get(design);
    return records?.find((r) => onTimeline.has(r)) ?? records?.[0];
  };
  const features: F3dFeature[] = [];
  for (const id of items) {
    const type = seg.typeOf(id);
    if (!type || !FEATURE_TYPES[type.guid]) {
      const scope = tryDecode(`feature #${id}`, () => readScope(seg, id));
      const label = type ? TIMELINE_LABELS[type.guid] : undefined;
      features.push({
        type: 'other',
        id,
        kind: scope?.kind ?? label ?? type?.guid ?? '?',
        name: scope ? nameOf(scope) : (label ?? 'Timeline item'),
        suppressed: scope ? scope.state === null : false,
        parameters: byScope.get(id) ?? [],
      });
      continue;
    }
    const scope = tryDecode(`feature #${id}`, () => readScope(seg, id));
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
      for (const ref of scope.refs) {
        const t = seg.typeOf(ref)?.guid;
        if (t === SKETCH_PROFILE_OPERAND) {
          const p = tryDecode(`profile #${ref}`, () => readProfileOperand(seg, ref));
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
          if (first) named.push(faceOf(first.tags, faces, featureOf));
        }
      }
      features.push({
        type: 'extrude',
        ...base,
        ...head,
        profiles,
        faces: named,
        participants: participantsOf(seg, scope),
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
          const f = seg.frame(ref);
          axis = tryDecode(`axis #${ref}`, () => readAxis(seg, refsIn(seg, f.start, f.end)));
        }
      }
      features.push({
        type: 'revolve',
        ...base,
        operation,
        profiles,
        participants: participantsOf(seg, scope),
        ...(axis ? { axis } : {}),
      });
    } else if (FEATURE_TYPES[type.guid] === 'Hole') {
      const centres: Vec3[] = [];
      let plane: ModelPlane | undefined;
      const inside = (ref: number) => {
        const f = seg.frame(ref);
        return refsIn(seg, f.start, f.end);
      };
      for (const ref of scope.refs) {
        const t = seg.typeOf(ref)?.guid;
        if (t === GEOMETRY_OPERAND)
          for (const q of inside(ref))
            if (seg.typeOf(q)?.guid === MODEL_POINT) {
              const c = tryDecode(`hole centre #${q}`, () => readModelPoint(seg, q));
              if (c) centres.push(c);
            }
        if (t === HOLE_PLACEMENT && !plane)
          for (const g of inside(ref))
            if (seg.typeOf(g)?.guid === GEOMETRY_OPERAND)
              for (const q of inside(g))
                if (seg.typeOf(q)?.guid === MODEL_PLANE)
                  plane ??= tryDecode(`hole plane #${q}`, () => readModelPlane(seg, q));
      }
      const flipped = readHoleFlipped(seg, scope);
      features.push({ type: 'hole', ...base, centres, flipped, ...(plane ? { plane } : {}) });
    } else if (FEATURE_TYPES[type.guid] === 'CircularPattern') {
      const inside = (ref: number) => {
        const f = seg.frame(ref);
        return refsIn(seg, f.start, f.end);
      };
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
      const moved: F3dFace[] = [];
      for (const group of scope.refs) {
        if (seg.typeOf(group)?.guid !== OPERAND_GROUP) continue;
        for (const recipe of recipesIn(seg, group)) {
          const first = tryDecode(`face #${recipe}`, () => readEdgeRecipe(seg, recipe))?.faces[0];
          if (first) moved.push(faceOf(first.tags, faces, featureOf));
        }
      }
      const distance = base.parameters.find((p) => p.kind === 'distance');
      features.push({
        type: 'offset-faces',
        ...base,
        faces: moved,
        ...(distance ? { distance } : {}),
      });
    } else if (FEATURE_TYPES[type.guid] === 'Fillet' || FEATURE_TYPES[type.guid] === 'Chamfer') {
      const kind = FEATURE_TYPES[type.guid] === 'Fillet' ? 'fillet' : 'chamfer';
      const sets = tryDecode(`${kind} #${id}`, () =>
        readEdgeSets(seg, scope, base.parameters, kind, faces, featureOf),
      );
      if (sets) features.push({ type: kind, ...base, sets });
      else features.push({ type: 'other', ...base });
    } else features.push({ type: 'other', ...base });
  }

  // Bodies, and the feature that made each (from the links features keep to them).
  const creators = new Map<number, number>();
  for (const id of seg.idsOf(BODY_LINK)) {
    const f = seg.frame(id);
    const refs = refsIn(seg, f.start, f.end);
    const at = refs.findIndex((r) => seg.typeOf(r)?.guid === BODY);
    const body = refs[at];
    const by = refs[at + 1];
    if (body !== undefined && by !== undefined && !creators.has(body)) creators.set(body, by);
  }
  const bodies: F3dBody[] = [];
  for (const id of seg.idsOf(BODY)) {
    const flags = tryDecode(`body #${id}`, () => readBody(seg, id));
    if (!flags) continue;
    const creator = creators.get(id);
    bodies.push({ id, ...flags, ...(creator !== undefined ? { creator } : {}) });
  }

  return {
    parameters,
    userParameters: parameters.filter((p) => p.user),
    features,
    bodies,
    problems,
  };
}

/**
 * The operation table: after the prologue, one or two lists, the last of
 * which maps operation IDs to records — u32 n × (u64 operation, u64 record),
 * or in newer files u32 n × (u64 operation, u32 m, m × u64 records) — then
 * u32 k, k × u64 (not read) and the closing reference. Found by shape: the
 * longest list whose records all exist and that the trailer ends exactly.
 */
function readOperationTable(seg: Segment, id: number): Map<number, number[]> {
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
  for (let at = f.start; at + 4 <= f.end; at++) {
    for (const lists of [false, true]) {
      const r = new Reader(seg.bulk, at, f.end);
      const n = r.u32();
      if (n <= size || n * 16 > r.remaining) continue;
      try {
        const table = new Map<number, number[]>();
        let ok = true;
        for (let i = 0; i < n && ok; i++) {
          const op = r.u64();
          const m = lists ? r.u32() : 1;
          if (m === 0 || m * 8 > r.remaining) ok = false;
          const records: number[] = [];
          for (let j = 0; j < m && ok; j++) records.push(r.u64());
          ok &&= records.every((x) => seg.has(x));
          table.set(op, records);
        }
        if (ok && endsHere(r)) {
          best = table;
          size = n;
        }
      } catch {
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
      if (seg.typeOf(text)?.guid === SKETCH_TEXT) return { id, sketch, text };
    }
  throw new F3dFormatError(`Text profile #${id}: no text of this kind.`);
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

/** A face named by its tags: the feature that made it and, from the B-rep, its surface. */
function faceOf(
  tags: FaceTag[],
  faces: Map<string, AsmFace[]>,
  featureOf: (design: number) => number | undefined,
): F3dFace {
  const first = tags[0];
  const design = first ? Math.abs(first.designs[0] ?? -1) : -1;
  const out: F3dFace = { tags };
  const feature = design >= 0 ? featureOf(design) : undefined;
  if (feature !== undefined) out.feature = feature;
  const found = first ? faces.get(`${first.token}@${design}`)?.[0] : undefined;
  if (found) out.surface = found.surface;
  return out;
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
): F3dEdgeSet[] {
  const groups = scope.refs.filter((r) => seg.typeOf(r)?.guid === OPERAND_GROUP);
  const sizes = [...parameters]
    .sort((a, b) => a.number - b.number)
    .filter((p) => (kind === 'fillet' ? p.kind === 'Radius' : p.kind !== 'TangencyWeight'));
  const face = (tags: FaceTag[]) => faceOf(tags, faces, featureOf);
  const perSet = kind === 'chamfer' && sizes.length >= 2 * groups.length ? 2 : 1;
  return groups.map((group, i) => {
    const edges: F3dEdge[] = [];
    for (const recipeId of recipesIn(seg, group)) {
      const recipe = readEdgeRecipe(seg, recipeId);
      const [a, b, ...rest] = recipe.faces;
      if (a && b)
        edges.push({ faces: [face(a.tags), face(b.tags)], bounds: rest.map((x) => face(x.tags)) });
    }
    const set: F3dEdgeSet = { edges };
    const size = sizes[i * perSet];
    if (size) set.size = size;
    const size2 = perSet === 2 ? sizes[i * perSet + 1] : undefined;
    if (size2) set.size2 = size2;
    return set;
  });
}
