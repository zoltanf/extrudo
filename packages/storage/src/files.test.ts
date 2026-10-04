import { describe, expect, it } from 'vitest';
import { memoryFiles } from './files';

describe('memoryFiles', () => {
  it('lists the files under a folder, and nothing else', async () => {
    const files = memoryFiles();
    await files.write('projects/a/document.json', new Uint8Array([1]));
    await files.write('projects/a/attachments/aa', new Uint8Array([2]));
    await files.write('projects/a/attachments/bb', new Uint8Array([3]));
    await files.write('projects/ab/document.json', new Uint8Array([4]));
    expect(await files.list('projects/a')).toEqual([
      'projects/a/attachments/aa',
      'projects/a/attachments/bb',
      'projects/a/document.json',
    ]);
    expect(await files.list('projects/a/attachments')).toEqual([
      'projects/a/attachments/aa',
      'projects/a/attachments/bb',
    ]);
    // A folder that isn't there, and one that is a file.
    expect(await files.list('projects/zz')).toEqual([]);
    expect(await files.list('projects/a/document.json')).toEqual([]);
  });

  it('hands out copies, so a caller cannot change what is stored', async () => {
    const files = memoryFiles();
    await files.write('a', new Uint8Array([1, 2]));
    const read = await files.read('a');
    read?.set([9, 9]);
    expect(await files.read('a')).toEqual(new Uint8Array([1, 2]));
  });
});
