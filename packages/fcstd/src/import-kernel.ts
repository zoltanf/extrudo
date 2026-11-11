/**
 * What the FreeCAD importer needs from a geometry kernel (ADR-0144 decision
 * 2). The package never imports the kernel: the caller supplies this, the
 * app with a throwaway kernel worker started as an import kernel, tests and
 * the CLI with a kernel in Node. Later slices add to it (rebuild the design
 * so far, describe a body or a stored shape, a persistent reference).
 */
import type { FcPlacement } from './model';

/** What a shape measures: how many solids, their volume, its faces' area, a tight box. */
export interface ShapeMeasure {
  readonly solids: number;
  readonly volume: number;
  readonly area: number;
  readonly box: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
}

/** A stored shape written as STEP and read back, with the shape as read beside it. */
export interface StoredShapeStep extends ShapeMeasure {
  /** The STEP text the kernel's writer made of the placed shape; `''` when it has no solid. */
  readonly step: string;
  /** The placed shape as read from the B-rep text, before STEP. */
  readonly read: ShapeMeasure;
}

export interface ImportKernel {
  /**
   * Reads B-rep text, places it by `chain` (outermost first, as
   * `FinalShape.chain` gives it), writes STEP and reads that back, in one
   * call. Throws when the text is refused or the kernel fails.
   */
  storedShapeToStep(
    text: string,
    chain: readonly FcPlacement[],
    options?: { name?: string; color?: string },
  ): Promise<StoredShapeStep>;
  /**
   * Throws the kernel away and starts a fresh one: after a call that threw,
   * trapped or ran over its time, the old instance may be corrupted. Any call
   * still running on the old one never resolves into a result that is used.
   */
  restart(): Promise<void>;
}
