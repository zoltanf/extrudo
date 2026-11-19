/**
 * Test support (no production code): the S12a fixture documents (`chain-fixtures.ts`, made with
 * FreeCAD 1.1.4 by our own script) as `.FCStd` bytes, in the grammar FreeCAD 1.1 wrote them or
 * (`asOldFile`) in the one a 0.14 or 0.16 file has: `Sketch` for `Profile`, one `Support` link,
 * no `MapMode` or attachment properties, no `BaseFeature`, `AddShape` or `SubShape`, `Midplane`
 * and `Type` for `SideType`, placements without their axis and angle, no `IsDriving` before
 * 0.16. The stored shapes stay: they are the same solids.
 */
import { inflateSync, strFromU8 } from 'fflate';
import { CHAIN_FIXTURES_DEFLATED } from './chain-fixtures';
import { fcstd, guiXml } from './fixtures';

export interface ChainFixtureObject {
  readonly object: string;
  readonly type: string;
  readonly label: string;
  readonly xml: string;
  readonly hidden?: true;
  readonly stored?: number;
  readonly measure?: {
    readonly solids: number;
    readonly volume: number;
    readonly area: number;
    readonly box: readonly number[];
    readonly centre: readonly number[];
  };
}

export interface ChainFixtureCase {
  readonly note: string;
  readonly roots: readonly string[];
  readonly objects: readonly ChainFixtureObject[];
}

interface ChainData {
  readonly cases: Readonly<Record<string, ChainFixtureCase>>;
  readonly breps: readonly string[];
}

let data: ChainData | undefined;
function chainData(): ChainData {
  if (!data) {
    const bytes = Uint8Array.from(atob(CHAIN_FIXTURES_DEFLATED), (c) => c.charCodeAt(0));
    data = JSON.parse(strFromU8(inflateSync(bytes))) as ChainData;
  }
  return data;
}

export function chainCase(name: string): ChainFixtureCase {
  const c = chainData().cases[name];
  if (!c) throw new Error(`no fixture document ${name}`);
  return c;
}

/** The names of every S12a fixture document. */
export const chainDocuments = (): string[] => Object.keys(chainData().cases);

export interface ChainExtraObject {
  readonly name: string;
  readonly type: string;
  readonly xml: string;
  readonly hidden?: boolean;
}

/** The B-rep text a fixture object stores. */
export function chainBrep(name: string, object: string): string {
  const o = chainCase(name).objects.find((x) => x.object === object);
  if (o?.stored === undefined) throw new Error(`${name}: ${object} stores no shape`);
  return chainData().breps[o.stored] as string;
}

export interface ChainFileOptions {
  /** Changes an object's XML before it is written; `undefined` drops the object. */
  readonly edit?: (object: string, xml: string) => string | undefined;
  /** Replaces an object's stored B-rep text (`undefined` leaves its entry out). */
  readonly brep?: (object: string, text: string) => string | undefined;
  /** Objects added after the case's own: internal name, type and `<Object>` element. */
  readonly extra?: readonly ChainExtraObject[];
  /** Objects added before the case's own. */
  readonly before?: readonly ChainExtraObject[];
  /** Archive entries added or replaced. */
  readonly entries?: Readonly<Record<string, string | Uint8Array>>;
  /** The document's `ProgramVersion`. */
  readonly version?: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One fixture document as `.FCStd` bytes. */
export function chainFile(name: string, options: ChainFileOptions = {}): Uint8Array {
  const { breps } = chainData();
  const entries: Record<string, string | Uint8Array> = {};
  const objects: ChainExtraObject[] = [...(options.before ?? [])];
  for (const o of chainCase(name).objects) {
    const xml = options.edit ? options.edit(o.object, o.xml) : o.xml;
    if (xml === undefined) continue;
    if (o.stored !== undefined) {
      const text = breps[o.stored] as string;
      const t = options.brep ? options.brep(o.object, text) : text;
      if (t !== undefined) entries[`${o.object}.Shape.brp`] = t;
    }
    objects.push({ name: o.object, type: o.type, xml, ...(o.hidden ? { hidden: true } : {}) });
  }
  objects.push(...(options.extra ?? []));
  Object.assign(entries, options.entries ?? {});
  const version = options.version ?? '1.1.4R20260101 (Git)';
  const body = [
    `<?xml version='1.0' encoding='utf-8'?>`,
    `<Document SchemaVersion="4" ProgramVersion="${version}" FileVersion="1">`,
    '<Properties Count="1" TransientCount="0"><Property name="Label" type="App::PropertyString"><String value="Chains"/></Property></Properties>',
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
    'GuiDocument.xml': guiXml(objects.map((o) => ({ name: o.name, visible: !o.hidden }))),
    ...entries,
  });
}

