/**
 * Test support (no production code): the S12b fixture documents (`structure-fixtures.ts`, made
 * with FreeCAD 1.1.4 by our own script) as `.FCStd` bytes. Each object is written back as the
 * `<Object>` element FreeCAD saved, with its stored shape and its binary side entries (a mesh's
 * kernel entry, a link array's placement list); `GuiDocument.xml` gets each object's visibility.
 * `edit`, `brep`, `files`, `extra` and `entries` make a document wrong or hostile on purpose.
 */
import { inflateSync, strFromU8 } from 'fflate';
import { fcstd, guiXml } from './fixtures';
import { STRUCTURE_FIXTURES_DEFLATED } from './structure-fixtures';

/** What FreeCAD measured for a shape (box as min then max). */
export interface StructureMeasure {
  readonly solids: number;
  readonly volume: number;
  readonly area: number;
  readonly box: readonly number[];
  readonly centre: readonly number[];
}

export interface StructureFixtureObject {
  readonly object: string;
  readonly type: string;
  readonly label: string;
  readonly xml: string;
  readonly hidden?: true;
  readonly stored?: number;
  /** FreeCAD's measure of the object's stored shape. */
  readonly measure?: StructureMeasure;
  /** The shape FreeCAD shows for it in the document's frame, through its containers and links. */
  readonly world?: StructureMeasure;
  /** What FreeCAD says about a mesh object, in its parent's frame (box as min then max). */
  readonly mesh?: {
    readonly points: number;
    readonly facets: number;
    readonly solid: boolean;
    readonly components: number;
    readonly volume: number;
    readonly area: number;
    readonly box: readonly number[];
  };
  /** Binary side entries, base64, by entry name. */
  readonly files?: Readonly<Record<string, string>>;
}

export interface StructureFixtureCase {
  readonly note: string;
  readonly roots: readonly string[];
  readonly objects: readonly StructureFixtureObject[];
}

interface StructureData {
  readonly cases: Readonly<Record<string, StructureFixtureCase>>;
  readonly breps: readonly string[];
}

let data: StructureData | undefined;
function structureData(): StructureData {
  if (!data) {
    const bytes = Uint8Array.from(atob(STRUCTURE_FIXTURES_DEFLATED), (c) => c.charCodeAt(0));
    data = JSON.parse(strFromU8(inflateSync(bytes))) as StructureData;
  }
  return data;
}

export function structureCase(name: string): StructureFixtureCase {
  const c = structureData().cases[name];
  if (!c) throw new Error(`no fixture document ${name}`);
  return c;
}

/** One object of a fixture document. */
export function structureObject(name: string, object: string): StructureFixtureObject {
  const o = structureCase(name).objects.find((x) => x.object === object);
  if (!o) throw new Error(`${name}: no object ${object}`);
  return o;
}

/** The names of every S12b fixture document. */
export const structureDocuments = (): string[] => Object.keys(structureData().cases);

