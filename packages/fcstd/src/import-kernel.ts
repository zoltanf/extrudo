/**
 * What the FreeCAD importer needs from a geometry kernel (ADR-0144 decision
 * 2). The package never imports the kernel: the caller supplies this, the
 * app with a throwaway kernel worker started as an import kernel, tests and
 * the CLI with a kernel in Node. S5 added the rebuild and the stored-shape
 * measure; S6 describing a stored shape's and a rebuilt body's edges and
 * faces, and the persistent reference of one of the body's.
 */
import type { AttachmentId, ExtrudoDocument, GeomRef } from '@extrudo/core';
import type { FcPlacement } from './model';

/** What a shape measures: how many solids, their volume, its faces' area, a tight box, its centre of mass. */
export interface ShapeMeasure {
  readonly solids: number;
  readonly volume: number;
  readonly area: number;
  readonly box: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
  /** The centre of mass of its solids (of its faces without solids, the origin without either), mm. */
  readonly centre: readonly [number, number, number];
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

type Vec3 = readonly [number, number, number];

/** An edge described for matching (S6), world mm: the kernel's `ElementEdge`. */
export interface ElementEdge {
  /** 0-based, in the shape's `TopExp::MapShapes` order. */
  readonly index: number;
  /** `line`, `circle`, `ellipse`, `bspline` … or `degenerate`. */
  readonly type: string;
  readonly length: number;
  readonly midpoint: Vec3;
  /** Its two ends (none for a degenerate edge), only where it was described in detail. */
  readonly ends?: readonly Vec3[];
  /** A line's direction, a circle's axis, else the middle tangent (either sign). */
  readonly direction?: Vec3;
  /** A circle's or ellipse's centre and (major) radius. */
  readonly centre?: Vec3;
  readonly radius?: number;
  /** The distinct faces it bounds, by index. */
  readonly faces: readonly number[];
}

/** A face described for matching (S6). */
export interface ElementFace {
  readonly index: number;
  /** `plane`, `cylinder` … */
  readonly type: string;
  readonly area: number;
  readonly centroid: Vec3;
  readonly direction?: Vec3;
  /** Its edges, by index. */
  readonly edges: readonly number[];
}

/** A shape's counts and the edges and faces described. */
export interface ShapeElements {
  readonly edgeCount: number;
  readonly faceCount: number;
  readonly edges: readonly ElementEdge[];
  readonly faces: readonly ElementFace[];
  /** Set, with nothing described, when there were more edges to describe than the kernel's cap. */
  readonly over?: number;
}

/** One sub-shape of a rebuilt body, for `references`. */
export interface SubShapeAt {
  readonly body: string;
  readonly kind: 'edge' | 'face';
  readonly index: number;
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
   * Reads B-rep text, places it by `chain` and describes the edges and faces
   * asked for (0-based), with the faces each edge bounds and the edges of
   * each face; indices out of range are left out. The same describing code
   * as `describeBodies`.
   */
  describeStoredShape(
    text: string,
    chain: readonly FcPlacement[],
    ask: { readonly edges: readonly number[]; readonly faces: readonly number[] },
  ): Promise<ShapeElements>;
  /**
   * Every edge and face of bodies of the last `rebuild`, by ID; in detail
   * (ends, circle) the edges whose midpoints lie within `near.radius` of one
   * of `near.points`.
   */
  describeBodies(
    bodies: readonly string[],
    near: { readonly points: readonly Vec3[]; readonly radius: number },
  ): Promise<Readonly<Record<string, ShapeElements>>>;
  /**
   * The persistent reference (ADR-0005) of each sub-shape of a body of the
   * last `rebuild`, as the app stores one for a picked edge or face;
   * `undefined` where there is none.
   */
  references(items: readonly SubShapeAt[]): Promise<readonly (GeomRef | undefined)[]>;
  /**
   * Throws the kernel away and starts a fresh one: after a call that threw,
   * trapped or ran over its time, the old instance may be corrupted. Any call
   * still running on the old one never resolves into a result that is used.
   */
  restart(): Promise<void>;
}
