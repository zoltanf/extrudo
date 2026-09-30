// The benchmark fixtures (P2-17, `fixtures/benchmarks/`) are files the app
// itself exported: they read through the archive reader with no migration.
import { describe, expect, it } from 'vitest';
import b1 from '../../../fixtures/benchmarks/b1-plate.extrudo?url&inline';
import b2 from '../../../fixtures/benchmarks/b2-storage-box.extrudo?url&inline';
import b3 from '../../../fixtures/benchmarks/b3-phone-stand.extrudo?url&inline';
import { readArchive } from './archive';

const bytesOf = (dataUrl: string) =>
  Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));

describe('benchmark fixtures', () => {
  it.each([
    ['B1 Plate', b1, ['Sketch1']],
    ['B2 Storage box', b2, ['Sketch1', 'Extrude1', 'Sketch2', 'Extrude2']],
    ['B3 Phone stand', b3, ['Sketch1', 'Extrude1', 'Sketch2', 'Extrude2', 'Combine1']],
  ])('%s opens as it was saved', (name, file, features) => {
    const archive = readArchive(bytesOf(file));
    expect(archive.migrated).toBe(false);
    expect(archive.doc.name).toBe(name);
    expect(archive.doc.features.map((f) => f.name)).toEqual(features);
    expect(archive.doc.timelineMarker).toBe(features.length);
    expect(archive.doc.parameters.length).toBeGreaterThan(3);
    expect(archive.thumbnail?.length).toBeGreaterThan(0);
  });
});
