/**
 * The bundled converter (P6-19, ADR-0115): runs only when
 * `node apps/desktop/scripts/fetch-cadmpeg.mjs` has put a binary in
 * `apps/desktop/vendor/cadmpeg/`, and checks it reports the pinned version.
 */
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cadmpegStatus, nodeCadmpegEnv } from './cadmpeg';

const desktop = join(__dirname, '../..');
const vendor = join(desktop, 'vendor/cadmpeg');
const binary = join(vendor, process.platform === 'win32' ? 'cadmpeg.exe' : 'cadmpeg');
const pinned = (
  JSON.parse(readFileSync(join(desktop, 'cadmpeg.json'), 'utf8')) as { version: string }
).version;

describe.skipIf(!existsSync(binary))('the fetched cadmpeg', () => {
  it('is found in the dev checkout and reports the pinned version', () => {
    const status = cadmpegStatus(nodeCadmpegEnv(tmpdir(), undefined, undefined, vendor));
    expect(status).toEqual({ found: true, path: binary, version: pinned });
  });
});
