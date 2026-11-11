/**
 * Small `.FCStd` files written by hand for the tests: `Document.xml` and
 * `GuiDocument.xml` in FreeCAD's grammar, and B-rep entries that are only the
 * format line and a shape table (the reader never parses B-rep text). No
 * part of any real file.
 */
import { strToU8, zipSync } from 'fflate';

export interface FixtureObject {
  name: string;
  type: string;
  /** `<Property>` elements, already written (see `prop`). */
  props: string[];
  extensions?: string[];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One `<Property>` with its value element(s). */
export const prop = (name: string, type: string, value: string, extra = '') =>
  `<Property name="${name}" type="${type}"${extra}>\n${value}\n</Property>`;

export const label = (text: string) =>
  prop('Label', 'App::PropertyString', `<String value="${esc(text)}"/>`);
export const float = (name: string, value: number | string, type = 'App::PropertyLength') =>
  prop(name, type, `<Float value="${value}"/>`);
export const link = (name: string, target: string, type = 'App::PropertyLink') =>
  prop(name, type, `<Link value="${target}"/>`);
export const links = (name: string, targets: string[]) =>
  prop(
    name,
    'App::PropertyLinkList',
    `<LinkList count="${targets.length}">${targets.map((t) => `<Link value="${t}"/>`).join('')}</LinkList>`,
  );
export const shape = (file: string) =>
  prop('Shape', 'Part::PropertyPartShape', `<Part file="${file}"/>`);
export const placement = (
  x = 0,
  y = 0,
  z = 0,
  angle = 0,
  axis: [number, number, number] = [0, 0, 1],
) =>
  prop(
    'Placement',
    'App::PropertyPlacement',
    `<PropertyPlacement Px="${x}" Py="${y}" Pz="${z}" Q0="0" Q1="0" Q2="${Math.sin(angle / 2)}" Q3="${Math.cos(angle / 2)}" A="${angle}" Ox="${axis[0]}" Oy="${axis[1]}" Oz="${axis[2]}"/>`,
  );

/** `Document.xml` for `objects`, in schema 4. */
export function documentXml(
  objects: FixtureObject[],
  options: { version?: string; label?: string; docProps?: string[] } = {},
): string {
  const docProps = [label(options.label ?? 'Unnamed'), ...(options.docProps ?? [])];
  return [
    `<?xml version='1.0' encoding='utf-8'?>`,
    `<!--`,
    ` Hand-written for a test.`,
    `-->`,
    `<Document SchemaVersion="4" ProgramVersion="${options.version ?? '1.0.0R39109 (Git)'}" FileVersion="1">`,
    `<Properties Count="${docProps.length}" TransientCount="0">`,
    ...docProps,
    `</Properties>`,
    `<Objects Count="${objects.length}">`,
    ...objects.map((o) => `<Object type="${o.type}" name="${o.name}" id="1"/>`),
    `</Objects>`,
    `<ObjectData Count="${objects.length}">`,
    ...objects.map((o) =>
      [
        `<Object name="${o.name}"${o.extensions ? ' Extensions="True"' : ''}>`,
        ...(o.extensions
          ? [
              `<Extensions Count="${o.extensions.length}">`,
              ...o.extensions.map((e) => `<Extension type="${e}" name="${e.split('::')[1]}"/>`),
              `</Extensions>`,
            ]
          : []),
        `<Properties Count="${o.props.length}" TransientCount="0">`,
        ...o.props,
        `</Properties>`,
        `</Object>`,
      ].join('\n'),
    ),
    `</ObjectData>`,
    `</Document>`,
  ].join('\n');
}

export interface FixtureView {
  name: string;
  visible?: boolean;
  /** Packed `0xRRGGBBAA`. */
  colour?: number;
  transparency?: number;
}

/** `GuiDocument.xml` with a view provider per entry. */
export function guiXml(views: FixtureView[]): string {
  return [
    `<?xml version='1.0' encoding='utf-8'?>`,
    `<Document SchemaVersion="1">`,
    `<ViewProviderData Count="${views.length}">`,
    ...views.map((v) => {
      const props = [
        ...(v.visible !== undefined
          ? [prop('Visibility', 'App::PropertyBool', `<Bool value="${v.visible}"/>`)]
          : []),
        ...(v.colour !== undefined
          ? [prop('ShapeColor', 'App::PropertyColor', `<PropertyColor value="${v.colour}"/>`)]
          : []),
        ...(v.transparency !== undefined
          ? [prop('Transparency', 'App::PropertyPercent', `<Integer value="${v.transparency}"/>`)]
          : []),
      ];
      return `<ViewProvider name="${v.name}">\n<Properties Count="${props.length}">\n${props.join('\n')}\n</Properties>\n</ViewProvider>`;
    }),
    `</ViewProviderData>`,
    `<Camera settings=""/>`,
    `</Document>`,
  ].join('\n');
}

/** B-rep text with a solid (`So`) or only faces: the format line and a shape table, nothing else. */
export function brep(kind: 'solid' | 'face' = 'solid'): string {
  return [
    '',
    'CASCADE Topology V1, (c) Matra-Datavision',
    'Locations 0',
    'Curve2ds 0',
    'Curves 0',
    'Polygon3D 0',
    'PolygonOnTriangulations 0',
    'Surfaces 0',
    'Triangulations 0',
    '',
    'TShapes 1',
    kind === 'solid' ? 'So' : 'Fa',
    '',
    '0101100',
    '*',
    '',
    '+1 0 ',
    '',
  ].join('\n');
}

/** A zip of the given entries (strings as UTF-8). */
export function fcstd(entries: Record<string, string | Uint8Array>): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(entries))
    files[name] = typeof content === 'string' ? strToU8(content) : content;
  return zipSync(files);
}

