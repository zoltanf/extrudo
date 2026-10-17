/**
 * The `.scad` file (P6-09, ADR-0088 §9): header comment, `$fa`/`$fs`, the
 * parameter block, a module per written body version and shared tool, then
 * each exported body in its colour. Only what the exported bodies reach is
 * written, and only those mesh versions are meshed (ADR-0088 §2).
 *
 * Deterministic: the same document and options give the same bytes. Module
 * names come from body and feature names in timeline order, never from IDs
 * or the clock.
 */
import type { BodyId } from '@extrudo/core';
import { KernelError } from '../kernel';
import type { MeshOptions } from '../mesh';
import type { CsgNode } from './ir';
import { parameterUse, type WrittenStep } from './live';
import { polyhedronOf } from './mesh';
import { scadNumber } from './number';
import { parameterBlock } from './params';
import { commentText, type PrintRefs, printModule, printNode } from './print';
import { type ScadSource, type Version, walkVersions } from './versions';

/** A body the export writes, as Export Model chose it. */
export interface ScadBody {
  id: BodyId;
  name: string;
  /** `#rrggbb`. */
  color?: string;
  /** The component it is in, named in its comment. */
  component?: string;
}

export interface ScadExportOptions {
  /** In the order to write them. */
  bodies: readonly ScadBody[];
  /** The mesh versions' tessellation, and the file's `$fa`/`$fs`. */
  tessellation: MeshOptions;
  project: string;
  /** Extrudo's version, for the header. */
  version: string;
}

const RESERVED = new Set([
  'module',
  'function',
  'if',
  'else',
  'for',
  'let',
  'each',
  'true',
  'false',
  'undef',
  'include',
  'use',
  'assert',
  'echo',
]);

/** An OpenSCAD identifier from a name: letters, digits and `_`; not starting with a digit. */
export function scadIdentifier(name: string): string {
  let id = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (id === '') id = 'Body';
  if (/^[0-9]/.test(id)) id = `_${id}`;
  return RESERVED.has(id) ? `${id}_` : id;
}

/** `$fs`: the chord a deflection allows on a 1 mm radius, so small holes are as fine as Export Model's mesh. */
export function fragmentSize(linearDeflection: number): number {
  return Number(Math.sqrt(8 * linearDeflection).toPrecision(2));
}

/**
 * Segments OpenSCAD draws a full circle of `radius` with, from the file's
 * `$fa`/`$fs`, its own rule with `$fn = 0` (ADR-0088 §7):
 * `max(min(360 / $fa, radius * 2π / $fs), 5)`, rounded up.
 */
export function fragmentsFor(fa: number, fs: number, radius: number): number {
  return Math.ceil(Math.max(Math.min(360 / fa, (radius * 2 * Math.PI) / fs), 5));
}

