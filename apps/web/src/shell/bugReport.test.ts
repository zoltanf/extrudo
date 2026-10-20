import { readFileSync } from 'node:fs';
import type { Feature, FeatureId } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import type { BuildInfo } from '../../pwa/build-info';
import { ISSUES_URL } from './aboutLinks';
import {
  type BugReportInput,
  buildReport,
  CUT_MARK,
  createErrorLog,
  errorText,
  type IssueFields,
  issueFields,
  issueUrl,
  timelineSummary,
  versionLine,
  watchWindowErrors,
} from './bugReport';
import type { InfoRow } from './systemInfo';

const build: BuildInfo = {
  version: '0.8.1',
  channel: 'stable',
  commit: '0f9e938',
  dirty: false,
  date: '2026-10-19T00:00:00Z',
  engines: { occt: 'occt-1', planegcs: 'planegcs-1', openscad: 'openscad-1' },
};

const running: readonly InfoRow[] = [
  { label: 'App', value: 'Browser (Chrome)' },
  { label: 'Browser', value: 'Chrome 153' },
  { label: 'System', value: 'Linux x86_64' },
  { label: 'Graphics', value: 'Mesa' },
];

function input(overrides: Partial<BugReportInput> = {}): BugReportInput {
  return {
    title: 'Crash',
    what: 'It broke.',
    steps: '1. Open',
    build,
    running,
    errors: [],
    ...overrides,
  };
}

describe('versionLine', () => {
  it('joins the App row, the version and the channel with the commit', () => {
    expect(versionLine(build, running)).toBe('Browser (Chrome) · 0.8.1 (stable, 0f9e938)');
  });

  it('leaves the App part out without an App row', () => {
    expect(
      versionLine(
        build,
        running.filter((row) => row.label !== 'App'),
      ),
    ).toBe('0.8.1 (stable, 0f9e938)');
  });

  it('says no commit without one, and notes uncommitted changes', () => {
    expect(versionLine({ ...build, commit: '' }, running)).toBe(
      'Browser (Chrome) · 0.8.1 (stable, no commit)',
    );
    const dev: BuildInfo = { ...build, version: '0.8.1+dev.3', channel: 'dev', dirty: true };
    expect(versionLine({ ...dev, commit: 'abc1234' }, running)).toBe(
      'Browser (Chrome) · 0.8.1+dev.3 (dev, abc1234, uncommitted changes)',
    );
  });
});

describe('issueFields', () => {
  it('trims the texts and reads browser, os and version from the rows', () => {
    const fields = issueFields(
      input({ title: ' Crash ', what: ' It broke. ', steps: ' 1. Open ' }),
    );
    expect(fields.title).toBe('Crash');
    expect(fields.what).toBe('It broke.');
    expect(fields.steps).toBe('1. Open');
    expect(fields.browser).toBe('Chrome 153');
    expect(fields.os).toBe('Linux x86_64');
    expect(fields.version).toBe('Browser (Chrome) · 0.8.1 (stable, 0f9e938)');
  });

  it('falls back to unknown without the Browser and System rows', () => {
    const fields = issueFields(input({ running: [{ label: 'App', value: 'Browser (Chrome)' }] }));
    expect(fields.browser).toBe('unknown');
    expect(fields.os).toBe('unknown');
  });

  it('lists the errors, then Running on without the Browser and System rows', () => {
    expect(issueFields(input()).console).toBe(
      '(none)\n\nRunning on:\nApp: Browser (Chrome)\nGraphics: Mesa',
    );
    const withErrors = issueFields(
      input({ errors: ['Extrude2: The cut does not touch any body.', 'The kernel stopped.'] }),
    );
    expect(withErrors.console).toBe(
      'Extrude2: The cut does not touch any body.\nThe kernel stopped.' +
        '\n\nRunning on:\nApp: Browser (Chrome)\nGraphics: Mesa',
    );
  });

  it('adds the Timeline block only when it is included', () => {
    expect(issueFields(input()).console).not.toContain('Timeline:');
    expect(issueFields(input({ timeline: [] })).console.endsWith('Timeline:\n(empty)')).toBe(true);
    const lines = issueFields(input({ timeline: ['1. Sketch1 (sketch)'] })).console;
    expect(lines).toBe(
      '(none)\n\nRunning on:\nApp: Browser (Chrome)\nGraphics: Mesa\n\nTimeline:\n1. Sketch1 (sketch)',
    );
  });
});