const body = (shapeFile: string): FixtureObject => ({
  name: 'Body',
  type: 'PartDesign::Body',
  extensions: ['App::OriginGroupExtension'],
  props: [
    label('Bracket'),
    links('Group', ['Sketch', 'Pad']),
    link('Tip', 'Pad'),
    link('Origin', 'Origin'),
    placement(10, 0, 0),
    shape(shapeFile),
  ],
});

const sketch = (shapeFile: string): FixtureObject => ({
  name: 'Sketch',
  type: 'Sketcher::SketchObject',
  extensions: ['Part::AttachExtension'],
  props: [
    label('Sketch'),
    prop(
      'AttachmentSupport',
      'App::PropertyLinkSubList',
      '<LinkSubList count="1"><Link obj="XY_Plane" sub=""/></LinkSubList>',
    ),
    prop('MapMode', 'App::PropertyEnumeration', '<Integer value="5"/>'),
    prop(
      'Geometry',
      'Part::PropertyGeometryList',
      `<GeometryList count="1"><Geometry type="Part::GeomCircle" id="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><Circle CenterX="0" CenterY="0" CenterZ="0" NormalX="0" NormalY="0" NormalZ="1" AngleXU="0" Radius="5"/><Construction value="0"/></Geometry></GeometryList>`,
    ),
    prop(
      'Constraints',
      'Sketcher::PropertyConstraintList',
      `<ConstraintList count="1"><Constrain Name="r" Type="8" Value="5" First="0" FirstPos="0" Second="-2000" SecondPos="0" Third="-2000" ThirdPos="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsActive="1"/></ConstraintList>`,
    ),
    placement(),
    shape(shapeFile),
  ],
});

const pad = (shapeFile: string): FixtureObject => ({
  name: 'Pad',
  type: 'PartDesign::Pad',
  props: [
    label('Pad'),
    prop('Profile', 'App::PropertyLinkSub', '<LinkSub value="Sketch" count="0"></LinkSub>'),
    float('Length', 15),
    prop(
      'Type',
      'App::PropertyEnumeration',
      '<Integer value="0"/><CustomEnumList count="2"><Enum value="Length"/><Enum value="UpToLast"/></CustomEnumList>',
    ),
    link('BaseFeature', ''),
    prop(
      'ExpressionEngine',
      'App::PropertyExpressionEngine',
      '<ExpressionEngine count="1"><Expression path="Length" expression="Spreadsheet.depth * 2"/></ExpressionEngine>',
    ),
    placement(),
    shape(shapeFile),
  ],
});

const origin: FixtureObject[] = [
  {
    name: 'Origin',
    type: 'App::Origin',
    props: [label('Origin'), links('OriginFeatures', ['XY_Plane'])],
  },
  {
    name: 'XY_Plane',
    type: 'App::Plane',
    props: [label('XY_Plane'), prop('Role', 'App::PropertyString', '<String value="XY_Plane"/>')],
  },
];

/** A body with a sketch and a pad, saved by 1.0: entries named `<Object>.<Property>.brp`. */
export function bodyFile10(options: { gui?: boolean } = {}): Uint8Array {
  const objects = [
    ...origin,
    body('Body.Shape.brp'),
    sketch('Sketch.Shape.brp'),
    pad('Pad.Shape.brp'),
  ];
  return fcstd({
    'Document.xml': documentXml(objects, { docProps: [unitSystem()] }),
    ...(options.gui === false
      ? {}
      : {
          'GuiDocument.xml': guiXml([
            { name: 'Body', visible: true, colour: 0xcc3300ff, transparency: 20 },
            { name: 'Sketch', visible: false },
            { name: 'Pad', visible: false },
          ]),
        }),
    'Body.Shape.brp': brep(),
    'Sketch.Shape.brp': brep('face'),
    'Pad.Shape.brp': brep(),
  });
}

