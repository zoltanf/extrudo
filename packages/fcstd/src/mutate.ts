/**
 * Test support (no production code): seeded hostile `.FCStd` files made from our own fixture
 * documents (P6-25 S13, ADR-0144), for `mutate.test.ts`. A mutant is a fixture's entries with
 * one to three mutations: bytes of `Document.xml`, `GuiDocument.xml` or a binary entry flipped,
 * dropped, repeated or cut; properties and objects swapped, removed or repeated; numbers
 * replaced by extremes; links pointed elsewhere; container lists re-nested; names made hostile;
 * entries removed, repeated or renamed; or the finished archive's own bytes flipped. The same
 * seed always gives the same bytes.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/** A small seeded generator (mulberry32): the same seed, the same numbers. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Numbers as a hostile file writes them, in every place one is read. */
export const EXTREMES = [
  'NaN',
  'nan',
  'inf',
  '-inf',
  'Infinity',
  '-0',
  '1e308',
  '-1e308',
  '1e999',
  '4.9e-324',
  '2147483648',
  '-2147483649',
  '4294967296',
  '9007199254740993',
  '0x10',
  '1,5',
  '',
  '-1',
  '0',
  '1e-320',
];

/** Names and labels a hostile file gives its objects. */
export const HOSTILE_NAMES = [
  '__proto__',
  'constructor',
  'hasOwnProperty',
  'toString',
  'x'.repeat(10_000),
  'a\u202Eb\u2066c',
  'tab\there',
  'line\nbreak',
  '&#1;',
  '../../etc',
  '',
  ' ',
  '�',
];

export interface Mutant {
  /** What was done, for a failure's message. */
  readonly steps: readonly string[];
  readonly bytes: Uint8Array;
}

type Entries = Record<string, Uint8Array>;

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
const int = (r: () => number, n: number) => Math.floor(r() * n);

/** The `[start, end)` ranges of every `<tag …>…</tag>` or `<tag …/>` in `xml`, for elements that don't nest themselves. */
function blocks(xml: string, tag: string): [number, number][] {
  const out: [number, number][] = [];
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let at = xml.indexOf(open);
  while (at >= 0 && out.length < 5000) {
    const gt = xml.indexOf('>', at);
    if (gt < 0) break;
    let end: number;
    if (xml[gt - 1] === '/') end = gt + 1;
    else {
      const c = xml.indexOf(close, gt);
      if (c < 0) break;
      end = c + close.length;
    }
    out.push([at, end]);
    at = xml.indexOf(open, end);
  }
  return out;
}

