/**
 * Fuzzy command search for the Ctrl+K palette and the S toolbox (P1-14,
 * ADR-0023). A query matches a label when its letters appear in order;
 * letters at word starts and runs of letters score higher, so "3pr" finds
 * "3-Point Rectangle" before "Inscribed Polygon". Separators in the query
 * are ignored. A query that doesn't match the label can still match the
 * command's words (its group, its hint), but only by word prefixes, and it
 * then ranks below every label match.
 */

export interface Searchable {
  id: string;
  label: string;
  /** More words to find it by: its group, its hint. */
  keywords?: string;
  /** Not runnable yet; ranked after runnable commands that match as well. */
  unavailable?: string;
}

export interface Match {
  score: number;
  /** Indices of the matched characters in the label, for highlighting. */
  positions: number[];
}

export interface SearchResult<T> {
  item: T;
  /** Empty when the query matched the command's words rather than its label. */
  positions: number[];
}

const MATCH = 1;
const BOUNDARY = 8;
const FIRST = 2;
const CONSECUTIVE = 6;
const GAP = 0.5;
const LEADING = 0.2;
const LENGTH = 0.05;

const SEPARATORS = /[\s\-_/.,·›:]+/g;
const ALNUM = /[\p{L}\p{N}]/u;

/** Whether a word starts at `i`: after a separator, at a lower→Upper step, or a letter↔digit step. */
function isBoundary(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text.charAt(i - 1);
  const here = text.charAt(i);
  if (!ALNUM.test(prev)) return true;
  if (prev === prev.toLowerCase() && here !== here.toLowerCase()) return true;
  return /\d/.test(prev) !== /\d/.test(here);
}

/** Scores `text` against `query`; `undefined` if the query's letters don't all appear in order. */
export function fuzzyMatch(query: string, text: string): Match | undefined {
  const q = query.toLowerCase().replace(SEPARATORS, '');
  if (!q) return { score: 0, positions: [] };
  const t = text.toLowerCase();
  const n = t.length;
  const m = q.length;
  if (m > n) return undefined;
  const bonus = Array.from({ length: n }, (_, j) =>
    isBoundary(text, j) ? BOUNDARY + (j === 0 ? FIRST : 0) : 0,
  );
  // best[i][j]: the best score with query letter i matched at text index j; from[i][j] the
  // index letter i − 1 was matched at.
  const best: Float64Array[] = [];
  const from: Int32Array[] = [];
  for (let i = 0; i < m; i++) {
    const row = new Float64Array(n).fill(Number.NEGATIVE_INFINITY);
    const back = new Int32Array(n).fill(-1);
    for (let j = i; j < n; j++) {
      if (t[j] !== q[i]) continue;
      if (i === 0) {
        row[j] = MATCH + (bonus[j] ?? 0) - LEADING * j;
        continue;
      }
      const prev = best[i - 1] as Float64Array;
      for (let k = i - 1; k < j; k++) {
        const before = prev[k] as number;
        if (before === Number.NEGATIVE_INFINITY) continue;
        const step = k === j - 1 ? CONSECUTIVE : -GAP * (j - k - 1);
        const score = before + MATCH + (bonus[j] ?? 0) + step;
        if (score > (row[j] as number)) {
          row[j] = score;
          back[j] = k;
        }
      }
    }
    best.push(row);
    from.push(back);
  }
  const last = best[m - 1] as Float64Array;
  let end = -1;
  for (let j = 0; j < n; j++) {
    if (
      last[j] !== Number.NEGATIVE_INFINITY &&
      (end < 0 || (last[j] as number) > (last[end] as number))
    )
      end = j;
  }
  if (end < 0) return undefined;
  const positions: number[] = [];
  for (let i = m - 1, j = end; i >= 0; i--) {
    positions.unshift(j);
    j = (from[i] as Int32Array)[j] as number;
  }
  return { score: (last[end] as number) - LENGTH * n, positions };
}

/** Every query word of 3+ letters starts a word of `words` (and there is one). */
function wordsMatch(query: string, words: string): boolean {
  const tokens = query.toLowerCase().split(SEPARATORS).filter(Boolean);
  const long = tokens.filter((t) => t.length >= 3);
  if (long.length === 0) return false;
  const pool = words.toLowerCase().split(SEPARATORS);
  return long.every((token) => pool.some((word) => word.startsWith(token)));
}

/**
 * The commands that match `query`, best first; all of them, in their order,
 * for an empty query. `recent` (most recent first) nudges ties.
 */
export function searchCommands<T extends Searchable>(
  items: readonly T[],
  query: string,
  recent: readonly string[] = [],
): SearchResult<T>[] {
  if (!query.replace(SEPARATORS, '')) return items.map((item) => ({ item, positions: [] }));
  const scored: { item: T; positions: number[]; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const label = fuzzyMatch(query, item.label);
    let score: number;
    let positions: number[] = [];
    if (label) {
      score = label.score;
      positions = label.positions;
    } else if (wordsMatch(query, `${item.label} ${item.keywords ?? ''}`)) {
      score = -100;
    } else return;
    const r = recent.indexOf(item.id);
    if (r >= 0) score += 1 - r * 0.1;
    if (item.unavailable) score -= 3;
    scored.push({ item, positions, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map(({ item, positions }) => ({ item, positions }));
}
