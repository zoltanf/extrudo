/**
 * The history check (ADR-0144 decision 3, S5): a rebuilt body and the shape
 * the file stores for the same feature are measured by the same kernel code
 * (`ShapeMeasure`) and are the same when they have as many solids, their
 * volume and area are within a relative tolerance, every corner of their
 * tight boxes is within a fraction of the diagonal and so is the distance
 * between their centres of mass (S6). The numbers and why they can't let a
 * wrong body through are in ADR-0144's S5 and S6 amendments.
 */
import type { ShapeMeasure } from './import-kernel';

/** How far a rebuilt body's volume may be from the stored shape's, relative. */
export const HISTORY_VOLUME_TOLERANCE = 1e-6;
/** How far its area may be, relative. */
export const HISTORY_AREA_TOLERANCE = 1e-6;
/** How far a box corner may be, relative to the stored box's diagonal (plus 1e-6 mm). */
export const HISTORY_BOX_TOLERANCE = 1e-4;
/**
 * How far the centre of mass may be, relative to the stored box's diagonal
 * (plus 1e-9 mm). S6 added it: a chamfer and its flipped twin have the same
 * volume, area and box, but not the same centre (ADR-0144's S6 amendment).
 */
export const HISTORY_CENTRE_TOLERANCE = 1e-7;

/**
 * How far a rebuilt body is from a stored shape: relative volume and area,
 * and the largest box corner's move (mm) beside the stored box's diagonal.
 */
export interface Drift {
  readonly volume: number;
  readonly area: number;
  /** The largest move of a box corner, mm. */
  readonly corner: number;
  /** The stored box's diagonal, mm. */
  readonly diagonal: number;
  /** How far the centres of mass are apart, mm. */
  readonly centre: number;
}

const relative = (a: number, b: number) => {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale === 0 ? 0 : Math.abs(a - b) / scale;
};

/** How far `rebuilt` is from `stored`, in the check's terms. */
export function drift(rebuilt: ShapeMeasure, stored: ShapeMeasure): Drift {
  const s = stored.box;
  const corners = [...s.min, ...s.max];
  const after = [...rebuilt.box.min, ...rebuilt.box.max];
  return {
    volume: relative(rebuilt.volume, stored.volume),
    area: relative(rebuilt.area, stored.area),
    corner: Math.max(...corners.map((v, i) => Math.abs(v - (after[i] as number)))),
    diagonal: Math.hypot(...s.max.map((v, i) => v - (s.min[i] as number))),
    centre: Math.hypot(...stored.centre.map((v, i) => v - (rebuilt.centre[i] as number))),
  };
}

/** Why the rebuilt body is not the stored shape, or `undefined` when it is. */
export function historyDisagreement(
  rebuilt: ShapeMeasure,
  stored: ShapeMeasure,
): string | undefined {
  if (rebuilt.solids !== stored.solids)
    return `${stored.solids} solid${stored.solids === 1 ? '' : 's'} stored, ${rebuilt.solids} rebuilt`;
  const d = drift(rebuilt, stored);
  if (!(d.volume <= HISTORY_VOLUME_TOLERANCE))
    return `the volume differs by ${(d.volume * 100).toPrecision(2)} %`;
  if (!(d.area <= HISTORY_AREA_TOLERANCE))
    return `the area differs by ${(d.area * 100).toPrecision(2)} %`;
  if (!(d.corner <= HISTORY_BOX_TOLERANCE * d.diagonal + 1e-6))
    return `the bounding box differs by ${d.corner.toPrecision(3)} mm`;
  if (!(d.centre <= HISTORY_CENTRE_TOLERANCE * d.diagonal + 1e-9))
    return `the centre of mass is ${d.centre.toPrecision(3)} mm away`;
  return undefined;
}

/**
 * The measures of several bodies as one shape: solids, volume and area added
 * up, the boxes' union, the centres weighted by volume (by area when there is
 * no volume, equally when there is neither), as the kernel weighs one shape's.
 */
export function combined(measures: readonly ShapeMeasure[]): ShapeMeasure {
  let solids = 0;
  let volume = 0;
  let area = 0;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const m of measures) {
    solids += m.solids;
    volume += m.volume;
    area += m.area;
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i] as number, m.box.min[i] as number);
      max[i] = Math.max(max[i] as number, m.box.max[i] as number);
    }
  }
  if (measures.length === 0)
    return {
      solids: 0,
      volume: 0,
      area: 0,
      box: { min: [0, 0, 0], max: [0, 0, 0] },
      centre: [0, 0, 0],
    };
  const weight = (m: ShapeMeasure) => (volume !== 0 ? m.volume : area !== 0 ? m.area : 1);
  const total = measures.reduce((t, m) => t + weight(m), 0);
  const centre: [number, number, number] = [0, 0, 0];
  for (const m of measures)
    for (let i = 0; i < 3; i++)
      centre[i] = (centre[i] as number) + ((m.centre[i] as number) * weight(m)) / total;
  return { solids, volume, area, box: { min, max }, centre };
}

export { saneMeasure } from './shapes';
