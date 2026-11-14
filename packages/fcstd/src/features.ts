/**
 * PartDesign's four sketch-based features (Pad, Pocket, Revolution, Groove,
 * ADR-0144 S5) and its two dress-ups (Fillet, Chamfer, S6) as typed data:
 * what Extrudo's `extrude`, `revolve`, `fillet` and `chamfer` can say,
 * decoded from the feature's properties, or why not, from a closed set of
 * reasons. A dress-up's edges are names only here (`Edge3`, `Face2` of the
 * feature before it); the walk finds them (`dressups.ts`). Nothing is mapped onto a design here and nothing is guessed: a
 * property this slice reads that is missing, unreadable, of the wrong kind,
 * not finite or out of range refuses the feature (`value`), and so does any
 * setting the slice doesn't map. What a property it doesn't read changes is
 * caught by the comparison with the stored shape (`bodies.ts`).
 *
 * `decodeFeature` never throws for anything a file holds. The properties as
 * read are in `FORMAT.md`.
 */
import { linkedObjects } from './final-shapes';
import { cleanName } from './names';

/** An object name from the file, for a detail: cleaned and cut like any name the import writes. */
const named = (name: string) => cleanName(name, name);

import { type FcDocument, type FcObject, type FcValue, floatList, versionAtLeast } from './model';
import type { DecodedSketch } from './sketch-decode';

export type FeatureKind =
  | 'pad'
  | 'pocket'
  | 'revolution'
  | 'groove'
  | 'fillet'
  | 'chamfer'
  | 'linear'
  | 'polar'
  | 'mirrored'
  | 'multi'
  | 'hole';

/** The FreeCAD types the importer maps, by kind. */
export const FEATURE_TYPES: Readonly<Record<string, FeatureKind>> = {
  'PartDesign::Pad': 'pad',
  'PartDesign::Pocket': 'pocket',
  'PartDesign::Revolution': 'revolution',
  'PartDesign::Groove': 'groove',
  'PartDesign::Fillet': 'fillet',
  'PartDesign::Chamfer': 'chamfer',
  'PartDesign::LinearPattern': 'linear',
  'PartDesign::PolarPattern': 'polar',
  'PartDesign::Mirrored': 'mirrored',
  'PartDesign::MultiTransform': 'multi',
  'PartDesign::Hole': 'hole',
};

/** Why a feature is not mapped: the closed set the report and the app word. */
export type FeatureRefusal =
  /** Not a feature the importer maps (a pattern, a hole …: later slices). */
  | 'type'
  /** Suppressed in the file. */
  | 'suppressed'
  /** Its profile is a face, a part of a sketch, missing or not a sketch. */
  | 'profile'
  /** Its sketch didn't come in, or has no closed profile. */
  | 'sketch'
  /** A taper angle. */
  | 'taper'
  /** A custom direction or a direction from a reference. */
  | 'direction'
  /** Up to first, last, a face or a shape. */
  | 'up-to'
  /** A revolve axis this slice doesn't map. */
  | 'axis'
  /** A property it reads is missing, unreadable, of the wrong kind, not finite or out of range. */
  | 'value'
  /** A setting this slice doesn't map (two angles, a groove through all). */
  | 'option'
  /** A Pocket, a Groove, a Fillet or a Chamfer with nothing before it to work on. */
  | 'no-base'
  /** A dress-up whose `Base` is missing or is not the feature before it. */
  | 'base'
  /** A dress-up names a sub-element that is neither `EdgeN` nor `FaceN`, or one its base doesn't have. */
  | 'element'
  /** A dress-up with no edges, or with more than the importer or Extrudo's feature takes. */
  | 'edges'
  /** More than the importer takes: a pattern's instances, a transform's originals, a hole's centres (S7). */
  | 'limit'
  /** A pattern or mirror repeats a feature Extrudo can't repeat, or one that isn't this body's mapped feature (S7). */
  | 'original'
  /** A pattern's direction or axis, or a mirror's plane, that the importer doesn't map (S7). */
  | 'transform-reference'
  /** A MultiTransform whose chain of steps the importer doesn't map (S7). */
  | 'multi-transform';

/** One side of a pad or pocket: a length, or through all (pocket). */
export interface DecodedSide {
  readonly extent: 'length' | 'through-all';
  /** mm, for `length`. */
  readonly length?: number;
}

/** A revolve's axis, in the terms this slice maps. */
export type DecodedAxis =
  /** The sketch's own horizontal or vertical axis (drawn by the importer, decision 8). */
  | { readonly kind: 'sketch-axis'; readonly axis: 'h' | 'v' }
  /** A line of the sketch, by its geometry index. */
  | { readonly kind: 'sketch-line'; readonly geometry: number }
  /** An origin axis of the feature's body (which must not be moved). */
  | { readonly kind: 'origin'; readonly axis: 'x' | 'y' | 'z' };

interface Common {
  /** The FreeCAD object's internal name. */
  readonly object: string;
  /** The profile sketch's internal name. */
  readonly sketch: string;
  /** FreeCAD makes faces of every nesting level (`AllowMultiFace`, Bullseye) or of the first only. */
  readonly multiFace: boolean;
  readonly reversed: boolean;
  /**
   * Which FreeCAD property each Extrudo input came from (`distance` →
   * `Length`), so the parameters slice (S10) can bind them.
   */
  readonly sources: Readonly<Record<string, string>>;
}

/** A sub-element a dress-up names on its base's stored shape: `Edge3` is edge 2, `Face1` face 0. */
export interface DressUpElement {
  readonly kind: 'edge' | 'face';
  /** 0-based, in the stored shape's `TopExp::MapShapes` order (FORMAT.md). */
  readonly index: number;
  /** As the file names it. */
  readonly name: string;
}

interface DressUpCommon {
  readonly object: string;
  /** The feature before it, whose stored shape the elements are on. */
  readonly base: string;
  /** Each distinct element once, in the file's order. */
  readonly elements: readonly DressUpElement[];
  readonly sources: Readonly<Record<string, string>>;
}

/** A chamfer's sizes, in Extrudo's terms (`CHAMFER_MODES`). */
export type DecodedChamferMode = 'equal' | 'two-distances' | 'distance-angle';

export type DecodedDressUp =
  | (DressUpCommon & {
      readonly kind: 'fillet';
      /** mm. */
      readonly radius: number;
    })
  | (DressUpCommon & {
      readonly kind: 'chamfer';
      readonly mode: DecodedChamferMode;
      /** mm, on the face that takes the first distance. */
      readonly size: number;
      /** mm, `two-distances` only. */
      readonly size2?: number;
      /** Degrees, `distance-angle` only. */
      readonly angle?: number;
      /**
       * The first distance goes on the second face round each edge (FreeCAD
       * 1.0's meaning: already toggled for an older file, FORMAT.md).
       */
      readonly flip: boolean;
    });

