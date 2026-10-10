/**
 * 3MF (3D Manufacturing Format, core specification 1.3): a zip (OPC
 * package) with `[Content_Types].xml`, `_rels/.rels` and the model part
 * `3D/3dmodel.model`. Each body is one mesh `object` with its name; each
 * object is one build item, placed as modelled (no transform). Units are
 * millimetres.
 *
 * With `assemblies` (P6-05, ADR-0081 §7) several mesh objects become the
 * `<components>` of one grouped `object`, one build item per group: a slicer
 * reads such an object as one part made of several, which is what a component
 * is for. Without it the XML is exactly as before.
 *
 * Colours use the materials extension (not required, so a consumer may
 * ignore them): one `m:colorgroup` with a colour per coloured body, which
 * the object names as its default property (`pid`/`pindex`) and, because
 * Bambu Studio and OrcaSlicer read colours per triangle only, every
 * triangle names as well (`pid`/`p1`). PrusaSlicer ignores 3MF colours.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { xmlText as escapeXml, num } from './format';
import type { MeshObject, TriangleMesh } from './mesh';

export const MODEL_PATH = '3D/3dmodel.model';
const CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const MATERIAL = 'http://schemas.microsoft.com/3dmanufacturing/material/2015/02';
const MODEL_REL = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
const MODEL_TYPE = 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml';
const RELS_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';

export interface ThreeMfOptions {
  /**
   * The package's `unit` attribute, the core specification's own name for the
   * numbers in the model part ("millimeter" by default; "centimeter" is what a
   * slicer that measures in cm writes).
   */
  unit?: string;
  /** `Title` metadata: the design's name. */
  title?: string;
  /** `Application` metadata, e.g. "Extrudo 0.2.0". */
  application?: string;
  /** Decimals of coordinates in mm (default 5: 10 nm). */
  decimals?: number;
  /**
   * Grouped build items (P6-05, ADR-0081 §7): one `object` per assembly whose
   * `<components>` list names the mesh objects (`parts` are indices into
   * `objects`). Build items are the assemblies in order, then the objects in
   * no assembly, in order. Absent (or empty): one object and item per mesh,
   * exactly as before.
   */
  assemblies?: readonly ThreeMfAssembly[];
}

/** One assembly of a 3MF export: a named group of mesh objects (ADR-0081 §7). */
export interface ThreeMfAssembly {
  name: string;
  /** Indices into the `objects` passed to `write3mf`/`modelXml`. */
  parts: readonly number[];
}

/** Writes bodies as a 3MF package, one object and build item each. */
export function write3mf(objects: readonly MeshObject[], options: ThreeMfOptions = {}): Uint8Array {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes()),
      '_rels/.rels': strToU8(relationships()),
      [MODEL_PATH]: strToU8(modelXml(objects, options)),
    },
    { level: 6, mtime: new Date('2026-01-01T00:00:00Z') },
  );
}

function contentTypes(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    ` <Default Extension="rels" ContentType="${RELS_TYPE}"/>`,
    ` <Default Extension="model" ContentType="${MODEL_TYPE}"/>`,
    '</Types>',
    '',
  ].join('\n');
}

function relationships(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ` <Relationship Target="/${MODEL_PATH}" Id="rel0" Type="${MODEL_REL}"/>`,
    '</Relationships>',
    '',
  ].join('\n');
}

