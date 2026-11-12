/**
 * Test support (no production code): `.FCStd` files with PartDesign bodies
 * written by hand for the history tests (S5): bodies, origins, sketches and
 * Pad / Pocket / Revolution / Groove objects in FreeCAD's grammar, each
 * feature storing the body after it as B-rep text the kernel's test support
 * writes (boxes and cylinders of any size). No part of any real file.
 */
import {
  documentXml,
  type FixtureObject,
  fcstd,
  guiXml,
  label,
  link,
  links,
  placement,
  prop,
  shape,
} from './fixtures';
import { line, type SketchSpec, sketchObject } from './sketch-fixtures';

export type Place = [number, number, number, number?, [number, number, number]?];

export interface FeatureSpec {
  name: string;
  /** `Pad`, `Pocket`, `Revolution`, `Groove`, or a whole type (`PartDesign::Fillet`). */
  type: string;
  /** The profile sketch's name (`Profile`), unless `props` say otherwise. */
  sketch?: string;
  /** Sub-names on the profile link. */
  profileSubs?: string[];
  length?: number | string;
  length2?: number | string;
  /** The `Type` enumeration's index. */
  kind?: number;
  reversed?: boolean;
  midplane?: boolean;
  angle?: number | string;
  /** `ReferenceAxis`: an object and its sub-names. */
  axis?: { object: string; subs?: string[] };
  /** More properties, already written. */
  props?: string[];
  /** Properties not to write. */
  omit?: string[];
  /** The stored shape (B-rep text); `undefined` stores none. */
  stored?: string;
  /** `BaseFeature`, when it isn't the previous feature. */
  base?: string | null;
}

export interface BodySpec {
  name: string;
  label?: string;
  placement?: Place;
  sketches: SketchSpec[];
  features: FeatureSpec[];
  /** `Tip`; the last feature by default (`null` for none). */
  tip?: string | null;
  /** The body's own `Shape` (in its container's frame); the tip's stored shape by default. */
  final?: string;
  /** Write an origin with its axes (`<body>X_Axis` …). */
  origin?: boolean;
  /** `Group`, when it isn't origin, sketches and features in order. */
  group?: string[];
  /** More properties of the body, already written. */
  props?: string[];
}

export const linkSub = (name: string, object: string, subs: string[] = []) =>
  prop(
    name,
    'App::PropertyLinkSub',
    `<LinkSub value="${object}" count="${subs.length}">${subs.map((s) => `<Sub value="${s}"/>`).join('')}</LinkSub>`,
  );
export const bool = (name: string, value: boolean) =>
  prop(name, 'App::PropertyBool', `<Bool value="${value ? 'true' : 'false'}"/>`);
export const choice = (name: string, index: number) =>
  prop(name, 'App::PropertyEnumeration', `<Integer value="${index}"/>`);
export const num = (name: string, value: number | string, type = 'App::PropertyLength') =>
  prop(name, type, `<Float value="${value}"/>`);

const TYPES: Record<string, string> = {
  Pad: 'PartDesign::Pad',
  Pocket: 'PartDesign::Pocket',
  Revolution: 'PartDesign::Revolution',
  Groove: 'PartDesign::Groove',
};

function featureObject(f: FeatureSpec, base: string | undefined): FixtureObject {
  const type = TYPES[f.type] ?? f.type;
  const revolve = type.endsWith('Revolution') || type.endsWith('Groove');
  const omit = new Set(f.omit ?? []);
  const props: [string, string][] = [
    ['Label', label(f.name)],
    ['Placement', placement()],
    ['Profile', linkSub('Profile', f.sketch ?? 'Sketch', f.profileSubs)],
    ['Type', choice('Type', f.kind ?? 0)],
    ['Reversed', bool('Reversed', f.reversed ?? false)],
    ['Midplane', bool('Midplane', f.midplane ?? false)],
    ...((revolve
      ? [
          ['Angle', num('Angle', f.angle ?? 360, 'App::PropertyAngle')],
          [
            'ReferenceAxis',
            linkSub(
              'ReferenceAxis',
              f.axis?.object ?? f.sketch ?? 'Sketch',
              f.axis ? (f.axis.subs ?? []) : ['V_Axis'],
            ),
          ],
        ]
      : [
          ['Length', num('Length', f.length ?? 10)],
          ['Length2', num('Length2', f.length2 ?? 10)],
        ]) as [string, string][]),
    ['BaseFeature', link('BaseFeature', base ?? '')],
    ['Shape', shape(`${f.name}.brp`)],
  ];
  return {
    name: f.name,
    type,
    props: [...props.filter(([n]) => !omit.has(n)).map(([, p]) => p), ...(f.props ?? [])],
  };
}

