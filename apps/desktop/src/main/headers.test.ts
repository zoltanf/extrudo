import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HEADERS } from './headers';

/** The headers of a `_headers` block whose rule is `rule`. */
function blockHeaders(text: string, rule: string): Record<string, string> {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === rule);
  const headers: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break;
    const match = /^\s+([^:]+):\s*(.*)$/.exec(line);
    if (match) headers[match[1] as string] = match[2] as string;
  }
  return headers;
}

describe('the app:// headers equal the web app’s _headers (P6-01 review)', () => {
  it('has exactly the `/*` block’s headers, value for value', () => {
    const text = readFileSync(
      new URL('../../../../apps/web/public/_headers', import.meta.url),
      'utf8',
    );
    const expected = blockHeaders(text, '/*');
    expect(Object.keys(expected).length).toBeGreaterThan(0);
    expect(HEADERS).toEqual(expected);
  });
});
