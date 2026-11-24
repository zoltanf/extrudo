/**
 * The user guide's FreeCAD page (`docs/guide/freecad.md`, P6-25 S13) keeps up with the app: it
 * quotes every sentence every notice of the import can show (driven through reports that reach
 * every branch, `fcstd-notice-reports.ts`), no sentence it can't, every reason in the app's words,
 * and states the importer's limits as the code has them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  IMPORT_TIMEOUT_MS,
  MAX_BODY_FEATURES,
  MAX_FCSTD_BYTES,
  MAX_FILE_FEATURES,
  MAX_IMPORT_COMPONENTS,
  MAX_IMPORT_MESH_FACETS,
  MAX_IMPORT_MESHES,
  MAX_IMPORT_PARAMETERS,
  MAX_LINK_COPIES,
  MAX_MESH_FACETS,
  MAX_RESTARTS,
  SHAPE_TIMEOUT_MS,
} from '@extrudo/fcstd';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_BYTES } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import {
  MAX_FCSTD_BYTES as APP_MAX_FCSTD_BYTES,
  fcstdNotices,
  HISTORY_STOP,
  LEFT_OUT,
  LINK_REASON,
  TREE_REASON,
} from './actions';
import { noticeReports } from './fcstd-notice-reports';

const code = readFileSync(fileURLToPath(new URL('./actions.ts', import.meta.url)), 'utf8');

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
/** Markdown's line breaks don't count: words as one line. */
const flat = (text: string) => text.replace(/\s+/g, ' ');
const page = flat(read('../../../../docs/guide/freecad.md'));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The page's quoted notices (`**"…"**`), each once. */
const quotes = [...new Set([...page.matchAll(/\*\*"(.+?)"\*\*/g)].map((m) => m[1] as string))];
/** A name the reports put in a notice (`NAME1` …), one or a list as `listed` writes it. */
const NAME = 'NAME\\d+';
const LIST = `${NAME}(?:; ${NAME})*(?:; and \\d+ more)?`;
/** Every reason in the app's words. */
const REASON = `(?:${[
  ...new Set([LEFT_OUT, LINK_REASON, HISTORY_STOP, TREE_REASON].flatMap((t) => Object.values(t))),
]
  .map(escapeRe)
  .join('|')})`;
const KINDS = '(?:parts|compounds|links to parts)';
const SOURCES = '(?:spreadsheets?|variable sets?)';
/**
 * What each part in *italics* stands for: exactly what the reports (`fcstd-notice-reports.ts`)
 * put there, so a quote can't stand for another sentence or take in the one after it.
 */
const ITALICS: Readonly<Record<string, string>> = {
  name: NAME,
  body: NAME,
  shape: NAME,
  link: NAME,
  names: LIST,
  bodies: LIST,
  shapes: LIST,
  links: LIST,
  old: NAME,
  new: `${NAME}(?:(?:, | and )${NAME} to ${NAME})*(?:, and \\d+ more)?`,
  parts: `${KINDS}(?:(?:, | and )${KINDS})*`,
  reason: `${REASON}(?:, and ${REASON})?`,
  reasons: `${REASON}(?:, or ${REASON})?`,
  n: '\\d+',
  k: '\\d+',
  j: '\\d+',
  'm shapes': '\\d+ shapes?',
  'n parameters': '\\d+ parameters?',
  'n things': '\\d+ things?',
  its: '(?:its|their)',
  'its m': 'its \\d+',
  "the file's m": "the file's \\d+",
  'its expressions':
    '(?:its one expression|both of its expressions|all \\d+ of its expressions|its \\d+ expressions)',
  "The file's expressions":
    "(?:The file's one expression|Both of the file's expressions|All \\d+ of the file's expressions|The file's \\d+ expressions)",
  'plain numbers': '(?:a plain number|plain numbers)',
  'a body': '(?:a body|bodies)',
  spreadsheets: `${SOURCES}(?: and ${SOURCES})?`,
  'sketches and features':
    '(?:sketches and features|primitives and booleans|sketches, features, primitives and booleans)',
  'One name': '(?:One name|\\d+ names)',
  'A datum line or plane': '(?:A datum line or plane|The plane of a tilted sketch)',
  'Datum lines and planes and the planes of tilted sketches':
    '(?:(?:A datum line or plane|\\d+ datum lines and planes)(?: and (?:the plane of a tilted sketch|the planes of \\d+ tilted sketches))?|The planes of \\d+ tilted sketches)',
  'A threaded hole': '(?:A threaded hole|\\d+ threaded holes)',
  'a plain hole': '(?:a plain hole|plain holes)',
};
const patternOf = (q: string) =>
  q
    .split(/(\*[^*]+\*)/)
    .map((part) => {
      const italic = /^\*([^*]+)\*$/.exec(part)?.[1];
      if (italic === undefined) return escapeRe(part);
      const re = Object.hasOwn(ITALICS, italic) ? ITALICS[italic] : undefined;
      if (re === undefined)
        throw new Error(`the page's *${italic}* stands for nothing the test knows`);
      return re;
    })
    .join('');