function originObjects(body: string): FixtureObject[] {
  const axes = ['X', 'Y', 'Z'].map((a) => ({
    name: `${body}${a}_Axis`,
    type: 'App::Line',
    props: [
      label(`${a}_Axis`),
      placement(),
      prop('Role', 'App::PropertyString', `<String value="${a}_Axis"/>`),
    ],
  }));
  return [
    {
      name: `${body}Origin`,
      type: 'App::Origin',
      props: [
        label('Origin'),
        placement(),
        links(
          'OriginFeatures',
          axes.map((a) => a.name),
        ),
      ],
    },
    ...axes,
  ];
}

/** The objects and entries of one body. */
export function bodyParts(b: BodySpec): {
  objects: FixtureObject[];
  entries: Record<string, string>;
} {
  const entries: Record<string, string> = {};
  const features = b.features.map((f, i) => {
    const previous = i > 0 ? b.features[i - 1]?.name : undefined;
    const base = f.base === null ? undefined : (f.base ?? previous);
    if (f.stored !== undefined) entries[`${f.name}.brp`] = f.stored;
    return featureObject(f, base);
  });
  const tip = b.tip === null ? undefined : (b.tip ?? b.features.at(-1)?.name);
  const tipStored = b.features.find((f) => f.name === tip)?.stored;
  const final = b.final ?? tipStored;
  if (final !== undefined) entries[`${b.name}.brp`] = final;
  const origin = b.origin ? originObjects(b.name) : [];
  const sketches = b.sketches.map((s) => sketchObject(s));
  const group = b.group ?? [
    ...origin.slice(0, 1).map((o) => o.name),
    ...sketches.map((s) => s.name),
    ...features.map((f) => f.name),
  ];
  const at = b.placement ?? [0, 0, 0];
  const body: FixtureObject = {
    name: b.name,
    type: 'PartDesign::Body',
    extensions: ['App::OriginGroupExtension'],
    props: [
      label(b.label ?? b.name),
      placement(at[0], at[1], at[2], at[3] ?? 0, at[4] ?? [0, 0, 1]),
      links('Group', group),
      link('Tip', tip ?? ''),
      ...(b.origin ? [link('Origin', `${b.name}Origin`)] : []),
      shape(`${b.name}.brp`),
      ...(b.props ?? []),
    ],
  };
  return { objects: [body, ...origin, ...sketches, ...features], entries };
}

/** A file of these bodies (and other objects), as FreeCAD 1.0 saves it, with a GUI document. */
export function historyFile(
  bodies: BodySpec[],
  options: {
    extra?: FixtureObject[];
    entries?: Record<string, string>;
    version?: string;
    hidden?: string[];
  } = {},
): Uint8Array {
  const objects: FixtureObject[] = [];
  const entries: Record<string, string> = { ...options.entries };
  for (const b of bodies) {
    const parts = bodyParts(b);
    objects.push(...parts.objects);
    Object.assign(entries, parts.entries);
  }
  objects.push(...(options.extra ?? []));
  return fcstd({
    'Document.xml': documentXml(objects, {
      label: 'History',
      ...(options.version ? { version: options.version } : {}),
    }),
    'GuiDocument.xml': guiXml(
      bodies.map((b) => ({
        name: b.name,
        visible: !(options.hidden ?? []).includes(b.name),
        colour: 0x3366ccff,
      })),
    ),
    ...entries,
  });
}

/** A closed rectangle of four lines from `(x0, y0)` to `(x1, y1)`, counter-clockwise from its bottom edge. */
export const rectangle = (x0: number, y0: number, x1: number, y1: number): string[] => [
  line(x0, y0, x1, y0),
  line(x1, y0, x1, y1),
  line(x1, y1, x0, y1),
  line(x0, y1, x0, y0),
];

/**
 * A placement whose sketch x is world +y, sketch y world +z and normal world
 * +x (a turn of 120° about (1, 1, 1)), at `[x, y, z]`: the vertical plane a
 * revolve about the sketch's V axis turns round a vertical line.
 */
export const facingX = (x: number, y: number, z: number): Place => [
  x,
  y,
  z,
  (2 * Math.PI) / 3,
  [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)],
];

/** FreeCAD's XZ plane for a sketch: sketch y is world +z, the normal world −y. */
export const onXZ = (y = 0): Place => [0, y, 0, Math.PI / 2, [1, 0, 0]];

/**
 * A stored "shape" that is only a measure, for a test kernel that answers
 * with it (`measuringKernel`): FreeCAD's numbers for a shape no generator here
 * writes. Starts with the format line so the reader passes it on.
 */
export const measureText = (m: {
  solids: number;
  volume: number;
  area: number;
  box: { min: number[]; max: number[] };
}) => `CASCADE Topology V1, (c) Matra-Datavision\nMEASURE ${JSON.stringify(m)}\n`;