export type DecodedFeature =
  | DecodedDressUp
  | DecodedTransform
  | DecodedHole
  | (Common & {
      readonly kind: 'pad' | 'pocket';
      readonly direction: 'one-side' | 'symmetric' | 'two-sides';
      readonly side1: DecodedSide;
      /** Two sides only: the side against the direction. */
      readonly side2?: DecodedSide;
    })
  | (Common & {
      readonly kind: 'revolution' | 'groove';
      readonly axis: DecodedAxis;
      /** Degrees, in (0, 360]. */
      readonly angle: number;
      readonly symmetric: boolean;
    });

export type FeatureDecode =
  | { readonly ok: true; readonly feature: DecodedFeature }
  | { readonly ok: false; readonly reason: FeatureRefusal; readonly detail: string };

/** What decoding needs besides the feature: the body it is in and whether that body is moved. */
export interface FeatureContext {
  /** The feature's PartDesign body. */
  readonly body: FcObject;
  /** Some container of the feature has a placement other than the identity. */
  readonly moved: boolean;
  /** The profile sketch, decoded (S4), to find a revolve's axis line in. */
  readonly sketch?: DecodedSketch;
  /** The feature before it in the body's chain (a dress-up's `Base` must be it). */
  readonly previous?: string;
  /** Any sketch of the file, decoded once (S7: a pattern's direction may be a line of another sketch). */
  readonly sketchOf?: (name: string) => DecodedSketch | undefined;
}

/** The longest length a feature may have here (10 km): past it the kernel's arithmetic, not the file, decides. */
export const MAX_FEATURE_LENGTH = 1e7;

const PAD_TYPES = ['Length', 'UpToLast', 'UpToFirst', 'UpToFace', 'TwoLengths', 'UpToShape'];
const POCKET_TYPES = ['Length', 'ThroughAll', 'UpToFirst', 'UpToFace', 'TwoLengths', 'UpToShape'];
const REVOLUTION_TYPES = ['Angle', 'UpToLast', 'UpToFirst', 'UpToFace', 'TwoAngles'];
const GROOVE_TYPES = ['Angle', 'ThroughAll', 'UpToFirst', 'UpToFace', 'TwoAngles'];
const SIDE_TYPES = ['One side', 'Two sides', 'Symmetric'];
const UP_TO = new Set(['UpToLast', 'UpToFirst', 'UpToFace', 'UpToShape']);

class Refuse extends Error {
  constructor(
    readonly reason: FeatureRefusal,
    readonly detail: string,
  ) {
    super(detail);
  }
}
const refuse = (reason: FeatureRefusal, detail: string): never => {
  throw new Refuse(reason, detail);
};

/** The property `name` of `o`, refusing when the reader left it out as unreadable. */
function value(o: FcObject, name: string): FcValue | undefined {
  if (o.unreadable?.includes(name)) refuse('value', `its ${name} can't be read`);
  return o.properties[name]?.value;
}

function bool(o: FcObject, name: string, fallback?: boolean): boolean {
  const v = value(o, name);
  if (v === undefined) {
    if (fallback === undefined) return refuse('value', `it has no ${name}`);
    return fallback;
  }
  if (v.kind !== 'bool') return refuse('value', `its ${name} is not true or false`);
  return v.value;
}

function number(o: FcObject, name: string, fallback?: number): number {
  const v = value(o, name);
  if (v === undefined) {
    if (fallback === undefined) return refuse('value', `it has no ${name}`);
    return fallback;
  }
  if (v.kind !== 'float' && v.kind !== 'integer')
    return refuse('value', `its ${name} is not a number`);
  if (!Number.isFinite(v.value)) return refuse('value', `its ${name} is not a finite number`);
  return v.value;
}

/** An enumeration's name: the file's own list when it has one, else the class's. */
function choice(o: FcObject, name: string, names: readonly string[], fallback?: string): string {
  const v = value(o, name);
  if (v === undefined) {
    if (fallback === undefined) return refuse('value', `it has no ${name}`);
    return fallback;
  }
  if (v.kind !== 'enum' && v.kind !== 'integer')
    return refuse('value', `its ${name} is not a choice`);
  const index = v.kind === 'enum' ? v.index : v.value;
  const listed = v.kind === 'enum' ? v.values?.[index] : undefined;
  // A deprecated entry keeps its place in FreeCAD's list with a leading `?`.
  const found = listed !== undefined ? listed.replace(/^\?/, '') : names[index];
  if (found === undefined || !names.includes(found))
    return refuse('value', `its ${name} is choice ${index}, which this importer doesn't know`);
  return found;
}

function length(o: FcObject, name: string): number {
  const v = number(o, name);
  if (v < 0 || v > MAX_FEATURE_LENGTH) refuse('value', `its ${name} of ${v} mm is out of range`);
  return v;
}

/** Whether a taper property holds something other than 0. */
function tapered(o: FcObject, name: string): boolean {
  return number(o, name, 0) !== 0;
}

/** The profile sketch's name, or a refusal: a whole sketch only. */
function profileSketch(doc: FcDocument, o: FcObject): string {
  const v = value(o, 'Profile') ?? value(o, 'Sketch');
  if (v === undefined) return refuse('profile', 'it has no profile');
  let object: string | undefined;
  let subs: readonly string[] = [];
  if (v.kind === 'linkSub') {
    object = v.object;
    subs = v.subs.map((s) => s.name).filter((s) => s !== '');
  } else if (v.kind === 'link') object = v.object;
  else return refuse('value', 'its profile is not a link');
  if (object === undefined) return refuse('profile', 'it has no profile');
  const target = doc.byName.get(object);
  if (!target) return refuse('profile', `its profile ${named(object)} isn't in the file`);
  if (!target.type.startsWith('Sketcher::SketchObject'))
    return refuse('profile', `its profile is ${subs.length > 0 ? 'a face' : 'not a sketch'}`);
  if (subs.length > 0) return refuse('profile', 'its profile is a part of a sketch');
  return object;
}

/** The common settings every one of the four reads. */
function common(doc: FcDocument, o: FcObject) {
  if (bool(o, 'Suppressed', false)) refuse('suppressed', 'it is suppressed');
  const sketch = profileSketch(doc, o);
  return {
    sketch,
    multiFace: bool(o, 'AllowMultiFace', true),
    reversed: bool(o, 'Reversed'),
    midplane: bool(o, 'Midplane'),
  };
}

