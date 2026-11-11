/**
 * A third-party file's stored shape as STEP (P6-25 S3, ADR-0144 decision 5):
 * read the B-rep text, place it, write STEP with our own writer and read that
 * STEP back, all in one call, so the caller can compare what it will import
 * with what the file stored. Only an import's throwaway kernel runs it
 * (`KernelServiceOptions.importKernel`).
 */
import { compose, IDENTITY, type Matrix12 } from './features/matrix';
import { type Kernel, KernelError, type ShapeHandle } from './kernel';

/** A rigid placement: a move, then a turn by a unit quaternion `[x, y, z, w]` (FreeCAD's form). */
export interface ShapePlacement {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
}

/** What a shape measures: the volume of its solids, its faces' area, a tight box. */
export interface StoredShapeMeasure {
  solids: number;
  volume: number;
  area: number;
  box: { min: [number, number, number]; max: [number, number, number] };
}

export interface StoredShapeStep extends StoredShapeMeasure {
  /** The STEP text our writer made of the placed shape. */
  step: string;
  /** The placed shape as read from the B-rep text, before STEP. */
  read: StoredShapeMeasure;
}

export interface StoredShapeOptions {
  /** The STEP product's name. */
  name?: string;
  /** `#rrggbb`, written as the solids' colour. */
  color?: string;
}

/** The 3 × 4 matrix of one placement: `x ↦ R·x + t`. */
export function placementMatrix(p: ShapePlacement): Matrix12 {
  const values = [...p.position, ...p.rotation];
  if (!values.every(Number.isFinite))
    throw new KernelError('A placement has a number that is not finite.');
  const [px, py, pz] = p.position;
  let [x, y, z, w] = p.rotation;
  const n = Math.hypot(x, y, z, w);
  if (n === 0) throw new KernelError('A placement has a zero rotation.');
  [x, y, z, w] = [x / n, y / n, z / n, w / n];
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    px,
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    py,
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
    pz,
  ] as unknown as Matrix12;
}

/** The placements composed, outermost first: `P0 · P1 · … · Pn`. */
export function chainMatrix(chain: readonly ShapePlacement[]): Matrix12 {
  return chain.reduce<Matrix12>((m, p) => compose(m, placementMatrix(p)), IDENTITY);
}

const isIdentity = (m: Matrix12) =>
  m.every((v, i) => Math.abs(v - (IDENTITY[i] as number)) < 1e-15);

function measured(kernel: Kernel, shape: ShapeHandle): StoredShapeMeasure {
  const solids = kernel.solids(shape);
  kernel.release(...solids);
  const { volume, area, bbox } = kernel.properties(shape);
  return {
    solids: solids.length,
    volume,
    area,
    box: { min: [...bbox.min], max: [...bbox.max] },
  };
}

/**
 * Reads `text` (`Kernel.readBrep`'s checks), places it by `chain`, writes it
 * as STEP and reads that back. Every shape is released before it returns or
 * throws. A shape without a solid throws: there is nothing to import.
 */
export function storedShapeToStep(
  kernel: Kernel,
  text: string,
  chain: readonly ShapePlacement[],
  options: StoredShapeOptions = {},
): StoredShapeStep {
  using scope = kernel.scope();
  const matrix = chainMatrix(chain);
  const read = scope.track(kernel.readBrep(text));
  const placed = isIdentity(matrix) ? read : scope.track(kernel.transform(read, matrix).shape);
  const before = measured(kernel, placed);
  if (before.solids === 0) throw new KernelError('The stored shape has no solid.');
  const step = kernel.writeStep([
    {
      shape: placed,
      name: options.name ?? 'Shape',
      ...(options.color !== undefined && { color: options.color }),
    },
  ]);
  const back = scope.track(kernel.readStep(step));
  return { step, ...measured(kernel, back), read: before };
}
