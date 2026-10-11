/**
 * Threads (`584D9526…`). The thread's own members, after the prologue and an
 * empty property block (offset 6) or right after the prologue (offset 2):
 *
 *   f64 profile angle (deg: 60 metric, 55 pipe)
 *   u8 external (1: on a shaft, 0: in a hole)
 *   wstr class ("6g", "6H", "A"), wstr designation ("M10x1.5", "G 1/2-14"),
 *   wstr size ("10.0", "1/2"), wstr family ("ISO Metric profile", …)
 *   u8 full length (0: `ThreadLength` and `ThreadOffset` are parameters it owns)
 *   u32 1 or 2 (not known)
 *   f64 major diameter, f64 minor diameter (cm), u8, f64 pitch (cm), f64 pitch diameter (cm)
 *
 * The face it threads is a face operand in an operand group, its recipe
 * naming the face first.
 */
import { Reader } from '../bytes';
import type { Segment } from '../segment';
import type { Scope } from './scope';

export const THREAD = '584D9526-EF22-4F6F-9FE1-5FCF1F3CE575';

export interface ThreadSpec {
  /** The tooth's angle, degrees. */
  angle: number;
  external: boolean;
  designation: string;
  family: string;
  /** Threads the whole face (else `ThreadLength` from `ThreadOffset`). */
  full: boolean;
  /** Diameters and pitch, cm. */
  major: number;
  minor: number;
  pitch: number;
}

export function readThreadSpec(seg: Segment, scope: Scope): ThreadSpec | undefined {
  for (const at of [6, 2]) {
    try {
      const r = new Reader(seg.bulk, scope.start + at, scope.end);
      const angle = r.f64();
      if (!(angle >= 20 && angle <= 90)) continue;
      const external = r.u8();
      r.wstr(64); // class
      const designation = r.wstr(128);
      r.wstr(64); // size
      const family = r.wstr(128);
      const full = r.u8();
      r.u32();
      const major = r.f64();
      const minor = r.f64();
      r.u8();
      const pitch = r.f64();
      if (external > 1 || full > 1 || !(major > minor && minor > 0 && pitch > 0 && pitch < major))
        continue;
      return {
        angle,
        external: external === 1,
        designation,
        family,
        full: full === 1,
        major,
        minor,
        pitch,
      };
    } catch {
      // not at this offset
    }
  }
  return undefined;
}