function extrusion(doc: FcDocument, o: FcObject, kind: 'pad' | 'pocket'): DecodedFeature {
  const base = common(doc, o);
  const types = kind === 'pad' ? PAD_TYPES : POCKET_TYPES;
  const type = choice(o, 'Type', types);
  const sideType = choice(o, 'SideType', SIDE_TYPES, 'One side');
  if (bool(o, 'UseCustomVector', false)) refuse('direction', 'it has a custom direction');
  const axis = value(o, 'ReferenceAxis');
  if (axis !== undefined) {
    if (axis.kind !== 'linkSub') refuse('value', 'its ReferenceAxis is not a link');
    else if (axis.object !== undefined) {
      const subs = axis.subs.map((s) => s.name);
      // The profile sketch's own normal is the default direction.
      if (!(axis.object === base.sketch && subs.length === 1 && subs[0] === 'N_Axis'))
        refuse('direction', 'its direction comes from a reference');
    }
  }
  const side = (t: string, lengthName: string): DecodedSide => {
    if (UP_TO.has(t)) return refuse('up-to', `it goes ${upTo(t)}`);
    if (t === 'ThroughAll') return { extent: 'through-all' };
    return { extent: 'length', length: length(o, lengthName) };
  };
  const sources: Record<string, string> = { profiles: 'Profile', flip: 'Reversed' };
  let direction: 'one-side' | 'symmetric' | 'two-sides';
  let side1: DecodedSide;
  let side2: DecodedSide | undefined;
  // FreeCAD 1.1 reads TwoLengths first, then Midplane, then its SideType.
  if (type === 'TwoLengths') {
    direction = 'two-sides';
    side1 = side('Length', 'Length');
    side2 = side('Length', 'Length2');
    sources.direction = 'Type';
  } else {
    side1 = side(type, 'Length');
    if (base.midplane || sideType === 'Symmetric') {
      direction = 'symmetric';
      sources.direction = base.midplane ? 'Midplane' : 'SideType';
    } else if (sideType === 'Two sides') {
      direction = 'two-sides';
      side2 = side(choice(o, 'Type2', types, 'Length'), 'Length2');
      sources.direction = 'SideType';
    } else direction = 'one-side';
  }
  if (side1.extent === 'length') sources.distance = 'Length';
  if (side2?.extent === 'length') sources.distance2 = 'Length2';
  if (tapered(o, 'TaperAngle') || (direction === 'two-sides' && tapered(o, 'TaperAngle2')))
    refuse('taper', 'it is tapered');
  const total = (side1.length ?? 0) + (side2?.length ?? 0);
  if (
    side1.extent === 'length' &&
    (side2 === undefined || side2.extent === 'length') &&
    !(total > 0)
  )
    refuse('value', 'its length is 0');
  return {
    kind,
    object: o.name,
    sketch: base.sketch,
    multiFace: base.multiFace,
    reversed: base.reversed,
    sources,
    direction,
    side1,
    ...(side2 ? { side2 } : {}),
  };
}

const upTo = (t: string) =>
  t === 'UpToLast'
    ? 'up to the last face'
    : t === 'UpToFirst'
      ? 'up to the first face'
      : t === 'UpToFace'
        ? 'up to a face'
        : 'up to a shape';

/** An origin's features by name, built once per origin object (a file's objects live as long as its import). */
const originSets = new WeakMap<FcObject, Set<string>>();
function originFeatures(origin: FcObject): Set<string> {
  let set = originSets.get(origin);
  if (!set) {
    const v = origin.properties.OriginFeatures?.value;
    set = new Set(v ? linkedObjects(v) : []);
    originSets.set(origin, set);
  }
  return set;
}

const ORIGIN_ROLE = /^([XYZ])_Axis(?:\d{0,6})$/;

/** A revolve's `ReferenceAxis` in the terms this slice maps, or a refusal. */
function axisOf(
  doc: FcDocument,
  o: FcObject,
  sketch: string,
  context: FeatureContext,
): DecodedAxis {
  const v = value(o, 'ReferenceAxis');
  if (v === undefined) return refuse('axis', 'it has no axis');
  if (v.kind !== 'linkSub') return refuse('value', 'its ReferenceAxis is not a link');
  if (v.object === undefined) return refuse('axis', 'it has no axis');
  const subs = v.subs.map((s) => s.name).filter((s) => s !== '');
  if (v.object === sketch) {
    const sub = subs.length === 1 ? (subs[0] as string) : '';
    if (sub === 'H_Axis') return { kind: 'sketch-axis', axis: 'h' };
    if (sub === 'V_Axis') return { kind: 'sketch-axis', axis: 'v' };
    if (sub === 'N_Axis') return refuse('axis', "its axis is the sketch's normal");
    const geometry = context.sketch?.geometry ?? [];
    const edge = /^Edge(\d{1,6})$/.exec(sub);
    if (edge) {
      const index = Number(edge[1]) - 1;
      const g = geometry[index];
      if (index < 0 || g?.kind !== 'line')
        return refuse('axis', `its axis ${sub} is not a line of the sketch`);
      return { kind: 'sketch-line', geometry: index };
    }
    const nth = /^Axis(\d{1,6})$/.exec(sub);
    if (nth) {
      // The N-th construction line, counted from 0 over the sketch's construction lines.
      let k = -1;
      for (let i = 0; i < geometry.length; i++) {
        const g = geometry[i];
        if (g === undefined) return refuse('axis', `its axis ${sub} can't be found in the sketch`);
        if (g.kind === 'line' && g.construction && ++k === Number(nth[1]))
          return { kind: 'sketch-line', geometry: i };
      }
      return refuse('axis', `its axis ${sub} is not in the sketch`);
    }
    return refuse('axis', `its axis ${sub || 'the whole sketch'} is not one this importer maps`);
  }
  const target = doc.byName.get(v.object);
  if (!target) return refuse('axis', `its axis ${named(v.object)} isn't in the file`);
  if (target.type !== 'App::Line' || subs.length > 0)
    return refuse('axis', 'its axis is an edge or a datum line');
  // An origin axis of this feature's own body.
  const originName = context.body.properties.Origin?.value;
  const origin =
    originName?.kind === 'link' && originName.object
      ? doc.byName.get(originName.object)
      : undefined;
  if (!origin || !originFeatures(origin).has(target.name))
    return refuse('axis', "its axis is not an origin axis of the feature's body");
  const role = target.properties.Role?.value;
  const m = ORIGIN_ROLE.exec(role?.kind === 'string' ? role.value : target.name);
  if (!m) return refuse('axis', 'its axis is not an origin axis');
  if (context.moved) return refuse('axis', 'its axis is an origin axis of a moved body');
  return { kind: 'origin', axis: (m[1] as string).toLowerCase() as 'x' | 'y' | 'z' };
}

