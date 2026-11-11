/**
 * A small XML reader of our own for `Document.xml` and `GuiDocument.xml`:
 * elements, attributes and text; the five predefined entities and numeric
 * character references. Comments and processing instructions are skipped,
 * CDATA is text. A document type declaration (`<!DOCTYPE`) or any other
 * entity is refused, so nothing in a file can make the reader expand,
 * fetch or repeat anything.
 *
 * It builds a tree: the model reads objects in two passes (their types in
 * `Objects`, their properties in `ObjectData`) and looks properties up by
 * name, and the library's largest document (6.3 MB) costs about 80 ms and 27 MB
 * as a tree (the S2 amendment of ADR-0144 has the numbers).
 * One pass over the text, a cursor that only moves forward: linear in the
 * input, no object per character.
 */
import { FcstdFormatError } from './errors';

export interface XmlElement {
  readonly name: string;
  /** Attribute values, entities decoded (a null-prototype record: any name is safe). */
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly XmlElement[];
  /** The element's own text, entities decoded; `''` when it has only whitespace. */
  readonly text: string;
}

/** The deepest nesting allowed. FreeCAD's documents nest at most about 10 levels. */
export const MAX_DEPTH = 256;
/** The most attributes one element may have (FreeCAD's sketch constraints have about 20). */
export const MAX_ATTRIBUTES = 256;
/** The most elements one document may have (the library's largest has 55,138). */
export const MAX_NODES = 4_000_000;

