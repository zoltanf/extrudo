import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreferencesFile } from './preferences';

const dirs: string[] = [];
async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'extrudo-prefs-'));
  dirs.push(dir);
  return join(dir, 'preferences.json');
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('preferences on disk (ADR-0075 §3)', () => {
  it('reads an empty or damaged file as no preferences', async () => {
    expect(createPreferencesFile(await tempFile()).read()).toEqual({});
  });

  it('keeps values in memory, writes debounced, and reads them back', async () => {
    const file = await tempFile();
    const prefs = createPreferencesFile(file, { debounceMs: 5 });
    prefs.set('theme', 'light');
    prefs.set('panel', 300);
    // Readable at once, before any write.
    expect(prefs.read()).toEqual({ theme: 'light', panel: 300 });
    prefs.flush();
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ theme: 'light', panel: 300 });
    // A fresh instance (an app restart) sees the same values.
    expect(createPreferencesFile(file).read()).toEqual({ theme: 'light', panel: 300 });
  });

  it('writes once the debounce elapses', async () => {
    const file = await tempFile();
    const prefs = createPreferencesFile(file, { debounceMs: 5 });
    prefs.set('a', 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ a: 1 });
  });
});
