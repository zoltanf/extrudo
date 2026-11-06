import { describe, expect, it } from 'vitest';
import config from '../../electron.vite.config';

// The renderer is the web app rebuilt with this config, not apps/web's: a Vite plugin the web
// build needs has to be here too, or the desktop build fails (v0.10.0's first tag did, ADR-0133).
describe('the desktop renderer build', () => {
  it("has the web build's release-notes plugin", () => {
    const renderer = (config as { renderer?: { plugins?: unknown[] } }).renderer;
    const names = (renderer?.plugins ?? [])
      .flat(Number.POSITIVE_INFINITY)
      .map((p) => (p as { name?: string } | null)?.name);
    expect(names).toContain('extrudo-release-notes');
  });
});
