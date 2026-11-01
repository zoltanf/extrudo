/**
 * Drawn figures for the docs (ADR-0116 §2): a `*.figure.svg` file checked against
 * an allow-list and rewritten for inlining into a page. Build-time only.
 *
 * The parser is small and strict on purpose: an XML declaration and comments
 * (both dropped), elements, attributes in quotes, text with the five XML
 * entities. No DOCTYPE, CDATA, processing instruction or other entity, so nothing
 * can hide from the check. Colours come from the `sk-*` classes in `docs.css`:
 * `fill` and `stroke` may only be `none` or `currentColor`.
 */
import { escapeText } from './widgets/svg';

const ELEMENTS = new Set(
  'svg g path line polyline polygon rect circle ellipse text tspan title desc defs marker symbol use'.split(
    ' ',
  ),
);
/** The elements whose text is content; elsewhere only whitespace may sit between tags. */
const TEXT_ELEMENTS = new Set(['text', 'tspan', 'title', 'desc']);
/** Attributes whose value is free (geometry, text layout and stroke shape); it is escaped on output. */
const FREE = new Set(
  (
    'x y x1 y1 x2 y2 cx cy r rx ry width height d points transform viewBox text-anchor ' +
    'dominant-baseline font-size font-weight refX refY markerWidth markerHeight orient ' +
    'preserveAspectRatio stroke-dasharray stroke-width stroke-linecap stroke-linejoin opacity'
  ).split(' '),
);
const MARKERS = new Set(['marker-start', 'marker-end', 'marker-mid']);
const PAINT = new Set(['fill', 'stroke']);
const SVG_NS = 'http://www.w3.org/2000/svg';
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const NAME = /^[A-Za-z_][\w.-]*$/;

interface Node {
  tag: string;
  attributes: [string, string][];
  children: (Node | string)[];
}

/** What a figure becomes: the `<svg>` markup, ready for the page. */
export interface FigureOptions {
  /** Prefixed to every id (and every reference to one), so two figures on a page can't clash. */
  prefix: string;
  /** The figure's accessible name. */
  label: string;
}

/**
 * The figure's `<svg>` checked and rewritten: ids prefixed, references followed,
 * `role="img"` and `aria-label` on the root, `xmlns` dropped (HTML needs none).
 * Throws a message naming the offending element or attribute.
 */
export function figureSvg(source: string, options: FigureOptions): string {
  const root = parse(source);
  const ids = new Set<string>();
  collectIds(root, ids);
  const rename = (id: string): string => {
    if (!ids.has(id)) throw new Error(`#${id} names no element`);
    return `${options.prefix}-${id}`;
  };
  const body = root.children.map((child) => serialize(child, rename)).join('');
  const attributes = root.attributes
    .filter(([name]) => name !== 'xmlns')
    .map(([name, value]) => attribute(name, value, rename));
  return `<svg${attributes.join('')} role="img" aria-label="${escapeText(options.label)}">${body}</svg>`;
}

function collectIds(node: Node, ids: Set<string>): void {
  for (const [name, value] of node.attributes) {
    if (name !== 'id') continue;
    if (ids.has(value)) throw new Error(`id "${value}" is used twice`);
    ids.add(value);
  }
  for (const child of node.children) if (typeof child !== 'string') collectIds(child, ids);
}

function serialize(node: Node | string, rename: (id: string) => string): string {
  if (typeof node === 'string') return escapeText(node);
  const attributes = node.attributes.map(([name, value]) => attribute(name, value, rename));
  const body = node.children.map((child) => serialize(child, rename)).join('');
  return body
    ? `<${node.tag}${attributes.join('')}>${body}</${node.tag}>`
    : `<${node.tag}${attributes.join('')}/>`;
}

/** One attribute, renamed where it is or names an id. Values were checked by `parse`. */
function attribute(name: string, value: string, rename: (id: string) => string): string {
  let out = value;
  if (name === 'id') out = rename(value);
  else if (name === 'href') out = `#${rename(value.slice(1))}`;
  else if (MARKERS.has(name) && value !== 'none') out = `url(#${rename(value.slice(5, -1))})`;
  return ` ${name}="${escapeText(out)}"`;
}

