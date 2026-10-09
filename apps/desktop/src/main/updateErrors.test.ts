import { describe, expect, it } from 'vitest';
import {
  classifyUpdateError,
  firstLine,
  MAX_ERROR_LINE,
  OTHER_PREFIX,
  otherFailureText,
} from './updateErrors';

// The owner's report from the v0.4.1 AppImage (2026-10-09): the draft release is invisible.
const OWNER = new Error(
  'Cannot parse releases feed: Error: Unable to find latest version on GitHub (https://github.com/zoltanf/extrudo/releases/latest), please ensure a production release exists: HttpError: 406\n' +
    '"method: GET url: https://github.com/zoltanf/extrudo/releases.atom\n\n' +
    'Please double check that your authentication token is correct.\n"\n' +
    'Headers: {\n  "server": "GitHub.com",\n  "content-type": "text/html"\n}',
);

describe('classifyUpdateError', () => {
  it('knows the owner’s unpublished-release error', () => {
    expect(classifyUpdateError(OWNER)).toBe('no-release');
  });

  it.each([
    'Unable to find latest version on GitHub',
    'please ensure a production release exists',
    'Cannot find latest-linux.yml in the latest release artifacts (https://x): HttpError: 404',
    'HttpError: 404 Not Found',
    'HttpError: 406',
  ])('treats %s as no release', (message) => {
    expect(classifyUpdateError(new Error(message))).toBe('no-release');
  });

  it.each([
    'getaddrinfo ENOTFOUND github.com',
    'connect ECONNREFUSED 140.82.121.4:443',
    'connect ETIMEDOUT 140.82.121.4:443',
    'net::ERR_INTERNET_DISCONNECTED',
    'net::ERR_NAME_NOT_RESOLVED',
    'read ECONNRESET',
    'getaddrinfo EAI_AGAIN github.com',
  ])('treats %s as offline', (message) => {
    expect(classifyUpdateError(new Error(message))).toBe('offline');
  });

  it('treats anything else as other, strings included', () => {
    expect(classifyUpdateError(new Error('HttpError: 403 rate limit exceeded'))).toBe('other');
    expect(classifyUpdateError('signature mismatch')).toBe('other');
    expect(classifyUpdateError(undefined)).toBe('other');
  });
});

describe('firstLine and otherFailureText', () => {
  it('keeps the first line only', () => {
    expect(firstLine('\n  first\nsecond')).toBe('first');
  });

  it('cuts a long line to 140 characters', () => {
    const line = firstLine('x'.repeat(500));
    expect(line.length).toBe(MAX_ERROR_LINE);
    expect(line.endsWith('…')).toBe(true);
  });

  it('never shows headers or bodies', () => {
    const text = otherFailureText(new Error('HttpError: 403 rate limit\nHeaders: {\n "a": 1\n}'));
    expect(text).toBe(`${OTHER_PREFIX} HttpError: 403 rate limit`);
    expect(text).not.toContain('Headers');
  });

  it('has a sentence for an empty message', () => {
    expect(otherFailureText(new Error(''))).toBe(OTHER_PREFIX);
  });
});
