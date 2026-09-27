/**
 * Content hashes for the recompute cache (architecture §5.1, ADR-0024).
 *
 * A feature's cache key is the hash of everything its result depends on, so
 * a collision would silently show the wrong geometry. 128 bits (cyrb128,
 * four 32-bit lanes) keeps that out of reach for a cache of a few hundred
 * entries; it isn't cryptographic, and doesn't need to be.
 */

/** JSON with object keys sorted, so key order (insertion order) doesn't change the hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    // JSON has no NaN or Infinity; keep them apart from null and from each other.
    if (typeof value === 'number' && !Number.isFinite(value)) return `"#${value}"`;
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/** A 128-bit hash of a string, as 32 hex digits. */
export function hashString(text: string): string {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}

/** The hash of values' canonical JSON. */
export function hashOf(...values: unknown[]): string {
  return hashString(canonicalJson(values));
}
