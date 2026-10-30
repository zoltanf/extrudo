// The STEP round-trip check for converted bodies (ADR-0097's 2026-10-30
// amendment, slice D7): a converted body must survive writing it to STEP and
// reading it back. A plain module the mesh-to-solid tests import; nothing in
// `index.ts`.
import { expect } from 'vitest';
import type { Kernel, ShapeHandle } from './kernel';

/** What `stepRoundTrip` measured, for the sweep's JSON line and the reports. */
export interface StepRoundTrip {
  valid: boolean; // kernel.isValid(back)
  faces: number; // kernel.count(back, 'face')
  solids: number; // kernel.solids(back).length
  volumeRatio: number; // kernel.properties(back).volume / kernel.properties(shape).volume
  bytes: number; // text.length
}

/**
 * Writes `shape` to STEP (`kernel.writeStep([{ shape, name }])`), reads it
 * back (`kernel.readStep`), measures, releases the read-back shape and every
 * solid handle it made. Never throws on a bad result: it measures.
 */
export function stepRoundTrip(kernel: Kernel, shape: ShapeHandle, name = 'Body'): StepRoundTrip {
  const text = kernel.writeStep([{ shape, name }]);
  let back: ShapeHandle | undefined;
  try {
    back = kernel.readStep(text);
    const solids = kernel.solids(back);
    try {
      return {
        valid: kernel.isValid(back),
        faces: kernel.count(back, 'face'),
        solids: solids.length,
        volumeRatio: kernel.properties(back).volume / kernel.properties(shape).volume,
        bytes: text.length,
      };
    } finally {
      kernel.release(...solids);
    }
  } catch {
    // A bad result is a measurement (a read back that won't parse, say), not
    // an error: the callers decide whether it passes.
    return { valid: false, faces: 0, solids: 0, volumeRatio: 0, bytes: text.length };
  } finally {
    if (back) kernel.release(back);
  }
}

/**
 * The bar (slice D7): the read-back body is valid, keeps the face and solid
 * counts, and its volume is the written body's within 1e-4. Throws (a Vitest
 * assertion with the case's name) when it fails; the measurement still comes
 * back for the reports.
 */
export function expectStepRoundTrip(
  kernel: Kernel,
  shape: ShapeHandle,
  name?: string,
): StepRoundTrip {
  const label = name ?? 'the converted body';
  const trip = stepRoundTrip(kernel, shape, name);
  const faces = kernel.count(shape, 'face');
  const solids = kernel.solids(shape);
  try {
    expect(trip.valid, `${label}: read back valid`).toBe(true);
    expect(trip.faces, `${label}: read back faces (${trip.faces} of ${faces})`).toBe(faces);
    expect(trip.solids, `${label}: read back solids (${trip.solids} of ${solids.length})`).toBe(
      solids.length,
    );
    expect(
      Math.abs(trip.volumeRatio - 1),
      `${label}: read back volume within 1e-4 (ratio ${trip.volumeRatio})`,
    ).toBeLessThan(1e-4);
  } finally {
    kernel.release(...solids);
  }
  return trip;
}
