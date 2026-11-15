/**
 * Test support (no production code): the S11 fixture documents (`part-fixtures.ts`, made
 * with FreeCAD 1.1.4 by our own script) as `.FCStd` bytes. Each object is written back as the
 * `<Object>` element FreeCAD saved, its tokens expanded; `GuiDocument.xml` gets each object's
 * visibility. `edit` changes an object's XML to make a document wrong or hostile on purpose,
 * `brep` an object's stored shape, `extra` adds objects and `entries` archive entries.
 */
import { inflateSync, strFromU8 } from 'fflate';
import { fcstd, guiXml } from './fixtures';
import {
  PART_BREP_DEFLATED,
  PART_CASES,
  PART_TOKENS,
  type PartFixtureCase,
  type PartFixtureObject,
} from './part-fixtures';

let breps: readonly string[] | undefined;
/** The fixtures' distinct B-rep texts, inflated once. */
export function partBreps(): readonly string[] {
  if (!breps) {
    const bytes = Uint8Array.from(atob(PART_BREP_DEFLATED), (c) => c.charCodeAt(0));
    breps = strFromU8(inflateSync(bytes)).split('\u0000');
  }
  return breps;
}

/** An object's XML with its tokens expanded (in reverse: a later token's text holds earlier ones). */
export function expandPartXml(xml: string): string {
  let out = xml;
  for (const [token, text] of [...PART_TOKENS].reverse()) out = out.split(token).join(text);
  return out;
}

export function partCase(name: string): PartFixtureCase {
  const c = PART_CASES[name];
  if (!c) throw new Error(`no fixture document ${name}`);
  return c;
}

/** The stored B-rep text of one fixture object. */
export function partBrep(name: string, object: string): string {
  const o = partCase(name).objects.find((x) => x.object === object);
  if (o?.stored === undefined) throw new Error(`${name}: ${object} stores no shape`);
  return partBreps()[o.stored] as string;
}

/** An object a test adds: its declared type and its `<Object>` element. */
export interface RawPartObject {
  readonly name: string;
  readonly type: string;
  readonly xml: string;
  readonly hidden?: boolean;
}

export interface PartFileOptions {
  /** Changes an object's XML (expanded) before it is written; `undefined` drops the object. */
  readonly edit?: (object: string, xml: string) => string | undefined;
  /** Replaces an object's stored B-rep text (`undefined` leaves its entry out). */
  readonly brep?: (object: string, text: string) => string | undefined;
  /** Objects added after the case's own. */
  readonly extra?: readonly RawPartObject[];
  /** Archive entries added or replaced. */
  readonly entries?: Readonly<Record<string, string | Uint8Array>>;
  /** Visibility changed, by object. */
  readonly visible?: Readonly<Record<string, boolean>>;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One fixture document as `.FCStd` bytes, as FreeCAD 1.1 saves it. */
export function partFile(name: string, options: PartFileOptions = {}): Uint8Array {
  const c = partCase(name);
  const texts = partBreps();
  const entries: Record<string, string | Uint8Array> = {};
  const objects: RawPartObject[] = [];
  const raw = (o: PartFixtureObject) => {
    const xml = expandPartXml(o.xml);
    const edited = options.edit ? options.edit(o.object, xml) : xml;
    if (edited === undefined) return;
    if (o.stored !== undefined) {
      const text = texts[o.stored] as string;
      const t = options.brep ? options.brep(o.object, text) : text;
      if (t !== undefined) entries[`${o.object}.Shape.brp`] = t;
    }
    for (const [file, b64] of Object.entries(o.files ?? {}))
      entries[file] = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    objects.push({
      name: o.object,
      type: o.type,
      xml: edited,
      ...(o.hidden ? { hidden: true } : {}),
    });
  };
  for (const o of c.objects) raw(o);
  objects.push(...(options.extra ?? []));
  Object.assign(entries, options.entries ?? {});
  const xml = [
    `<?xml version='1.0' encoding='utf-8'?>`,
    '<Document SchemaVersion="4" ProgramVersion="1.1.4R20260101 (Git)" FileVersion="1">',
    '<Properties Count="1" TransientCount="0"><Property name="Label" type="App::PropertyString"><String value="Parts"/></Property></Properties>',
    `<Objects Count="${objects.length}">`,
    ...objects.map((o) => `<Object type="${o.type}" name="${esc(o.name)}" id="1"/>`),
    '</Objects>',
    `<ObjectData Count="${objects.length}">`,
    ...objects.map((o) => o.xml),
    '</ObjectData>',
    '</Document>',
  ].join('\n');
  return fcstd({
    'Document.xml': xml,
    'GuiDocument.xml': guiXml(
      objects.map((o) => ({ name: o.name, visible: options.visible?.[o.name] ?? !o.hidden })),
    ),
    ...entries,
  });
}

/** The names of every S11 fixture document. */
export const PART_DOCUMENTS = Object.keys(PART_CASES);
