/**
 * A file's final shapes (ADR-0144 decision 7): what the author sees as the
 * result, never a feature's intermediate state or a tool another object used
 * up. Each PartDesign body's own shape; in files from before bodies, the tip
 * of each feature chain; every other shape-holding object that no other
 * object consumes and whose stored shape has a solid; one instance per link;
 * the meshes nothing consumes. Visibility in FreeCAD doesn't select: a hidden
 * final shape comes back hidden.
 *
 * Every lookup goes through indexes built once per call: O(objects + links).
 */
import { FcstdFormatError } from './errors';
import {
  brepHasSolid,
  type FcDocument,
  type FcObject,
  type FcPlacement,
  type FcValue,
  storedShapeEntry,
} from './model';

export type FinalShapeKind = 'body' | 'chain-tip' | 'shape' | 'link' | 'mesh';

export interface FinalShape {
  readonly kind: FinalShapeKind;
  /** The object chosen: the body, the feature, the link … */
  readonly object: FcObject;
  /** The object whose stored data holds the geometry: `object` itself, or a link's target. */
  readonly source: FcObject;
  /** The archive entry with the geometry (B-rep text, or the mesh kernel for `mesh`); `undefined` for an empty body. */
  readonly entry: string | undefined;
  readonly format: 'brep' | 'mesh';
  /** The name to give it: the chosen object's label. */
  readonly name: string;
  readonly visible: boolean;
  readonly colour?: readonly [number, number, number];
  readonly transparency?: number;
  /**
   * The placements to apply to the stored geometry, outermost first: the
   * containers' (an `App::Part`, a body around a feature), and for a link its
   * own placement, after it the inverse of its target's when the link
   * replaces that placement. Empty for a shape at the document's top.
   */
  readonly chain: readonly FcPlacement[];
}

/** Objects whose links never consume what they name (containers, drawings, analyses, spreadsheets). */
const NOT_CONSUMING = [
  'Fem::',
  'TechDraw::',
  'Spreadsheet::',
  'App::DocumentObjectGroup',
  'App::Part',
  'App::Origin',
  'Assembly::',
  'App::LinkGroup',
];
/** Properties that name objects without consuming them. */
const NOT_CONSUMING_PROPERTIES = new Set([
  'ExpressionEngine',
  'Group',
  'Origin',
  'Tip',
  'Model',
  'OriginFeatures',
  'Label',
  'Proxy',
]);
/** Object families that never hold a final shape of their own. */
const NEVER_FINAL = ['Sketcher::', 'App::', 'Spreadsheet::', 'TechDraw::', 'Fem::'];
const DATUMS = new Set(['Plane', 'Line', 'Point', 'CoordinateSystem']);
/** Containers whose placement applies to what they hold (FreeCAD's geo-feature groups). */
const GEO_GROUPS = new Set([
  'App::Part',
  'PartDesign::Body',
  'App::Origin',
  'App::LocalCoordinateSystem',
  'PartDesign::Boolean',
  'Assembly::AssemblyObject',
]);
const isLink = (o: FcObject) => o.type === 'App::Link' || o.type === 'App::LinkElement';
/** How many links a link may go through to reach a shape. */
const MAX_LINK_HOPS = 32;
/** How deep containers may nest before the walk gives up. */
const MAX_CONTAINER_DEPTH = 64;

/** Every object a property value names, as a plain list. */
export function linkedObjects(value: FcValue): string[] {
  switch (value.kind) {
    case 'link':
      return value.object ? [value.object] : [];
    case 'linkSub':
      return value.object ? [value.object] : [];
    case 'linkList':
      return [...value.objects];
    case 'linkSubList':
      return value.items.map((i) => i.object);
    case 'xlink':
      return value.items.filter((i) => i.file === '').map((i) => i.object);
    default:
      return [];
  }
}

const identity: FcPlacement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

function placement(o: FcObject, name = 'Placement'): FcPlacement | undefined {
  const v = o.properties[name]?.value;
  return v?.kind === 'placement' ? v.value : undefined;
}