// --- The old grammar --------------------------------------------------------------------------

export type OldVersion = '0.14' | '0.16';

const COMMON = ['Label', 'Placement', 'Shape'];
const SKETCH_BASED = [...COMMON, 'Sketch', 'Midplane', 'Reversed'];
const EXTRUDED = [...SKETCH_BASED, 'Type', 'Length', 'UpToFace'];
/** What each type holds in the old files (`ExpressionEngine` from 0.16), read off the library's files. */
export const OLD_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
  'PartDesign::Pad': [...EXTRUDED, 'Length2', 'AddShape'],
  'PartDesign::Pocket': [...EXTRUDED, 'SubShape'],
  'PartDesign::Revolution': [...SKETCH_BASED, 'Angle', 'Axis', 'Base', 'ReferenceAxis', 'AddShape'],
  'PartDesign::Groove': [...SKETCH_BASED, 'Angle', 'Axis', 'Base', 'ReferenceAxis', 'SubShape'],
  'PartDesign::Fillet': [...COMMON, 'Base', 'Radius'],
  'PartDesign::Chamfer': [...COMMON, 'Base', 'Size'],
  'PartDesign::LinearPattern': [
    ...COMMON,
    'Direction',
    'Length',
    'Occurrences',
    'Originals',
    'Reversed',
  ],
  'PartDesign::PolarPattern': [...COMMON, 'Angle', 'Axis', 'Occurrences', 'Originals', 'Reversed'],
  'PartDesign::Mirrored': [...COMMON, 'MirrorPlane', 'Originals'],
  'Sketcher::SketchObject': [...COMMON, 'Constraints', 'ExternalGeometry', 'Geometry', 'Support'],
};

/** The property types an old file declares where they differ from what FreeCAD 1.1 wrote, by version. */
const OLD_TYPES: Readonly<Record<OldVersion, Readonly<Record<string, string>>>> = {
  '0.14': {
    'PartDesign::LinearPattern.Length': 'App::PropertyFloat',
    'PartDesign::LinearPattern.Occurrences': 'App::PropertyInteger',
    'PartDesign::PolarPattern.Occurrences': 'App::PropertyInteger',
    'PartDesign::PolarPattern.Angle': 'App::PropertyFloat',
    'PartDesign::Fillet.Radius': 'App::PropertyFloatConstraint',
    'PartDesign::Chamfer.Size': 'App::PropertyFloatConstraint',
  },
  '0.16': {
    'PartDesign::LinearPattern.Occurrences': 'App::PropertyInteger',
    'PartDesign::PolarPattern.Occurrences': 'App::PropertyInteger',
    'PartDesign::Fillet.Radius': 'App::PropertyQuantityConstraint',
    'PartDesign::Chamfer.Size': 'App::PropertyQuantityConstraint',
  },
};

