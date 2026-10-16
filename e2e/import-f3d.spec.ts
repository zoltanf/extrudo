import { expect, type Page, test } from '@playwright/test';

// The .f3d import runs in its own module worker (ADR-0083, 2026-10-16). The file
// is built here, never a sample: a stored ZIP with one design segment that
// decodes to an empty design (the same segment as packages/f3d's archive tests).

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** A design segment with no records. */
function metaStream(): number[] {
  const out: number[] = [];
  const u32 = (v: number) =>
    out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  const str8 = (s: string) => {
    const b = [...Buffer.from(s)];
    u32(b.length);
    out.push(...b);
  };
  str8('Design1');
  u32(1); // segment id
  u32(0); // asset GUID (empty)
  u32(0); // serializer magic: not 1234, so four reserved bytes
  u32(0);
  str8(''); // segment type name
  str8(''); // add-in name
  u32(0);
  u32(0); // segment type code + reserved
  u32(0); // type count
  u32(0); // named records
  u32(0); // primary index
  u32(0); // secondary index
  return out;
}

/** A ZIP of stored (uncompressed) entries; the importer doesn't check CRCs. */
function storedZip(entries: Record<string, number[]>): Buffer {
  const locals: number[] = [];
  const central: number[] = [];
  const u16 = (a: number[], v: number) => a.push(v & 0xff, (v >>> 8) & 0xff);
  const u32 = (a: number[], v: number) => {
    u16(a, v & 0xffff);
    u16(a, v >>> 16);
  };
  for (const [name, data] of Object.entries(entries)) {
    const n = [...Buffer.from(name)];
    const offset = locals.length;
    u32(locals, 0x04034b50);
    for (const v of [20, 0, 0, 0, 0]) u16(locals, v); // version, flags, method 0, time, date
    for (const v of [0, data.length, data.length]) u32(locals, v); // crc, sizes
    u16(locals, n.length);
    u16(locals, 0);
    locals.push(...n, ...data);
    u32(central, 0x02014b50);
    for (const v of [20, 20, 0, 0, 0, 0]) u16(central, v);
    for (const v of [0, data.length, data.length]) u32(central, v);
    for (const v of [n.length, 0, 0, 0, 0]) u16(central, v);
    u32(central, 0); // external attributes
    u32(central, offset);
    central.push(...n);
  }
  const end: number[] = [];
  u32(end, 0x06054b50);
  const count = Object.keys(entries).length;
  for (const v of [0, 0, count, count]) u16(end, v);
  u32(end, central.length);
  u32(end, locals.length);
  u16(end, 0);
  return Buffer.from([...locals, ...central, ...end]);
}

async function importF3d(page: Page, name: string, buffer: Buffer) {
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…', exact: true }).click(),
  ]);
  await chooser.setFiles({ name, mimeType: 'application/octet-stream', buffer });
}

test('an .f3d file is imported in its own worker and opens as a new design', async ({ page }) => {
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  const file = storedZip({
    'Asset/Design1/MetaStream.dat': metaStream(),
    'Asset/Design1/BulkStream.dat': [],
  });
  await importF3d(page, 'Empty part.f3d', file);
  await expect(page).toHaveURL(/#\/p\/[^/]+$/);
  await expect(
    page.getByText('Imported from the .f3d file: 0 of 0 timeline features.'),
  ).toBeVisible();
  expect(workers.some((url) => /f3dWorker/.test(url))).toBe(true);
});

test("a file that isn't an .f3d says why, and the page stays", async ({ page }) => {
  await importF3d(page, 'Broken.f3d', Buffer.from('not a zip at all, just text'));
  await expect(page.getByRole('alert')).toContainText(
    'Import failed: Not a ZIP archive (no end of central directory).',
  );
  await expect(page.getByRole('button', { name: 'Import…', exact: true })).toBeEnabled();
});
