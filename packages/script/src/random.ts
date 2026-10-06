/**
 * `Math.random` inside the sandbox: a small PRNG seeded from the script's own
 * feature ID (ADR-0070 §2), so a script that shuffles or jitters gives the same
 * numbers on every recompute and two scripts give different ones.
 */

/**
 * A generator function in [0, 1) from a seed string (mulberry32, seeded by the
 * string's own hash). The same seed always gives the same sequence, in this
 * version and the next: it is part of what a script is allowed to rely on.
 */
export function seededRandom(seed: string): () => number {
  let state = hash(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** FNV-1a over the seed's UTF-8 bytes, so any feature ID gives a full state. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (const character of text) {
    value ^= character.codePointAt(0) ?? 0;
    value = Math.imul(value, 0x01000193);
  }
  return value | 0;
}
