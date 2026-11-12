/**
 * PartDesign's four sketch-based features (Pad, Pocket, Revolution, Groove)
 * as typed data (ADR-0144 S5): what Extrudo's `extrude` and `revolve` can
 * say, decoded from the feature's properties, or why not, from a closed set
 * of reasons. Nothing is mapped onto a design here and nothing is guessed: a
 * property this slice reads that is missing, unreadable, of the wrong kind,
 * not finite or out of range refuses the feature (`value`), and so does any
 * setting the slice doesn't map. What a property it doesn't read changes is
 * caught by the comparison with the stored shape (`bodies.ts`).
 *
 * `decodeFeature` never throws for anything a file holds. The properties as
 * read are in `FORMAT.md`.
 */
import { linkedObjects } from './final-shapes';
import type { FcDocument, FcObject, FcValue } from './model';
import type { DecodedSketch } from './sketch-decode';

export type FeatureKind = 'pad' | 'pocket' | 'revolution' | 'groove';

/** The FreeCAD types this slice maps, by kind. */
export const FEATURE_TYPES: Readonly<Record<string, FeatureKind>> = {
  'PartDesign::Pad': 'pad',
  'PartDesign::Pocket': 'pocket',
  'PartDesign::Revolution': 'revolution',
  'PartDesign::Groove': 'groove',
};

/** Why a feature is not mapped: the closed set the report and the app word. */
export type FeatureRefusal =
  /** Not one of the four features (a fillet, a pattern, a hole …: later slices). */
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
  /** A Pocket or a Groove with nothing before it to cut. */
  | 'no-base';

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

export type DecodedFeature =
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
  if (!target) return refuse('profile', `its profile ${object} isn't in the file`);
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
  if (!target) return refuse('axis', `its axis ${v.object} isn't in the file`);
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
        : revolution(doc, object, kind, context);
    return { ok: true, feature };
  } catch (error) {
    if (error instanceof Refuse) return { ok: false, reason: error.reason, detail: error.detail };
    // Nothing in a file should get here; if it does, the feature is refused, never the import.
    return { ok: false, reason: 'value', detail: String((error as Error)?.message ?? error) };
  }
}
