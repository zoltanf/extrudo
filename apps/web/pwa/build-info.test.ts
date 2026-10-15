import { describe, expect, it } from 'vitest';
import { buildInfo } from './build-info';

/** A fake git: `describe` answers what `git describe --long --dirty` would. */
const fakeGit =
  (describe: string | undefined, head: string | undefined = 'abc1234') =>
  (args: string[]) =>
    args[0] === 'describe' ? describe : args[0] === 'rev-parse' ? head : undefined;

describe('buildInfo', () => {
  it('is the plain version when HEAD is the tag, on every channel', () => {
    for (const channel of ['stable', 'edge', 'dev']) {
      const info = buildInfo('0.6.1', { EXTRUDO_CHANNEL: channel }, fakeGit('v0.6.1-0-gabc1234'));
      expect(info.version).toBe('0.6.1');
      expect(info.commit).toBe('abc1234');
    }
  });

  it('adds the commits since the tag as build metadata on edge and dev', () => {
    const git = fakeGit('v0.6.1-17-gabc1234');
    expect(buildInfo('0.6.1', { EXTRUDO_CHANNEL: 'edge' }, git).version).toBe('0.6.1+edge.17');
    expect(buildInfo('0.6.1', {}, git).version).toBe('0.6.1+dev.17');
    expect(buildInfo('0.6.1', { EXTRUDO_CHANNEL: 'stable' }, git).version).toBe('0.6.1');
  });

  it('flags uncommitted changes', () => {
    const info = buildInfo('0.6.1', {}, fakeGit('v0.6.1-3-gabc1234-dirty'));
    expect(info.dirty).toBe(true);
    expect(info.version).toBe('0.6.1+dev.3');
    expect(buildInfo('0.6.1', {}, fakeGit('v0.6.1-3-gabc1234')).dirty).toBe(false);
  });

  it('falls back to the package version without git', () => {
    const none = buildInfo('0.6.1', { EXTRUDO_CHANNEL: 'edge' }, () => undefined);
    expect(none.version).toBe('0.6.1');
    expect(none.commit).toBe('');
    const head = buildInfo('0.6.1', {}, fakeGit(undefined, 'def5678901'));
    expect(head.version).toBe('0.6.1');
    expect(head.commit).toBe('def5678');
  });

  it('treats an unknown EXTRUDO_CHANNEL as dev', () => {
    expect(buildInfo('0.6.1', { EXTRUDO_CHANNEL: 'beta' }, fakeGit(undefined)).channel).toBe('dev');
    expect(buildInfo('0.6.1', { EXTRUDO_CHANNEL: '' }, fakeGit(undefined)).channel).toBe('dev');
  });
});
