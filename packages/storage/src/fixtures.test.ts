// The benchmark fixtures (P2-17, `fixtures/benchmarks/`) are files the app
// itself exported: they read through the archive reader with no migration.
import { describe, expect, it } from 'vitest';
import b1 from '../../../fixtures/benchmarks/b1-plate.extrudo?url&inline';
import b2 from '../../../fixtures/benchmarks/b2-storage-box.extrudo?url&inline';
import b3 from '../../../fixtures/benchmarks/b3-phone-stand.extrudo?url&inline';
import b4 from '../../../fixtures/benchmarks/b4-box-with-lid.extrudo?url&inline';
import b5 from '../../../fixtures/benchmarks/b5-pcb-enclosure.extrudo?url&inline';
import b6 from '../../../fixtures/benchmarks/b6-wall-hook.extrudo?url&inline';
import b7 from '../../../fixtures/benchmarks/b7-knurled-knob.extrudo?url&inline';
import { readArchive } from './archive';

const bytesOf = (dataUrl: string) =>
  Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));

describe('benchmark fixtures', () => {
  it.each([
    ['B1 Plate', b1, ['Sketch1']],
    ['B2 Storage box', b2, ['Sketch1', 'Extrude1', 'Sketch2', 'Extrude2']],
    ['B3 Phone stand', b3, ['Sketch1', 'Extrude1', 'Sketch2', 'Extrude2', 'Combine1']],
    [
      'B4 Box with lid',
      b4,
      ['Offset Plane1', 'Box1', 'Shell1', 'Chamfer1', 'Box2', 'Box3', 'Fillet1'],
    ],
    [
      'B5 PCB enclosure',
      b5,
      [
        'Box1',
        'Shell1',
        'Cylinder1',
        'Hole1',
        'Rectangular Pattern1',
        'Box2',
        'Hole2',
        'Hole3',
        'Mirror1',
      ],
    ],
    ['B6 Wall hook', b6, ['Box1', 'Box2', 'Box3', 'Draft1', 'Fillet1']],
    [
      'B7 Knurled knob',
      b7,
      ['Sketch1', 'Revolve1', 'Chamfer1', 'Cylinder1', 'Circular Pattern1', 'Hole1'],
    ],
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