/** A notice is one or more of `quotes`' sentences, one after another. */
const matcher = (qs: readonly string[]) => {
  const one = `(?:${qs.map((q) => `(?:${patternOf(q)})`).join('|')})`;
  return new RegExp(`^${one}(?: ${one})*$`);
};
const patterns = quotes.map(patternOf);
const notice = matcher(quotes);

describe('the FreeCAD guide page', () => {
  const notices = noticeReports().flatMap(([what, r]) =>
    fcstdNotices(r).map((text) => ({ what, text })),
  );

  it('quotes every notice the import can show, sentence by sentence, with the file’s text in italics', () => {
    expect(quotes.length).toBeGreaterThan(30);
    for (const { what, text } of notices) expect(text, what).toMatch(notice);
  });

  // One large pattern a quote: seconds on a loaded machine, so its own time.
  it('needs every quote: without any one of them some notice is no longer on the page', {
    timeout: 60_000,
  }, () => {
    for (const [i, q] of quotes.entries()) {
      const without = matcher(quotes.filter((_, k) => k !== i));
      // Only a notice that reads this quote's sentence can stop matching without it.
      const alone = new RegExp(`(?:^|[.…] )${patterns[i]}(?: |$)`);
      expect(
        notices.some(({ text }) => alone.test(text) && !without.test(text)),
        `"${q}" is matched by the other quotes alone`,
      ).toBe(true);
    }
  });

  it('quotes no sentence the import doesn’t show', () => {
    for (const [i, p] of patterns.entries()) {
      const alone = new RegExp(`(?:^|[.…] )${p}(?: |$)`);
      expect(
        notices.some(({ text }) => alone.test(text)),
        `"${quotes[i]}" is on the page but no notice reads so`,
      ).toBe(true);
    }
  });

  it('has a report for every notice the code can push', () => {
    // A new notice needs a report in `fcstd-notice-reports.ts` that reaches it, and its sentence
    // on the page: then this count changes with it.
    const body = code.slice(
      code.indexOf('export function fcstdNotices('),
      code.indexOf('/** The two commonest reasons'),
    );
    expect(body.split('out.push(').length - 1).toBe(12);
    expect(body.split('out[0] = ').length - 1).toBe(1);
    const reached = new Set(notices.map(({ text }) => text.split(/[:;,.]/)[0]));
    expect(reached.size).toBeGreaterThan(20);
  });

  it('gives every reason in the words the notices use (checked by table: the reports reach a few)', () => {
    for (const words of [LEFT_OUT, LINK_REASON, HISTORY_STOP, TREE_REASON])
      for (const text of Object.values(words)) expect(page, text).toContain(text);
  });

  it('states the limits the importer has', () => {
    const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;
    const n = (x: number) => x.toLocaleString('en-US');
    expect(APP_MAX_FCSTD_BYTES).toBe(MAX_FCSTD_BYTES);
    for (const text of [
      `up to ${mb(MAX_FCSTD_BYTES)}`,
      `up to ${mb(MAX_ATTACHMENT_BYTES)} once converted`,
      `up to ${mb(MAX_ATTACHMENTS_BYTES)}`,
      `at most ${IMPORT_TIMEOUT_MS / 60_000} minutes`,
      `${n(MAX_MESH_FACETS)} facets`,
      `${n(MAX_IMPORT_MESHES)} meshes`,
      `${n(MAX_IMPORT_MESH_FACETS)} facets`,
      `${n(MAX_LINK_COPIES)} copies`,
      `${n(MAX_IMPORT_COMPONENTS)} components`,
      `${n(MAX_IMPORT_PARAMETERS)} parameters`,
      `up to ${n(MAX_BODY_FEATURES)} features`,
      `a file up to ${n(MAX_FILE_FEATURES)}`,
    ])
      expect(page, text).toContain(text);
    expect(SHAPE_TIMEOUT_MS).toBe(60_000);
    expect(page).toContain('one shape at most a minute');
    expect(MAX_RESTARTS).toBe(3);
    expect(page).toContain('The kernel stopped three times');
  });
});