/** The model part's XML. */
export function modelXml(objects: readonly MeshObject[], options: ThreeMfOptions = {}): string {
  const decimals = options.decimals ?? 5;
  const assemblies = (options.assemblies ?? []).filter((a) => a.parts.length > 0);
  // A part may be in one assembly only, and must be one of the objects.
  const seen = new Set<number>();
  for (const assembly of assemblies) {
    for (const part of assembly.parts) {
      if (part < 0 || part >= objects.length) {
        throw new Error(`Assembly part ${part} is not one of the ${objects.length} objects.`);
      }
      if (seen.has(part)) throw new Error(`Object ${part} is in two assemblies.`);
      seen.add(part);
    }
  }
  const grouped = assemblies.length > 0;
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<model unit="${options.unit ?? 'millimeter'}" xml:lang="en-US" xmlns="${CORE}" xmlns:m="${MATERIAL}">`,
  ];
  if (options.title) out.push(` <metadata name="Title">${xmlText(options.title)}</metadata>`);
  if (options.application) {
    out.push(` <metadata name="Application">${xmlText(options.application)}</metadata>`);
  }
  out.push(' <resources>');
  // Resource IDs: 1 for the colour group (if any), then one per object, the
  // grouped objects after the mesh objects.
  const colored = objects.filter((o) => o.color !== undefined);
  const group = colored.length > 0 ? 1 : 0;
  if (group) {
    out.push('  <m:colorgroup id="1">');
    for (const object of colored)
      out.push(`   <m:color color="${displayColor(object.color as string)}"/>`);
    out.push('  </m:colorgroup>');
  }
  let index = 0;
  objects.forEach((object, i) => {
    const id = group + 1 + i;
    const color = object.color === undefined ? undefined : index++;
    const property = color === undefined ? '' : ` pid="1" pindex="${color}"`;
    const perTriangle = color === undefined ? '' : ` pid="1" p1="${color}"`;
    out.push(`  <object id="${id}" type="model" name="${xmlText(object.name)}"${property}>`);
    out.push('   <mesh>', '    <vertices>');
    const p = object.mesh.positions;
    for (let n = 0; n + 2 < p.length; n += 3) {
      const x = num(p[n] as number, decimals);
      const y = num(p[n + 1] as number, decimals);
      const z = num(p[n + 2] as number, decimals);
      out.push(`     <vertex x="${x}" y="${y}" z="${z}"/>`);
    }
    out.push('    </vertices>', '    <triangles>');
    const t = object.mesh.indices;
    for (let k = 0; k + 2 < t.length; k += 3) {
      out.push(`     <triangle v1="${t[k]}" v2="${t[k + 1]}" v3="${t[k + 2]}"${perTriangle}/>`);
    }
    out.push('    </triangles>', '   </mesh>', '  </object>');
  });
  if (grouped) {
    assemblies.forEach((assembly, j) => {
      const id = group + 1 + objects.length + j;
      out.push(`  <object id="${id}" type="model" name="${xmlText(assembly.name)}">`);
      out.push('   <components>');
      for (const part of assembly.parts)
        out.push(`    <component objectid="${group + 1 + part}"/>`);
      out.push('   </components>', '  </object>');
    });
  }
  out.push(' </resources>', ' <build>');
  if (grouped) {
    assemblies.forEach((_, j) => {
      out.push(`  <item objectid="${group + 1 + objects.length + j}"/>`);
    });
    objects.forEach((_, i) => {
      if (!seen.has(i)) out.push(`  <item objectid="${group + 1 + i}"/>`);
    });
  } else {
    objects.forEach((_, i) => {
      out.push(`  <item objectid="${group + 1 + i}"/>`);
    });
  }
  out.push(' </build>', '</model>', '');
  return out.join('\n');
}

/** Text for XML: escaped, without the control characters XML 1.0 forbids. */
function xmlText(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
  return escapeXml(text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''));
}

/** A colour as 3MF's `#RRGGBB` or `#RRGGBBAA` (upper case). */
function displayColor(color: string): string {
  const hex = color.replace(/^#/, '');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) throw new Error(`Not a colour: ${color}`);
  return `#${hex.toUpperCase()}`;
}

// ------------------------------------------------------------------ read --

/** A mesh object read from a 3MF model. */
export interface ThreeMfObject {
  id: number;
  name: string;
  type: string;
  mesh: TriangleMesh;
  /** The object's default colour (from basematerials or a colour group), `#RRGGBBAA`. */
  color?: string;
}

export interface ThreeMfModel {
  unit: string;
  metadata: Record<string, string>;
  objects: ThreeMfObject[];
  /** Object IDs of the build items, in order (a grouped item's own object ID). */
  build: number[];
  /**
   * The build items expanded (P6-05, ADR-0081 §7): a `<components>` grouped
   * object's parts, each with its transform, so an importer makes one body per
   * part. An item that names a plain mesh has one part, the object itself.
   */
  items: ThreeMfItem[];
  /** The package's part names. */
  parts: string[];
  contentTypes: string;
  relationships: string;
}

/** One build item's meshes, expanded through a grouped object's components. */
export interface ThreeMfItem {
  objectId: number;
  meshes: ThreeMfItemPart[];
}

/** One mesh of a build item, with the transform it is placed by, when any. */
export interface ThreeMfItemPart {
  object: ThreeMfObject;
  /** Row-major 4×3 transform (item `transform` composed with the component's). */
  transform?: number[];
}

/**
 * Reads the mesh objects of a 3MF package: enough for tests and simple
 * files. Handles the core spec's objects with meshes, names, metadata,
 * base materials and the materials extension's colour groups as object
 * defaults, build items, and the `<components>`/`<component>` grouping and
 * transforms that a component export writes (ADR-0081 §7). A grouped object
 * is not a mesh, so it stays out of `objects`; `items` lists the expanded
 * meshes. Per-triangle properties and other extensions are ignored.
 */
export function read3mf(bytes: Uint8Array): ThreeMfModel {
  const entries = unzipSync(bytes);
  const text = (name: string) => {
    const entry = entries[name];
    if (!entry) throw new Error(`Not a 3MF package: ${name} is missing.`);
    return strFromU8(entry);
  };
  const relationships = text('_rels/.rels');
  const target = [...tags(relationships)].find(
    (tag) => tag.name === 'Relationship' && tag.attributes.Type === MODEL_REL,
  )?.attributes.Target;
  if (!target) throw new Error('Not a 3MF package: no 3D model relationship.');
  const xml = text(target.replace(/^\//, ''));

  const model: ThreeMfModel = {
    unit: 'millimeter',
    metadata: {},
    objects: [],
    build: [],
    items: [],
    parts: Object.keys(entries),
    contentTypes: text('[Content_Types].xml'),
    relationships,
  };
  const colors = new Map<number, string[]>();
  /** Grouped objects by ID: their `<component>` list (ADR-0081 §7). */
  const assemblies = new Map<number, { objectId: number; transform?: number[] }[]>();
  const rawItems: { objectId: number; transform?: number[] }[] = [];
  let group: string[] | undefined;
  let object:
    | (ThreeMfObject & {
        pid?: number;
        pindex?: number;
        components: { objectId: number; transform?: number[] }[];
      })
    | undefined;
  let positions: number[] = [];
  let indices: number[] = [];
  let metadata: string | undefined;
  for (const tag of tags(xml)) {
    const a = tag.attributes;
    switch (local(tag.name)) {
      case 'model':
        if (!tag.closing) model.unit = a.unit ?? 'millimeter';
        break;
      case 'metadata':
        if (tag.closing && metadata !== undefined) {
          model.metadata[metadata] = unescapeXml(tag.textBefore);
          metadata = undefined;
        } else if (!tag.closing && a.name) {
          metadata = a.name;
          if (tag.selfClosing) {
            model.metadata[metadata] = '';
            metadata = undefined;
          }
        }
        break;
      case 'basematerials':
      case 'colorgroup':
        if (tag.closing) group = undefined;
        else {
          group = [];
          colors.set(Number(a.id), group);
        }
        break;
      case 'base':
        group?.push(normalColor(a.displaycolor ?? '#FFFFFF'));
        break;
      case 'color':
        group?.push(normalColor(a.color ?? '#FFFFFF'));
        break;
      case 'object':
        if (tag.closing && object) {
          const { pid, pindex, components, ...rest } = object;
          if (components.length > 0) {
            assemblies.set(object.id, components);
          } else {
            const color = pid === undefined ? undefined : colors.get(pid)?.[pindex ?? 0];
            model.objects.push({
              ...rest,
              mesh: { positions: new Float64Array(positions), indices: new Uint32Array(indices) },
              ...(color !== undefined && { color }),
            });
          }
          object = undefined;
        } else if (!tag.closing) {
          object = {
            id: Number(a.id),
            name: unescapeXml(a.name ?? ''),
            type: a.type ?? 'model',
            mesh: { positions: new Float64Array(), indices: new Uint32Array() },
            components: [],
            ...(a.pid !== undefined && { pid: Number(a.pid) }),
            ...(a.pindex !== undefined && { pindex: Number(a.pindex) }),
          };
          positions = [];
          indices = [];
        }
        break;
      case 'component': {
        if (object) {
          const transform = parseTransform(a.transform);
          object.components.push({ objectId: Number(a.objectid), ...(transform && { transform }) });
        }
        break;
      }
      case 'vertex':
        positions.push(Number(a.x), Number(a.y), Number(a.z));
        break;
      case 'triangle':
        indices.push(Number(a.v1), Number(a.v2), Number(a.v3));
        break;
      case 'item': {
        const transform = parseTransform(a.transform);
        rawItems.push({ objectId: Number(a.objectid), ...(transform && { transform }) });
        break;
      }
    }
  }
  model.build = rawItems.map((item) => item.objectId);
  const byId = new Map(model.objects.map((o) => [o.id, o]));
  model.items = rawItems.map(({ objectId, transform }) => {
    const parts = assemblies.get(objectId);
    if (parts === undefined) {
      const object = byId.get(objectId);
      return {
        objectId,
        meshes: object ? [{ object, ...(transform !== undefined && { transform }) }] : [],
      };
    }
    const meshes = parts.flatMap((part) => {
      const object = byId.get(part.objectId);
      if (!object) return [];
      const composed = composeTransforms(transform, part.transform);
      return [{ object, ...(composed !== undefined && { transform: composed }) }];
    });
    return { objectId, meshes };
  });
  return model;
}

/** A 3MF transform attribute (12 row-major numbers), or `undefined` if absent or malformed. */
function parseTransform(value: string | undefined): number[] | undefined {
  if (value === undefined) return undefined;
  const parts = value.trim().split(/\s+/).map(Number);
  return parts.length === 12 && parts.every(Number.isFinite) ? parts : undefined;
}

/**
 * `outer` applied after `inner` (both 4×3 row-major), or whichever is
 * present. `m` maps `p` to `L·p + t` with `L = [[m0,m3,m6],[m1,m4,m7],[m2,m5,m8]]`.
 */
function composeTransforms(
  outer: number[] | undefined,
  inner: number[] | undefined,
): number[] | undefined {
  if (outer === undefined) return inner;
  if (inner === undefined) return outer;
  const lo = [
    [outer[0] as number, outer[3] as number, outer[6] as number],
    [outer[1] as number, outer[4] as number, outer[7] as number],
    [outer[2] as number, outer[5] as number, outer[8] as number],
  ];
  const li = [
    [inner[0] as number, inner[3] as number, inner[6] as number],
    [inner[1] as number, inner[4] as number, inner[7] as number],
    [inner[2] as number, inner[5] as number, inner[8] as number],
  ];
  const to = [outer[9] as number, outer[10] as number, outer[11] as number];
  const ti = [inner[9] as number, inner[10] as number, inner[11] as number];
  const r = [0, 1, 2].map((i) =>
    [0, 1, 2].map(
      (j) =>
        (lo[i]?.[0] as number) * (li[0]?.[j] as number) +
        (lo[i]?.[1] as number) * (li[1]?.[j] as number) +
        (lo[i]?.[2] as number) * (li[2]?.[j] as number),
    ),
  );
  const tr = [0, 1, 2].map(
    (i) =>
      (lo[i]?.[0] as number) * (ti[0] as number) +
      (lo[i]?.[1] as number) * (ti[1] as number) +
      (lo[i]?.[2] as number) * (ti[2] as number) +
      (to[i] as number),
  );
  return [
    r[0]?.[0] as number,
    r[1]?.[0] as number,
    r[2]?.[0] as number,
    r[0]?.[1] as number,
    r[1]?.[1] as number,
    r[2]?.[1] as number,
    r[0]?.[2] as number,
    r[1]?.[2] as number,
    r[2]?.[2] as number,
    tr[0] as number,
    tr[1] as number,
    tr[2] as number,
  ];
}

interface Tag {
  name: string;
  attributes: Record<string, string>;
  closing: boolean;
  selfClosing: boolean;
  /** The text between the previous tag and this one. */
  textBefore: string;
}

/** The tags of an XML document in order (no DOM: io runs anywhere). */
function* tags(xml: string): Generator<Tag> {
  const pattern = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let last = 0;
  for (const match of xml.matchAll(pattern)) {
    const attributes: Record<string, string> = {};
    for (const [, key, double, single] of (match[3] ?? '').matchAll(
      /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
    )) {
      attributes[local(key as string)] = unescapeXml(double ?? single ?? '');
    }
    yield {
      name: match[2] as string,
      attributes,
      closing: match[1] === '/',
      selfClosing: match[4] === '/',
      textBefore: xml.slice(last, match.index),
    };
    last = (match.index ?? 0) + match[0].length;
  }
}

/** A name without its namespace prefix. */
function local(name: string): string {
  return name.slice(name.indexOf(':') + 1);
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function normalColor(color: string): string {
  const hex = color.replace(/^#/, '').toUpperCase();
  return `#${hex.length === 6 ? `${hex}FF` : hex}`;
}
