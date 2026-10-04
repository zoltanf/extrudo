/**
 * The rib feature in the kernel (P4-10, ADR-0064 §1, FR-FT-17): a thin wall
 * that fills the space between one sketch **line** and the bodies beside it.
 *
 * The line is the rib's open edge — a diagonal on an L-bracket's middle
 * plane — and the wall runs from it to wherever the body is:
 *
 * 1. the line in world mm from the sketch's own output (`frame` and
 *    `lines`, as revolve's axis takes one, ADR-0029), its unit direction
 *    `u`, the plane's normal `n`, and `d = n × u` signed **towards the
 *    body** (the side of the line the material is on, read from the bodies'
 *    centre of mass; `flip` reverses it);
 * 2. `L` = the bodies' box diagonal plus the line's length: the line
 *    extended by `L` at both ends and swept `L` along `d` makes one long
 *    rectangle that starts at the line, and prisms it along `n` by the
 *    thickness (`side`: −t/2…t/2, 0…t or −t…0) with `namedPrism`: **the
 *    slab**;
 * 3. every body is cut out of the slab (`namedBoolean`), which leaves the rib
 *    among the pieces: the one holding the point `m + ε d` at mid-thickness
 *    (the line's midpoint moved a hair into the material side,
 *    ε = 1e-4 × L; found with the exact distance, 0 = inside or on). A line
 *    that lies inside a body says so; a piece that reaches the slab's far
 *    side or either extended end says the rib doesn't close;
 * 4. `operate` joins that piece into the bodies it touches
 *    (`touchingBodies`) and `splitSolids` keeps one body per solid. The piece
 *    is the feature's `previewTools`, so the dialog previews it and a pattern
 *    can repeat it (`repeatableFeatures` counts a rib as a join).
 *
 * Names: the prism's own, under `rib:<id>` — `…:cap:start` (the face on the
 * line), `…:cap:end` (the far side), `…:side:<sketch line>` and
 * `…:side:(<sketch line>:end0|end1)` for the extension's ends — carried
 * through the cut and the join by history, as extrude's are (ADR-0028).
 */
import {
  type FeatureId,
  type GeomRef,
  parseSketchEntityRefId,
  RIB_DEFAULT_THICKNESS,
  type RibInputs,
  type RibSide,
  ribFeature,
  ribSettings,
  sketchToWorld,
} from '@extrudo/core';
import { type Kernel, KernelError, type ShapeHandle, type ShapeScope, type Vec3 } from '../kernel';
import { deriveNames } from '../naming/names';
import { type NamedShape, namedBoolean, namedPrism } from '../naming/ops';
import { LostReferenceError } from '../naming/resolve';
import { parseFace } from '../naming/topo-id';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { splitSolids } from './bodies';
import { type OperationWords, operate } from './operation';
import type { SketchOutputData } from './sketch';
import { add, corners, cross, dot, length, scale, sub, unit } from './vec';

/** Thicknesses (mm) at or below which a rib has none. */
const EPS = 1e-6;
/** How far from the line the probe point sits, as a share of `L`. */
const PROBE = 1e-4;
/** How near the slab's own bounds a piece counts as reaching them, as a share of `L`. */
const REACH = 1e-6;
/** The side of the probe box, mm: small enough to sit in a piece, a solid all the same. */
const PROBE_SIZE = 1e-3;
/** The tolerance the slab's rectangle is built with, mm (as a sketch's faces are). */
const FACE_TOLERANCE = 1e-7;

/** How a rib speaks of itself (the shared operation code, `operation.ts`). */
const WORDS: OperationWords = { noun: 'rib', check: 'Check its line and thickness.' };

/** The one way the rib fails to close against the body, in the user's words. */
const DOESNT_CLOSE =
  "The rib doesn't close against the body: make the line's ends reach it, or flip the rib.";

/**
 * The `data` of a rib's output: the line, the plane and the way it grows, so
 * the dialog's arrows stand where the wall does (ADR-0027) without knowing
 * the kernel's rule for `d`.
 */
export interface RibOutputData {
  /** The line's midpoint in world mm: where the arrows stand. */
  origin: Vec3;
  /** The line's unit direction, from its start to its end. */
  along: Vec3;
  /** The sketch plane's normal: the way the thickness goes for side `one`. */
  normal: Vec3;
  /** The in-plane unit direction the wall grows in (`flip` reverses it). */
  towards: Vec3;
  /** The thickness in mm. */
  thickness: number;
  /** Where the thickness sits about the plane, along `normal` (mm). */
  band: [number, number];
}

