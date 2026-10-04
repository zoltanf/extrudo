/**
 * A small XML reader (P4-06, ADR-0066 §1): enough of XML for SVG — elements,
 * attributes, the five named entities and numeric references. Comments,
 * CDATA sections, processing instructions and the doctype declaration are
 * skipped. No dependency: `@extrudo/io` stays standalone (MIT), and the
 * subsets an SVG needs are small.
 *
 * Text content is kept trimmed as an element's `text`: SVG geometry is all
 * attributes, but a drawing's title is text.
 */

export interface XmlNode {
  /** The tag name as written (case kept: SVG's is case-sensitive). */
  name: string;
  /** Attributes with their names as written, in document order. */
  attributes: Record<string, string>;
  children: XmlNode[];
  /** The element's own text, entities expanded and whitespace trimmed. */
  text: string;
}

/** Thrown when the text isn't XML this reader can walk. */
export class XmlError extends Error {
  override readonly name = 'XmlError';
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** What a `&amp;`-style reference means, or `undefined` if it isn't one. */
export function xmlEntity(ref: string): string | undefined {
  const named = NAMED[ref];
  if (named !== undefined) return named;
  if (ref.startsWith('#')) {
    const hex = ref.startsWith('#x') || ref.startsWith('#X');
    const code = hex ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1));
    if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
      try {
        return String.fromCodePoint(code);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Replaces entity and numeric references in XML text; unknown ones stay as they are. */
export function decodeXml(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (whole, ref: string) => xmlEntity(ref) ?? whole,
  );
}

/** A name: a letter or underscore, then letters, digits, `.`, `-` or `:`. */
const isNameChar = (c: string) => /[A-Za-z0-9._:-]/.test(c);
const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

/**
 * The index just past a comment, CDATA section, processing instruction or
 * declaration at `at`, or `undefined` when there is none. `<!DOCTYPE …>` may
 * carry an internal subset in `[ ]`.
 */
function skipNonElement(text: string, at: number): number | undefined {
  const until = (needle: string) => {
    const end = text.indexOf(needle, at);
    return end < 0 ? undefined : end + needle.length;
  };
  if (text.startsWith('<!--', at)) return until('-->');
  if (text.startsWith('<![CDATA[', at)) return until(']]>');
  if (text.startsWith('<?', at)) return until('?>');
  if (!text.startsWith('<!', at)) return undefined;
  let depth = 0;
  for (let k = at; k < text.length; k++) {
    const c = text[k];
    if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === '>' && depth <= 0) return k + 1;
  }
  return undefined;
}

/** The root element of `text`, or an `XmlError`. */
export function parseXml(text: string): XmlNode {
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  let i = 0;

  const push = (node: XmlNode) => {
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else root ??= node;
  };

  while (i < text.length) {
    const open = text.indexOf('<', i);
    if (open < 0) break;
    if (open > i && stack.length > 0) {
      (stack[stack.length - 1] as XmlNode).text += decodeXml(text.slice(i, open));
    }
    const skipped = skipNonElement(text, open);
    if (skipped !== undefined) {
      i = skipped;
      continue;
    }
    if (text.startsWith('</', open)) {
      const end = text.indexOf('>', open);
      if (end < 0) throw new XmlError('An element is not closed.');
      if (stack.length === 0) {
        throw new XmlError(`Unexpected </${text.slice(open + 2, end).trim()}>.`);
      }
      stack.pop();
      i = end + 1;
      continue;
    }

    // A start tag: its name, its attributes, then `>` or `/>`.
    let k = open + 1;
    while (k < text.length && isNameChar(text[k] as string)) k++;
    const name = text.slice(open + 1, k);
    if (!name) throw new XmlError('A tag has no name.');
    const node: XmlNode = { name, attributes: {}, children: [], text: '' };
    let closed = false;
    while (k < text.length) {
      while (k < text.length && isSpace(text[k] as string)) k++;
      const c = text[k];
      if (c === undefined) throw new XmlError(`<${name}> is not finished.`);
      if (c === '>') {
        k++;
        break;
      }
      if (c === '/' && text[k + 1] === '>') {
        k += 2;
        closed = true;
        break;
      }
      let a = k;
      while (a < text.length && isNameChar(text[a] as string)) a++;
      const attribute = text.slice(k, a);
      if (!attribute) throw new XmlError(`<${name}> has an attribute without a name.`);
      while (a < text.length && isSpace(text[a] as string)) a++;
      if (text[a] !== '=') {
        // Some files write an attribute without a value; read it as empty.
        node.attributes[attribute] = '';
        k = a;
        continue;
      }
      a++;
      while (a < text.length && isSpace(text[a] as string)) a++;
      const quote = text[a];
      if (quote !== '"' && quote !== "'")
        throw new XmlError(`<${name}> ${attribute} has no quotes.`);
      const end = text.indexOf(quote, a + 1);
      if (end < 0) throw new XmlError(`<${name}> ${attribute} is not closed.`);
      node.attributes[attribute] = decodeXml(text.slice(a + 1, end));
      k = end + 1;
    }
    if (closed) push(node);
    else {
      push(node);
      stack.push(node);
    }
    i = k;
  }

  if (!root) throw new XmlError('There is no element in the file.');
  return root;
}