/** The object names a document declares. */
const objectNames = (xml: string) =>
  [...xml.matchAll(/<Object (?:type="[^"]*" )?name="([^"]*)"/g)].map((m) => m[1] as string);

function mutateXml(r: () => number, xml: string): [string, string] {
  const kind = int(r, 11);
  const n = xml.length;
  switch (kind) {
    case 0: {
      const at = int(r, n);
      const c = String.fromCharCode((xml.charCodeAt(at) ^ (1 << int(r, 7))) & 0x7f);
      return [`flip char ${at}`, xml.slice(0, at) + c + xml.slice(at + 1)];
    }
    case 1: {
      const at = int(r, n);
      const len = 1 + int(r, 200);
      return [`drop ${at}+${len}`, xml.slice(0, at) + xml.slice(at + len)];
    }
    case 2: {
      const at = int(r, n);
      const len = 1 + int(r, 400);
      const times = 1 + int(r, 20);
      return [
        `repeat ${at}+${len}×${times}`,
        xml.slice(0, at) + xml.slice(at, at + len).repeat(times) + xml.slice(at),
      ];
    }
    case 3: {
      const at = int(r, n);
      return [`truncate ${at}`, xml.slice(0, at)];
    }
    case 4: {
      const numbers = [...xml.matchAll(/="(-?[\d.][\d.eE+-]*)"/g)];
      if (numbers.length === 0) return ['no number', xml];
      const m = pick(r, numbers);
      const value = pick(r, EXTREMES);
      const at = (m.index as number) + 2;
      return [
        `number ${m[1]} → ${value}`,
        xml.slice(0, at) + value + xml.slice(at + (m[1] as string).length),
      ];
    }
    case 5:
    case 6:
    case 7: {
      const tag = r() < 0.7 ? 'Property' : 'Object';
      const bs = blocks(xml, tag);
      if (bs.length < 2) return [`no ${tag}`, xml];
      const [a0, a1] = pick(r, bs);
      if (kind === 5) {
        const [b0, b1] = pick(r, bs);
        if (b0 === a0) return [`swap ${tag} with itself`, xml];
        const [x, y] =
          a0 < b0
            ? [
                [a0, a1],
                [b0, b1],
              ]
            : [
                [b0, b1],
                [a0, a1],
              ];
        const [x0, x1] = x as [number, number];
        const [y0, y1] = y as [number, number];
        if (y0 < x1) return [`overlapping ${tag}s`, xml];
        return [
          `swap ${tag} ${x0} ${y0}`,
          xml.slice(0, x0) +
            xml.slice(y0, y1) +
            xml.slice(x1, y0) +
            xml.slice(x0, x1) +
            xml.slice(y1),
        ];
      }
      if (kind === 6) return [`remove ${tag} ${a0}`, xml.slice(0, a0) + xml.slice(a1)];
      return [`repeat ${tag} ${a0}`, xml.slice(0, a1) + xml.slice(a0, a1) + xml.slice(a1)];
    }
    case 8: {
      const links = [...xml.matchAll(/<Link value="([^"]*)"/g)];
      const names = objectNames(xml);
      if (links.length === 0) return ['no link', xml];
      const m = pick(r, links);
      const to =
        r() < 0.2 ? '' : r() < 0.25 ? 'Nothing' : pick(r, names.length > 0 ? names : ['X']);
      const at = (m.index as number) + '<Link value="'.length;
      return [
        `link ${m[1]} → ${to}`,
        xml.slice(0, at) + to + xml.slice(at + (m[1] as string).length),
      ];
    }
    case 9: {
      const lists = [...xml.matchAll(/<LinkList count="(\d+)">/g)];
      const names = objectNames(xml);
      if (lists.length === 0 || names.length === 0) return ['no list', xml];
      const m = pick(r, lists);
      const add = Array.from({ length: 1 + int(r, 3) }, () => pick(r, names));
      const at = (m.index as number) + m[0].length;
      const count = Number(m[1]) + add.length;
      return [
        `renest +${add.join(',')}`,
        `${xml.slice(0, m.index as number)}<LinkList count="${count}">${add.map((a) => `<Link value="${a}"/>`).join('')}${xml.slice(at)}`,
      ];
    }
    default: {
      const attrs = [...xml.matchAll(/(name|value)="([^"]*)"/g)];
      if (attrs.length === 0) return ['no name', xml];
      const m = pick(r, attrs);
      const raw = pick(r, HOSTILE_NAMES);
      const value = raw
        .replace(/&(?!#1;)/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
      const at = (m.index as number) + (m[1] as string).length + 2;
      return [
        `name ${(m[2] as string).slice(0, 20)} → ${raw.slice(0, 20)}`,
        xml.slice(0, at) + value + xml.slice(at + (m[2] as string).length),
      ];
    }
  }
}

function mutateBinary(r: () => number, bytes: Uint8Array): [string, Uint8Array] {
  const n = bytes.length;
  if (n === 0) return ['empty', new Uint8Array([int(r, 256)])];
  switch (int(r, 4)) {
    case 0: {
      const out = bytes.slice();
      const k = 1 + int(r, 8);
      for (let i = 0; i < k; i++) {
        const at = int(r, n);
        out[at] = (out[at] as number) ^ (1 << int(r, 8));
      }
      return [`flip ${k} bytes`, out];
    }
    case 1: {
      const at = int(r, n);
      return [`truncate ${at}`, bytes.slice(0, at)];
    }
    case 2: {
      const at = int(r, n);
      const len = 1 + int(r, Math.min(4096, n - at));
      const out = new Uint8Array(n - len);
      out.set(bytes.subarray(0, at));
      out.set(bytes.subarray(at + len), at);
      return [`drop ${at}+${len}`, out];
    }
    default: {
      const at = int(r, n);
      const piece = bytes.subarray(at, at + 1 + int(r, 64));
      const times = 1 + int(r, 50);
      const out = new Uint8Array(n + piece.length * times);
      out.set(bytes.subarray(0, at));
      for (let t = 0; t < times; t++) out.set(piece, at + t * piece.length);
      out.set(bytes.subarray(at), at + piece.length * times);
      return [`repeat ${piece.length}×${times}`, out];
    }
  }
}

const XML = ['Document.xml', 'GuiDocument.xml'];

/** One mutation of `entries`, in place; what it did. */
function mutateEntries(r: () => number, entries: Entries): string {
  const names = Object.keys(entries).sort();
  const roll = r();
  if (roll < 0.55) {
    const name = pick(
      r,
      XML.filter((x) => x in entries).length > 0 ? XML.filter((x) => x in entries) : names,
    );
    const xml = strFromU8(entries[name] as Uint8Array);
    const [what, out] = mutateXml(r, xml);
    entries[name] = strToU8(out);
    return `${name}: ${what}`;
  }
  const binaries = names.filter((n) => !XML.includes(n));
  if (roll < 0.8 && binaries.length > 0) {
    const name = pick(r, binaries);
    const [what, out] = mutateBinary(r, entries[name] as Uint8Array);
    entries[name] = out;
    return `${name}: ${what}`;
  }
  const name = pick(r, names);
  switch (int(r, 3)) {
    case 0:
      delete entries[name];
      return `remove ${name}`;
    case 1: {
      const to = pick(r, [
        '../x',
        '/abs',
        'a\\b',
        'C:x',
        'n'.repeat(300),
        `${name}.copy`,
        'Document.XML',
      ]);
      entries[to] = entries[name] as Uint8Array;
      return `copy ${name} → ${to.slice(0, 20)}`;
    }
    default: {
      const to = pick(r, names);
      entries[to] = entries[name] as Uint8Array;
      return `${name} as ${to}`;
    }
  }
}

/** A mutant of `file` from `seed`: the same seed always gives the same bytes. */
export function mutant(file: Uint8Array, seed: number): Mutant {
  const r = random(seed);
  const entries: Entries = unzipSync(file);
  const steps: string[] = [];
  const count = 1 + int(r, 3);
  for (let i = 0; i < count; i++) steps.push(mutateEntries(r, entries));
  let bytes: Uint8Array = zipSync(entries, {
    level: r() < 0.5 ? 0 : 6,
    mtime: new Date(2026, 0, 1),
  });
  // Now and then the archive's own bytes.
  if (r() < 0.1) {
    const [what, out] = mutateBinary(r, bytes);
    steps.push(`archive: ${what}`);
    bytes = out;
  }
  return { steps, bytes };
}