export const kernelRib: KernelFeatureDefinition<RibInputs> = {
  ...ribFeature,
  bodyAccess: () => 'write',
  evaluate: evaluateRib,
};

function evaluateRib(ctx: EvalContext<RibInputs>): FeatureOutput {
  const settings = ribSettings(ctx.inputs);
  if (!settings.curve) throw new KernelError('Pick a sketch line for the rib to grow from.');
  const thickness = settings.thickness ? ctx.value('thickness') : RIB_DEFAULT_THICKNESS;
  if (!(thickness > EPS)) throw new KernelError('The thickness must be greater than 0.');
  if (ctx.bodies.size === 0) {
    throw new KernelError("There's no body for the rib to grow on. Draw one first.");
  }
  const line = ribLine(ctx, settings.curve);
  using scope = ctx.kernel.scope();
  const { n, towards } = directions(ctx, line, settings.flip);
  const frame: SlabFrame = {
    towards,
    n,
    band: bandOf(settings.side, thickness),
    L: reach(ctx, line),
  };

  const slab = slabOf(ctx, scope, line, frame);
  const piece = ribPiece(ctx, scope, slab, line, frame);
  const warnings: string[] = [];
  const data: RibOutputData = {
    origin: line.mid,
    along: line.u,
    normal: n,
    towards,
    thickness,
    band: frame.band,
  };
  return {
    ...splitSolids(
      ctx,
      scope,
      operate(ctx, scope, { operation: 'join', bodies: [] }, piece, undefined, warnings, WORDS),
    ),
    data,
    ...(warnings.length ? { warnings } : {}),
  };
}

// ------------------------------------------------------------------ the line

/** The rib's line in world mm: its ends, its middle, its direction and its plane. */
interface RibLine {
  a: Vec3;
  /** The line's midpoint. */
  mid: Vec3;
  /** Its unit direction, from its start to its end. */
  u: Vec3;
  /** How long it is. */
  size: number;
  /** The sketch plane's normal. */
  n: Vec3;
  /** The sketch entity's ID, for the face names. */
  entity: string;
}

/**
 * The line a reference names, placed by the sketch's own output frame (so a
 * sketch on a face works as well as one on an origin plane), from its start
 * to its end.
 */
function ribLine(ctx: EvalContext<RibInputs>, ref: GeomRef): RibLine {
  const parsed = parseSketchEntityRefId(ref.id);
  if (!parsed) throw new KernelError("The rib's curve isn't a sketch line. Pick it again.");
  const data = ctx.output(parsed.feature as FeatureId).data as
    | Partial<SketchOutputData>
    | undefined;
  const line = data?.lines?.[parsed.entity];
  if (!data?.frame || !line) {
    throw new LostReferenceError(
      "Can't find the rib's line any more: an earlier change to its sketch removed it. Edit the rib and pick another line.",
      ref,
    );
  }
  const a = sketchToWorld(data.frame, line[0]);
  const b = sketchToWorld(data.frame, line[1]);
  const along = sub(b, a);
  if (length(along) <= EPS)
    throw new KernelError("The rib's line has no length. Pick another line.");
  return {
    a,
    mid: scale(add(a, b), 0.5),
    u: unit(along),
    size: length(along),
    n: unit(data.frame.normal),
    entity: parsed.entity,
  };
}

/**
 * The plane's normal `n` and the in-plane direction `d` the wall grows in:
 * `n × u`, signed towards the body and reversed by `flip`.
 *
 * "Towards the body" is the side of the line the material is on, read from
 * where the bodies' mass is: the legs of an L are on the corner side of its
 * diagonal, which the middle of their box is not — it lies in the bracket's
 * opening — so it is the centre of mass that decides. A line across the
 * material has both sides; the mass picks the larger one, which `flip`
 * reverses.
 */
function directions(
  ctx: EvalContext<RibInputs>,
  line: RibLine,
  flip: boolean,
): { n: Vec3; towards: Vec3 } {
  const across = cross(line.n, line.u);
  const towards = dot(across, sub(massCentre(ctx), line.mid)) < 0 ? scale(across, -1) : across;
  return { n: line.n, towards: flip ? scale(towards, -1) : towards };
}

