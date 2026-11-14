/**
 * `readFcstd(bytes)`: a FreeCAD `.FCStd` file as plain data. The document's
 * facts, every object with its typed properties, expressions and extensions,
 * and what `GuiDocument.xml` says about each object's visibility and colour.
 * Nothing is resolved or interpreted here: links stay object names, enums stay
 * the stored integers (with the file's own string list when it has one), and a
 * sketch's geometry and constraints stay the raw records the file holds. The
 * format is in `FORMAT.md` beside this package's sources.
 *
 * Anything left out or unreadable lands in `FcDocument.problems`, never
 * silently (ADR-0083's rule); only a file that isn't an `.FCStd` at all, or
 * that breaks a limit, throws `FcstdFormatError`.
 */
import { type FcEntries, unzipFcstd } from './archive';
import { FcstdFormatError, finite, short } from './errors';
import { child, children, parseXmlBytes, type XmlElement } from './xml';

export type Vec3 = readonly [number, number, number];

/** A placement: `p' = R·p + position`, the rotation a unit quaternion `[x, y, z, w]`. */
export interface FcPlacement {
  readonly position: Vec3;
  readonly rotation: readonly [number, number, number, number];
}

/** One sub-element of a link (`Face6`, `Edge12`, `H_Axis`, `''` for the whole object). */
export interface FcSub {
  /** The name FreeCAD restores: the `shadowed` name when the file has one, else the stored one. */
  readonly name: string;
  /** The stored name when `shadowed` replaced it. */
  readonly old?: string;
  /** FreeCAD 1.0's topological name, kept beside it (`;g1126;SKT.Edge4`). */
  readonly shadow?: string;
}

/** A raw element of the file: its name, attributes and children, nothing interpreted. */
export interface FcRecord {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly FcRecord[];
}

export interface FcExpression {
  /** The bound property path (`Length`, `.Constraints.width`, `Placement.Base.x`). */
  readonly path: string;
  readonly expression: string;
}

export interface FcCell {
  readonly address: string;
  readonly content: string;
  readonly alias?: string;
}

