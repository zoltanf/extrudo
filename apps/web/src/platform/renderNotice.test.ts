import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryPreferences } from './preferences';
import {
  resetSoftwareNoticeSession,
  SOFTWARE_NOTICE_PREFERENCE,
  SOFTWARE_NOTICE_TEXT,
  showSoftwareNotice,
} from './renderNotice';

const software = { kind: 'software', reason: 'x' } as const;

describe('showSoftwareNotice', () => {
  beforeEach(resetSoftwareNoticeSession);

  it('shows nothing for hardware or no WebGL', () => {
    const push = vi.fn();
    expect(showSoftwareNotice({ kind: 'hardware' }, memoryPreferences(), push)).toBe(false);
    expect(showSoftwareNotice({ kind: 'none', reason: 'x' }, memoryPreferences(), push)).toBe(
      false,
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('shows once per session', () => {
    const push = vi.fn();
    const prefs = memoryPreferences();
    expect(showSoftwareNotice(software, prefs, push)).toBe(true);
    expect(showSoftwareNotice(software, prefs, push)).toBe(false);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]?.[0]).toBe('info');
    expect(push.mock.calls[0]?.[1]).toBe(SOFTWARE_NOTICE_TEXT);
  });

  it("'Don't show again' stores the preference and stops applying", () => {
    const push = vi.fn();
    const prefs = memoryPreferences();
    showSoftwareNotice(software, prefs, push);
    const action = push.mock.calls[0]?.[2].action;
    expect(action.available()).toBe(true);
    action.run();
    expect(prefs.get(SOFTWARE_NOTICE_PREFERENCE, '')).toBe('dismissed');
    expect(action.available()).toBe(false);
  });

  it('respects a stored dismissal', () => {
    const push = vi.fn();
    const prefs = memoryPreferences({ [SOFTWARE_NOTICE_PREFERENCE]: 'dismissed' });
    expect(showSoftwareNotice(software, prefs, push)).toBe(false);
  });
});