const PROPERTY = /<Property name="([^"]+)" type="([^"]+)"[^>]*?(?:\/>|>(.*?)<\/Property>)/gs;

/** One property of an object's XML: its inner text, when it has it. */
function inner(xml: string, name: string): string | undefined {
  for (const m of xml.matchAll(PROPERTY)) if (m[1] === name) return m[3] ?? '';
  return undefined;
}
const attr = (xml: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(xml)?.[1];
const property = (name: string, type: string, body: string) =>
  `<Property name="${name}" type="${type}">${body}</Property>`;
const bool = (v: boolean) => `<Bool value="${v ? 'true' : 'false'}"/>`;
/** FreeCAD 1.1's `SideType`, by index. */
const SIDE = { one: 0, two: 1, symmetric: 2 };

/**
 * The XML of one object as an old FreeCAD writes it. A sketch drawn on no face has an empty
 * `Support`, as the library's old revolutions do: nothing in such a file says what a feature on
 * that sketch builds on.
 */
function oldXml(type: string, xml: string, version: OldVersion): string {
  const allowed = OLD_PROPERTIES[type];
  if (!allowed) return xml;
  const keep = new Set([...allowed, ...(version === '0.16' ? ['ExpressionEngine'] : [])]);
  const out: string[] = [];
  const side = Number(attr(inner(xml, 'SideType') ?? '', 'value') ?? SIDE.one);
  const twoSides = side === SIDE.two;
  const midplane = side === SIDE.symmetric;
  for (const m of xml.matchAll(PROPERTY)) {
    const [whole, name, declared, body = ''] = m as unknown as [string, string, string, string];
    if (name === 'Profile') {
      const sketch = attr(body, 'value') ?? '';
      out.push(property('Sketch', 'App::PropertyLink', `<Link value="${sketch}"/>`));
    } else if (name === 'AttachmentSupport') {
      const link = /<Link obj="([^"]*)" sub="([^"]*)"/.exec(body);
      const object = link?.[1] ?? '';
      const sub = link?.[2] ?? '';
      out.push(
        property(
          'Support',
          'App::PropertyLinkSub',
          `<LinkSub value="${object}" count="${object ? 1 : 0}">${object ? `<Sub value="${sub}"/>` : ''}</LinkSub>`,
        ),
      );
    } else if (name === 'Midplane')
      out.push(property(name, declared, bool(midplane || /"true"/.test(body))));
    else if (name === 'Type' && twoSides)
      out.push(property(name, 'App::PropertyEnumeration', '<Integer value="4"/>'));
    else if (keep.has(name)) {
      const t = OLD_TYPES[version][`${type}.${name}`] ?? declared;
      out.push(whole.replace(`type="${declared}"`, `type="${t}"`));
    }
  }
  for (const [name, entry] of [
    ['AddShape', 'AddShape'],
    ['SubShape', 'SubShape'],
  ] as const)
    if (keep.has(name)) {
      const object = attr(xml, 'name');
      out.push(property(name, 'Part::PropertyPartShape', `<Part file="${object}.${entry}.brp"/>`));
    }
  if (keep.has('Axis') && keep.has('Base') && !inner(xml, 'Axis')) {
    const zero = '<PropertyVector valueX="0" valueY="0" valueZ="0"/>';
    out.push(property('Axis', 'App::PropertyVector', zero));
    out.push(property('Base', 'App::PropertyVector', zero));
  }
  const name = attr(xml, 'name');
  return `<Object name="${name}"><Properties Count="${out.length}" TransientCount="0">${out
    .join('')
    .replace(/ A="[^"]*" Ox="[^"]*" Oy="[^"]*" Oz="[^"]*"/g, '')
    .replace(/<GeoExtensions.*?<\/GeoExtensions>/gs, '')
    .replace(/ migrated="1"/g, '')
    .replace(/ IsInVirtualSpace="[^"]*"/g, '')
    .replace(version === '0.14' ? / IsDriving="[^"]*"/g : /$^/g, '')}</Properties></Object>`;
}

/** The document an old FreeCAD would have written for a case, the same solids stored. */
export function asOldFile(
  name: string,
  version: OldVersion,
  options: ChainFileOptions = {},
): Uint8Array {
  const types = new Map(chainCase(name).objects.map((o) => [o.object, o.type]));
  const entries: Record<string, string> = {};
  for (const o of chainCase(name).objects) {
    if (o.type === 'PartDesign::Pad' || o.type === 'PartDesign::Revolution')
      entries[`${o.object}.AddShape.brp`] = '';
    if (o.type === 'PartDesign::Pocket' || o.type === 'PartDesign::Groove')
      entries[`${o.object}.SubShape.brp`] = '';
  }
  return chainFile(name, {
    ...options,
    version: version === '0.14' ? '0.14.3703 (Git)' : '0.16.6712 (Git)',
    entries: { ...entries, ...(options.entries ?? {}) },
    edit: (object, xml) => {
      const old = oldXml(types.get(object) as string, xml, version);
      return options.edit ? options.edit(object, old) : old;
    },
  });
}
