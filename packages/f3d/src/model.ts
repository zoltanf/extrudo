/**
 * The decoded design: the records of a design segment assembled into the
 * things a person sees in Fusion's timeline — parameters, sketches with their
 * plane and geometry, and features with their inputs. Lengths stay in
 * Fusion's internal centimetres here; the mapper converts.
 */
import { designSegments, type Entries, unzip } from './archive';
import { type AsmFace, type AsmSurface, asmFaces, readAsm } from './asm';
import { F3dFormatError, Reader } from './bytes';
import {
  EDGE_OPERAND,
  EDGE_RECIPE,
  type FaceTag,
  OPERAND_GROUP,
  readEdgeRecipe,
} from './decode/edges';
import {
  type ExtrudeHead,
  type ProfileOperand,
  readExtrudeHead,
  readProfileOperand,
  SKETCH_PROFILE_OPERAND,
} from './decode/extrude';
import { FEATURE_TYPES } from './decode/index';
import {
  PARAMETER_OWNER,
  PARAMETER_VALUE,
  type ParameterValue,
  parameterValue,
} from './decode/parameters';
import { readScope, type Scope } from './decode/scope';
import {
  refAhead,
  SKETCH_CIRCULAR,
  SKETCH_LINE,
  SKETCH_POINT,
  type SketchCircular,
  type SketchLine,
  type SketchPoint,
  sketchCircular,
  sketchLine,
  sketchPoint,
} from './decode/sketch-geometry';
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

export interface F3dOther extends FeatureBase {
  type: 'other';
}

export type F3dFeature = F3dSketchFeature | F3dExtrude | F3dEdgeFeature | F3dOther;

export interface F3dDesign {
  parameters: ParameterValue[];
  userParameters: ParameterValue[];
  features: F3dFeature[];
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
      s = { id, frame, points: [], lines: [], circulars: [] };
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

  // Face tags name the feature that made a face by its operation ID; the
  // operation table maps those IDs to feature records. Its last member before
  // the closing owner reference is u32 n and n pairs of (u64 operation ID,
  // u64 record); version 1 puts another table in front, so it is read from
  // the end.
  const operations = new Map<number, number>();
  for (const id of seg.idsOf(OPERATION_TABLE)) {
    tryDecode(`operation table #${id}`, () => {
      const f = seg.frame(id);
      // The closing reference (11 bytes, 51 with its type GUID), after a u32 0
      // in version 1. The longest list that fits wins: an empty one also fits
      // on that zero word.
      let best: [number, number][] | undefined;
      for (const tail of [11, 15, 51, 55]) {
        for (let n = 1; n <= 100000; n++) {
          const at = f.end - tail - 16 * n - 4;
          if (at < f.start) break;
          const r = new Reader(seg.bulk, at, f.end - tail);
          if (r.u32() !== n) continue;
          const pairs: [number, number][] = [];
          for (let i = 0; i < n; i++) pairs.push([r.u64(), r.u64()]);
          if (!pairs.every(([, rec]) => seg.has(rec))) continue;
          if (!best || pairs.length > best.length) best = pairs;
        }
      }
      if (best) {
        for (const [op, rec] of best) operations.set(op, rec);
        return;
      }
      throw new F3dFormatError('no operation pairs');
    });
  }
  const featureOf = (design: number): number | undefined => operations.get(design);

  // The timeline, in order.
  const items: number[] = [];
  for (const id of seg.idsOf(TIMELINE)) {
    const t = tryDecode(`timeline #${id}`, () => timeline.decode(seg, id));
    if (t) items.push(...t.items);
  }
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
        if (seg.typeOf(ref)?.guid !== SKETCH_PROFILE_OPERAND) continue;
        const p = tryDecode(`profile #${ref}`, () => readProfileOperand(seg, ref));
        if (p) profiles.push(p);
      }
      features.push({ type: 'extrude', ...base, ...head, profiles });
    } else if (FEATURE_TYPES[type.guid] === 'Fillet' || FEATURE_TYPES[type.guid] === 'Chamfer') {
      const kind = FEATURE_TYPES[type.guid] === 'Fillet' ? 'fillet' : 'chamfer';
      const sets = tryDecode(`${kind} #${id}`, () =>
        readEdgeSets(seg, scope, base.parameters, kind, faces, featureOf),
      );
      if (sets) features.push({ type: kind, ...base, sets });
      else features.push({ type: 'other', ...base });
    } else features.push({ type: 'other', ...base });
  }

  return {
    parameters,
    userParameters: parameters.filter((p) => p.user),
    features,
    problems,
  };
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
  const face = (tags: FaceTag[]): F3dFace => {
    const first = tags[0];
    const design = first ? Math.abs(first.designs[0] ?? -1) : -1;
    const out: F3dFace = { tags };
    const feature = design >= 0 ? featureOf(design) : undefined;
    if (feature !== undefined) out.feature = feature;
    const found = first ? faces.get(`${first.token}@${design}`)?.[0] : undefined;
    if (found) out.surface = found.surface;
    return out;
  };
  const perSet = kind === 'chamfer' && sizes.length >= 2 * groups.length ? 2 : 1;
  return groups.map((group, i) => {
    const f = seg.frame(group);
    const edges: F3dEdge[] = [];
    for (const member of refsIn(seg, f.start, f.end)) {
      if (seg.typeOf(member)?.guid !== EDGE_OPERAND) continue;
      const m = seg.frame(member);
      const recipeId = refsIn(seg, m.start, m.end).find((r) => seg.typeOf(r)?.guid === EDGE_RECIPE);
      if (recipeId === undefined) continue;
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
