/**
 * Test support (no production code): `.FCStd` files written by hand whose
 * stored shapes are real B-rep text, for the shapes-only import's tests and
 * the e2e spec. The texts are the kernel's own test shapes (a 10 × 20 × 30 mm
 * box written by OCCT's writer, and prisms made with our own scripts); every
 * XML line is ours. No part of any real file.
 */
import { BOX, IDENTITY_MOVED, LOCATED_FACE } from '@extrudo/kernel/brep-test-support';
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

export { BOX, IDENTITY_MOVED, LOCATED_FACE };

/**
 * Two copies of `BOX` in one compound, the second moved by `dx` along x.
 * The compound goes last in the shape table, so every reference in the box's
 * own table counts one further back (B-rep references count from the end).
 */
export function twoBoxes(dx = 50): string {
  const [head, tail] = BOX.split('\nTShapes ') as [string, string];
  const count = Number(tail.slice(0, tail.indexOf('\n')));
  const shapes = tail
    .slice(tail.indexOf('\n'))
    .replace(/\n\+1 0 $/, '')
    .split('\n')
    .map((line) =>
      // Only a sub-shape list (`+9 0 -9 3 *`) holds references.
      line.endsWith('*')
        ? line.replace(/([+-])(\d+) (\d+)/g, (_, sign: string, n: string, loc: string) => {
            return `${sign}${Number(n) + 1} ${loc}`;
          })
        : line,
    )
    .join('\n');
  const located = head.replace(
    'Locations 0',
    ['Locations 1', '1', `1 0 0 ${dx}`, '0 1 0 0', '0 0 1 0'].join('\n'),
  );
  return `${located}\nTShapes ${count + 1}${shapes}Co\n\n1100000\n+2 0 +2 1 *\n\n+1 0 `;
}

const part = (name: string, ...props: string[]): FixtureObject => ({
  name,
  type: 'Part::Feature',
  props: [label(name), placement(), shape(`${name}.brp`), ...props],
});

/**
 * Every case of the shapes-only import in one file, in this order:
 *
 * - `Bracket`: a body with a sketch and a pad; only the body's shape comes in.
 * - `Holed box`: a Part cut of a box by a cylinder; the box and the cylinder are used up.
 * - `Hidden box`: hidden in the file.
 * - `Red box`: coloured red, half transparent.
 * - `Moved box`, inside `Assembly part`, an `App::Part` moved by 5 mm along z.
 * - `Holed box copy`: a link to the cut, placed 20 mm along x.
 * - `Scan`: a mesh (left out).
 * - `Empty body`: a body with no shape (left out).
 * - `Pair`: a compound of two boxes, the second 50 mm along x.
 * - `Twin A`, `Twin B`: two objects with the same shape (one attachment).
 */
export function shapesFile(): Uint8Array {
  const objects: FixtureObject[] = [
    {
      name: 'Body',
      type: 'PartDesign::Body',
      extensions: ['App::OriginGroupExtension'],
      props: [
        label('Bracket'),
        links('Group', ['Sketch', 'Pad']),
        link('Tip', 'Pad'),
        placement(),
        shape('Body.brp'),
      ],
    },
    {
      name: 'Sketch',
      type: 'Sketcher::SketchObject',
      props: [label('Sketch'), placement(), shape('Sketch.brp')],
    },
    {
      name: 'Pad',
      type: 'PartDesign::Pad',
      props: [
        label('Pad'),
        prop('Profile', 'App::PropertyLinkSub', '<LinkSub value="Sketch" count="0"></LinkSub>'),
        placement(),
        shape('Pad.brp'),
      ],
    },
    part('Box'),
    { ...part('Cylinder'), type: 'Part::Cylinder' },
    {
      name: 'Cut',
      type: 'Part::Cut',
      props: [
        label('Holed box'),
        link('Base', 'Box'),
        link('Tool', 'Cylinder'),
        placement(),
        shape('Cut.brp'),
      ],
    },
    part('Hidden'),
    part('Red'),
    {
      name: 'Container',
      type: 'App::Part',
      extensions: ['App::OriginGroupExtension'],
      props: [label('Assembly part'), links('Group', ['Moved']), placement(0, 0, 5)],
    },
    part('Moved'),
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
      name: 'Mesh',
      type: 'Mesh::Feature',
      props: [
        label('Scan'),
        prop('Mesh', 'Mesh::PropertyMeshKernel', '<Mesh file="MeshKernel.bms"/>'),
        placement(),
      ],
    },
    {
      name: 'Body001',
      type: 'PartDesign::Body',
      extensions: ['App::OriginGroupExtension'],
      props: [label('Empty body'), links('Group', []), placement(), shape('Body001.brp')],
    },
    part('Pair'),
    part('TwinA'),
    part('TwinB'),
  ];
  const labels: Record<string, string> = {
    Hidden: 'Hidden box',
    Red: 'Red box',
    Moved: 'Moved box',
    TwinA: 'Twin A',
    TwinB: 'Twin B',
  };
  for (const o of objects) {
    const l = labels[o.name];
    if (l) o.props[0] = label(l);
  }
  return fcstd({
    'Document.xml': documentXml(objects, { label: 'Shapes' }),
    'GuiDocument.xml': guiXml([
      { name: 'Body', visible: true, colour: 0x3366ccff },
      { name: 'Box', visible: false },
      { name: 'Cylinder', visible: false },
      { name: 'Hidden', visible: false, colour: 0xccccccff },
      { name: 'Red', visible: true, colour: 0xff000000, transparency: 50 },
    ]),
    'Body.brp': BOX,
    'Sketch.brp': '',
    'Pad.brp': BOX,
    'Box.brp': BOX,
    'Cylinder.brp': LOCATED_FACE,
    'Cut.brp': IDENTITY_MOVED,
    'Hidden.brp': BOX,
    'Red.brp': BOX,
    'Moved.brp': BOX,
    'MeshKernel.bms': new Uint8Array(16),
    'Body001.brp': '',
    'Pair.brp': twoBoxes(),
    'TwinA.brp': BOX,
    'TwinB.brp': BOX,
  });
}

/** A file with objects but no shape at all: a spreadsheet and an empty group. */
export function noShapeFile(): Uint8Array {
  return fcstd({
    'Document.xml': documentXml([
      {
        name: 'Group',
        type: 'App::DocumentObjectGroup',
        props: [label('Notes'), links('Group', [])],
      },
    ]),
  });
}