function revolution(
  doc: FcDocument,
  o: FcObject,
  kind: 'revolution' | 'groove',
  context: FeatureContext,
): DecodedFeature {
  const base = common(doc, o);
  const type = choice(o, 'Type', kind === 'revolution' ? REVOLUTION_TYPES : GROOVE_TYPES, 'Angle');
  if (UP_TO.has(type)) refuse('up-to', `it turns ${upTo(type)}`);
  if (type !== 'Angle')
    refuse('option', type === 'TwoAngles' ? 'it turns by two angles' : 'it turns through all');
  const sideType = choice(o, 'SideType', SIDE_TYPES, 'One side');
  if (sideType === 'Two sides') refuse('option', 'it turns by two angles');
  const angle = number(o, 'Angle');
  if (!(angle > 0 && angle <= 360)) refuse('value', `its angle of ${angle}° is out of range`);
  const axis = axisOf(doc, o, base.sketch, context);
  const symmetric = base.midplane || sideType === 'Symmetric';
  return {
    kind,
    object: o.name,
    sketch: base.sketch,
    multiFace: base.multiFace,
    reversed: base.reversed,
    sources: {
      profiles: 'Profile',
      axis: 'ReferenceAxis',
      angle: 'Angle',
      flip: 'Reversed',
      ...(symmetric ? { direction: base.midplane ? 'Midplane' : 'SideType' } : {}),
    },
    axis,
    angle,
    symmetric,
  };
}

/** The most sub-elements one dress-up may name (the library's most is in ADR-0144's S6 amendment). */
export const MAX_DRESSUP_ELEMENTS = 1_000;

const ELEMENT = /^(Edge|Face)([1-9]\d{0,8})$/;
const CHAMFER_TYPES = ['Equal distance', 'Two distances', 'Distance and Angle'];

/** A dress-up's `Base`: the feature before it and the elements it names. */
function dressUpBase(
  doc: FcDocument,
  o: FcObject,
  context: FeatureContext,
): { base: string; elements: DressUpElement[] } {
  const v = value(o, 'Base');
  if (v === undefined) return refuse('base', 'it has no base');
  if (v.kind !== 'linkSub') return refuse('value', 'its Base is not a link');
  if (v.object === undefined || v.object === '') return refuse('base', 'it has no base');
  if (!doc.byName.has(v.object))
    return refuse('base', `its base ${named(v.object)} isn't in the file`);
  if (context.previous === undefined) return refuse('no-base', 'there is nothing before it');
  if (v.object !== context.previous)
    return refuse('base', `its base ${named(v.object)} is not the feature before it`);
  // Bounded before anything is looked at: a file may name any number.
  if (v.subs.length > MAX_DRESSUP_ELEMENTS)
    return refuse('edges', `it names ${v.subs.length} elements, more than ${MAX_DRESSUP_ELEMENTS}`);
  const elements: DressUpElement[] = [];
  const seen = new Set<string>();
  for (const sub of v.subs) {
    const name = sub.name;
    if (name === '') continue;
    const m = ELEMENT.exec(name);
    if (!m) return refuse('element', `it names ${clipName(name)}, which is not an edge or a face`);
    if (seen.has(name)) continue;
    seen.add(name);
    elements.push({
      kind: m[1] === 'Edge' ? 'edge' : 'face',
      index: Number(m[2]) - 1,
      name,
    });
  }
  return { base: v.object, elements };
}

/** A sub-element name from the file, for a detail: cleaned and cut like any name the import writes. */
const clipName = (name: string) => cleanName(name, 'nothing');

/** A size of a dress-up: finite, above 0 and at most `MAX_FEATURE_LENGTH`. */
function size(o: FcObject, name: string): number {
  const v = number(o, name);
  if (!(v > 0 && v <= MAX_FEATURE_LENGTH))
    return refuse('value', `its ${name} of ${v} mm is out of range`);
  return v;
}

function dressUp(
  doc: FcDocument,
  o: FcObject,
  kind: 'fillet' | 'chamfer',
  context: FeatureContext,
): DecodedDressUp {
  if (bool(o, 'Suppressed', false)) refuse('suppressed', 'it is suppressed');
  const { base, elements } = dressUpBase(doc, o, context);
  if (bool(o, 'UseAllEdges', false)) refuse('option', 'it works on every edge of the body');
  if (elements.length === 0) refuse('edges', 'it names no edges');
  if (kind === 'fillet')
    return {
      kind,
      object: o.name,
      base,
      elements,
      radius: size(o, 'Radius'),
      sources: { edges: 'Base', radius: 'Radius' },
    };
  // ChamferType came with 0.19; a file from before has equal distances.
  const type = choice(o, 'ChamferType', CHAMFER_TYPES, 'Equal distance');
  const first = size(o, 'Size');
  const shared = { kind, object: o.name, base, elements } as const;
  if (type === 'Equal distance')
    return {
      ...shared,
      mode: 'equal',
      size: first,
      flip: false,
      sources: { edges: 'Base', distance: 'Size' },
    };
  let flip = bool(o, 'FlipDirection', false);
  // FreeCAD 1.0 turned the flag's meaning round and toggles it when it opens an older file.
  if (doc.version && !versionAtLeast(doc.version, [1, 0, 0])) flip = !flip;
  const sources: Record<string, string> = {
    edges: 'Base',
    mode: 'ChamferType',
    distance: 'Size',
    flip: 'FlipDirection',
  };
  if (type === 'Two distances')
    return {
      ...shared,
      mode: 'two-distances',
      size: first,
      size2: size(o, 'Size2'),
      flip,
      sources: { ...sources, distanceB: 'Size2' },
    };
  const angle = number(o, 'Angle');
  if (!(angle > 0 && angle < 180)) refuse('value', `its angle of ${angle}° is out of range`);
  return {
    ...shared,
    mode: 'distance-angle',
    size: first,
    angle,
    flip,
    sources: { ...sources, angle: 'Angle' },
  };
}

/**
 * One feature of a body as typed data, or why this slice doesn't map it.
 * Never throws for anything the file holds.
 */
