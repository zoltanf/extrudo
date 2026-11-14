/**
 * Test support (no production code): S9's fixture parts
 * (`reference-fixtures.ts`, made with FreeCAD 1.1.4 by our own script) as
 * `.FCStd` bytes, through S7's writer (`pattern-parts.ts`).
 */
import { type FixtureSet, type PartChange, type PartOptions, partFile } from './pattern-parts';
import { REF_BREP, REF_CASES, REF_PROPS } from './reference-fixtures';

export const REF_FIXTURES: FixtureSet = { cases: REF_CASES, brep: REF_BREP, props: REF_PROPS };

/** The names of every S9 fixture part. */
export const REF_PARTS = Object.keys(REF_CASES);

/** One S9 fixture part as `.FCStd` bytes. */
export function refFile(name: string, change: PartChange = {}, options: PartOptions = {}) {
  return partFile(name, change, { fixtures: REF_FIXTURES, ...options });
}