describe('buildReport', () => {
  it('holds the sections of the form, in the order of the form, without the title', () => {
    const report = buildReport(
      input({ title: 'Crash', what: 'It broke.', steps: '1. Open', errors: ['E1'] }),
    );
    expect(report).toBe(`### What happened?

It broke.

### Steps to reproduce

1. Open

### Extrudo version

Browser (Chrome) · 0.8.1 (stable, 0f9e938)

### Browser and version

Chrome 153

### Operating system

Linux x86_64

### Console errors

\`\`\`text
E1

Running on:
App: Browser (Chrome)
Graphics: Mesa
\`\`\`
`);
    expect(report.endsWith('\n')).toBe(true);
    expect(report.endsWith('\n\n')).toBe(false);
  });

  it('says (not filled in) for an empty what and steps', () => {
    expect(
      buildReport(input({ what: '   ', steps: '' })).startsWith(
        '### What happened?\n\n(not filled in)\n\n### Steps to reproduce\n\n(not filled in)',
      ),
    ).toBe(true);
  });
});

describe('issueUrl', () => {
  it('builds the URL with the params in order, and they decode back', () => {
    const url = issueUrl(
      issueFields(input({ title: 'Crash', what: 'It broke', steps: '1. Open' })),
    );
    expect(url.startsWith(`${ISSUES_URL}?template=bug_report.yml`)).toBe(true);
    const search = new URL(url).searchParams;
    expect([...search.keys()]).toEqual([
      'template',
      'title',
      'what',
      'steps',
      'version',
      'browser',
      'os',
      'console',
    ]);
    expect(search.get('title')).toBe('Crash');
    expect(search.get('what')).toBe('It broke');
    expect(search.get('steps')).toBe('1. Open');
    expect(search.get('version')).toBe('Browser (Chrome) · 0.8.1 (stable, 0f9e938)');
    expect(search.get('browser')).toBe('Chrome 153');
    expect(search.get('os')).toBe('Linux x86_64');
  });

  it('leaves an empty title out', () => {
    const search = new URL(issueUrl(issueFields(input({ title: ' ' })))).searchParams;
    expect([...search.keys()].includes('title')).toBe(false);
  });
});

describe('issueUrl cutting', () => {
  const cut = (fields: IssueFields, limit: number) => issueUrl(fields, ISSUES_URL, limit);
  const decoded = (url: string, key: string) => new URL(url).searchParams.get(key);

  it('cuts the console first, and keeps what and steps', () => {
    const fields: IssueFields = {
      title: 'T'.repeat(10),
      what: 'W'.repeat(10),
      steps: 'S'.repeat(10),
      version: 'v',
      browser: 'b',
      os: 'o',
      console: 'C'.repeat(1000),
    };
    const url = cut(fields, 400);
    expect(url.length).toBeLessThanOrEqual(400);
    const kept = decoded(url, 'console');
    expect(kept?.endsWith(CUT_MARK)).toBe(true);
    expect(kept).toMatch(/^C+… \(cut: see the copied report\)$/);
    expect(fields.console.startsWith(kept?.slice(0, kept.length - CUT_MARK.length) ?? '')).toBe(
      true,
    );
    expect(decoded(url, 'what')).toBe(fields.what);
    expect(decoded(url, 'steps')).toBe(fields.steps);
  });

  it('leaves the console as the mark when it alone cannot fit, and cuts the steps', () => {
    const fields: IssueFields = {
      title: 'T'.repeat(160),
      what: 'W'.repeat(10),
      steps: 'S'.repeat(80),
      version: 'v',
      browser: 'b',
      os: 'o',
      console: 'C'.repeat(100),
    };
    const url = cut(fields, 400);
    expect(decoded(url, 'console')).toBe(CUT_MARK);
    const steps = decoded(url, 'steps');
    expect(steps?.endsWith(CUT_MARK)).toBe(true);
    expect(steps?.length).toBeGreaterThan(CUT_MARK.length);
    expect(fields.steps.startsWith(steps?.slice(0, steps.length - CUT_MARK.length) ?? '')).toBe(
      true,
    );
    expect(decoded(url, 'what')).toBe(fields.what);
  });

  it('returns the URL even when everything is cut and it is still too long', () => {
    const fields: IssueFields = {
      title: 'T'.repeat(1000),
      what: 'W'.repeat(100),
      steps: 'S'.repeat(100),
      version: 'v',
      browser: 'b',
      os: 'o',
      console: 'C'.repeat(100),
    };
    const url = cut(fields, 400);
    expect(url.length).toBeGreaterThan(400);
    expect(decoded(url, 'title')).toBe(fields.title);
    expect(decoded(url, 'what')).toBe(CUT_MARK);
    expect(decoded(url, 'steps')).toBe(CUT_MARK);
    expect(decoded(url, 'console')).toBe(CUT_MARK);
  });

  it('never cuts the version, the browser or the os', () => {
    const fields: IssueFields = {
      title: 'T'.repeat(10),
      what: 'W'.repeat(10),
      steps: 'S'.repeat(10),
      version: '0.8.1 (stable, 0f9e938)',
      browser: 'Chrome 153',
      os: 'Linux x86_64',
      console: 'C'.repeat(1000),
    };
    const url = cut(fields, 400);
    const search = new URL(url).searchParams;
    expect(search.get('version')).toBe(fields.version);
    expect(search.get('browser')).toBe(fields.browser);
    expect(search.get('os')).toBe(fields.os);
  });
});