interface Building {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const PREDEFINED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

const isSpace = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

/** Ends a name: whitespace, `/`, `>`, `=`, `<`, quotes. */
const endsName = (c: number) =>
  isSpace(c) || c === 0x2f || c === 0x3e || c === 0x3d || c === 0x3c || c === 0x22 || c === 0x27;

/**
 * Decodes `&…;` references in `raw` (`where` names it for a message). Linear:
 * each reference is found with one `indexOf` and the pieces joined once.
 */
function decodeEntities(raw: string, where: string): string {
  let amp = raw.indexOf('&');
  if (amp < 0) return raw;
  const parts: string[] = [];
  let from = 0;
  while (amp >= 0) {
    const semi = raw.indexOf(';', amp + 1);
    if (semi < 0 || semi - amp > 12)
      throw new FcstdFormatError(`Bad XML: an unfinished character reference in ${where}.`);
    parts.push(raw.slice(from, amp));
    const ref = raw.slice(amp + 1, semi);
    if (ref.startsWith('#')) {
      const hex = ref[1] === 'x';
      const digits = ref.slice(hex ? 2 : 1);
      if (!(hex ? /^[0-9a-fA-F]{1,6}$/ : /^[0-9]{1,7}$/).test(digits))
        throw new FcstdFormatError(`Bad XML: a bad character reference &${ref}; in ${where}.`);
      const code = Number.parseInt(digits, hex ? 16 : 10);
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
        throw new FcstdFormatError(`Bad XML: a bad character reference &${ref}; in ${where}.`);
      parts.push(String.fromCodePoint(code));
    } else {
      const value = Object.hasOwn(PREDEFINED, ref) ? PREDEFINED[ref] : undefined;
      if (value === undefined)
        throw new FcstdFormatError(
          `Bad XML: the entity &${ref.slice(0, 20)}; is not supported (${where}).`,
        );
      parts.push(value);
    }
    from = semi + 1;
    amp = raw.indexOf('&', from);
  }
  parts.push(raw.slice(from));
  return parts.join('');
}

/** XML's attribute-value rule: a literal tab, newline or carriage return reads as a space. */
const normaliseAttribute = (raw: string) =>
  /[\t\n\r]/.test(raw) ? raw.replace(/\r\n|[\t\n\r]/g, ' ') : raw;

/**
 * The root element of `text`. Throws `FcstdFormatError` with a plain message
 * (`what` names the document) for anything that is not well-formed XML or
 * that breaks a limit.
 */
export function parseXml(text: string, what = 'the XML'): XmlElement {
  const n = text.length;
  const stack: Building[] = [];
  let root: Building | undefined;
  let nodes = 0;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const bad = (why: string) => new FcstdFormatError(`Bad XML in ${what}: ${why}.`);
  const appendText = (raw: string) => {
    const top = stack[stack.length - 1];
    if (!top) {
      if (/\S/.test(raw)) throw bad('text outside the root element');
      return;
    }
    if (top.text === '' && !/\S/.test(raw)) return;
    top.text += decodeEntities(raw, `<${top.name}>`);
  };
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      appendText(text.slice(i));
      break;
    }
    if (lt > i) appendText(text.slice(i, lt));
    const next = text.charCodeAt(lt + 1);
    if (next === 0x21 /* ! */) {
      if (text.startsWith('<!--', lt)) {
        const end = text.indexOf('-->', lt + 4);
        if (end < 0) throw bad('a comment never ends');
        i = end + 3;
        continue;
      }
      if (text.startsWith('<![CDATA[', lt)) {
        const end = text.indexOf(']]>', lt + 9);
        if (end < 0) throw bad('a CDATA section never ends');
        const top = stack[stack.length - 1];
        if (!top) throw bad('text outside the root element');
        top.text += text.slice(lt + 9, end);
        i = end + 3;
        continue;
      }
      if (text.startsWith('<!DOCTYPE', lt))
        throw bad('a document type declaration (<!DOCTYPE>), which is not allowed');
      throw bad('a markup declaration, which is not allowed');
    }
    if (next === 0x3f /* ? */) {
      const end = text.indexOf('?>', lt + 2);
      if (end < 0) throw bad('a processing instruction never ends');
      i = end + 2;
      continue;
    }
    if (next === 0x2f /* / */) {
      const end = text.indexOf('>', lt + 2);
      if (end < 0) throw bad('a closing tag never ends');
      const name = text.slice(lt + 2, end).trimEnd();
      const open = stack.pop();
      if (!open) throw bad(`</${name.slice(0, 40)}> closes nothing`);
      if (open.name !== name)
        throw bad(`</${name.slice(0, 40)}> closes <${open.name.slice(0, 40)}>`);
      i = end + 1;
      continue;
    }
    // A start tag: its name, then attributes up to `>` or `/>`.
    let j = lt + 1;
    while (j < n && !endsName(text.charCodeAt(j))) j++;
    if (j === lt + 1) throw bad('a "<" that starts no element');
    const name = text.slice(lt + 1, j);
    const attrs: Record<string, string> = Object.create(null);
    let count = 0;
    let selfClosing = false;
    for (;;) {
      while (j < n && isSpace(text.charCodeAt(j))) j++;
      if (j >= n) throw bad(`<${name.slice(0, 40)}> never ends`);
      const c = text.charCodeAt(j);
      if (c === 0x3e /* > */) {
        j++;
        break;
      }
      if (c === 0x2f /* / */) {
        if (text.charCodeAt(j + 1) !== 0x3e) throw bad(`a stray "/" in <${name.slice(0, 40)}>`);
        selfClosing = true;
        j += 2;
        break;
      }
      const start = j;
      while (j < n && !endsName(text.charCodeAt(j))) j++;
      if (j === start) throw bad(`a bad attribute in <${name.slice(0, 40)}>`);
      const key = text.slice(start, j);
      while (j < n && isSpace(text.charCodeAt(j))) j++;
      if (text.charCodeAt(j) !== 0x3d /* = */)
        throw bad(`the attribute ${key.slice(0, 40)} has no value`);
      j++;
      while (j < n && isSpace(text.charCodeAt(j))) j++;
      const quote = text.charCodeAt(j);
      if (quote !== 0x22 && quote !== 0x27)
        throw bad(`the attribute ${key.slice(0, 40)} is not quoted`);
      const end = text.indexOf(quote === 0x22 ? '"' : "'", j + 1);
      if (end < 0) throw bad(`the attribute ${key.slice(0, 40)} never ends`);
      const raw = text.slice(j + 1, end);
      if (raw.includes('<')) throw bad(`a "<" in the attribute ${key.slice(0, 40)}`);
      if (Object.hasOwn(attrs, key))
        throw bad(`the attribute ${key.slice(0, 40)} twice in one element`);
      if (++count > MAX_ATTRIBUTES)
        throw bad(`<${name.slice(0, 40)}> has more than ${MAX_ATTRIBUTES} attributes`);
      attrs[key] = decodeEntities(normaliseAttribute(raw), `<${name.slice(0, 40)}>`);
      j = end + 1;
      const after = text.charCodeAt(j);
      if (j < n && !isSpace(after) && after !== 0x3e && after !== 0x2f)
        throw bad(`no space after the attribute ${key.slice(0, 40)}`);
    }
    if (++nodes > MAX_NODES) throw bad(`more than ${MAX_NODES} elements`);
    const element: Building = { name, attrs, children: [], text: '' };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(element);
    else if (!root) root = element;
    else throw bad('more than one root element');
    if (!selfClosing) {
      if (stack.length >= MAX_DEPTH) throw bad(`elements nested more than ${MAX_DEPTH} deep`);
      stack.push(element);
    }
    i = j;
  }
  const open = stack[stack.length - 1];
  if (open) throw bad(`<${open.name.slice(0, 40)}> never ends`);
  if (!root) throw bad('no element');
  return root;
}

/** UTF-8 bytes as XML: refused when they are not valid UTF-8. */
export function parseXmlBytes(bytes: Uint8Array, what: string): XmlElement {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new FcstdFormatError(`Bad XML in ${what}: it is not valid UTF-8.`);
  }
  return parseXml(text, what);
}

/** The first child named `name`. */
export function child(e: XmlElement | undefined, name: string): XmlElement | undefined {
  if (!e) return undefined;
  for (const c of e.children) if (c.name === name) return c;
  return undefined;
}

/** Every child named `name`. */
export function children(e: XmlElement | undefined, name: string): XmlElement[] {
  return e ? e.children.filter((c) => c.name === name) : [];
}
