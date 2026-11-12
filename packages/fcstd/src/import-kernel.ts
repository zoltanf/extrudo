/**
 * What the FreeCAD importer needs from a geometry kernel (ADR-0144 decision
 * 2). The package never imports the kernel: the caller supplies this, the
 * app with a throwaway kernel worker started as an import kernel, tests and
 * the CLI with a kernel in Node. S5 added the rebuild and the stored-shape
 * measure; later slices add to it (describe a body or a stored shape, a
 * persistent reference).
 */
import type { AttachmentId, ExtrudoDocument } from '@extrudo/core';
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

/** What a rebuild found. */
export interface RebuildResult {
  /** Every body at the end of the timeline, in creation order. */
  readonly ids: readonly string[];
  /** The measured bodies (every one of `ids` but the skipped). */
  readonly bodies: Readonly<Record<string, ShapeMeasure>>;
  /** The features whose status is an error, with the kernel's message. */
  readonly failed: readonly { readonly feature: string; readonly message: string }[];
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
   * Reads B-rep text, places it by `chain` (outermost first) and measures
   * it, with no STEP. The same measuring code as `rebuild`'s bodies.
   */
  measureStoredShape(text: string, chain: readonly FcPlacement[]): Promise<ShapeMeasure>;
  /**
   * Recomputes `doc` (the design so far) and measures every body at the end
   * of its timeline but the `skip`ped ones (bodies the importer has settled).
   * `files` are the attachments' bytes; the kernel is sent each one once.
   */
  rebuild(
    doc: ExtrudoDocument,
    files: ReadonlyMap<AttachmentId, Uint8Array>,
    skip?: readonly string[],
  ): Promise<RebuildResult>;
  /**
   * Throws the kernel away and starts a fresh one: after a call that threw,
   * trapped or ran over its time, the old instance may be corrupted. Any call
   * still running on the old one never resolves into a result that is used.
   */
  restart(): Promise<void>;
}