/** A binary side entry of a fixture object. */
export function structureEntry(name: string, object: string, file: string): Uint8Array {
  const b64 = structureObject(name, object).files?.[file];
  if (b64 === undefined) throw new Error(`${name}: ${object} has no entry ${file}`);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** The B-rep text a fixture object stores. */
export function structureBrep(name: string, object: string): string {
  const o = structureObject(name, object);
  if (o.stored === undefined) throw new Error(`${name}: ${object} stores no shape`);
  return structureData().breps[o.stored] as string;
}

export interface StructureExtraObject {
  readonly name: string;
  readonly type: string;
  readonly xml: string;
  readonly hidden?: boolean;
}

export interface StructureFileOptions {
  /** Changes an object's XML before it is written; `undefined` drops the object. */
  readonly edit?: (object: string, xml: string) => string | undefined;
  /** Replaces an object's stored B-rep text (`undefined` leaves its entry out). */
  readonly brep?: (object: string, text: string) => string | undefined;
  /** Replaces a binary side entry (`undefined` leaves it out). */
  readonly files?: (object: string, file: string, bytes: Uint8Array) => Uint8Array | undefined;
  /** Objects added after the case's own. */
  readonly extra?: readonly StructureExtraObject[];
  /** Archive entries added or replaced. */
  readonly entries?: Readonly<Record<string, string | Uint8Array>>;
  /** Visibility changed, by object. */
  readonly visible?: Readonly<Record<string, boolean>>;
  /** The declared type changed, by object (a box as a plain `Part::Feature`). */
  readonly types?: Readonly<Record<string, string>>;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One fixture document as `.FCStd` bytes, as FreeCAD 1.1 saves it. */
export function structureFile(name: string, options: StructureFileOptions = {}): Uint8Array {
  const { breps } = structureData();
  const entries: Record<string, string | Uint8Array> = {};
  const objects: StructureExtraObject[] = [];
  for (const o of structureCase(name).objects) {
    const xml = options.edit ? options.edit(o.object, o.xml) : o.xml;
    if (xml === undefined) continue;
    if (o.stored !== undefined) {
      const text = breps[o.stored] as string;
      const t = options.brep ? options.brep(o.object, text) : text;
      if (t !== undefined) entries[`${o.object}.Shape.brp`] = t;
    }
    for (const [file, b64] of Object.entries(o.files ?? {})) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const b = options.files ? options.files(o.object, file, bytes) : bytes;
      if (b !== undefined) entries[file] = b;
    }
    objects.push({
      name: o.object,
      type: options.types?.[o.object] ?? o.type,
      xml,
      ...(o.hidden ? { hidden: true } : {}),
    });
  }
  objects.push(...(options.extra ?? []));
  Object.assign(entries, options.entries ?? {});
  const body = [
    `<?xml version='1.0' encoding='utf-8'?>`,
    '<Document SchemaVersion="4" ProgramVersion="1.1.4R20260101 (Git)" FileVersion="1">',
    '<Properties Count="1" TransientCount="0"><Property name="Label" type="App::PropertyString"><String value="Structure"/></Property></Properties>',
    `<Objects Count="${objects.length}">`,
    ...objects.map((o) => `<Object type="${o.type}" name="${esc(o.name)}" id="1"/>`),
    '</Objects>',
    `<ObjectData Count="${objects.length}">`,
    ...objects.map((o) => o.xml),
    '</ObjectData>',
    '</Document>',
  ].join('\n');
  return fcstd({
    'Document.xml': body,
    'GuiDocument.xml': guiXml(
      objects.map((o) => ({ name: o.name, visible: options.visible?.[o.name] ?? !o.hidden })),
    ),
    ...entries,
  });
}

/** A placement as FreeCAD writes it in a `PropertyPlacement` element's attributes. */
const placementAttrs = (p: { position: readonly number[]; rotation: readonly number[] }) =>
  `Px="${p.position[0]}" Py="${p.position[1]}" Pz="${p.position[2]}" Q0="${p.rotation[0]}" Q1="${p.rotation[1]}" Q2="${p.rotation[2]}" Q3="${p.rotation[3]}"`;

export interface LinkObjectOptions {
  /** `ElementCount`: an array of this many (its list entry `<name>.PlacementList`). */
  readonly count?: number;
  /** `LinkPlacement` and `Placement`. */
  readonly placement?: { position: readonly number[]; rotation: readonly number[] };
  /** Any further change to the XML. */
  readonly edit?: (xml: string) => string;
}

/**
 * A link named `name` to `target`, from `link_array`'s packed array (FreeCAD's own XML): no
 * elements unless `count`, its lists in entries of its own name, `LinkTransform` off.
 */
export function linkObject(
  name: string,
  target: string,
  options: LinkObjectOptions = {},
): StructureExtraObject {
  let xml = structureObject('link_array', 'Link')
    .xml.replace('name="Link"', `name="${name}"`)
    .replace('<String value="Link"/>', `<String value="${name}"/>`)
    .replace('name="Box"/>', `name="${target}"/>`)
    .replace('<Integer value="3"/>', `<Integer value="${options.count ?? 0}"/>`)
    .replace('file="PlacementList"', `file="${name}.PlacementList"`)
    .replace('file="ScaleList"', `file="${name}.ScaleList"`);
  if (options.placement)
    xml = xml.replace(
      / Px="[^"]*" Py="[^"]*" Pz="[^"]*" Q0="[^"]*" Q1="[^"]*" Q2="[^"]*" Q3="[^"]*"( A="[^"]*" Ox="[^"]*" Oy="[^"]*" Oz="[^"]*")?/g,
      ` ${placementAttrs(options.placement)}`,
    );
  return { name, type: 'App::Link', xml: options.edit ? options.edit(xml) : xml };
}

/** A placement list entry: a count and seven doubles a placement (position, quaternion x y z w). */
export function placementListEntry(
  list: readonly (readonly number[])[],
  countAs = list.length,
): Uint8Array {
  const bytes = new Uint8Array(4 + 56 * list.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, countAs, true);
  for (const [i, p] of list.entries())
    for (const [k, v] of p.entries()) view.setFloat64(4 + 56 * i + 8 * k, v, true);
  return bytes;
}

/** An `App::Part` named `name` holding `members`, at the identity, from `part_basic`'s part. */
export function partObject(name: string, members: readonly string[]): StructureExtraObject {
  const xml = structureObject('part_basic', 'Part')
    .xml.replace('name="Part"', `name="${name}"`)
    .replace('<String value="Bracket"/>', `<String value="${name}"/>`)
    .replace(
      /<LinkList count="\d+">.*?<\/LinkList>/,
      `<LinkList count="${members.length}">${members.map((m) => `<Link value="${m}"/>`).join('')}</LinkList>`,
    )
    .replace(/<Property name="Origin"[^>]*><Link value="[^"]*"\/><\/Property>/, '');
  return { name, type: 'App::Part', xml };
}
