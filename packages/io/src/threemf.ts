/**
 * 3MF (3D Manufacturing Format, core specification 1.3): a zip (OPC
 * package) with `[Content_Types].xml`, `_rels/.rels` and the model part
 * `3D/3dmodel.model`. Each body is one mesh `object` with its name; each
 * object is one build item, placed as modelled (no transform). Units are
 * millimetres.
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
  /** `Title` metadata: the design's name. */
  title?: string;
  /** `Application` metadata, e.g. "Extrudo 0.2.0". */
  application?: string;
  /** Decimals of coordinates in mm (default 5: 10 nm). */
  decimals?: number;
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
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<model unit="millimeter" xml:lang="en-US" xmlns="${CORE}" xmlns:m="${MATERIAL}">`,
  ];
  if (options.title) out.push(` <metadata name="Title">${xmlText(options.title)}</metadata>`);
  if (options.application) {
    out.push(` <metadata name="Application">${xmlText(options.application)}</metadata>`);
  }
  out.push(' <resources>');
  // Resource IDs: 1 for the colour group (if any), then one per object.
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
  out.push(' </resources>', ' <build>');
  objects.forEach((_, i) => {
    out.push(`  <item objectid="${group + 1 + i}"/>`);
  });
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
  /** Object IDs of the build items, in order. */
  build: number[];
  /** The package's part names. */
  parts: string[];
  contentTypes: string;
  relationships: string;
}

/**
 * Reads the mesh objects of a 3MF package: enough for tests and simple
 * files. Handles the core spec's objects with meshes, names, metadata,
 * base materials and the materials extension's colour groups as object
 * defaults, and build items. Components, transforms, per-triangle
 * properties and other extensions are ignored.
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
    parts: Object.keys(entries),
    contentTypes: text('[Content_Types].xml'),
    relationships,
  };
  const colors = new Map<number, string[]>();
  let group: string[] | undefined;
  let object: (ThreeMfObject & { pid?: number; pindex?: number }) | undefined;
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
          const { pid, pindex, ...rest } = object;
          const color = pid === undefined ? undefined : colors.get(pid)?.[pindex ?? 0];
          model.objects.push({
            ...rest,
            mesh: { positions: new Float64Array(positions), indices: new Uint32Array(indices) },
            ...(color !== undefined && { color }),
          });
          object = undefined;
        } else if (!tag.closing) {
          object = {
            id: Number(a.id),
            name: unescapeXml(a.name ?? ''),
            type: a.type ?? 'model',
            mesh: { positions: new Float64Array(), indices: new Uint32Array() },
            ...(a.pid !== undefined && { pid: Number(a.pid) }),
            ...(a.pindex !== undefined && { pindex: Number(a.pindex) }),
          };
          positions = [];
          indices = [];
        }
        break;
      case 'vertex':
        positions.push(Number(a.x), Number(a.y), Number(a.z));
        break;
      case 'triangle':
        indices.push(Number(a.v1), Number(a.v2), Number(a.v3));
        break;
      case 'item':
        model.build.push(Number(a.objectid));
        break;
    }
  }
  return model;
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
