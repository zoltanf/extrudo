import { describe, expect, it } from 'vitest';
import { FILE_EXTENSION, FORMAT_NAME, FORMAT_VERSION } from './index';

describe('format constants', () => {
  it('name the format and file extension consistently', () => {
    expect(FORMAT_NAME).toBe('extrudo');
    expect(FILE_EXTENSION).toBe(`.${FORMAT_NAME}`);
  });

  it('are at format version 2', () => {
    expect(FORMAT_VERSION).toBe(2);
  });
});