/** Where the bodies' mass is: the volume-weighted middle of their centres of mass. */
function massCentre(ctx: EvalContext<RibInputs>): Vec3 {
  let volume = 0;
  const sum: [number, number, number] = [0, 0, 0];
  for (const shape of ctx.bodies.values()) {
    const { volume: v, centroid } = ctx.kernel.properties(shape);
    if (!(v > 0)) continue;
    volume += v;
    for (let k = 0; k < 3; k++) sum[k] = (sum[k] as number) + (centroid[k] as number) * v;
  }
  return volume > 0 ? scale([sum[0], sum[1], sum[2]], 1 / volume) : [0, 0, 0];
}

/** The box around every body (what `L` comes from). */
function unionBox(ctx: EvalContext<RibInputs>): { min: Vec3; max: Vec3 } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const shape of ctx.bodies.values()) {
    const { bbox } = ctx.kernel.measure(shape);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] as number, bbox.min[k] as number);
      max[k] = Math.max(max[k] as number, bbox.max[k] as number);
    }
  }
  return { min, max };
}

/**
 * `L`: how far the slab reaches at either end of the extended line and along
 * `d`, so it covers every body: the bodies' box diagonal plus the line's own
 * length.
 */
function reach(ctx: EvalContext<RibInputs>, line: RibLine): number {
  const { min, max } = unionBox(ctx);
  return length(sub(max, min)) + line.size;
}

/** Where the thickness sits about the sketch plane, along its normal (ADR-0064 §1). */
function bandOf(side: RibSide, thickness: number): [number, number] {
  if (side === 'one') return [0, thickness];
  if (side === 'other') return [-thickness, 0];
  return [-thickness / 2, thickness / 2];
}

// ------------------------------------------------------------------ the slab

/** The slab's own coordinates: `s` along the line, `t` towards the body. */
interface SlabFrame {
  /** The way the wall grows, in the plane: the slab's `t` axis. */
  towards: Vec3;
  /** The plane normal: the thickness runs along it. */
  n: Vec3;
  /** The thickness band along `n`, mm. */
  band: [number, number];
  /** How far the slab reaches at each end of the line and along `towards`. */
  L: number;
}

/**
 * The slab: the line extended by `L` at both ends and swept `L` along `d` —
 * one long rectangle that starts at the line — prisms along `n` by the
 * thickness. Named as a prism (`namedPrism`), so the wall's faces are
 * `rib:<id>:cap:start`, `…:cap:end` and `…:side:…`.
 */
function slabOf(
  ctx: EvalContext<RibInputs>,
  scope: ShapeScope,
  line: RibLine,
  frame: SlabFrame,
): NamedShape {
  const { towards, n, band, L } = frame;
  const corner = sub(line.a, scale(line.u, L));
  const w = line.size + 2 * L;
  const { faces } = ctx.kernel.planarFaces(
    [
      { kind: 'line', a: [0, 0], b: [w, 0] },
      { kind: 'line', a: [w, 0], b: [w, L] },
      { kind: 'line', a: [w, L], b: [0, L] },
      { kind: 'line', a: [0, L], b: [0, 0] },
    ],
    // A right-handed frame whose `x` runs along the line and whose `y`
    // (`normal × x`, and `cross(u, d) × u` is `d`) is the way the wall grows,
    // so the rectangle's own coordinates are `s` along the line and `t`
    // towards the body.
    { origin: corner, x: line.u, normal: cross(line.u, towards) },
    FACE_TOLERANCE,
  );
  for (const face of faces) scope.track(face.shape);
  const face = faces[0];
  if (!face) throw new KernelError("Couldn't make the slab the rib grows in.");
  const slab = namedPrism(ctx.kernel, {
    feature: ctx.feature.id,
    op: WORDS.noun,
    shape: face.shape,
    edgeSources: slabEdgeSources(ctx, face.shape, corner, towards, w, L, line),
    vector: scale(n, band[1] - band[0]),
    shift: scale(n, band[0]),
  });
  scope.track(slab.shape);
  return slab;
}

