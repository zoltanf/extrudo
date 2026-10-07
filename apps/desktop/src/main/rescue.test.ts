import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRescueFile } from './rescue';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'extrudo-rescue-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('rescue copies on disk (P6-01 review)', () => {
  it('keeps copies across instances and clears them', async () => {
    const dir = await tempDir();
    const file = join(dir, 'rescue.json');
    const rescue = createRescueFile(file);
    expect(rescue.list()).toEqual([]);
    expect(rescue.put('p1', '{"name":"A"}')).toBe(true);
    expect(rescue.put('p2', '{"name":"B"}')).toBe(true);
    expect(rescue.list()).toEqual([
      { id: 'p1', raw: '{"name":"A"}' },
      { id: 'p2', raw: '{"name":"B"}' },
    ]);

    // A restart reads what is on disk.
    const reopened = createRescueFile(file);
    expect(reopened.list()).toEqual(rescue.list());

    reopened.clear('p1');
    expect(reopened.list()).toEqual([{ id: 'p2', raw: '{"name":"B"}' }]);
    expect(createRescueFile(file).list()).toEqual([{ id: 'p2', raw: '{"name":"B"}' }]);
  });

  it('starts empty when the file is missing or damaged', async () => {
    const dir = await tempDir();
    expect(createRescueFile(join(dir, 'missing.json')).list()).toEqual([]);
    const damaged = join(dir, 'damaged.json');
    await import('node:fs/promises').then((fs) => fs.writeFile(damaged, 'not json'));
    expect(createRescueFile(damaged).list()).toEqual([]);
  });
});