/** The inverse of a placement: `R⁻¹·(p − t)`. */
export function invert(p: FcPlacement): FcPlacement {
  const [x, y, z, w] = p.rotation;
  const q: [number, number, number, number] = [-x, -y, -z, w];
  const [px, py, pz] = rotate(q, p.position);
  return { position: [-px, -py, -pz], rotation: q };
}

/** A vector turned by a unit quaternion. */
export function rotate(
  q: readonly [number, number, number, number],
  v: readonly [number, number, number],
): [number, number, number] {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // t = 2 q×v; v' = v + w t + q×t
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

/** A link's target (same document only) and whether the target's own placement stays. */
function linkTarget(o: FcObject): { target: string | undefined; keep: boolean } {
  const value = o.properties.LinkedObject?.value;
  let target: string | undefined;
  if (value?.kind === 'xlink') target = value.items.find((i) => i.file === '')?.object;
  else if (value?.kind === 'link' || value?.kind === 'linkSub') target = value.object;
  const transform = o.properties.LinkTransform?.value;
  return { target, keep: transform?.kind === 'bool' && transform.value };
}

/** A link's own placement: `LinkPlacement` when it has one, else `Placement`. */
const linkPlacement = (o: FcObject) => placement(o, 'LinkPlacement') ?? placement(o) ?? identity;

/** The document's final shapes, in document order. Problems found on the way go to `doc.problems`. */
export function finalShapes(doc: FcDocument): FinalShape[] {
  // Built once: who is in a body, who is consumed, who holds whom.
  const members = new Set<string>();
  const consumed = new Set<string>();
  const parent = new Map<string, FcObject>();
  for (const o of doc.objects) {
    if (o.type === 'PartDesign::Body')
      for (const key of ['Group', 'Model']) {
        const v = o.properties[key]?.value;
        if (v) for (const m of linkedObjects(v)) members.add(m);
      }
    for (const key of ['Group', 'Model']) {
      const v = o.properties[key]?.value;
      if (v?.kind !== 'linkList') continue;
      for (const m of v.objects) if (m !== o.name && !parent.has(m)) parent.set(m, o);
    }
    if (isLink(o) || NOT_CONSUMING.some((t) => o.type.startsWith(t))) continue;
    for (const p of Object.values(o.properties)) {
      if (NOT_CONSUMING_PROPERTIES.has(p.name) || p.value.kind === 'xlink') continue;
      for (const x of linkedObjects(p.value)) if (x !== o.name) consumed.add(x);
    }
  }

  const isGeoGroup = (o: FcObject) =>
    GEO_GROUPS.has(o.type) ||
    o.extensions.some(
      (e) => e.endsWith('GeoFeatureGroupExtension') || e.endsWith('OriginGroupExtension'),
    );
  /** The placements of `o`'s containers, outermost first (plain folders pass through). */
  const containers = (o: FcObject): FcPlacement[] => {
    const out: FcPlacement[] = [];
    const seen = new Set<string>([o.name]);
    for (let p = parent.get(o.name), depth = 0; p; p = parent.get(p.name), depth++) {
      if (seen.has(p.name) || depth >= MAX_CONTAINER_DEPTH) {
        doc.problems.push(
          `${o.name}: its containers hold each other in a loop; their placements are left out.`,
        );
        return [];
      }
      seen.add(p.name);
      if (isGeoGroup(p)) out.push(placement(p) ?? identity);
    }
    return out.reverse();
  };

  const solid = new Map<string, boolean>();
  /** Whether `o`'s stored shape has a solid (an empty shape quietly has none). */
  const hasSolid = (o: FcObject): boolean => {
    const known = solid.get(o.name);
    if (known !== undefined) return known;
    const entry = storedShapeEntry(doc, o);
    let result = false;
    if (entry !== undefined) {
      try {
        const bytes = doc.entries.get(entry);
        if (!bytes)
          doc.problems.push(`${o.name}.Shape: its stored shape ${entry} is missing from the file.`);
        else if (entry.endsWith('.bin'))
          doc.problems.push(
            `${o.name}.Shape: its stored shape is in FreeCAD's binary form, which is not read.`,
          );
        else if (bytes.length > 0) result = brepHasSolid(new TextDecoder('latin1').decode(bytes));
      } catch (error) {
        if (!(error instanceof FcstdFormatError)) throw error;
        doc.problems.push(`${o.name}.Shape: its stored shape can't be read: ${error.message}`);
      }
    }
    solid.set(o.name, result);
    return result;
  };

  const shape = (
    kind: FinalShapeKind,
    object: FcObject,
    source: FcObject,
    chain: FcPlacement[],
  ): FinalShape => {
    const look = object.gui?.colour ? object.gui : source.gui;
    const mesh = source.properties.Mesh?.value;
    return {
      kind,
      object,
      source,
      entry:
        kind === 'mesh' || (kind === 'link' && mesh?.kind === 'mesh')
          ? mesh?.kind === 'mesh' && mesh.entry !== ''
            ? mesh.entry
            : undefined
          : storedShapeEntry(doc, source),
      format: mesh?.kind === 'mesh' ? 'mesh' : 'brep',
      name: object.label,
      visible: object.gui?.visible ?? true,
      ...(look?.colour ? { colour: look.colour } : {}),
      ...(look?.transparency !== undefined ? { transparency: look.transparency } : {}),
      chain,
    };
  };

  const out: FinalShape[] = [];
  for (const o of doc.objects) {
    const t = o.type;
    if (isLink(o)) {
      if (t === 'App::Link') {
        const linked = link(o);
        if (linked) out.push(linked);
      }
      continue;
    }
    if (t === 'PartDesign::Body') {
      if (!consumed.has(o.name)) out.push(shape('body', o, o, containers(o)));
      continue;
    }
    if (members.has(o.name) || NEVER_FINAL.some((x) => t.startsWith(x))) continue;
    if (t.startsWith('PartDesign::')) {
      if (!DATUMS.has(t.slice('PartDesign::'.length)) && !consumed.has(o.name))
        out.push(shape('chain-tip', o, o, containers(o)));
      continue;
    }
    if (consumed.has(o.name)) continue;
    if (t === 'Mesh::Feature') {
      out.push(shape('mesh', o, o, containers(o)));
      continue;
    }
    if (hasSolid(o)) out.push(shape('shape', o, o, containers(o)));
  }
  return out;

  /** One instance of what a link shows, through further links, at the link's placement. */
  function link(o: FcObject): FinalShape | undefined {
    const chain = containers(o);
    const seen = new Set<string>([o.name]);
    const count = o.properties.ElementCount?.value;
    if (count?.kind === 'integer' && count.value > 0)
      doc.problems.push(`${o.name}: a link array; only the link itself is placed.`);
    let current = o;
    for (let hop = 0; hop < MAX_LINK_HOPS; hop++) {
      chain.push(linkPlacement(current));
      const { target: name, keep } = linkTarget(current);
      const target = name === undefined ? undefined : doc.byName.get(name);
      if (!target) {
        doc.problems.push(
          name === undefined
            ? `${o.name}: a link to nothing in this file, left out.`
            : `${o.name}: a link to ${name}, which isn't in the file, left out.`,
        );
        return undefined;
      }
      if (seen.has(target.name)) {
        doc.problems.push(`${o.name}: links that lead back to themselves, left out.`);
        return undefined;
      }
      seen.add(target.name);
      if (!keep)
        chain.push(
          invert(isLink(target) ? linkPlacement(target) : (placement(target) ?? identity)),
        );
      if (!isLink(target)) return shape('link', o, target, chain);
      current = target;
    }
    doc.problems.push(`${o.name}: a link through more than ${MAX_LINK_HOPS} links, left out.`);
    return undefined;
  }
}
