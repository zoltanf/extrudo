/**
 * Test support (no production code): the S10 fixture parts
 * (`parameter-fixtures.ts`, made with FreeCAD 1.1.4 by our own script) as
 * `.FCStd` bytes. Each object is written back as the `<Object>` element
 * FreeCAD saved, its tokens expanded; the body, its origin and the file around
 * them are written as S7's parts write them. `edit` changes an object's XML
 * (a stored value, an expression, an alias) to make a part wrong or hostile on
 * purpose; `extra` adds objects.
 */
import { fcstd, guiXml } from './fixtures';
import {
  PARAM_BREP,
  PARAM_CASES,
  PARAM_TOKENS,
  type ParamFixtureCase,
  type ParamFixtureObject,
} from './parameter-fixtures';

/** An object's XML with its tokens expanded. */
export function expandXml(xml: string): string {
  let out = xml;
  for (const [token, text] of PARAM_TOKENS) out = out.split(token).join(text);
  return out;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** An object written by a test: its declared type and its `<Object>` element. */
export interface RawObject {
  readonly name: string;
  readonly type: string;
  readonly xml: string;
}

export interface ParamPartOptions {
  /** Changes an object's XML (expanded) before it is written; `undefined` drops the object. */
  readonly edit?: (object: string, xml: string) => string | undefined;
  /** Objects added after the case's own. */
  readonly extra?: readonly RawObject[];
  /** Objects whose stored shape is left out. */
  readonly noShape?: readonly string[];
  /** The sheets and variable sets before the body's objects in the file (they come after by default). */
  readonly outsideFirst?: boolean;
}

const ORIGIN = ['X_Axis', 'Y_Axis', 'Z_Axis', 'XY_Plane', 'XZ_Plane', 'YZ_Plane'];

const placement = () =>
  '<Property name="Placement" type="App::PropertyPlacement"><PropertyPlacement Px="0" Py="0" Pz="0" Q0="0" Q1="0" Q2="0" Q3="1" A="0" Ox="0" Oy="0" Oz="1"/></Property>';
const labelXml = (text: string) =>
  `<Property name="Label" type="App::PropertyString"><String value="${esc(text)}"/></Property>`;
const objectXml = (name: string, props: string[], extensions?: string[]) =>
  [
    `<Object name="${esc(name)}"${extensions ? ' Extensions="True"' : ''}>`,
    ...(extensions
      ? [
          `<Extensions Count="${extensions.length}">`,
          ...extensions.map((e) => `<Extension type="${e}" name="${e.split('::')[1]}"/>`),
          '</Extensions>',
        ]
      : []),
    `<Properties Count="${props.length}" TransientCount="0">`,
    ...props,
    '</Properties>',
    '</Object>',
  ].join('');

/** The case's objects, the body and its origin as raw objects, and the archive's shape entries. */
export function paramObjects(
  name: string,
  options: ParamPartOptions = {},
): { objects: RawObject[]; entries: Record<string, string | Uint8Array> } {
  const c = PARAM_CASES[name] as ParamFixtureCase | undefined;
  if (!c) throw new Error(`no fixture part ${name}`);
  const entries: Record<string, string | Uint8Array> = {};
  const noShape = new Set(options.noShape ?? []);
  const raw = (o: ParamFixtureObject): RawObject | undefined => {
    const xml = expandXml(o.xml);
    const edited = options.edit ? options.edit(o.object, xml) : xml;
    if (edited === undefined) return undefined;
    if (o.stored !== undefined && !noShape.has(o.object))
      entries[`${o.object}.Shape.brp`] = PARAM_BREP[o.stored] as string;
    return { name: o.object, type: o.type, xml: edited };
  };
  const own = c.objects.map(raw).filter((o): o is RawObject => o !== undefined);
  const outside = c.outside.map(raw).filter((o): o is RawObject => o !== undefined);
  const tip = c.objects.find((o) => o.object === c.tip);
  if (tip?.stored !== undefined) entries['Body.Shape.brp'] = PARAM_BREP[tip.stored] as string;
  const body: RawObject = {
    name: 'Body',
    type: 'PartDesign::Body',
    xml: objectXml(
      'Body',
      [
        labelXml('Body'),
        placement(),
        `<Property name="Group" type="App::PropertyLinkList"><LinkList count="${c.group.length + 1}">${[
          'Origin',
          ...c.group,
        ]
          .map((g) => `<Link value="${g}"/>`)
          .join('')}</LinkList></Property>`,
        `<Property name="Tip" type="App::PropertyLink"><Link value="${c.tip}"/></Property>`,
        '<Property name="Origin" type="App::PropertyLink"><Link value="Origin"/></Property>',
        `<Property name="Shape" type="Part::PropertyPartShape"><Part file="${tip?.stored !== undefined ? 'Body.Shape.brp' : ''}"/></Property>`,
      ],
      ['App::OriginGroupExtension'],
    ),
  };
  const origin: RawObject[] = [
    {
      name: 'Origin',
      type: 'App::Origin',
      xml: objectXml('Origin', [
        labelXml('Origin'),
        placement(),
        `<Property name="OriginFeatures" type="App::PropertyLinkList"><LinkList count="${ORIGIN.length}">${ORIGIN.map((n) => `<Link value="${n}"/>`).join('')}</LinkList></Property>`,
      ]),
    },
    ...ORIGIN.map((n) => ({
      name: n,
      type: n.endsWith('Axis') ? 'App::Line' : 'App::Plane',
      xml: objectXml(n, [
        labelXml(n),
        placement(),
        `<Property name="Role" type="App::PropertyString"><String value="${n}"/></Property>`,
      ]),
    })),
  ];
  return {
    objects: [
      body,
      ...origin,
      ...(options.outsideFirst ? [...outside, ...own] : [...own, ...outside]),
      ...(options.extra ?? []),
    ],
    entries,
  };
}

/** One fixture part as `.FCStd` bytes, as FreeCAD 1.1 saves it. */
export function paramFile(name: string, options: ParamPartOptions = {}): Uint8Array {
  const { objects, entries } = paramObjects(name, options);
  const xml = [
    `<?xml version='1.0' encoding='utf-8'?>`,
    '<Document SchemaVersion="4" ProgramVersion="1.1.4R20260101 (Git)" FileVersion="1">',
    `<Properties Count="1" TransientCount="0">${labelXml('Parts')}</Properties>`,
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
    'GuiDocument.xml': guiXml([{ name: 'Body', visible: true, colour: 0x3366ccff }]),
    ...entries,
  });
}

/** The names of every S10 fixture part. */
export const PARAM_PARTS = Object.keys(PARAM_CASES);

/** A spreadsheet object with the given cells (address, content, alias?), labelled `label`. */
export function sheetObject(
  name: string,
  label: string,
  cells: readonly (readonly [string, string, string?])[],
): RawObject {
  return {
    name,
    type: 'Spreadsheet::Sheet',
    xml: objectXml(name, [
      labelXml(label),
      `<Property name="cells" type="Spreadsheet::PropertySheet"><Cells Count="${cells.length}" xlink="1"><XLinks count="0"></XLinks>${cells
        .map(
          ([address, content, alias]) =>
            `<Cell address="${esc(address)}" content="${esc(content)}"${alias !== undefined ? ` alias="${esc(alias)}"` : ''} />`,
        )
        .join('')}</Cells></Property>`,
    ]),
  };
}