/** The colour of a packed `0xRRGGBBAA` value; channel bytes as stored (the alpha byte's meaning depends on the version). */
export interface FcColourBytes {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** What a numeric property's stored number is in (FreeCAD stores internal units whatever the unit system). */
export type FcUnit = 'mm' | 'mm²' | 'mm³' | 'deg';

/** A property's value, by the element the file stores it as. */
export type FcValue =
  | { readonly kind: 'integer'; readonly value: number }
  | { readonly kind: 'float'; readonly value: number; readonly unit?: FcUnit }
  | { readonly kind: 'bool'; readonly value: boolean }
  | { readonly kind: 'string'; readonly value: string }
  /** `index` into `values` when the file lists them, else into the class's own list. */
  | { readonly kind: 'enum'; readonly index: number; readonly values?: readonly string[] }
  | { readonly kind: 'vector'; readonly value: Vec3 }
  | { readonly kind: 'placement'; readonly value: FcPlacement }
  | { readonly kind: 'colour'; readonly packed: number; readonly value: FcColourBytes }
  | { readonly kind: 'link'; readonly object: string | undefined }
  | { readonly kind: 'linkList'; readonly objects: readonly string[] }
  | {
      readonly kind: 'linkSub';
      readonly object: string | undefined;
      readonly subs: readonly FcSub[];
    }
  | {
      readonly kind: 'linkSubList';
      readonly items: readonly { readonly object: string; readonly sub: FcSub }[];
    }
  /** A link that may name another document (`file`, `''` for this one). */
  | {
      readonly kind: 'xlink';
      readonly items: readonly {
        readonly object: string;
        readonly file: string;
        readonly subs: readonly FcSub[];
      }[];
    }
  | { readonly kind: 'integerList'; readonly values: readonly number[] }
  | { readonly kind: 'stringList'; readonly values: readonly string[] }
  | { readonly kind: 'boolList'; readonly values: readonly boolean[] }
  | { readonly kind: 'map'; readonly entries: Readonly<Record<string, string>> }
  | { readonly kind: 'expressions'; readonly items: readonly FcExpression[] }
  /** A sketch's `Geometry` or `ExternalGeo`: one raw `Geometry` record per curve. */
  | { readonly kind: 'geometry'; readonly records: readonly FcRecord[] }
  /** A sketch's `Constraints`: one raw `Constrain` record per constraint. */
  | { readonly kind: 'constraints'; readonly records: readonly FcRecord[] }
  /** A part shape: the archive entry holding its B-rep (`''` for a null shape). */
  | { readonly kind: 'shape'; readonly entry: string }
  /** A mesh: the archive entry holding its mesh kernel. */
  | { readonly kind: 'mesh'; readonly entry: string }
  /** A list or file stored as its own archive entry (vector lists, colour lists, edge lists, included files). */
  | { readonly kind: 'file'; readonly element: string; readonly entry: string }
  | { readonly kind: 'sheet'; readonly cells: readonly FcCell[] }
  /** A scripted object's proxy: its class, never its pickled state. */
  | { readonly kind: 'python'; readonly module: string; readonly className: string }
  /** A material from the 1.0+ library, by its id. */
  | { readonly kind: 'material'; readonly uuid: string }
  /** A display material (`ShapeMaterial`, `LineMaterial` …): its diffuse colour and transparency (0–1). */
  | { readonly kind: 'appearance'; readonly diffuse: number; readonly transparency: number }
  /** A value element this reader does not know: kept raw and counted in `FcDocument.unknownTypes`. */
  | { readonly kind: 'unknown'; readonly raw: readonly FcRecord[] };

export interface FcProperty {
  readonly name: string;
  /** The C++ property type (`App::PropertyLength`). */
  readonly type: string;
  readonly value: FcValue;
  /** `status` bits (bit 21: a dynamic, user-added property). */
  readonly status?: number;
  /** A dynamic property's group (VarSet entries, scripted objects). */
  readonly group?: string;
}

export interface FcGui {
  readonly visible?: boolean;
  /** The shape's colour, 0–1 per channel (`ShapeColor`, else `ShapeAppearance`'s or `DiffuseColor`'s first). */
  readonly colour?: readonly [number, number, number];
  /** 0 opaque … 1 invisible (`Transparency` percent, or the appearance's own value). */
  readonly transparency?: number;
  /** When the file colours faces one by one: how many colours its list has. */
  readonly faceColours?: number;
}

export interface FcObject {
  /** The internal name links and expressions use (`Pad001`). */
  readonly name: string;
  /** The C++ class (`PartDesign::Pad`); `''` when `Objects` doesn't declare it. */
  readonly type: string;
  /** The visible name (the `Label` property, else the internal name). */
  readonly label: string;
  /** The extensions it declares (`App::OriginGroupExtension`, `App::GroupExtension` …). */
  readonly extensions: readonly string[];
  /** Its saved properties by name (a null-prototype record). */
  readonly properties: Readonly<Record<string, FcProperty>>;
  readonly expressions: readonly FcExpression[];
  /** FreeCAD marked it invalid when saving (its recompute failed). */
  readonly invalid?: boolean;
  /**
   * The properties the reader left out because their value can't be read (a
   * number that is not finite …), by name; absent when there are none. A
   * mapper that reads one of them refuses rather than take a default.
   */
  readonly unreadable?: readonly string[];
  /** `GuiDocument.xml`'s view of it; `undefined` when the file has no GUI document or no view provider for it. */
  readonly gui?: FcGui;
}

export interface FcDocument {
  /** `SchemaVersion` (4 in every file seen). */
  readonly schemaVersion: number | undefined;
  /** `ProgramVersion` as written (`0.19R`, `1.0.0R39109 (Git)`), `''` when missing. */
  readonly programVersion: string;
  /** Its leading `major.minor[.patch]`; `undefined` when missing (older than 0.14). */
  readonly version: readonly [number, number, number] | undefined;
  /** The document's `Label`. */
  readonly label: string;
  /**
   * The `UnitSystem` setting's name (1.0+), for display only: every stored
   * number is in millimetres and degrees (sketch constraint angles in radians)
   * whatever it says.
   */
  readonly unitSystem: string | undefined;
  readonly properties: Readonly<Record<string, FcProperty>>;
  /** Every object, in `ObjectData` order. */
  readonly objects: readonly FcObject[];
  readonly byName: ReadonlyMap<string, FcObject>;
  /** The file has a `GuiDocument.xml`. */
  readonly hasGui: boolean;
  /** Property types whose value element this reader doesn't know, with how often each occurs. */
  readonly unknownTypes: Readonly<Record<string, number>>;
  /** Everything left out or unreadable, one line each. */
  readonly problems: string[];
  readonly entries: FcEntries;
}

/** The status bit FreeCAD sets on a dynamic (user-added) property. */
export const DYNAMIC_PROPERTY = 1 << 21;

const UNITS: Readonly<Record<string, FcUnit>> = {
  'App::PropertyLength': 'mm',
  'App::PropertyDistance': 'mm',
  'App::PropertyArea': 'mm²',
  'App::PropertyVolume': 'mm³',
  'App::PropertyAngle': 'deg',
};

/** How the model reads a document's numbers and records its problems. */
class Context {
  readonly problems: string[];
  readonly unknownTypes: Record<string, number> = Object.create(null);
  constructor(problems: string[]) {
    this.problems = problems;
  }
}

const record = (e: XmlElement): FcRecord => ({
  tag: e.name,
  attrs: e.attrs,
  children: e.children.map(record),
});

function sub(a: Readonly<Record<string, string>>, key: string): FcSub {
  const stored = a[key] ?? '';
  const shadowed = a.shadowed;
  return {
    name: shadowed || stored,
    ...(shadowed && shadowed !== stored ? { old: stored } : {}),
    ...(a.shadow ? { shadow: a.shadow } : {}),
  };
}

/** A property's three numbers `prefix X/Y/Z` (or `valueX…`). */
const vector = (what: string, a: Readonly<Record<string, string>>, prefix: string): Vec3 => [
  finite(what, a[`${prefix}X`]) ?? 0,
  finite(what, a[`${prefix}Y`]) ?? 0,
  finite(what, a[`${prefix}Z`]) ?? 0,
];

/**
 * A placement element. FreeCAD reads the axis and angle when the angle `A` is
 * there (0.17+, axis normalised, a zero axis meaning +Z) and the quaternion
 * `Q0…Q3` (x, y, z, w) otherwise; files it wrote give the same rotation both ways.
 */
export function placementOf(what: string, a: Readonly<Record<string, string>>): FcPlacement {
  const position: Vec3 = [
    finite(what, a.Px) ?? 0,
    finite(what, a.Py) ?? 0,
    finite(what, a.Pz) ?? 0,
  ];
  if (a.A !== undefined) {
    const angle = finite(what, a.A) ?? 0;
    const axis = [finite(what, a.Ox) ?? 0, finite(what, a.Oy) ?? 0, finite(what, a.Oz) ?? 0];
    const length = Math.hypot(axis[0] as number, axis[1] as number, axis[2] as number);
    const [x, y, z] = length < 1e-12 ? [0, 0, 1] : axis.map((v) => v / length);
    const s = Math.sin(angle / 2);
    return {
      position,
      rotation: [(x as number) * s, (y as number) * s, (z as number) * s, Math.cos(angle / 2)],
    };
  }
  const q = [
    finite(what, a.Q0) ?? 0,
    finite(what, a.Q1) ?? 0,
    finite(what, a.Q2) ?? 0,
    finite(what, a.Q3) ?? 1,
  ];
  const length = Math.hypot(...q);
  if (length < 1e-12) return { position, rotation: [0, 0, 0, 1] };
  return { position, rotation: q.map((v) => v / length) as unknown as FcPlacement['rotation'] };
}

function colourOf(what: string, text: string | undefined): FcValue {
  const packed = finite(what, text) ?? 0;
  if (!Number.isInteger(packed) || packed < 0 || packed > 0xffffffff)
    throw new FcstdFormatError(`${what}: ${short(String(text))} is not a packed colour.`);
  return {
    kind: 'colour',
    packed,
    value: {
      r: (packed >>> 24) & 255,
      g: (packed >>> 16) & 255,
      b: (packed >>> 8) & 255,
      a: packed & 255,
    },
  };
}

const integer = (what: string, text: string | undefined): number => {
  const v = finite(what, text) ?? 0;
  if (!Number.isInteger(v))
    throw new FcstdFormatError(`${what}: ${short(String(text))} is not an integer.`);
  return v;
};

/**
 * One `<Property>`'s value, by its first value element (FreeCAD renamed and
 * retyped properties over the versions; the element says how the value is
 * stored whatever the declared type).
 */
function propertyValue(p: XmlElement, type: string, what: string, ctx: Context): FcValue {
  const e = p.children[0];
  if (!e) return unknown(p, type, ctx);
  const a = e.attrs;
  switch (e.name) {
    case 'Integer': {
      const list = child(p, 'CustomEnumList');
      if (list || type.includes('Enumeration'))
        return {
          kind: 'enum',
          index: integer(what, a.value),
          ...(list ? { values: children(list, 'Enum').map((x) => x.attrs.value ?? '') } : {}),
        };
      return { kind: 'integer', value: integer(what, a.value) };
    }
    case 'Float': {
      // The type is the file's text: only the table's own keys count (not `constructor`).
      const unit = Object.hasOwn(UNITS, type) ? UNITS[type] : undefined;
      return { kind: 'float', value: finite(what, a.value) ?? 0, ...(unit ? { unit } : {}) };
    }
    case 'Bool':
      return { kind: 'bool', value: a.value === 'true' || a.value === '1' };
    case 'String':
    case 'Uuid':
    case 'Path':
      return { kind: 'string', value: a.value ?? '' };
    case 'PropertyVector':
      return { kind: 'vector', value: vector(what, a, 'value') };
    case 'PropertyPlacement':
      return { kind: 'placement', value: placementOf(what, a) };
    case 'PropertyColor':
      return colourOf(what, a.value);
    case 'Link':
      return { kind: 'link', object: a.value || undefined };
    case 'LinkList':
      return {
        kind: 'linkList',
        objects: children(e, 'Link')
          .map((l) => l.attrs.value ?? '')
          .filter((x) => x !== ''),
      };
    case 'LinkSub':
      return {
        kind: 'linkSub',
        object: a.value || undefined,
        subs: children(e, 'Sub').map((s) => sub(s.attrs, 'value')),
      };
    case 'LinkSubList':
      return {
        kind: 'linkSubList',
        items: children(e, 'Link')
          .filter((l) => l.attrs.obj)
          .map((l) => ({ object: l.attrs.obj as string, sub: sub(l.attrs, 'sub') })),
      };
    case 'XLink':
    case 'XLinkSub':
      return { kind: 'xlink', items: a.name ? [xlinkItem(e)] : [] };
    case 'XLinkSubList':
      return {
        kind: 'xlink',
        items: e.children.filter((x) => x.attrs.name).map(xlinkItem),
      };
    case 'IntegerList':
      return { kind: 'integerList', values: children(e, 'I').map((x) => integer(what, x.attrs.v)) };
    case 'StringList':
      return { kind: 'stringList', values: children(e, 'String').map((x) => x.attrs.value ?? '') };
    case 'BoolList':
      return { kind: 'boolList', values: [...(a.value ?? '')].map((c) => c === '1') };
    case 'Map': {
      const entries: Record<string, string> = Object.create(null);
      for (const item of children(e, 'Item'))
        entries[item.attrs.key ?? ''] = item.attrs.value ?? '';
      return { kind: 'map', entries };
    }
    case 'ExpressionEngine':
      return {
        kind: 'expressions',
        items: children(e, 'Expression').map((x) => ({
          path: x.attrs.path ?? '',
          expression: x.attrs.expression ?? '',
        })),
      };
    case 'GeometryList':
      return { kind: 'geometry', records: children(e, 'Geometry').map(record) };
    case 'ConstraintList':
      return { kind: 'constraints', records: children(e, 'Constrain').map(record) };
    case 'Part':
      return { kind: 'shape', entry: a.file ?? '' };
    case 'Mesh':
      return { kind: 'mesh', entry: a.file ?? '' };
    case 'Cells':
      return {
        kind: 'sheet',
        cells: children(e, 'Cell').map((c) => ({
          address: c.attrs.address ?? '',
          content: c.attrs.content ?? '',
          ...(c.attrs.alias ? { alias: c.attrs.alias } : {}),
        })),
      };
    case 'Python':
      return { kind: 'python', module: a.module ?? '', className: a.class ?? '' };
    case 'PropertyMaterial':
      if (a.uuid !== undefined) return { kind: 'material', uuid: a.uuid };
      if (a.diffuseColor !== undefined) {
        const colour = colourOf(what, a.diffuseColor);
        const transparency = finite(what, a.transparency) ?? 0;
        return {
          kind: 'appearance',
          diffuse: colour.kind === 'colour' ? colour.packed : 0,
          transparency: Math.min(1, Math.max(0, transparency)),
        };
      }
      return unknown(p, type, ctx);
    default:
      if (a.file !== undefined) return { kind: 'file', element: e.name, entry: a.file };
      return unknown(p, type, ctx);
  }
}

function xlinkItem(e: XmlElement) {
  const subs =
    e.attrs.sub !== undefined
      ? [sub(e.attrs, 'sub')]
      : children(e, 'Sub').map((s) => sub(s.attrs, 'value'));
  return { object: e.attrs.name ?? '', file: e.attrs.file ?? '', subs };
}

function unknown(p: XmlElement, type: string, ctx: Context): FcValue {
  ctx.unknownTypes[type] = (ctx.unknownTypes[type] ?? 0) + 1;
  return { kind: 'unknown', raw: p.children.map(record) };
}

/** A `<Properties>` block, by name. A property that can't be read is left out with a problem. */
function propertiesOf(
  block: XmlElement | undefined,
  owner: string,
  ctx: Context,
  unreadable?: string[],
): Record<string, FcProperty> {
  const out: Record<string, FcProperty> = Object.create(null);
  for (const p of children(block, 'Property')) {
    const name = p.attrs.name;
    if (!name) {
      ctx.problems.push(`${owner}: a property without a name was left out.`);
      continue;
    }
    const type = p.attrs.type ?? '';
    const what = `${owner}.${name}`;
    try {
      const status = p.attrs.status === undefined ? undefined : integer(what, p.attrs.status);
      out[name] = {
        name,
        type,
        value: propertyValue(p, type, what, ctx),
        ...(status !== undefined ? { status } : {}),
        ...(p.attrs.group !== undefined ? { group: p.attrs.group } : {}),
      };
    } catch (error) {
      if (!(error instanceof FcstdFormatError)) throw error;
      ctx.problems.push(`${what} was left out: ${error.message}`);
      unreadable?.push(name);
    }
  }
  return out;
}

/** `ProgramVersion`'s leading `major.minor[.patch]`. */
export function parseVersion(text: string): [number, number, number] | undefined {
  const m = /^\s*(\d{1,4})\.(\d{1,4})(?:\.(\d{1,4}))?/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : undefined;
}

/** `a` is at least `b`. */
export function versionAtLeast(
  v: readonly [number, number, number] | undefined,
  b: readonly [number, number, number],
): boolean {
  if (!v) return false;
  for (let i = 0; i < 3; i++)
    if ((v[i] as number) !== (b[i] as number)) return (v[i] as number) > (b[i] as number);
  return true;
}

/** An enumeration's string, when the file lists the strings. */
export function enumString(value: FcValue | undefined): string | undefined {
  return value?.kind === 'enum' ? value.values?.[value.index] : undefined;
}

interface GuiFacts {
  visible?: boolean;
  colour?: [number, number, number];
  transparency?: number;
  faceColours?: number;
}

/**
 * The first colour of a `ShapeAppearance` material list (binary entry): `u32 n`,
 * then per material ambient, diffuse, specular, emissive as packed RGBA
 * `u32`s, shininess and transparency as `f32` (versions 2 and 3 alike for
 * these fields). `undefined` when the entry is too short or makes no sense.
 */
function firstMaterial(
  bytes: Uint8Array,
): { colour: [number, number, number]; transparency: number; count: number } | undefined {
  if (bytes.length < 4 + 24) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  if (count === 0 || count * 24 > bytes.length) return undefined;
  const diffuse = view.getUint32(8, true);
  const transparency = view.getFloat32(24, true);
  if (!Number.isFinite(transparency) || transparency < 0 || transparency > 1) return undefined;
  return { colour: unpack(diffuse), transparency, count };
}

/** The first colour of a `DiffuseColor` list (binary entry): `u32 n`, then `n` packed RGBA `u32`s. */
function firstColour(
  bytes: Uint8Array,
): { colour: [number, number, number]; count: number } | undefined {
  if (bytes.length < 8) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  if (count === 0 || count * 4 + 4 > bytes.length) return undefined;
  return { colour: unpack(view.getUint32(4, true)), count };
}

const unpack = (packed: number): [number, number, number] => [
  ((packed >>> 24) & 255) / 255,
  ((packed >>> 16) & 255) / 255,
  ((packed >>> 8) & 255) / 255,
];

/** Reads a binary side entry of `GuiDocument.xml`, `undefined` with a problem when it can't. */
function sideEntry(
  entries: FcEntries,
  name: string,
  owner: string,
  ctx: Context,
): Uint8Array | undefined {
  try {
    const bytes = entries.get(name);
    if (!bytes) ctx.problems.push(`${owner}: its colour entry ${name} is missing.`);
    return bytes;
  } catch (error) {
    if (!(error instanceof FcstdFormatError)) throw error;
    ctx.problems.push(`${owner}: its colour entry was left out: ${error.message}`);
    return undefined;
  }
}

/** `GuiDocument.xml`: per view provider, visibility and the shape's colour. */
function readGui(root: XmlElement, entries: FcEntries, ctx: Context): Map<string, GuiFacts> {
  const out = new Map<string, GuiFacts>();
  for (const vp of children(child(root, 'ViewProviderData'), 'ViewProvider')) {
    const name = vp.attrs.name;
    if (!name || out.has(name)) continue;
    const owner = `GuiDocument ${name}`;
    const props = propertiesOf(child(vp, 'Properties'), owner, ctx);
    const facts: GuiFacts = {};
    const visibility = props.Visibility?.value;
    if (visibility?.kind === 'bool') facts.visible = visibility.value;
    const percent = props.Transparency?.value;
    if (percent?.kind === 'integer' && percent.value >= 0 && percent.value <= 100)
      facts.transparency = percent.value / 100;
    const shapeColour = props.ShapeColor?.value;
    const appearance = props.ShapeAppearance?.value;
    const diffuse = props.DiffuseColor?.value;
    const diffuseBytes =
      diffuse?.kind === 'file' && diffuse.entry
        ? sideEntry(entries, diffuse.entry, owner, ctx)
        : undefined;
    const perFace = diffuseBytes ? firstColour(diffuseBytes) : undefined;
    const material =
      appearance?.kind === 'file' && appearance.entry
        ? sideEntry(entries, appearance.entry, owner, ctx)
        : undefined;
    const first = material ? firstMaterial(material) : undefined;
    if (perFace && perFace.count > 1) {
      facts.colour = perFace.colour;
      facts.faceColours = perFace.count;
    } else if (first) {
      facts.colour = first.colour;
      facts.transparency = first.transparency;
      if (first.count > 1) facts.faceColours = first.count;
    } else if (perFace) facts.colour = perFace.colour;
    else if (shapeColour?.kind === 'colour') facts.colour = unpack(shapeColour.packed);
    else if (props.ShapeMaterial?.value.kind === 'appearance')
      facts.colour = unpack(props.ShapeMaterial.value.diffuse);
    out.set(name, facts);
  }
  return out;
}

/** Reads an entry that must be there, as XML. */
function xmlEntry(entries: FcEntries, name: string): XmlElement | undefined {
  const bytes = entries.get(name);
  return bytes ? parseXmlBytes(bytes, name) : undefined;
}

/** Decodes an `.FCStd` archive. Throws `FcstdFormatError` for a file that isn't one. */
export function readFcstd(bytes: Uint8Array): FcDocument {
  return readFcstdEntries(unzipFcstd(bytes));
}

/** Decodes the entries of an `.FCStd` archive. */
export function readFcstdEntries(entries: FcEntries): FcDocument {
  const ctx = new Context([...entries.problems]);
  const root = xmlEntry(entries, 'Document.xml');
  if (!root) throw new FcstdFormatError('This is not an FCStd file (it has no Document.xml).');
  if (root.name !== 'Document')
    throw new FcstdFormatError(
      `This is not an FCStd file (its Document.xml holds <${short(root.name)}>).`,
    );
  const schemaVersion = finite('Document SchemaVersion', root.attrs.SchemaVersion);
  const programVersion = root.attrs.ProgramVersion ?? '';
  const properties = propertiesOf(child(root, 'Properties'), 'Document', ctx);

  // Schema 2 called objects features; the grammar inside is the same.
  const declared = child(root, 'Objects') ?? child(root, 'Features');
  const data = child(root, 'ObjectData') ?? child(root, 'FeatureData');
  const types = new Map<string, { type: string; invalid: boolean }>();
  for (const o of declared?.children ?? []) {
    const name = o.attrs.name;
    if (!name || (o.name !== 'Object' && o.name !== 'Feature')) continue;
    if (types.has(name)) {
      ctx.problems.push(
        `Document: the object ${short(name)} is declared twice; the first is kept.`,
      );
      continue;
    }
    types.set(name, { type: o.attrs.type ?? '', invalid: o.attrs.Invalid === '1' });
  }

  let gui: Map<string, GuiFacts> | undefined;
  try {
    const guiRoot = xmlEntry(entries, 'GuiDocument.xml');
    if (guiRoot) gui = readGui(guiRoot, entries, ctx);
  } catch (error) {
    if (!(error instanceof FcstdFormatError)) throw error;
    ctx.problems.push(`GuiDocument.xml was left out: ${error.message}`);
  }

  const objects: FcObject[] = [];
  const byName = new Map<string, FcObject>();
  for (const o of data?.children ?? []) {
    if (o.name !== 'Object' && o.name !== 'Feature') continue;
    const name = o.attrs.name;
    if (!name) {
      ctx.problems.push('Document: an object without a name was left out.');
      continue;
    }
    if (byName.has(name)) {
      ctx.problems.push(`Document: a second object named ${short(name)} was left out.`);
      continue;
    }
    const declaredAs = types.get(name);
    if (!declaredAs) ctx.problems.push(`Document: ${short(name)} has data but no declared type.`);
    const unreadable: string[] = [];
    const props = propertiesOf(child(o, 'Properties'), name, ctx, unreadable);
    const label = props.Label?.value;
    const engine = props.ExpressionEngine?.value;
    const facts = gui?.get(name);
    const ownVisibility = props.Visibility?.value;
    const visible =
      facts?.visible ?? (ownVisibility?.kind === 'bool' ? ownVisibility.value : undefined);
    const object: FcObject = {
      name,
      type: declaredAs?.type ?? '',
      label: label?.kind === 'string' && label.value !== '' ? label.value : name,
      extensions: children(child(o, 'Extensions'), 'Extension').map((x) => x.attrs.type ?? ''),
      properties: props,
      expressions: engine?.kind === 'expressions' ? engine.items : [],
      ...(declaredAs?.invalid ? { invalid: true } : {}),
      ...(unreadable.length > 0 ? { unreadable } : {}),
      ...(facts || visible !== undefined
        ? { gui: { ...facts, ...(visible !== undefined ? { visible } : {}) } }
        : {}),
    };
    objects.push(object);
    byName.set(name, object);
  }
  for (const name of types.keys())
    if (!byName.has(name))
      ctx.problems.push(`Document: ${short(name)} is declared but has no data.`);

  const label = properties.Label?.value;
  const unitSystem = properties.UnitSystem?.value;
  return {
    schemaVersion,
    programVersion,
    version: parseVersion(programVersion),
    label: label?.kind === 'string' ? label.value : '',
    unitSystem:
      unitSystem?.kind === 'enum'
        ? (unitSystem.values?.[unitSystem.index] ?? `#${unitSystem.index}`)
        : undefined,
    properties,
    objects,
    byName,
    hasGui: gui !== undefined,
    unknownTypes: ctx.unknownTypes,
    problems: ctx.problems,
    entries,
  };
}

/** The object `name` of `doc`, by its index. */
export function objectNamed(doc: FcDocument, name: string | undefined): FcObject | undefined {
  return name === undefined ? undefined : doc.byName.get(name);
}

/**
 * The archive entry that holds an object's B-rep text for one of its shape
 * properties: the property's own `file` attribute, which is
 * `<Object>.<Property>.brp` in files from 1.0 on and `PartShape<N>.brp`
 * (numbered in save order) through 0.21. `undefined` when the property is
 * missing, isn't a shape, or names no entry (a null shape).
 */
export function storedShapeEntry(
  doc: FcDocument,
  object: FcObject | string,
  property = 'Shape',
): string | undefined {
  const o = typeof object === 'string' ? doc.byName.get(object) : object;
  const value = o?.properties[property]?.value;
  return value?.kind === 'shape' && value.entry !== '' ? value.entry : undefined;
}

/**
 * The most B-rep text a stored shape may be: the kernel's `MAX_BREP_BYTES`
 * (`packages/kernel/src/kernel.ts`, 32 MB), which this package can't import;
 * `history.test.ts` checks the two are equal. A larger entry is never decoded.
 */
export const MAX_STORED_BREP_BYTES = 32 * 1024 * 1024;

/** The B-rep text format line: `CASCADE Topology V1, (c) Matra-Datavision` and its later versions. */
const BREP_TEXT = /^(?:DBRep_DrawableShape\s*)?\s*CASCADE Topology V\d/;

/**
 * The B-rep text of an object's stored shape, or `undefined` with a problem
 * on `doc.problems` when the entry is empty (a null shape), missing,
 * unreadable or FreeCAD's binary form (which this reader doesn't read). The
 * text is only checked for its format line, never parsed: only the import's
 * own kernel reads it (ADR-0144 decision 5).
 */
/**
 * The problem line for a stored shape in FreeCAD's binary form (`what` is
 * `<object>.<property>`). Exported so the importer recognises it by the same
 * words, never by matching a copy of them.
 */
export function binaryFormProblem(what: string): string {
  return `${what}: its stored shape is in FreeCAD's binary form, which is not read.`;
}

export function storedShapeText(
  doc: FcDocument,
  object: FcObject | string,
  property = 'Shape',
): string | undefined {
  const entry = storedShapeEntry(doc, object, property);
  const what = `${typeof object === 'string' ? object : object.name}.${property}`;
  if (entry === undefined) {
    doc.problems.push(`${what}: no stored shape.`);
    return undefined;
  }
  // Checked by the archive's own size before anything is inflated or decoded.
  const size = doc.entries.size(entry);
  if (size !== undefined && size > MAX_STORED_BREP_BYTES) {
    doc.problems.push(
      `${what}: its stored shape is ${Math.round(size / (1024 * 1024))} MB, more than the ${MAX_STORED_BREP_BYTES / (1024 * 1024)} MB the import's kernel reads.`,
    );
    return undefined;
  }
  let bytes: Uint8Array | undefined;
  try {
    bytes = doc.entries.get(entry);
  } catch (error) {
    if (!(error instanceof FcstdFormatError)) throw error;
    doc.problems.push(`${what}: its stored shape can't be read: ${error.message}`);
    return undefined;
  }
  if (!bytes) {
    doc.problems.push(`${what}: its stored shape ${short(entry)} is missing from the file.`);
    return undefined;
  }
  if (bytes.length === 0) {
    doc.problems.push(`${what}: its stored shape is empty.`);
    return undefined;
  }
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 128));
  if (entry.endsWith('.bin') || head.includes('Open CASCADE Topology')) {
    doc.problems.push(binaryFormProblem(what));
    return undefined;
  }
  if (!BREP_TEXT.test(head)) {
    doc.problems.push(`${what}: its stored shape is not B-rep text.`);
    return undefined;
  }
  return new TextDecoder('latin1').decode(bytes);
}

