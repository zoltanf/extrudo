/**
 * B-splines for the DXF reader (P4-06, ADR-0066 §1): a `SPLINE` entity's
 * poles and knots, in two jobs — knot insertion (Boehm) turns a spline of
 * degree ≤ 3 into its Bézier pieces exactly, and evaluation samples the ones
 * that can't (rational, or of a degree the drawing type can't hold). No
 * dependency: `@extrudo/io` has none.
 */

/** A B-spline in the flat form DXF writes: degree, poles, knots, weights. */
export interface Spline {
  degree: number;
  poles: [number, number][];
  /** `poles.length + degree + 1` knots, not decreasing. */
  knots: number[];
  /** One weight per pole (1 for a non-rational spline). */
  weights?: number[];
}

/** A Bézier piece: its first point and its three further poles. */
export interface CubicPiece {
  points: [number, number][];
}

/**
 * The `degree + 1` basis functions of a spline that aren't zero at `u`, and the
 * span they start at (Piegl & Tiller A2.2, `BasisFuns`).
 */
function basisFunctions(spline: Spline, u: number): { span: number; values: number[] } {
  const p = spline.degree;
  const { knots, poles } = spline;
  // The span: the last knot index whose knot is at or below u, inside the curve.
  let span = p;
  while (span < poles.length - 1 && (knots[span + 1] as number) <= u) span++;
  const left: number[] = [];
  const right: number[] = [];
  const values: number[] = [1];
  for (let j = 1; j <= p; j++) {
    left[j] = u - (knots[span + 1 - j] as number);
    right[j] = (knots[span + j] as number) - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const denominator = (right[r + 1] as number) + (left[j - r] as number);
      const temp = denominator === 0 ? 0 : (values[r] as number) / denominator;
      values[r] = saved + (right[r + 1] as number) * temp;
      saved = (left[j - r] as number) * temp;
    }
    values[j] = saved;
  }
  return { span, values };
}

/** The point of a spline at `u` (0 to 1, the clamped parameter range). */
export function splinePoint(spline: Spline, u: number): [number, number] {
  const { degree: p, poles, weights } = spline;
  const { span, values } = basisFunctions(spline, u);
  let x = 0;
  let y = 0;
  let total = 0;
  for (let j = 0; j <= p; j++) {
    const index = span - p + j;
    const pole = poles[index] ?? [0, 0];
    const w = weights ? (weights[index] ?? 1) : 1;
    const factor = (values[j] ?? 0) * w;
    x += factor * pole[0];
    y += factor * pole[1];
    total += factor;
  }
  return total === 0 ? [0, 0] : [x / total, y / total];
}

/** Inserts the knot `u` once (Piegl & Tiller A5.1 with r = 1). */
function insertKnot(spline: Spline, u: number): Spline {
  const { degree: p, knots, poles, weights } = spline;
  let k = p;
  while (k < poles.length - 1 && (knots[k + 1] as number) <= u) k++;
  const next: [number, number][] = [];
  const nextWeights: number[] | undefined = weights ? [] : undefined;
  for (let i = 0; i <= poles.length; i++) {
    if (i <= k - p) {
      next.push(poles[i] as [number, number]);
      nextWeights?.push(weights?.[i] as number);
    } else if (i > k) {
      next.push(poles[i - 1] as [number, number]);
      nextWeights?.push(weights?.[i - 1] as number);
    } else {
      const ki = knots[i] as number;
      const a = (u - ki) / ((knots[i + p] as number) - ki);
      const prev = poles[i - 1] as [number, number];
      const cur = poles[i] as [number, number];
      next.push([(1 - a) * prev[0] + a * cur[0], (1 - a) * prev[1] + a * cur[1]]);
      if (nextWeights) {
        const wp = weights?.[i - 1] as number;
        const wc = weights?.[i] as number;
        nextWeights.push((1 - a) * wp + a * wc);
      }
    }
  }
  return {
    degree: p,
    poles: next,
    knots: [...knots.slice(0, k + 1), u, ...knots.slice(k + 1)],
    ...(nextWeights && { weights: nextWeights }),
  };
}

/** A quadratic Bézier's poles as a cubic one's (degree elevation, exact). */
function elevate(poles: [number, number][]): [number, number][] {
  if (poles.length < 3) {
    const [a, b] = poles as [[number, number], [number, number]];
    return [
      a,
      [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3],
      [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3],
      b,
    ];
  }
  const [p0, p1, p2] = poles as [[number, number], [number, number], [number, number]];
  return [
    p0,
    [(p0[0] + 2 * p1[0]) / 3, (p0[1] + 2 * p1[1]) / 3],
    [(2 * p1[0] + p2[0]) / 3, (2 * p1[1] + p2[1]) / 3],
    p2,
  ];
}

/**
 * A spline of degree ≤ 3 as its Bézier pieces, exactly: every interior knot
 * is raised to the degree's multiplicity, so each knot span is one piece.
 * Degree 2 pieces are elevated to cubics, degree 1 left as lines. `undefined`
 * for a degree the drawing type can't hold (and for a rational spline, whose
 * pieces aren't polynomial — `sampleSpline` handles those).
 */
export function splinePieces(spline: Spline): CubicPiece[] | undefined {
  const { degree, knots } = spline;
  if (degree < 1 || degree > 3 || spline.weights?.some((w) => w !== 1)) return undefined;
  const breaks = [...new Set(knots)].slice(1, -1);
  let raised = spline;
  for (const u of breaks) {
    const multiplicity = raised.knots.filter((k) => k === u).length;
    for (let m = multiplicity; m < degree; m++) raised = insertKnot(raised, u);
  }
  return breaks.concat(1).map((_end, j) => {
    const slice = raised.poles.slice(j * degree, j * degree + degree + 1);
    return { points: (degree === 3 ? slice : elevate(slice)) as [number, number][] };
  });
}

/**
 * A spline sampled into cubic Bézier pieces, 16 per knot span: for the splines
 * `splinePieces` can't convert exactly (rational weights, or a degree above 3),
 * which is as close as a drawing's Bézier can get.
 */
export function sampleSpline(spline: Spline, perSpan = 16): CubicPiece[] {
  const spans = Math.max(1, new Set(spline.knots).size - 1);
  const points: [number, number][] = [];
  for (let i = 0; i <= spans * perSpan; i++)
    points.push(splinePoint(spline, i / (spans * perSpan)));
  return catmullRom(points);
}

/**
 * Cubic Bézier pieces through `points`: each piece's inner poles are a
 * Catmull-Rom tangent, so the curve passes through every point and its ends
 * are the first and last ones.
 */
function catmullRom(points: [number, number][]): CubicPiece[] {
  const out: CubicPiece[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const p0 = points[i - 1] ?? (points[i] as [number, number]);
    const p1 = points[i] as [number, number];
    const p2 = points[i + 1] as [number, number];
    const p3 = points[i + 2] ?? p2;
    out.push({
      points: [
        p1,
        [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
        [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
        p2,
      ],
    });
  }
  return out;
}