export function decodeFeature(
  doc: FcDocument,
  object: FcObject,
  context: FeatureContext,
): FeatureDecode {
  const kind = Object.hasOwn(FEATURE_TYPES, object.type) ? FEATURE_TYPES[object.type] : undefined;
  if (!kind)
    return { ok: false, reason: 'type', detail: `it is a ${object.type || 'object of no type'}` };
  try {
    const feature =
      kind === 'pad' || kind === 'pocket'
        ? extrusion(doc, object, kind)
        : kind === 'fillet' || kind === 'chamfer'
          ? dressUp(doc, object, kind, context)
          : kind === 'hole'
            ? hole(doc, object)
            : kind === 'revolution' || kind === 'groove'
              ? revolution(doc, object, kind, context)
              : transform(doc, object, kind, context);
    return { ok: true, feature };
  } catch (error) {
    if (error instanceof Refuse) return { ok: false, reason: error.reason, detail: error.detail };
    // Nothing in a file should get here; if it does, the feature is refused, never the import.
    return { ok: false, reason: 'value', detail: String((error as Error)?.message ?? error) };
  }
}

// --- Transforms (S7): LinearPattern, PolarPattern, Mirrored, MultiTransform --------------------

/** The most originals one transform may name, checked before any is looked at. */
export const MAX_ORIGINALS = 100;
/**
 * The most instances one transform may make, originals counted in: its
 * instances (both directions, every step of a MultiTransform multiplied)
 * times its originals. Extrudo's own pattern makes at most 1,000
 * (`MAX_PATTERN_INSTANCES`); the measured worst case at this cap is in
 * ADR-0144's S7 amendment.
 */
export const MAX_TRANSFORM_INSTANCES = 1_000;
/** The most steps a MultiTransform may have, checked before any is looked at. */
export const MAX_TRANSFORM_STEPS = 16;

/**
 * A direction, axis or plane a transform names, as the file names it; the
 * walk turns it into an Extrudo reference (`transforms.ts`).
 */
export type DecodedReference =
  /** A sketch's own axis: `H_Axis`, `V_Axis`, or its normal `N_Axis` (and a mirror's whole sketch). */
  | { readonly kind: 'sketch-axis'; readonly sketch: string; readonly axis: 'h' | 'v' | 'n' }
  /** A line of a sketch, by its geometry index (`EdgeN`, or the N-th construction line `AxisN`). */
  | { readonly kind: 'sketch-line'; readonly sketch: string; readonly geometry: number }
  /** An origin axis of the feature's body (which must not be moved). */
  | { readonly kind: 'origin-axis'; readonly axis: 'x' | 'y' | 'z' }
  /** An origin plane of the feature's body. */
  | { readonly kind: 'origin-plane'; readonly plane: 'xy' | 'xz' | 'yz' }
  /** An edge or a face of a feature's stored shape. */
  | { readonly kind: 'element'; readonly object: string; readonly element: DressUpElement };

/** One direction of a linear pattern. */
export interface DecodedRow {
  readonly reference: DecodedReference;
  readonly reversed: boolean;
  /** Instances along it, the original counted. */
  readonly count: number;
  /** `extent`: `distance` from the first to the last; `spacing`: between neighbours. */
  readonly measure: 'extent' | 'spacing';
  /** mm. */
  readonly distance: number;
}

export interface DecodedLinear {
  readonly kind: 'linear';
  readonly first: DecodedRow;
  /** FreeCAD 1.1's second direction (a grid). */
  readonly second?: DecodedRow;
}

export interface DecodedPolar {
  readonly kind: 'polar';
  readonly reference: DecodedReference;
  readonly reversed: boolean;
  readonly count: number;
  /** `total`: `angle` is the whole angle; `step`: between neighbours. */
  readonly measure: 'total' | 'step';
  /** Degrees. */
  readonly angle: number;
}

export interface DecodedMirrored {
  readonly kind: 'mirrored';
  readonly reference: DecodedReference;
}

/** One step: a transform by itself, or a step of a MultiTransform. */
export type DecodedStep = DecodedLinear | DecodedPolar | DecodedMirrored;

interface TransformCommon {
  readonly object: string;
  /** The features it repeats, each once, in the file's order. */
  readonly originals: readonly string[];
  readonly sources: Readonly<Record<string, string>>;
}

export type DecodedTransform =
  | (TransformCommon & DecodedStep)
  | (TransformCommon & {
      readonly kind: 'multi';
      /** Its steps' objects, in order. */
      readonly children: readonly string[];
      readonly steps: readonly DecodedStep[];
    });

const LINEAR_MODES = ['Extent', 'Spacing'];
const TRANSFORM_MODES = ['Features', 'Whole shape'];
const SKETCH_AXIS = /^([HVN])_Axis$/;
const NTH_AXIS = /^Axis(\d{1,6})$/;
const SKETCH_EDGE = /^Edge(\d{1,6})$/;
const ORIGIN_PLANE_ROLE = /^(XY|XZ|YZ)_Plane(?:\d{0,6})$/;

/** The origin of the feature's body, when it has one. */
function bodyOrigin(doc: FcDocument, body: FcObject): FcObject | undefined {
  const v = body.properties.Origin?.value;
  return v?.kind === 'link' && v.object ? doc.byName.get(v.object) : undefined;
}

/** The N-th construction line of a decoded sketch, counted from 0, by geometry index. */
function nthConstructionLine(sketch: DecodedSketch, n: number): number | 'unreadable' | undefined {
  let k = -1;
  for (let i = 0; i < sketch.geometry.length; i++) {
    const g = sketch.geometry[i];
    if (g === undefined) return 'unreadable';
    if (g.kind === 'line' && g.construction && ++k === n) return i;
  }
  return undefined;
}

/**
 * A transform's `Direction` / `Axis` / `MirrorPlane` as the file names it, or
 * a refusal (`transform-reference`). `what` words it in a detail.
 */