/** The same body as saved by 0.21: entries named `PartShape<N>.brp` in save order. */
export function bodyFile021(): Uint8Array {
  const objects = [
    ...origin,
    body('PartShape.brp'),
    sketch('PartShape1.brp'),
    pad('PartShape2.brp'),
  ];
  return fcstd({
    'Document.xml': documentXml(objects, { version: '0.21.2R33771 (Git)' }),
    'GuiDocument.xml': guiXml([{ name: 'Body', visible: true }]),
    'PartShape.brp': brep(),
    'PartShape1.brp': '',
    'PartShape2.brp': brep(),
  });
}

function unitSystem(): string {
  return prop(
    'UnitSystem',
    'App::PropertyEnumeration',
    '<Integer value="1"/><CustomEnumList count="2"><Enum value="Standard (mm, kg, s, degree)"/><Enum value="Imperial decimal (in, lb)"/></CustomEnumList>',
  );
}

/** A Part box cut by a cylinder, both inside an `App::Part` moved by 5 mm, and a link to the cut. */
export function partFile(): Uint8Array {
  const objects: FixtureObject[] = [
    {
      name: 'Part',
      type: 'App::Part',
      extensions: ['App::OriginGroupExtension'],
      props: [
        label('Assembly part'),
        links('Group', ['Box', 'Cylinder', 'Cut']),
        placement(0, 0, 5),
      ],
    },
    {
      name: 'Box',
      type: 'Part::Box',
      props: [
        label('Box'),
        float('Length', 10),
        float('Width', 10),
        float('Height', 10),
        placement(),
        shape('PartShape.brp'),
      ],
    },
    {
      name: 'Cylinder',
      type: 'Part::Cylinder',
      props: [
        label('Cylinder'),
        float('Radius', 2),
        float('Height', 10),
        float('Angle', 360, 'App::PropertyAngle'),
        placement(),
        shape('PartShape1.brp'),
      ],
    },
    {
      name: 'Cut',
      type: 'Part::Cut',
      props: [
        label('Holed box'),
        link('Base', 'Box'),
        link('Tool', 'Cylinder'),
        placement(),
        shape('PartShape2.brp'),
      ],
    },
    {
      name: 'Link',
      type: 'App::Link',
      extensions: ['App::LinkBaseExtension'],
      props: [
        label('Holed box copy'),
        prop('LinkedObject', 'App::PropertyXLink', '<XLink file="" stamp="" name="Cut"/>'),
        prop('LinkTransform', 'App::PropertyBool', '<Bool value="false"/>'),
        prop(
          'LinkPlacement',
          'App::PropertyPlacement',
          '<PropertyPlacement Px="20" Py="0" Pz="0" Q0="0" Q1="0" Q2="0" Q3="1"/>',
        ),
        placement(20, 0, 0),
      ],
    },
    {
      name: 'Sketch2D',
      type: 'Part::Part2DObjectPython',
      props: [
        label('A profile'),
        prop(
          'Proxy',
          'App::PropertyPythonObject',
          '<Python value="bnVsbA==" encoded="yes" module="draftobjects.wire" class="Wire"/>',
        ),
        shape('PartShape3.brp'),
      ],
    },
  ];
  return fcstd({
    'Document.xml': documentXml(objects, { version: '0.20.2R29603 (Git)' }),
    'GuiDocument.xml': guiXml([
      { name: 'Box', visible: false },
      { name: 'Cylinder', visible: false },
      { name: 'Cut', visible: true, colour: 0x00ff0000 },
      { name: 'Link', visible: true },
    ]),
    'PartShape.brp': brep(),
    'PartShape1.brp': brep(),
    'PartShape2.brp': brep(),
    'PartShape3.brp': brep('face'),
  });
}

/** A spreadsheet with two aliased cells and one plain one. */
export function sheetFile(): Uint8Array {
  const objects: FixtureObject[] = [
    {
      name: 'Spreadsheet',
      type: 'Spreadsheet::Sheet',
      props: [
        label('Dimensions'),
        prop(
          'cells',
          'Spreadsheet::PropertySheet',
          '<Cells Count="3" xlink="1"><XLinks count="0"></XLinks><Cell address="A1" content="depth"/><Cell address="B1" content="=7.5 mm" alias="depth"/><Cell address="B2" content="=depth &lt; 10 ? 3 : 4" alias="wall"/></Cells>',
        ),
      ],
    },
  ];
  return fcstd({ 'Document.xml': documentXml(objects) });
}
