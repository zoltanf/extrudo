/**
 * Each sketch is decoded once per import (P6-25 S5, the review's fix round):
 * a revolve's axis lookup and `addSketch` share one decode.
 */
import { cylinderBrep } from '@extrudo/kernel/brep-test-support';
import { describe, expect, it, vi } from 'vitest';
import { facingX, historyFile, rectangle } from './history-fixtures';
import { importFcstd } from './import';
import { nodeImportKernel } from './node-kernel-test-support';
import * as decode from './sketch-decode';

vi.mock('./sketch-decode', async (original) => {
  const real = await original<typeof import('./sketch-decode')>();
  return { ...real, decodeSketch: vi.fn(real.decodeSketch) };
});

describe('a revolve’s sketch', () => {
  it('is decoded once, for the axis and for addSketch', async () => {
    const r = await importFcstd(
      historyFile([
        {
          name: 'Body',
          sketches: [
            {
              name: 'Sketch',
              geometry: rectangle(0, 0, 10, 100),
              placement: facingX(-59.16, 59.16, 0),
            },
          ],
          features: [
            {
              name: 'Revolution',
              type: 'Revolution',
              axis: { object: 'Sketch', subs: ['Edge4'] },
              stored: cylinderBrep(100),
            },
          ],
        },
      ]),
      'History',
      { kernel: nodeImportKernel() },
    );
    expect(r.report.bodies[0]?.outcome).toBe('history');
    expect(vi.mocked(decode.decodeSketch)).toHaveBeenCalledTimes(1);
  });
});