function referenceOf(
  doc: FcDocument,
  o: FcObject,
  name: string,
  what: string,
  context: FeatureContext,
  plane: boolean,
): DecodedReference {
  const v = value(o, name);
  if (v === undefined) return refuse('transform-reference', `it has no ${what}`);
  if (v.kind !== 'linkSub') return refuse('value', `its ${name} is not a link`);
  if (v.object === undefined || v.object === '')
    return refuse('transform-reference', `it has no ${what}`);
  const subs = v.subs.map((s) => s.name).filter((s) => s !== '');
  if (subs.length > 1) return refuse('transform-reference', `its ${what} names several elements`);
  const sub = subs[0] ?? '';
  const target = doc.byName.get(v.object);
  if (!target)
    return refuse('transform-reference', `its ${what} ${named(v.object)} isn't in the file`);
  if (target.type.startsWith('Sketcher::SketchObject')) {
    const axis = SKETCH_AXIS.exec(sub);
    // A mirror in the whole sketch is a mirror in its plane.
    if (sub === '' && plane) return { kind: 'sketch-axis', sketch: target.name, axis: 'n' };
    if (axis)
      return {
        kind: 'sketch-axis',
        sketch: target.name,
        axis: (axis[1] as string).toLowerCase() as 'h' | 'v' | 'n',
      };
    const decoded = context.sketchOf?.(target.name);
    const edge = SKETCH_EDGE.exec(sub);
    const nth = NTH_AXIS.exec(sub);
    if (decoded && edge) {
      const index = Number(edge[1]) - 1;
      if (index < 0 || decoded.geometry[index]?.kind !== 'line')
        return refuse(
          'transform-reference',
          `its ${what} ${clipName(sub)} is not a line of the sketch`,
        );
      return { kind: 'sketch-line', sketch: target.name, geometry: index };
    }
    if (decoded && nth) {
      const found = nthConstructionLine(decoded, Number(nth[1]));
      if (found === undefined || found === 'unreadable')
        return refuse('transform-reference', `its ${what} ${clipName(sub)} is not in the sketch`);
      return { kind: 'sketch-line', sketch: target.name, geometry: found };
    }
    return refuse(
      'transform-reference',
      `its ${what} ${clipName(sub) || 'the whole sketch'} is not one this importer maps`,
    );
  }
  if (target.type === 'App::Line' || target.type === 'App::Plane') {
    const origin = bodyOrigin(doc, context.body);
    if (!origin || !originFeatures(origin).has(target.name))
      return refuse(
        'transform-reference',
        `its ${what} is not an origin feature of the feature's body`,
      );
    if (context.moved)
      return refuse('transform-reference', `its ${what} is an origin feature of a moved body`);
    const role = target.properties.Role?.value;
    const r = role?.kind === 'string' ? role.value : target.name;
    const axis = ORIGIN_ROLE.exec(r);
    if (target.type === 'App::Line' && axis)
      return { kind: 'origin-axis', axis: (axis[1] as string).toLowerCase() as 'x' | 'y' | 'z' };
    const p = ORIGIN_PLANE_ROLE.exec(r);
    if (target.type === 'App::Plane' && p)
      return {
        kind: 'origin-plane',
        plane: (p[1] as string).toLowerCase() as 'xy' | 'xz' | 'yz',
      };
    return refuse('transform-reference', `its ${what} is not an origin axis or plane`);
  }
  if (target.type.startsWith('PartDesign::Line') || target.type.startsWith('PartDesign::Plane'))
    return refuse('transform-reference', `its ${what} is a datum line or plane`);
  const element = ELEMENT.exec(sub);
  if (!element)
    return refuse(
      'transform-reference',
      `its ${what} is ${sub ? clipName(sub) : 'a whole object'} of ${named(target.name)}`,
    );
  return {
    kind: 'element',
    object: target.name,
    element: {
      kind: element[1] === 'Edge' ? 'edge' : 'face',
      index: Number(element[2]) - 1,
      name: sub,
    },
  };
}

/** A count of instances: a whole number from 1 to `MAX_TRANSFORM_INSTANCES`. */
function occurrences(o: FcObject, name: string): number {
  const v = number(o, name);
  if (!Number.isInteger(v) || v < 1)
    return refuse('value', `its ${name} of ${v} is not a whole number from 1`);
  if (v > MAX_TRANSFORM_INSTANCES)
    return refuse('limit', `its ${name} of ${v} is more than ${MAX_TRANSFORM_INSTANCES}`);
  return v;
}

/**
 * Refuses a pattern whose gaps aren't all its own spacing. FreeCAD 1.1 keeps
 * one entry per gap (`Spacings`): -1 (and 0, which it writes for a second
 * direction it adds) for "the pattern's spacing", a length for a gap of its
 * own; and a repeating list of gaps (`SpacingPattern`), zeros when unused
 * (FORMAT.md). A gap equal to the spacing changes nothing. A property that
 * isn't there is the default.
 */
function defaultGaps(doc: FcDocument, o: FcObject, name: string, step: number | undefined): void {
  if (o.properties[name] === undefined) return;
  if (o.unreadable?.includes(name)) refuse('value', `its ${name} can't be read`);
  const before = doc.problems.length;
  const read = floatList(doc, o, name);
  doc.problems.splice(before);
  const list = read ?? refuse('value', `its ${name} can't be read`);
  const own = (g: number) =>
    step === undefined ? g !== 0 : g > 0 && Math.abs(g - step) > 1e-9 * Math.max(1, step);
  if (list.some(own)) refuse('option', `it has gaps of their own (${name})`);
}

/** The positions a pattern leaves out (FreeCAD 1.1): refused unless there are none. */
function noSuppressed(o: FcObject): void {
  for (const name of ['SuppressedIndices', 'SuppressedPositions']) {
    const v = value(o, name);
    if (v === undefined) continue;
    const none =
      (v.kind === 'integerList' && v.values.length === 0) ||
      (v.kind === 'unknown' &&
        v.raw.every((r) => r.children.length === 0 && (r.attrs.count ?? '0') === '0'));
    if (!none) refuse('option', 'it leaves some of its instances out');
  }
}

function row(
  doc: FcDocument,
  o: FcObject,
  context: FeatureContext,
  suffix: '' | '2',
  sources: Record<string, string>,
): DecodedRow {
  const n = suffix === '' ? '1' : '2';
  const reference = referenceOf(doc, o, `Direction${suffix}`, 'direction', context, false);
  const count = occurrences(o, `Occurrences${suffix}`);
  // Mode came with FreeCAD 1.0's spacing; before it the length was always the whole extent.
  const mode = choice(o, `Mode${suffix}`, LINEAR_MODES, 'Extent');
  const measure = mode === 'Spacing' ? 'spacing' : 'extent';
  const lengthName = measure === 'spacing' ? `Offset${suffix}` : `Length${suffix}`;
  const distance = length(o, lengthName);
  if (count > 1 && !(distance > 0))
    refuse('value', `its ${lengthName} of 0 mm puts every copy on the original`);
  const step = measure === 'spacing' ? distance : count > 1 ? distance / (count - 1) : distance;
  defaultGaps(doc, o, `Spacings${suffix}`, step);
  defaultGaps(doc, o, `SpacingPattern${suffix}`, undefined);
  sources[`direction${n}`] = `Direction${suffix}`;
  sources[`count${n}`] = `Occurrences${suffix}`;
  sources[`distance${n}`] = lengthName;
  return { reference, reversed: bool(o, `Reversed${suffix}`, false), count, measure, distance };
}