/**
 * Whether B-rep text holds a solid: a `So` record in its `TShapes` section.
 * One forward scan; no part of the text is parsed.
 */
export function brepHasSolid(text: string): boolean {
  const at = text.indexOf('\nTShapes ');
  if (at < 0) return false;
  const solid = /\nSo[ \t]*\r?\n/g;
  solid.lastIndex = at;
  return solid.test(text);
}

/** The most numbers a float list entry may hold for the importer to read it (a pattern's gaps). */
export const MAX_FLOAT_LIST = 100_000;

/**
 * A `FloatList` property's numbers. FreeCAD writes a non-empty list into an
 * archive entry of its own (`<FloatList file="…"/>`, FORMAT.md): a
 * little-endian 32-bit count, then that many 64-bit floats. An empty list
 * names no entry. `undefined` with a problem on `doc.problems` when the
 * property is missing or not a float list, or its entry is missing, larger
 * than `MAX_FLOAT_LIST` numbers, cut short, or holds a number that is not
 * finite. Checked by the archive's own size before the entry is inflated.
 */
export function floatList(
  doc: FcDocument,
  object: FcObject,
  property: string,
): number[] | undefined {
  const what = `${object.name}.${property}`;
  const value = object.properties[property]?.value;
  if (value?.kind !== 'file' || value.element !== 'FloatList') {
    doc.problems.push(`${what}: not a list of numbers.`);
    return undefined;
  }
  if (value.entry === '') return [];
  const size = doc.entries.size(value.entry);
  if (size !== undefined && size > 4 + 8 * MAX_FLOAT_LIST) {
    doc.problems.push(`${what}: its list of numbers is too long to read.`);
    return undefined;
  }
  let bytes: Uint8Array | undefined;
  try {
    bytes = doc.entries.get(value.entry);
  } catch (error) {
    if (!(error instanceof FcstdFormatError)) throw error;
    doc.problems.push(`${what}: its list of numbers can't be read: ${error.message}`);
    return undefined;
  }
  if (!bytes || bytes.length < 4) {
    doc.problems.push(`${what}: its list of numbers is missing from the file.`);
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  if (count > MAX_FLOAT_LIST || bytes.length !== 4 + 8 * count) {
    doc.problems.push(`${what}: its list of numbers is cut short or too long.`);
    return undefined;
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = view.getFloat64(4 + 8 * i, true);
    if (!Number.isFinite(v)) {
      doc.problems.push(`${what}: its list holds a number that is not finite.`);
      return undefined;
    }
    out.push(v);
  }
  return out;
}
