/**
 * Test support (no production code): the S7 fixture parts
 * (`pattern-fixtures.ts`, made with FreeCAD 1.1.4 by our own script) as
 * `.FCStd` bytes, each object's properties written back in FreeCAD's grammar
 * from the values its own XML holds, so the importer reads what FreeCAD
 * wrote. `change` swaps a property's value (or drops it with `undefined`) to
 * map a part wrongly on purpose or to make it hostile.
 */

import { documentXml, type FixtureObject, fcstd, guiXml, label, links, prop } from './fixtures';
import {
  BREP,
  type FixtureProp,
  PATTERN_CASES,
  type PatternFixtureCase,
  type PatternFixtureObject,
  PROPS,
} from './pattern-fixtures';
import { circle, line, sketchObject } from './sketch-fixtures';

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
    }
  >
>;

const placementOfQuaternion = (at: readonly number[]) => {
  const [x, y, z, qx, qy, qz, qw] = at as [number, number, number, number, number, number, number];
  return prop(
    'Placement',
    'App::PropertyPlacement',
    `<PropertyPlacement Px="${x}" Py="${y}" Pz="${z}" Q0="${qx}" Q1="${qy}" Q2="${qz}" Q3="${qw}" A="0" Ox="0" Oy="0" Oz="1"/>`,
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
      const s = sketchObject({
        name: o.object,
        geometry:
          options.sketchGeometry?.[o.object] ??
          o.sketch.geometry.map((g) =>
            g[0] === 'line'
              ? line(g[1] as number, g[2] as number, g[3] as number, g[4] as number)
              : circle(g[1] as number, g[2] as number, g[3] as number),
          ),
      });
      // The stored placement as a quaternion (the helper writes an angle about an axis).
      s.props = s.props.map((p) =>
        p.startsWith('<Property name="Placement"') ? placementOfQuaternion(o.sketch?.at ?? []) : p,
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
        placementOfQuaternion([0, 0, 0, 0, 0, 0, 1]),
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