function linear(
  doc: FcDocument,
  o: FcObject,
  context: FeatureContext,
  sources: Record<string, string>,
): DecodedLinear {
  const first = row(doc, o, context, '', sources);
  // A second direction (FreeCAD 1.1): only when it has more than one instance.
  const count2 = o.properties.Occurrences2 === undefined ? 1 : occurrences(o, 'Occurrences2');
  if (count2 <= 1) return { kind: 'linear', first };
  const d2 = value(o, 'Direction2');
  if (d2?.kind === 'linkSub' && (d2.object === undefined || d2.object === ''))
    refuse('transform-reference', 'its second direction has instances but no direction');
  return { kind: 'linear', first, second: row(doc, o, context, '2', sources) };
}

function polar(
  doc: FcDocument,
  o: FcObject,
  context: FeatureContext,
  sources: Record<string, string>,
): DecodedPolar {
  const reference = referenceOf(doc, o, 'Axis', 'axis', context, false);
  const count = occurrences(o, 'Occurrences');
  const mode = choice(o, 'Mode', LINEAR_MODES, 'Extent');
  const measure = mode === 'Spacing' ? 'step' : 'total';
  const angleName = measure === 'step' ? 'Offset' : 'Angle';
  const angle = number(o, angleName);
  if (!(Math.abs(angle) <= 360)) refuse('value', `its ${angleName} of ${angle}° is out of range`);
  if (count > 1 && angle === 0)
    refuse('value', `its ${angleName} of 0° puts every copy on the original`);
  const turn = measure === 'total' && Math.abs(angle) === 360 ? count : count - 1;
  defaultGaps(
    doc,
    o,
    'Spacings',
    measure === 'step' ? angle : turn > 0 ? Math.abs(angle) / turn : 0,
  );
  defaultGaps(doc, o, 'SpacingPattern', undefined);
  sources.axis = 'Axis';
  sources.count = 'Occurrences';
  sources.angle = angleName;
  return { kind: 'polar', reference, reversed: bool(o, 'Reversed', false), count, measure, angle };
}

/** One step of a transform (a whole transform, or a MultiTransform's child). */
function step(
  doc: FcDocument,
  o: FcObject,
  kind: 'linear' | 'polar' | 'mirrored',
  context: FeatureContext,
  sources: Record<string, string>,
): DecodedStep {
  noSuppressed(o);
  if (kind === 'linear') return linear(doc, o, context, sources);
  if (kind === 'polar') return polar(doc, o, context, sources);
  sources.plane = 'MirrorPlane';
  return {
    kind: 'mirrored',
    reference: referenceOf(doc, o, 'MirrorPlane', 'mirror plane', context, true),
  };
}

/** How many instances a step makes, the original counted. */
const instancesOf = (s: DecodedStep) =>
  s.kind === 'mirrored' ? 2 : s.kind === 'polar' ? s.count : s.first.count * (s.second?.count ?? 1);

function transform(
  doc: FcDocument,
  o: FcObject,
  kind: FeatureKind,
  context: FeatureContext,
): DecodedTransform {
  if (bool(o, 'Suppressed', false)) refuse('suppressed', 'it is suppressed');
  if (choice(o, 'TransformMode', TRANSFORM_MODES, 'Features') !== 'Features')
    refuse('option', 'it repeats the whole shape');
  const list = value(o, 'Originals');
  if (list === undefined) return refuse('original', 'it has no originals');
  if (list.kind !== 'linkList') return refuse('value', 'its Originals is not a list of links');
  // Bounded before anything is looked at: a file may list any number.
  if (list.objects.length > MAX_ORIGINALS)
    return refuse(
      'limit',
      `it repeats ${list.objects.length} features, more than ${MAX_ORIGINALS}`,
    );
  const originals = [...new Set(list.objects)];
  if (originals.length === 0) return refuse('original', 'it repeats nothing');
  if (originals.includes(o.name)) return refuse('original', 'it lists itself among its originals');
  const sources: Record<string, string> = { features: 'Originals' };
  const common = { object: o.name, originals };
  let total: number;
  let decoded: DecodedTransform;
  if (kind === 'multi') {
    const steps = value(o, 'Transformations');
    if (steps === undefined || steps.kind !== 'linkList')
      return refuse('value', 'its Transformations is not a list of links');
    if (steps.objects.length > MAX_TRANSFORM_STEPS)
      return refuse(
        'multi-transform',
        `it has ${steps.objects.length} steps, more than ${MAX_TRANSFORM_STEPS}`,
      );
    if (steps.objects.length === 0) return refuse('multi-transform', 'it has no steps');
    const children: string[] = [];
    const out: DecodedStep[] = [];
    for (const name of steps.objects) {
      if (name === o.name) return refuse('multi-transform', 'it lists itself among its steps');
      if (children.includes(name))
        return refuse('multi-transform', `it lists its step ${named(name)} twice`);
      const child = doc.byName.get(name);
      if (!child) return refuse('multi-transform', `its step ${named(name)} isn't in the file`);
      const k = Object.hasOwn(FEATURE_TYPES, child.type) ? FEATURE_TYPES[child.type] : undefined;
      if (k !== 'linear' && k !== 'polar' && k !== 'mirrored')
        return refuse(
          'multi-transform',
          `its step ${named(name)} is a ${child.type || 'object of no type'}`,
        );
      children.push(name);
      const childSources: Record<string, string> = {};
      out.push(step(doc, child, k, context, childSources));
      for (const [key, prop] of Object.entries(childSources))
        sources[`${children.length}.${key}`] = `${name}.${prop}`;
    }
    total = out.reduce((n, s) => n * instancesOf(s), 1);
    decoded = { ...common, kind: 'multi', children, steps: out, sources };
  } else {
    const s = step(doc, o, kind as 'linear' | 'polar' | 'mirrored', context, sources);
    total = instancesOf(s);
    decoded = { ...common, ...s, sources };
  }
  if (total * originals.length > MAX_TRANSFORM_INSTANCES)
    refuse(
      'limit',
      `it makes ${total * originals.length} instances, more than ${MAX_TRANSFORM_INSTANCES}`,
    );
  return decoded;
}

// --- Hole (S7) -------------------------------------------------------------------------------