/**
 * What each edge of the slab's rectangle comes from, by where its middle is:
 * the edge on the line after the sketch line, the extension's two ends after
 * `<line>:end0` and `<line>:end1`, and the far side after nothing (it bounds
 * no body, so no name of the wall's reaches past it).
 */
function slabEdgeSources(
  ctx: EvalContext<RibInputs>,
  face: ShapeHandle,
  corner: Vec3,
  towards: Vec3,
  w: number,
  L: number,
  line: RibLine,
): (string | null)[] {
  return ctx.kernel.describe(face).edges.map((edge) => {
    const p = sub(edge.midpoint, corner);
    const s = dot(p, line.u);
    const t = dot(p, towards);
    // The edge at the smallest distance from a side of the rectangle.
    const side = Math.min(t, L - t, s, w - s);
    if (side === t) return line.entity;
    if (side === s) return `${line.entity}:end0`;
    if (side === w - s) return `${line.entity}:end1`;
    return null;
  });
}

// ------------------------------------------------------------------ the piece

/**
 * The rib: the piece of the slab that holds the line's midpoint moved a hair
 * into the material side at mid-thickness, after every body has been cut out
 * of the slab. Its faces keep the names the cut carried through, so the wall
 * carries `rib:<id>:cap:start` where it stands on the line.
 */
function ribPiece(
  ctx: EvalContext<RibInputs>,
  scope: ShapeScope,
  slab: NamedShape,
  line: RibLine,
  frame: SlabFrame,
): NamedShape {
  const { towards, n, band, L } = frame;
  const { kernel } = ctx;
  // A line in the material has no open side to grow into.
  const middle = probeAt(kernel, scope, line.mid);
  if ([...ctx.bodies.values()].some((shape) => kernel.distance(shape, middle) === 0)) {
    throw new KernelError("The rib's line lies inside the body.");
  }
  let rest = slab;
  for (const [id, shape] of ctx.bodies) {
    rest = namedBoolean(
      kernel,
      'cut',
      rest,
      { shape, names: ctx.names(id) },
      {
        feature: ctx.feature.id,
        op: WORDS.noun,
      },
    );
    scope.track(rest.shape);
  }
  const probe = probeAt(
    kernel,
    scope,
    add(add(line.mid, scale(towards, PROBE * L)), scale(n, (band[0] + band[1]) / 2)),
  );
  const solids = kernel.solids(rest.shape);
  for (const solid of solids) scope.track(solid);
  const piece = solids.find((solid) => kernel.distance(solid, probe) === 0);
  if (!piece) throw new KernelError(DOESNT_CLOSE);
  if (reaches(kernel, piece, line, towards, L)) throw new KernelError(DOESNT_CLOSE);
  const faces = kernel
    .locate(piece, rest.shape, 'face')
    .map((at) => parseFace(rest.names.faces[at] ?? '').stem);
  return { shape: piece, names: deriveNames(faces, kernel.describe(piece)) };
}

/** A tiny box at `at` to ask whether a shape holds it (the exact distance is 0 inside or on). */
function probeAt(kernel: Kernel, scope: ShapeScope, at: Vec3): ShapeHandle {
  return scope.track(
    kernel.box(
      [PROBE_SIZE, PROBE_SIZE, PROBE_SIZE],
      [at[0] - PROBE_SIZE / 2, at[1] - PROBE_SIZE / 2, at[2] - PROBE_SIZE / 2],
    ),
  );
}

/**
 * Whether the piece reaches the slab's own bounds: its far side along `d` or
 * either end of the extended line (in the slab's coordinates, within
 * 1e-6 × L). A rib that does runs past the body instead of closing on it.
 */
function reaches(
  kernel: Kernel,
  piece: ShapeHandle,
  line: RibLine,
  towards: Vec3,
  L: number,
): boolean {
  const { min, max } = kernel.measure(piece).bbox;
  const corner = sub(line.a, scale(line.u, L));
  let s0 = Infinity;
  let s1 = -Infinity;
  let t1 = -Infinity;
  for (const point of corners(min as Vec3, max as Vec3)) {
    const q = sub(point, corner);
    const s = dot(q, line.u);
    s0 = Math.min(s0, s);
    s1 = Math.max(s1, s);
    t1 = Math.max(t1, dot(q, towards));
  }
  const tol = REACH * L;
  return s0 <= tol || s1 >= line.size + 2 * L - tol || t1 >= L - tol;
}
