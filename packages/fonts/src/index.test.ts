import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUNDLED_FONTS, DEFAULT_FONT } from './index.js';

const DIR = join(__dirname, '../fonts');

describe('bundled fonts', () => {
  it('lists IDs that are unique and versioned', () => {
    const ids = BUNDLED_FONTS.map((font) => font.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+@[0-9]+$/);
  });

  it('has a default that is listed first', () => {
    expect(BUNDLED_FONTS[0]?.id).toBe(DEFAULT_FONT);
  });

  it('lists every file in fonts/, each once, with its license text', () => {
    const files = readdirSync(DIR).filter((name) => name.endsWith('.ttf'));
    expect(BUNDLED_FONTS.map((font) => font.file).sort()).toEqual(files.sort());
    const licenses = readdirSync(join(__dirname, '..')).filter((name) => name.startsWith('OFL-'));
    for (const font of BUNDLED_FONTS) {
      const family = `OFL-${font.family.toLowerCase().replace(/[^a-z]/g, '')}.txt`;
      expect(licenses).toContain(family);
    }
  });

  for (const font of BUNDLED_FONTS) {
    it(`has a TrueType file for ${font.id}`, () => {
      const bytes = readFileSync(join(DIR, font.file));
      // TrueType collections start with 'ttcf'; every font here is a single TTF.
      expect([...bytes.subarray(0, 4)]).toEqual([0x00, 0x01, 0x00, 0x00]);
      expect(bytes.length).toBeLessThan(120 * 1024);
    });
  }
});
