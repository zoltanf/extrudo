/**
 * Test support (no production code): S8's fixture parts (`step-fixtures.ts`,
 * made with FreeCAD 1.1.4 by our own script) as `.FCStd` bytes, through S7's
 * writer (`pattern-parts.ts`).
 */
import { type FixtureSet, type PartChange, type PartOptions, partFile } from './pattern-parts';
import { STEP_BREP, STEP_CASES, STEP_PROPS } from './step-fixtures';

export const STEP_FIXTURES: FixtureSet = { cases: STEP_CASES, brep: STEP_BREP, props: STEP_PROPS };

/** The names of every S8 fixture part. */
export const STEP_PARTS = Object.keys(STEP_CASES);

/** One S8 fixture part as `.FCStd` bytes. */
export function stepFile(name: string, change: PartChange = {}, options: PartOptions = {}) {
  return partFile(name, change, { fixtures: STEP_FIXTURES, ...options });
}
