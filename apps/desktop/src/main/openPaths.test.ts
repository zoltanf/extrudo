import { describe, expect, it } from 'vitest';
import {
  createOpenQueue,
  extrudoPathFromArgv,
  isExtrudoPath,
  isGzippedExtrudoPath,
} from './openPaths';

describe('extrudoPathFromArgv (P6-01 slice 2)', () => {
  it('finds an .extrudo path among the arguments, case-insensitively', () => {
    expect(extrudoPathFromArgv(['/usr/bin/extrudo', '.', '/tmp/Bracket.EXTRUDO'])).toBe(
      '/tmp/Bracket.EXTRUDO',
    );
    expect(extrudoPathFromArgv(['electron', '--inspect', '/tmp/a.extrudo'])).toBe('/tmp/a.extrudo');
  });

  it('ignores flags and arguments that are not .extrudo files', () => {
    expect(extrudoPathFromArgv(['electron', '.', '--remote-debugging-port=9333'])).toBeUndefined();
    expect(extrudoPathFromArgv([])).toBeUndefined();
  });

  it('only treats an .extrudo name as one (finding 5)', () => {
    expect(isExtrudoPath('/tmp/a.extrudo')).toBe(true);
    expect(isExtrudoPath('/tmp/A.EXTRUDO')).toBe(true);
    expect(isExtrudoPath('/tmp/a.extrudo.bak')).toBe(false);
    expect(isExtrudoPath('/tmp/a.txt')).toBe(false);
    expect(isExtrudoPath('')).toBe(false);
  });

  it('takes a gzipped .extrudo too, and tells it apart', () => {
    expect(isExtrudoPath('/tmp/a.extrudo.gz')).toBe(true);
    expect(isExtrudoPath('/tmp/A.EXTRUDO.GZ')).toBe(true);
    expect(isExtrudoPath('/tmp/a.stl.gz')).toBe(false);
    expect(isGzippedExtrudoPath('/tmp/a.extrudo.gz')).toBe(true);
    expect(isGzippedExtrudoPath('/tmp/a.extrudo')).toBe(false);
  });
});

describe('open queue (P6-01 slice 2)', () => {
  it('holds a path until it is delivered and the renderer is ready, then flushes', () => {
    const delivered: string[] = [];
    const queue = createOpenQueue();
    queue.push('/a.extrudo');
    queue.push('/b.extrudo');
    expect(delivered).toEqual([]);

    queue.deliverWith((path) => delivered.push(path));
    expect(delivered).toEqual([]);
    queue.ready();
    expect(delivered).toEqual(['/a.extrudo', '/b.extrudo']);
  });

  it('delivers at once once ready and delivered', () => {
    const delivered: string[] = [];
    const queue = createOpenQueue();
    queue.deliverWith((path) => delivered.push(path));
    queue.ready();
    queue.push('/c.extrudo');
    expect(delivered).toEqual(['/c.extrudo']);
  });
});
