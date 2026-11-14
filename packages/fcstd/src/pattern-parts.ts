/**
 * Test support (no production code): the S7 fixture parts
 * (`pattern-fixtures.ts`, made with FreeCAD 1.1.4 by our own script) as
 * `.FCStd` bytes, each object's properties written back in FreeCAD's grammar
 * from the values its own XML holds, so the importer reads what FreeCAD
 * wrote. `change` swaps a property's value (or drops it with `undefined`) to
 * map a part wrongly on purpose or to make it hostile.
 */

import { MAP_MODES } from './attach';
import { documentXml, type FixtureObject, fcstd, guiXml, label, links, prop } from './fixtures';
import {
  BREP,
  type FixtureProp,
  PATTERN_CASES,
  type PatternFixtureCase,
  type PatternFixtureObject,
  PROPS,
} from './pattern-fixtures';
import { circle, constraint, line, sketchObject } from './sketch-fixtures';

/** `ExternalGeo` as FreeCAD 1.x writes it: the two axes, then each projected curve with its `ref`. */
function externalGeoXml(geo: readonly (readonly (string | number)[])[]): string {
  const f = (v: number) => v.toFixed(16);
  const ext = (id: number, ref: string) =>
    `<GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="${id}" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="${esc(ref)}" Flags="0"/></GeoExtensions>`;
  const lineXml = (id: number, ref: string, x1: number, y1: number, x2: number, y2: number) =>
    `<Geometry type="Part::GeomLineSegment" id="${id}"${ref ? ` ref="${esc(ref)}"` : ''} migrated="1">${ext(id, ref)}<LineSegment StartX="${f(x1)}" StartY="${f(y1)}" StartZ="0" EndX="${f(x2)}" EndY="${f(y2)}" EndZ="0"/><Construction value="1"/></Geometry>`;
  const records = [lineXml(-1, '', 0, 0, 1, 0), lineXml(-2, '', 0, 0, 0, 1)];
  geo.forEach((g, i) => {
    const id = i + 1;
    if (g[0] === 'line')
      records.push(
        lineXml(id, g[5] as string, g[1] as number, g[2] as number, g[3] as number, g[4] as number),
      );
    else if (g[0] === 'circle')
      records.push(
        `<Geometry type="Part::GeomCircle" id="${id}" ref="${esc(g[4] as string)}" migrated="1">${ext(id, g[4] as string)}<Circle CenterX="${f(g[1] as number)}" CenterY="${f(g[2] as number)}" CenterZ="0" NormalX="0" NormalY="0" NormalZ="1" AngleXU="0" Radius="${f(g[3] as number)}"/><Construction value="1"/></Geometry>`,
      );
    else if (g[0] === 'arc')
      // An arc as FreeCAD 1.x stores it: centre, radius, AngleXU, start and end angles, the normal's Z.
      records.push(
        `<Geometry type="Part::GeomArcOfCircle" id="${id}" ref="${esc(g[8] as string)}" migrated="1">${ext(id, g[8] as string)}<ArcOfCircle CenterX="${f(g[1] as number)}" CenterY="${f(g[2] as number)}" CenterZ="0" NormalX="0" NormalY="0" NormalZ="${f(g[7] as number)}" AngleXU="${f(g[4] as number)}" Radius="${f(g[3] as number)}" StartAngle="${f(g[5] as number)}" EndAngle="${f(g[6] as number)}"/><Construction value="1"/></Geometry>`,
      );
    else records.push(g[1] as string);
  });
  return prop(
    'ExternalGeo',
    'Part::PropertyGeometryList',
    `<GeometryList count="${records.length}">${records.join('')}</GeometryList>`,
  );
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A FloatList entry as FreeCAD writes one: a little-endian count, then the doubles. */
export function floatListBytes(values: readonly number[]): Uint8Array {
  const out = new Uint8Array(4 + 8 * values.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, values.length, true);
  values.forEach((v, i) => {
    view.setFloat64(4 + 8 * i, v, true);
  });
  return out;
}

/** One property's XML; FloatList values go into `entries` under `<object>.<name>`. */
function propXml(
  object: string,
  [name, type, value]: FixtureProp,
  entries: Record<string, string | Uint8Array>,
): string {
  if (typeof value === 'number' || typeof value === 'string') {
    const tag = /Integer|Enumeration/.test(type) ? 'Integer' : 'Float';
    return prop(name, type, `<${tag} value="${value}"/>`);
  }
  if (typeof value === 'boolean')
    return prop(name, type, `<Bool value="${value ? 'true' : 'false'}"/>`);
  const v = value as Record<string, unknown>;
  if ('index' in v) {
    const names = v.names as string[];
    return prop(
      name,
      type,
      `<Integer value="${v.index}" CustomEnum="true"/><CustomEnumList count="${names.length}">${names.map((n) => `<Enum value="${esc(n)}"/>`).join('')}</CustomEnumList>`,
    );
  }
  if ('link' in v) return prop(name, type, `<Link value="${v.link}"/>`);
  if ('sub' in v) {
    const [target, subs] = v.sub as [string, string[]];
    return prop(
      name,
      type,
      `<LinkSub value="${target}" count="${subs.length}">${subs.map((s) => `<Sub value="${esc(s)}"/>`).join('')}</LinkSub>`,
    );
  }
  if ('list' in v) {
    const list = v.list as string[];
    return prop(
      name,
      type,
      `<LinkList count="${list.length}">${list.map((l) => `<Link value="${l}"/>`).join('')}</LinkList>`,
    );
  }
  if ('subList' in v) {
    const list = v.subList as [string, string][];
    return prop(
      name,
      type,
      `<LinkSubList count="${list.length}">${list.map(([o, s]) => `<Link obj="${o}" sub="${s}"/>`).join('')}</LinkSubList>`,
    );
  }
  if ('floats' in v) {
    const floats = v.floats as number[];
    if (floats.length === 0) return prop(name, type, `<FloatList file=""/>`);
    const entry = `${object}.${name}`;
    entries[entry] = floatListBytes(floats);
    return prop(name, type, `<FloatList file="${entry}"/>`);
  }
  if ('ints' in v) {
    const ints = v.ints as number[];
    return prop(
      name,
      type,
      `<IntegerList count="${ints.length}">${ints.map((i) => `<I v="${i}"/>`).join('')}</IntegerList>`,
    );
  }
  if ('vector' in v) {
    const [x, y, z] = v.vector as number[];
    return prop(name, type, `<PropertyVector valueX="${x}" valueY="${y}" valueZ="${z}"/>`);
  }
  if ('string' in v) return prop(name, type, `<String value="${esc(v.string as string)}"/>`);
  if ('raw' in v) return prop(name, type, v.raw as string);
  throw new Error(`a fixture property ${name} of an unknown form`);
}

/** A property value in the fixtures' form, for `change`. */
export const P = {
  float: (v: number | string) => v,
  int: (v: number) => v,
  bool: (v: boolean) => v,
  link: (target: string) => ({ link: target }),
  sub: (target: string, subs: string[]) => ({ sub: [target, subs] }),
  list: (targets: string[]) => ({ list: targets }),
  floats: (values: number[]) => ({ floats: values }),
  /** Already written XML for the value element(s). */
  raw: (xml: string) => ({ raw: xml }),
};

/** What a test changes: per object, property values (`undefined` drops it), its stored shape, or the whole object. */
export type PartChange = Readonly<
  Record<
    string,
    {
      readonly props?: Readonly<Record<string, unknown>>;
      readonly stored?: string | null;
      readonly type?: string;
      /** S9: the stored placement (position, quaternion) of a datum or a sketch. */
      readonly at?: readonly number[];
      /** S9: a sketch's constraints, external links, external geometry or supports replaced (`undefined` drops them). */
      readonly constraints?: readonly (readonly (string | number | boolean)[])[];
      readonly external?: readonly (readonly string[])[] | undefined;
      readonly externalGeo?: readonly (readonly (string | number)[])[] | undefined;
      readonly support?: readonly (readonly string[])[] | undefined;
    }
  >
>;

/**
 * A placement as FreeCAD writes it: the quaternion and, as FreeCAD's reader
 * takes them first, the same rotation as an angle about an axis.
 */
const placementOfQuaternion = (at: readonly number[]) => {
  const [x, y, z, qx, qy, qz, qw] = at as [number, number, number, number, number, number, number];
  const s = Math.hypot(qx, qy, qz);
  const angle = s > 1e-15 ? 2 * Math.atan2(s, qw) : 0;
  const [ox, oy, oz] = s > 1e-15 ? [qx / s, qy / s, qz / s] : [0, 0, 1];
  return prop(
    'Placement',
    'App::PropertyPlacement',
    `<PropertyPlacement Px="${x}" Py="${y}" Pz="${z}" Q0="${qx}" Q1="${qy}" Q2="${qz}" Q3="${qw}" A="${angle}" Ox="${ox}" Oy="${oy}" Oz="${oz}"/>`,
  );
};

const ORIGIN = ['X_Axis', 'Y_Axis', 'Z_Axis', 'XY_Plane', 'XZ_Plane', 'YZ_Plane'];

export interface PartOptions {
  /** The body's placement (position, angle in radians, axis): a moved body. */
  readonly bodyAt?: readonly [number, number, number, number?, [number, number, number]?];
  /** Objects added to the file (another body …). */
  readonly extra?: FixtureObject[];
  /** More body members after the case's own. */
  readonly members?: string[];
  /** The tip, when it isn't the case's. */
  readonly tip?: string;
  /** A sketch's geometry replaced, already written (`circle`, `line` …), by sketch name. */
  readonly sketchGeometry?: Readonly<Record<string, string[]>>;
  /** The objects' own placements (all identity in the fixtures), written as given. */
  readonly version?: string;
  /** The fixture set the part is from (S7's by default; S8's `STEP_FIXTURES`). */
  readonly fixtures?: FixtureSet;
}

/** A set of fixture parts in `pattern-fixtures.ts`'s form. */
export interface FixtureSet {
  readonly cases: Readonly<Record<string, PatternFixtureCase>>;
  readonly brep: readonly string[];
  readonly props: readonly (readonly FixtureProp[])[];
}

/** S7's parts. */
export const PATTERN_FIXTURES: FixtureSet = { cases: PATTERN_CASES, brep: BREP, props: PROPS };

/** The objects and entries of one fixture part, as one body named `Body`. */
export function partObjects(
  name: string,
  change: PartChange = {},
  options: PartOptions = {},
): { objects: FixtureObject[]; entries: Record<string, string | Uint8Array> } {
  const set = options.fixtures ?? PATTERN_FIXTURES;
  const c = set.cases[name] as PatternFixtureCase;
  if (!c) throw new Error(`no fixture part ${name}`);
  const entries: Record<string, string | Uint8Array> = {};
  const objects: FixtureObject[] = [];
  const stored = (o: PatternFixtureObject): string | undefined => {
    const ch = change[o.object]?.stored;
    if (ch === null) return undefined;
    return ch ?? (o.stored !== undefined ? set.brep[o.stored] : undefined);
  };
  for (const o of c.objects) {
    if (o.sketch) {
      const sk = o.sketch;
      const sch = change[o.object];
      const s = sketchObject({
        name: o.object,
        geometry:
          options.sketchGeometry?.[o.object] ??
          sk.geometry.map((g) => {
            const c = { construction: g.at(-1) === 'construction' };
            return g[0] === 'line'
              ? line(g[1] as number, g[2] as number, g[3] as number, g[4] as number, c)
              : circle(g[1] as number, g[2] as number, g[3] as number, c);
          }),
        constraints: (sch?.constraints ?? sk.constraints ?? []).map((c) =>
          constraint({
            type: c[0] as number,
            value: c[1] as number,
            first: c[2] as number,
            firstPos: c[3] as number,
            second: c[4] as number,
            secondPos: c[5] as number,
            third: c[6] as number,
            thirdPos: c[7] as number,
            ...(c[8] ? { name: c[8] as string } : {}),
            ...(c[9] === false ? { driving: false } : {}),
            ...(c[10] === false ? { active: false } : {}),
          }),
        ),
      });
      // The stored placement as a quaternion (the helper writes an angle about an axis).
      s.props = s.props.map((p) =>
        p.startsWith('<Property name="Placement"')
          ? placementOfQuaternion(sch?.at ?? sk.at ?? [])
          : p,
      );
      const external = sch && 'external' in sch ? sch.external : sk.external;
      if (external)
        s.props.push(
          prop(
            'ExternalGeometry',
            'App::PropertyLinkSubList',
            `<LinkSubList count="${external.length}">${external
              .map(
                ([obj, sub, shadow]) =>
                  `<Link obj="${esc(obj as string)}" sub="${esc(sub as string)}"${shadow ? ` shadow="${esc(shadow)}"` : ''}/>`,
              )
              .join('')}</LinkSubList>`,
          ),
        );
      const geo = sch && 'externalGeo' in sch ? sch.externalGeo : sk.externalGeo;
      if (geo) s.props.push(externalGeoXml(geo));
      const support = sch && 'support' in sch ? sch.support : sk.support;
      if (support)
        s.props.push(
          prop(
            'AttachmentSupport',
            'App::PropertyLinkSubList',
            `<LinkSubList count="${support.length}">${support
              .map(
                ([obj, sub]) => `<Link obj="${esc(obj as string)}" sub="${esc(sub as string)}"/>`,
              )
              .join('')}</LinkSubList>`,
          ),
        );
      if (sk.mapMode !== undefined)
        s.props.push(
          prop(
            'MapMode',
            'App::PropertyEnumeration',
            `<Integer value="${Math.max(0, MAP_MODES.indexOf(sk.mapMode))}"/>`,
          ),
        );
      objects.push(s);
      continue;
    }
    const ch = change[o.object]?.props ?? {};
    const props: FixtureProp[] = (set.props[o.props as number] ?? []).map((p) =>
      Object.hasOwn(ch, p[0]) ? [p[0], p[1], ch[p[0]]] : p,
    );
    for (const [k, v] of Object.entries(ch))
      if (!props.some((p) => p[0] === k)) props.push([k, guessType(v), v]);
    const text = stored(o);
    if (text !== undefined) entries[`${o.object}.Shape.brp`] = text;
    objects.push({
      name: o.object,
      type: change[o.object]?.type ?? (o.type as string),
      props: [
        label(o.object),
        placementOfQuaternion(change[o.object]?.at ?? o.at ?? [0, 0, 0, 0, 0, 0, 1]),
        ...props.filter((p) => p[2] !== undefined).map((p) => propXml(o.object, p, entries)),
        prop(
          'Shape',
          'Part::PropertyPartShape',
          `<Part file="${text !== undefined ? `${o.object}.Shape.brp` : ''}"/>`,
        ),
      ],
    });
  }
  const origin: FixtureObject[] = [
    {
      name: 'Origin',
      type: 'App::Origin',
      props: [
        label('Origin'),
        placementOfQuaternion([0, 0, 0, 0, 0, 0, 1]),
        links('OriginFeatures', ORIGIN),
      ],
    },
    ...ORIGIN.map((n) => ({
      name: n,
      type: n.endsWith('Axis') ? 'App::Line' : 'App::Plane',
      props: [
        label(n),
        placementOfQuaternion([0, 0, 0, 0, 0, 0, 1]),
        prop('Role', 'App::PropertyString', `<String value="${n}"/>`),
      ],
    })),
  ];
  const tip = options.tip ?? c.tip;
  const tipText = c.objects.find((o) => o.object === tip);
  const final = tipText ? stored(tipText) : undefined;
  if (final !== undefined) entries['Body.Shape.brp'] = final;
  const at = options.bodyAt ?? [0, 0, 0];
  const angle = at[3] ?? 0;
  const axis = at[4] ?? [0, 0, 1];
  const s = Math.sin(angle / 2);
  const body: FixtureObject = {
    name: 'Body',
    type: 'PartDesign::Body',
    extensions: ['App::OriginGroupExtension'],
    props: [
      label('Part'),
      placementOfQuaternion([
        at[0],
        at[1],
        at[2],
        axis[0] * s,
        axis[1] * s,
        axis[2] * s,
        Math.cos(angle / 2),
      ]),
      links('Group', [...c.group, ...(options.members ?? [])]),
      prop('Tip', 'App::PropertyLink', `<Link value="${tip}"/>`),
      prop('Origin', 'App::PropertyLink', `<Link value="Origin"/>`),
      prop(
        'Shape',
        'Part::PropertyPartShape',
        `<Part file="${final !== undefined ? 'Body.Shape.brp' : ''}"/>`,
      ),
    ],
  };
  return { objects: [body, ...origin, ...objects, ...(options.extra ?? [])], entries };
}

function guessType(v: unknown): string {
  if (typeof v === 'boolean') return 'App::PropertyBool';
  if (typeof v === 'number') return 'App::PropertyFloat';
  const o = v as Record<string, unknown>;
  if ('sub' in o) return 'App::PropertyLinkSub';
  if ('list' in o) return 'App::PropertyLinkList';
  if ('link' in o) return 'App::PropertyLink';
  if ('floats' in o) return 'App::PropertyFloatList';
  return 'App::PropertyString';
}

/** One fixture part as `.FCStd` bytes, as FreeCAD 1.1 saves it. */
export function partFile(
  name: string,
  change: PartChange = {},
  options: PartOptions = {},
): Uint8Array {
  const { objects, entries } = partObjects(name, change, options);
  return fcstd({
    'Document.xml': documentXml(objects, {
      label: 'Parts',
      version: options.version ?? '1.1.4R20260101 (Git)',
    }),
    'GuiDocument.xml': guiXml([{ name: 'Body', visible: true, colour: 0x3366ccff }]),
    ...entries,
  });
}

/** The names of every fixture part. */
export const PATTERN_PARTS = Object.keys(PATTERN_CASES);
