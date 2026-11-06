import { describe, expect, it, vi } from 'vitest';
import { memoryPreferences } from '../platform/preferences';
import {
  announceUpdate,
  checkWhatsNew,
  compareVersions,
  updatedText,
  WHATS_NEW_ACTION,
  WHATS_NEW_KEY,
  whatsNewStore,
} from './whatsNew';

const stable = { channel: 'stable' as const, version: '0.10.0', returning: true };
const notes = { version: '0.10.0', highlights: ['**A**'], changes: [] };

describe("What's new (ADR-0133)", () => {
  it('compares versions by number, ignoring the build suffix', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.9.1', '0.9.0')).toBe(1);
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
    expect(compareVersions('0.10.0+edge.3', '0.10.0')).toBe(0);
    expect(compareVersions('0.8.3', '0.9.0')).toBe(-1);
  });

  it('announces an update once, and records it', () => {
    const prefs = memoryPreferences({ [WHATS_NEW_KEY]: '0.9.0' });
    expect(checkWhatsNew(prefs, stable)).toBe(true);
    expect(prefs.get(WHATS_NEW_KEY, null)).toBe('0.10.0');
    expect(checkWhatsNew(prefs, stable)).toBe(false);
  });

  it('a returning user of a version without it hears about the update', () => {
    expect(checkWhatsNew(memoryPreferences(), stable)).toBe(true);
  });

  it('a first install only records the version', () => {
    const prefs = memoryPreferences();
    expect(checkWhatsNew(prefs, { ...stable, returning: false })).toBe(false);
    expect(prefs.get(WHATS_NEW_KEY, null)).toBe('0.10.0');
  });

  it('a downgrade says nothing but is recorded', () => {
    const prefs = memoryPreferences({ [WHATS_NEW_KEY]: '0.11.0' });
    expect(checkWhatsNew(prefs, stable)).toBe(false);
    expect(prefs.get(WHATS_NEW_KEY, null)).toBe('0.10.0');
  });

  it('edge builds never announce or record', () => {
    const prefs = memoryPreferences({ [WHATS_NEW_KEY]: '0.9.0' });
    expect(checkWhatsNew(prefs, { ...stable, channel: 'edge', version: '0.10.0+edge.4' })).toBe(
      false,
    );
    expect(prefs.get(WHATS_NEW_KEY, null)).toBe('0.9.0');
  });

  it('dev builds compare the base version', () => {
    const prefs = memoryPreferences({ [WHATS_NEW_KEY]: '0.9.0' });
    expect(checkWhatsNew(prefs, { ...stable, channel: 'dev', version: '0.10.0+dev.2' })).toBe(true);
    expect(prefs.get(WHATS_NEW_KEY, null)).toBe('0.10.0');
  });

  it('the toast says the version and its button opens the dialog', async () => {
    const push = vi.fn();
    const prefs = memoryPreferences({ [WHATS_NEW_KEY]: '0.9.0' });
    expect(await announceUpdate(prefs, stable, push, async () => notes)).toBe(true);
    expect(push).toHaveBeenCalledOnce();
    const [tone, text, options] = push.mock.calls[0] ?? [];
    expect(tone).toBe('info');
    expect(text).toBe(updatedText('0.10.0'));
    expect(options.action.label).toBe(WHATS_NEW_ACTION);
    whatsNewStore.setState({ open: false });
    options.action.run();
    expect(whatsNewStore.getState().open).toBe(true);
  });

  it('no toast without notes, or when the notes fail to load', async () => {
    const push = vi.fn();
    expect(await announceUpdate(memoryPreferences(), stable, push, async () => null)).toBe(false);
    expect(
      await announceUpdate(memoryPreferences(), stable, push, () => Promise.reject(new Error())),
    ).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
});