describe('timelineSummary', () => {
  it('lists every feature in timeline order, with its type and suppression', () => {
    const feature = (id: string, type: string, name: string, suppressed = false): Feature => ({
      id: id as FeatureId,
      type,
      name,
      suppressed,
      inputs: {},
    });
    const features = [
      feature('a', 'sketch', 'Sketch1'),
      feature('b', 'extrude', 'Extrude1', true),
      feature('c', 'fillet', 'Fillet1'),
    ];
    expect(timelineSummary({ features })).toEqual([
      '1. Sketch1 (sketch)',
      '2. Extrude1 (extrude) (suppressed)',
      '3. Fillet1 (fillet)',
    ]);
  });
});

describe('createErrorLog', () => {
  it('keeps the first trimmed line, and ignores empties and repeats of the newest', () => {
    const log = createErrorLog();
    log.record('  First line\nsecond line\n  ');
    log.record('\n\n');
    log.record('First line');
    expect(log.recent()).toEqual(['First line']);
    log.record('Second');
    log.record('First line');
    expect(log.recent()).toEqual(['First line', 'Second', 'First line']);
  });

  it('keeps only the last limit entries, oldest first, and clears', () => {
    const log = createErrorLog(10);
    for (let i = 1; i <= 12; i++) log.record(`E${i}`);
    expect(log.recent()).toEqual(['E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11', 'E12']);
    log.clear();
    expect(log.recent()).toEqual([]);
  });
});

describe('errorText', () => {
  it('formats an Error, a string and anything else, first line only', () => {
    expect(errorText(new TypeError('bad'))).toBe('TypeError: bad');
    expect(errorText('just a string')).toBe('just a string');
    expect(errorText(42)).toBe('42');
    expect(errorText(new Error('one\ntwo'))).toBe('Error: one');
    expect(errorText('one\ntwo')).toBe('one');
  });
});

describe('watchWindowErrors', () => {
  it('records error events and unhandled rejections until unsubscribed', () => {
    const target = new EventTarget();
    const log = createErrorLog();
    const stop = watchWindowErrors(log, target);
    target.dispatchEvent(Object.assign(new Event('error'), { error: new TypeError('boom') }));
    expect(log.recent()).toEqual(['TypeError: boom']);
    target.dispatchEvent(Object.assign(new Event('error'), { message: 'just a message' }));
    expect(log.recent()).toEqual(['TypeError: boom', 'just a message']);
    target.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: new Error('nope') }),
    );
    expect(log.recent()).toEqual(['TypeError: boom', 'just a message', 'Error: nope']);
    stop();
    target.dispatchEvent(Object.assign(new Event('error'), { message: 'after' }));
    expect(log.recent()).toEqual(['TypeError: boom', 'just a message', 'Error: nope']);
  });
});

describe('the issue form', () => {
  it('has a field for everything the URL prefills, plus the file field', () => {
    const template = readFileSync(
      new URL('../../../../.github/ISSUE_TEMPLATE/bug_report.yml', import.meta.url),
      'utf8',
    );
    const ids = [...template.matchAll(/^\s*id:\s*(\w+)\s*$/gm)].map((m) => m[1] ?? '');
    const sample: IssueFields = {
      title: '',
      what: '',
      steps: '',
      version: '',
      browser: '',
      os: '',
      console: '',
    };
    const expected = [...Object.keys(sample).filter((key) => key !== 'title'), 'file'];
    for (const id of expected) expect(ids).toContain(id);
  });
});