/** The one root `<svg>`, every element and attribute checked. */
function parse(source: string): Node {
  let text = source.replace(/^﻿/, '');
  const declaration = /^<\?xml\s[^?]*\?>/.exec(text);
  if (declaration) text = text.slice(declaration[0].length);

  const top: Node = { tag: '', attributes: [], children: [] };
  const stack: Node[] = [top];
  let at = 0;
  while (at < text.length) {
    const current = stack[stack.length - 1] as Node;
    if (text.startsWith('<!--', at)) {
      const end = text.indexOf('-->', at + 4);
      if (end < 0) throw new Error('a comment is not closed');
      at = end + 3;
    } else if (text.startsWith('<!', at)) {
      const rest = text.slice(at, at + 9).toUpperCase();
      const what = rest.startsWith('<!DOCTYPE')
        ? 'a DOCTYPE'
        : rest.startsWith('<![CDATA[')
          ? 'CDATA'
          : 'a markup declaration';
      throw new Error(`${what} isn't allowed`);
    } else if (text.startsWith('<?', at)) {
      throw new Error('a processing instruction isn’t allowed');
    } else if (text.startsWith('</', at)) {
      const match = /^<\/([A-Za-z][\w:.-]*)\s*>/.exec(text.slice(at));
      if (!match) throw new Error(`a broken closing tag at ${at}`);
      if (match[1] !== current.tag)
        throw new Error(`</${match[1]}> doesn't close <${current.tag}>`);
      stack.pop();
      at += match[0].length;
    } else if (text[at] === '<') {
      const match =
        /^<([A-Za-z][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/.exec(
          text.slice(at),
        );
      if (!match) throw new Error(`a broken tag at ${at}: ${text.slice(at, at + 30)}`);
      const tag = match[1] ?? '';
      if (!ELEMENTS.has(tag)) throw new Error(`element <${tag}> isn't allowed`);
      if (stack.length === 1 && (tag !== 'svg' || top.children.length > 0)) {
        throw new Error('the file must hold one <svg>');
      }
      const node: Node = { tag, attributes: attributes(tag, match[2] ?? ''), children: [] };
      current.children.push(node);
      if (match[3] !== '/') stack.push(node);
      at += match[0].length;
    } else {
      const end = text.indexOf('<', at);
      const raw = text.slice(at, end < 0 ? text.length : end);
      const decoded = entities(raw);
      if (decoded.trim() !== '') {
        if (!TEXT_ELEMENTS.has(current.tag)) {
          throw new Error(
            `text isn't allowed in <${current.tag || 'the file'}>: ${raw.trim().slice(0, 30)}`,
          );
        }
        current.children.push(decoded);
      } else if (TEXT_ELEMENTS.has(current.tag) && decoded) {
        current.children.push(decoded);
      }
      at += raw.length;
    }
  }
  if (stack.length > 1) throw new Error(`<${(stack[stack.length - 1] as Node).tag}> is not closed`);
  const root = top.children[0];
  if (!root || typeof root === 'string') throw new Error('the file must hold one <svg>');
  return root;
}

/** An element's attributes, each checked against the allow-list. */
function attributes(tag: string, source: string): [string, string][] {
  const out: [string, string][] = [];
  for (const match of source.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const name = match[1] ?? '';
    const value = entities(match[2] ?? match[3] ?? '');
    if (out.some(([seen]) => seen === name)) throw new Error(`<${tag}> has "${name}" twice`);
    const refuse = () => new Error(`<${tag}> attribute ${name}="${value}" isn't allowed`);
    if (FREE.has(name)) {
      // Free values are geometry; they never carry a URL.
      if (/url\s*\(/i.test(value)) throw refuse();
    } else if (name === 'class') {
      if (
        !value
          .split(/\s+/)
          .filter(Boolean)
          .every((token) => /^[A-Za-z][\w-]*$/.test(token))
      ) {
        throw refuse();
      }
    } else if (name === 'id') {
      if (!NAME.test(value)) throw refuse();
    } else if (name === 'href') {
      if (!/^#[A-Za-z_][\w.-]*$/.test(value)) throw refuse();
    } else if (PAINT.has(name)) {
      if (value !== 'none' && value !== 'currentColor') throw refuse();
    } else if (MARKERS.has(name)) {
      if (value !== 'none' && !/^url\(#[A-Za-z_][\w.-]*\)$/.test(value)) throw refuse();
    } else if (name === 'xmlns') {
      if (tag !== 'svg' || value !== SVG_NS) throw refuse();
    } else {
      throw refuse();
    }
    out.push([name, value]);
  }
  return out;
}

/** Text with the five XML entities read; any other `&` fails. */
function entities(raw: string): string {
  return raw.replace(/&([^;\s]*);?/g, (all, name: string) => {
    const value = all.endsWith(';') ? ENTITIES[name] : undefined;
    if (value === undefined)
      throw new Error(`entity ${all} isn't allowed (only &amp; &lt; &gt; &quot; &apos;)`);
    return value;
  });
}
