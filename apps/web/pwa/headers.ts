/**
 * Reads the `_headers` file the host applies (Cloudflare Pages' format, ADR-0054):
 * a path pattern on a line of its own, then indented `Name: value` lines. Used by
 * `vite preview` (so local previews and the e2e suite run under the live site's
 * headers) and by the tests that check the file. Only what the file uses is
 * supported: `*` as a splat at the end of a pattern and exact paths.
 */

export interface HeaderRule {
  pattern: string;
  headers: { name: string; value: string }[];
}

export function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    if (/^\s/.test(raw)) {
      const rule = rules.at(-1);
      const colon = raw.indexOf(':');
      if (!rule || colon < 0) throw new Error(`Header line outside a rule: "${raw.trim()}"`);
      rule.headers.push({ name: raw.slice(0, colon).trim(), value: raw.slice(colon + 1).trim() });
    } else {
      rules.push({ pattern: raw.trim(), headers: [] });
    }
  }
  return rules;
}

/** Whether a rule's pattern matches a URL path (`/assets/*` matches `/assets/a.js`). */
export function matches(pattern: string, path: string): boolean {
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
  return pattern === path;
}

/**
 * The headers a path gets: those of every matching rule, in file order. The host
 * joins repeated names with ", ", so do we.
 */
export function headersFor(rules: HeaderRule[], path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of rules) {
    if (!matches(rule.pattern, path)) continue;
    for (const { name, value } of rule.headers) {
      const key = name.toLowerCase();
      out[key] = key in out ? `${out[key]}, ${value}` : value;
    }
  }
  return out;
}