export function writeScad(source: ScadSource, options: ScadExportOptions): string {
  const { angularDeflection, linearDeflection } = options.tessellation;
  const fa = Number(((angularDeflection * 180) / Math.PI).toPrecision(3));
  const fs = fragmentSize(linearDeflection);
  const walk = walkVersions({
    ...source,
    ...(!source.fragments && { fragments: (radius: number) => fragmentsFor(fa, fs, radius) }),
  });
  const { versions, tools } = walk;

  // The exported bodies' last versions.
  const roots: number[] = options.bodies.map((body) => {
    const at = walk.current.get(body.id);
    const shape = source.bodies.get(body.id);
    if (at === undefined || shape === undefined) {
      throw new KernelError(`${body.name} is no longer in the model. Try again.`);
    }
    return at;
  });

  // What they reach, how often each tool is used there, and the parameters
  // their scalars use.
  const reached = new Set<number>();
  const toolUses = new Map<number, number>();
  const used = new Set<string>();
  const scan = (value: unknown): void => {
    if (Array.isArray(value)) for (const v of value) scan(v);
    else if (typeof value === 'object' && value !== null && 'refs' in value) {
      for (const ref of (value as { refs: readonly string[] }).refs) used.add(ref);
    }
  };
  const visit = (node: CsgNode): void => {
    if (node.kind !== 'polygon' && node.kind !== 'polyhedron') {
      for (const [key, value] of Object.entries(node)) if (key !== 'children') scan(value);
    }
    if (node.kind === 'version') {
      reach(node.version);
      return;
    }
    if (node.kind === 'tool') {
      const uses = (toolUses.get(node.tool) ?? 0) + 1;
      toolUses.set(node.tool, uses);
      if (uses === 1) visit((tools[node.tool] as { node: CsgNode }).node);
      return;
    }
    if ('children' in node) for (const child of node.children) visit(child);
  };
  const reach = (at: number): void => {
    if (reached.has(at)) return;
    reached.add(at);
    const version = versions[at] as Version;
    if (version.kind === 'csg') visit(version.node);
  };
  for (const at of roots) reach(at);
  const written = [...reached].sort((a, b) => a - b);

  // Module names: each body's name once, made unique in the order first written.
  const exported = new Map(options.bodies.map((b) => [b.id, b]));
  const bodyIdent = new Map<BodyId, string>();
  const taken = new Set<string>();
  const unique = (base: string): string => {
    let name = base;
    for (let k = 2; taken.has(name); k++) name = `${base}_${k}`;
    taken.add(name);
    return name;
  };
  const bodyName = (id: BodyId): string => {
    const given = exported.get(id)?.name ?? source.bodyName?.(id);
    if (given) return given;
    // `<feature>:<n>`: the feature's name, numbered after the first.
    const colon = id.lastIndexOf(':');
    const feature = colon > 0 ? id.slice(0, colon) : id;
    const n = colon > 0 ? Number(id.slice(colon + 1)) : 0;
    const base = source.featureName(feature as never) ?? feature;
    return n > 0 ? `${base} body ${n + 1}` : `${base} body`;
  };
  for (const at of written) {
    const { body } = versions[at] as Version;
    if (!bodyIdent.has(body)) bodyIdent.set(body, unique(scadIdentifier(bodyName(body))));
  }
  const versionName = (at: number): string => {
    const version = versions[at] as Version;
    return `${bodyIdent.get(version.body)}_v${version.n}`;
  };
  const toolName = new Map<number, string>();
  for (const [tool, uses] of [...toolUses].sort((a, b) => a[0] - b[0])) {
    if (uses < 2) continue;
    const { step, n } = tools[tool] as { step: number; n: number };
    const feature = source.steps[step]?.feature.name ?? 'Feature';
    toolName.set(tool, unique(`${scadIdentifier(feature)}_tool${n > 1 ? n : ''}`));
  }
  const refs: PrintRefs = {
    version: (_body, version) => versionName(version),
    tool: (tool) => toolName.get(tool) ?? (tools[tool] as { node: CsgNode }).node,
  };

  // The header.
  const meshes = written.filter((at) => versions[at]?.kind === 'mesh');
  const lines: string[] = [
    `// ${commentText(options.project) || 'Untitled'}`,
    `// Exported from Extrudo ${commentText(options.version)} as OpenSCAD (2021.01 or later).`,
    '// Lengths in mm, angles in degrees.',
  ];
  if (meshes.length === 0) {
    lines.push('// Every body is OpenSCAD code: no polyhedra.');
  } else {
    lines.push(
      `// ${meshes.length} ${meshes.length === 1 ? 'body version is a polyhedron' : 'body versions are polyhedra'} (a mesh of the shape), where OpenSCAD can't follow:`,
    );
    for (const at of meshes) {
      const version = versions[at] as Extract<Version, { kind: 'mesh' }>;
      lines.push(`//   ${versionName(at)}: ${commentText(version.reason)}`);
    }
  }
  lines.push('', `$fa = ${scadNumber(fa)};`, `$fs = ${scadNumber(fs)};`);

  // The parameter block (ADR-0088 §5, §9): what the written code uses, and
  // what the written versions' features hold fixed.
  if (source.parameters) {
    const steps = new Map<number, WrittenStep>();
    for (const at of written) {
      const version = versions[at] as Version;
      const step = steps.get(version.step);
      if (step) step.mesh ||= version.kind === 'mesh';
      else {
        steps.set(version.step, {
          feature: (source.steps[version.step] as { feature: WrittenStep['feature'] }).feature,
          name: walk.stepNames[version.step] as string,
          mesh: version.kind === 'mesh',
          read: walk.reads[version.step] as ReadonlySet<string>,
          at: version.step,
        });
      }
    }
    const makers = new Set(source.steps.map((s) => s.feature.id));
    const use = parameterUse(source.parameters, used, [...steps.values()], makers);
    const block = parameterBlock(source.parameters.doc, source.parameters.expr, use).code.trim();
    if (block !== '') lines.push('', block);
  }

  // The modules, in timeline order: tools with the versions of their step.
  const tooled = [...toolName.keys()];
  for (const at of written) {
    const version = versions[at] as Version;
    for (const tool of tooled) {
      if (tools[tool]?.step !== version.step) continue;
      lines.push(
        '',
        ...printModule(toolName.get(tool) as string, (tools[tool] as { node: CsgNode }).node, refs),
      );
      tooled.splice(tooled.indexOf(tool), 1);
    }
    const node: CsgNode =
      version.kind === 'csg'
        ? version.node
        : polyhedronOf(source.kernel.exportMesh(version.shape, options.tessellation));
    lines.push('', ...printModule(versionName(at), node, refs));
  }
  for (const tool of tooled) {
    lines.push(
      '',
      ...printModule(toolName.get(tool) as string, (tools[tool] as { node: CsgNode }).node, refs),
    );
  }

  // The bodies.
  options.bodies.forEach((body, i) => {
    const call: CsgNode = { kind: 'version', body: body.id, version: roots[i] as number };
    const node: CsgNode =
      body.color === undefined
        ? call
        : { kind: 'color', color: body.color.toLowerCase(), children: [call] };
    const where = body.component === undefined ? '' : ` (component ${commentText(body.component)})`;
    lines.push('', `// ${commentText(body.name)}${where}`, ...printNode(node, refs));
  });
  return `${lines.join('\n')}\n`;
}
