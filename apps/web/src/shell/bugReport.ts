/**
 * The Report a Bug dialog's pure pieces (ADR-0092, §2 and §4, first row of
 * §5): the report text "Copy report" puts on the clipboard, the prefilled
 * GitHub issue-form URL with its length cuts, the version line, the timeline
 * summary, and the ring buffer of errors the shell fills and the dialog
 * reads. No React, no DOM access (the window listener goes through
 * `watchWindowErrors`'s `target`); tested in `bugReport.test.ts`.
 */
import type { ExtrudoDocument } from '@extrudo/core';
import type { BuildInfo } from '../../pwa/build-info';
import { ISSUES_URL } from './aboutLinks';
import type { InfoRow } from './systemInfo';

export interface BugReportInput {
  title: string;
  what: string;
  steps: string;
  build: BuildInfo;
  /** `systemInfo().running` (the "Running on" rows). */
  running: readonly InfoRow[];
  /** The error log's `recent()`, oldest first. */
  errors: readonly string[];
  /** `timelineSummary(doc)` when the person ticked "Include the timeline"; else undefined. */
  timeline?: readonly string[];
}

/** One value per field of `.github/ISSUE_TEMPLATE/bug_report.yml`, by field id. */
export interface IssueFields {
  title: string;
  what: string;
  steps: string;
  version: string;
  browser: string;
  os: string;
  console: string;
}

export const ISSUE_TEMPLATE = 'bug_report.yml';
export const URL_LIMIT = 8000;
export const CUT_MARK = '… (cut: see the copied report)';
export const ERROR_LIMIT = 10;

const URL_PARAM_ORDER = ['title', 'what', 'steps', 'version', 'browser', 'os', 'console'] as const;
type UrlParam = (typeof URL_PARAM_ORDER)[number];
type CuttableParam = Exclude<UrlParam, 'title' | 'version' | 'browser' | 'os'>;

/** The "Extrudo version" line: `<App row value> · <version> (<channel>, <commit>)`. */
export function versionLine(build: BuildInfo, running: readonly InfoRow[]): string {
  const app = running.find((row) => row.label === 'App')?.value;
  const inside = `${build.channel}, ${build.commit || 'no commit'}${
    build.dirty ? ', uncommitted changes' : ''
  }`;
  return `${app ? `${app} · ` : ''}${build.version} (${inside})`;
}

/** The values for the issue form's fields, by field id. */
export function issueFields(input: BugReportInput): IssueFields {
  const value = (label: string) => input.running.find((row) => row.label === label)?.value;
  const running = input.running.filter((row) => row.label !== 'Browser' && row.label !== 'System');
  const blocks = [input.errors.length ? input.errors.join('\n') : '(none)'];
  if (running.length > 0) {
    blocks.push(['Running on:', ...running.map((row) => `${row.label}: ${row.value}`)].join('\n'));
  }
  if (input.timeline) {
    blocks.push(
      ['Timeline:', ...(input.timeline.length ? input.timeline : ['(empty)'])].join('\n'),
    );
  }
  return {
    title: input.title.trim(),
    what: input.what.trim(),
    steps: input.steps.trim(),
    version: versionLine(input.build, input.running),
    browser: value('Browser') ?? 'unknown',
    os: value('System') ?? 'unknown',
    console: blocks.join('\n\n'),
  };
}

/** The Markdown report "Copy report" copies: the form's sections, in the form's order. */
export function buildReport(input: BugReportInput): string {
  const fields = issueFields(input);
  return [
    '### What happened?',
    '',
    fields.what || '(not filled in)',
    '',
    '### Steps to reproduce',
    '',
    fields.steps || '(not filled in)',
    '',
    '### Extrudo version',
    '',
    fields.version,
    '',
    '### Browser and version',
    '',
    fields.browser,
    '',
    '### Operating system',
    '',
    fields.os,
    '',
    '### Console errors',
    '',
    '```text',
    fields.console,
    '```',
    '',
  ].join('\n');
}

/**
 * The prefilled issue-form URL. Cuts `console`, then `steps`, then `what`
 * (longest fitting prefix plus the cut mark, searched again per prefix on
 * the original value) until the URL fits; a field that cannot be made to
 * fit stays as the mark alone. Never cut: title, version, browser, os.
 */
export function issueUrl(
  fields: IssueFields,
  base: string = ISSUES_URL,
  limit: number = URL_LIMIT,
): string {
  const build = (values: IssueFields): string => {
    const params = new URLSearchParams();
    params.set('template', ISSUE_TEMPLATE);
    for (const key of URL_PARAM_ORDER) {
      const value = values[key];
      if (value) params.set(key, value);
    }
    return `${base}?${params}`;
  };
  const fits = (values: IssueFields): boolean => build(values).length <= limit;
  const cutTo = (values: IssueFields, key: CuttableParam, original: string): string => {
    const marked = { ...values, [key]: CUT_MARK };
    if (!fits(marked)) return CUT_MARK;
    let low = 0;
    let high = original.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (fits({ ...values, [key]: `${original.slice(0, mid)}${CUT_MARK}` })) low = mid;
      else high = mid - 1;
    }
    return `${original.slice(0, low)}${CUT_MARK}`;
  };
  let values = fields;
  for (const key of ['console', 'steps', 'what'] as const) {
    if (fits(values)) break;
    values = { ...values, [key]: cutTo(values, key, values[key]) };
  }
  return build(values);
}

/** One line per feature, in timeline order: `3. Extrude1 (extrude)`. */
export function timelineSummary(doc: Pick<ExtrudoDocument, 'features'>): string[] {
  return doc.features.map(
    (feature, i) =>
      `${i + 1}. ${feature.name} (${feature.type})${feature.suppressed ? ' (suppressed)' : ''}`,
  );
}

/** The ring buffer behind the dialog's error list. */
export interface ErrorLog {
  /** Keeps the first line of `text`, trimmed; ignores an empty one and a repeat of the newest entry. */
  record(text: string): void;
  /** The newest `limit` entries, oldest first. */
  recent(): readonly string[];
  clear(): void;
}

export function createErrorLog(limit: number = ERROR_LIMIT): ErrorLog {
  const entries: string[] = [];
  return {
    record(text) {
      const lineEnd = text.indexOf('\n');
      const first = (lineEnd === -1 ? text : text.slice(0, lineEnd)).trim();
      if (!first || entries[entries.length - 1] === first) return;
      entries.push(first);
      if (entries.length > limit) entries.shift();
    },
    recent: () => [...entries],
    clear: () => {
      entries.length = 0;
    },
  };
}

/** The shell's one log (the dialog reads it, the shell and the window watcher write it). */
export const errorLog: ErrorLog = createErrorLog();

/** "TypeError: x is not a function" for an Error, the string itself for a string, String(reason) otherwise. */
export function errorText(reason: unknown): string {
  const text = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  const lineEnd = text.indexOf('\n');
  return lineEnd === -1 ? text : text.slice(0, lineEnd);
}

/**
 * Records uncaught errors (`error` events: `event.error ?? event.message`) and
 * unhandled rejections (`unhandledrejection` events: `event.reason`) in `log`.
 * Returns the unsubscribe. `target` is `window` in the app and a plain
 * `EventTarget` in tests.
 */
export function watchWindowErrors(
  log: ErrorLog,
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  const onError = (event: Event) => {
    const e = event as ErrorEvent;
    log.record(errorText(e.error ?? e.message));
  };
  const onRejection = (event: Event) => {
    log.record(errorText((event as PromiseRejectionEvent).reason));
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
