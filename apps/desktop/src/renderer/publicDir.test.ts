import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../electron.vite.config';

describe('the desktop renderer build', () => {
  it("copies the web app's public folder, so the tooltip clips ship", () => {
    const publicDir = config.renderer?.publicDir;
    expect(publicDir).toBe(resolve(import.meta.dirname, '../../../web/public'));
    expect(existsSync(resolve(publicDir as string, 'demos/sphere.webm'))).toBe(true);
  });
});