/** What a hole's cut is, as far as the file says. */
export type DecodedHoleCut =
  | 'none'
  | 'counterbore'
  | 'countersink'
  /** A bare index past the first three, or a screw standard's name: the sizes are stored, the kind isn't (S7). */
  | 'counterbore-or-countersink';

export interface DecodedHole {
  readonly kind: 'hole';
  readonly object: string;
  readonly sketch: string;
  /** mm. */
  readonly diameter: number;
  readonly extent: 'blind' | 'through';
  /** mm, to the end of the full diameter (Extrudo's meaning: a drill point counted in is taken off). */
  readonly depth?: number;
  /** Degrees; 0 for a flat bottom. */
  readonly tipAngle: number;
  readonly cut: DecodedHoleCut;
  /** mm (`HoleCutDiameter`), with a cut. */
  readonly cutDiameter?: number;
  /** mm (`HoleCutDepth`), with a counterbore. */
  readonly cutDepth?: number;
  /** Degrees (`HoleCutCountersinkAngle`), with a countersink. */
  readonly cutAngle?: number;
  /** Drills along the sketch's normal (FreeCAD drills against it). */
  readonly reversed: boolean;
  /** Which of the sketch's geometry gives centres (`BaseProfileType`). */
  readonly on: { readonly points: boolean; readonly circles: boolean; readonly arcs: boolean };
  /** Threaded but the thread not modelled: a plain hole of the stored diameter, the thread lost. */
  readonly threadLost: boolean;
  readonly sources: Readonly<Record<string, string>>;
}

const DEPTH_TYPES = ['Dimension', 'ThroughAll', 'UpToFirst', 'UpToFace', 'UpToShape'];
const DRILL_POINTS = ['Flat', 'Angled'];
/** FreeCAD's own first three cut types, the same in every version (the rest changed, FORMAT.md). */
const HOLE_CUTS = ['None', 'Counterbore', 'Countersink'];

/** The hole's cut type: by name where the file has the names, else by its first three indices. */
function holeCut(o: FcObject): DecodedHoleCut {
  const v = value(o, 'HoleCutType');
  if (v === undefined) return refuse('value', 'it has no HoleCutType');
  if (v.kind !== 'enum' && v.kind !== 'integer')
    return refuse('value', 'its HoleCutType is not a choice');
  const index = v.kind === 'enum' ? v.index : v.value;
  const name = v.kind === 'enum' ? v.values?.[index]?.replace(/^\?/, '') : undefined;
  if (name === undefined && v.kind === 'enum' && v.values !== undefined)
    return refuse('value', `its HoleCutType is choice ${index}, which the file doesn't list`);
  const known = name ?? (Number.isInteger(index) && index >= 0 ? HOLE_CUTS[index] : undefined);
  if (known === 'None') return 'none';
  if (known === 'Counterbore') return 'counterbore';
  if (known === 'Countersink') return 'countersink';
  if (name === 'Counterdrill') return refuse('option', 'it is counterdrilled');
  if (!Number.isInteger(index) || index < 0)
    return refuse('value', `its HoleCutType ${index} is not a choice`);
  return 'counterbore-or-countersink';
}

function hole(doc: FcDocument, o: FcObject): DecodedHole {
  if (bool(o, 'Suppressed', false)) refuse('suppressed', 'it is suppressed');
  const sketch = profileSketch(doc, o);
  const sources: Record<string, string> = { points: 'Profile', diameter: 'Diameter' };
  if (bool(o, 'Tapered', false)) refuse('option', 'it is tapered');
  const threaded = bool(o, 'Threaded', false);
  const modelled = bool(o, 'ModelThread', false) || bool(o, 'ModelActualThread', false);
  if (threaded && modelled) refuse('option', 'its thread is modelled');
  if (bool(o, 'Midplane', false)) refuse('option', 'it goes both ways from its sketch');
  const diameter = size(o, 'Diameter');
  const depthType = choice(o, 'DepthType', DEPTH_TYPES);
  if (depthType !== 'Dimension' && depthType !== 'ThroughAll')
    refuse('up-to', `it goes ${upTo(depthType)}`);
  const extent = depthType === 'ThroughAll' ? 'through' : 'blind';
  let depth: number | undefined;
  let tipAngle = 0;
  if (extent === 'blind') {
    depth = size(o, 'Depth');
    sources.depth = 'Depth';
    if (choice(o, 'DrillPoint', DRILL_POINTS) === 'Angled') {
      tipAngle = number(o, 'DrillPointAngle');
      if (!(tipAngle > 0 && tipAngle < 180))
        refuse('value', `its DrillPointAngle of ${tipAngle}° is out of range`);
      sources.tipAngle = 'DrillPointAngle';
      // With DrillForDepth FreeCAD's depth reaches the point's tip; Extrudo's ends at the full diameter.
      if (bool(o, 'DrillForDepth', false)) {
        depth -= diameter / 2 / Math.tan((tipAngle * Math.PI) / 360);
        if (!(depth > 1e-6)) refuse('value', 'its depth is no deeper than its drill point');
      }
    }
  }
  const cut = holeCut(o);
  const out: {
    cutDiameter?: number;
    cutDepth?: number;
    cutAngle?: number;
  } = {};
  if (cut !== 'none') {
    out.cutDiameter = size(o, 'HoleCutDiameter');
    sources.cutDiameter = 'HoleCutDiameter';
    if (cut !== 'countersink') {
      out.cutDepth = size(o, 'HoleCutDepth');
      sources.cutDepth = 'HoleCutDepth';
    }
    if (cut !== 'counterbore') {
      out.cutAngle = number(o, 'HoleCutCountersinkAngle');
      if (!(out.cutAngle > 0 && out.cutAngle < 180))
        refuse('value', `its HoleCutCountersinkAngle of ${out.cutAngle}° is out of range`);
      sources.cutAngle = 'HoleCutCountersinkAngle';
    }
  }
  // OnPoints 1, OnCircles 2, OnArcs 4; files before the setting drill at circles and arcs.
  const types = number(o, 'BaseProfileType', 6);
  if (!Number.isInteger(types) || types < 0 || types > 7)
    refuse('value', `its BaseProfileType of ${types} is not a choice`);
  const reversed = bool(o, 'Reversed', false);
  if (reversed) sources.flip = 'Reversed';
  return {
    kind: 'hole',
    object: o.name,
    sketch,
    diameter,
    extent,
    ...(depth !== undefined ? { depth } : {}),
    tipAngle,
    cut,
    ...out,
    reversed,
    on: { points: (types & 1) !== 0, circles: (types & 2) !== 0, arcs: (types & 4) !== 0 },
    threadLost: threaded,
    sources,
  };
}
