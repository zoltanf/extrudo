/**
 * Test support (no production code): S13's fixture documents (`final-fixtures.ts`, made with
 * FreeCAD 1.1.4 by our own `scripts/make-final-fixtures.py`) as `.FCStd` bytes, through S11's
 * writer (`part-parts.ts`).
 */
import { inflateSync, strFromU8 } from 'fflate';
import { FINAL_BREP_DEFLATED, FINAL_CASES, FINAL_TOKENS } from './final-fixtures';
import { type PartFileOptions, type PartFixtureSource, partFile } from './part-parts';

let breps: readonly string[] | undefined;
const SOURCE: PartFixtureSource = {
  cases: FINAL_CASES,
  breps: () => {
    if (!breps) {
      const bytes = Uint8Array.from(atob(FINAL_BREP_DEFLATED), (c) => c.charCodeAt(0));
      breps = strFromU8(inflateSync(bytes)).split('\u0000');
    }
    return breps;
  },
  expand: (xml) => {
    let out = xml;
    for (const [token, text] of [...FINAL_TOKENS].reverse()) out = out.split(token).join(text);
    return out;
  },
};

/** One S13 fixture document as `.FCStd` bytes. */
export function finalFile(name: string, options: PartFileOptions = {}): Uint8Array {
  return partFile(name, options, SOURCE);
}

/** One object of an S13 fixture document: FreeCAD's own record of it. */
export function finalObject(name: string, object: string) {
  const o = FINAL_CASES[name]?.objects.find((x) => x.object === object);
  if (!o) throw new Error(`${name}: no ${object}`);
  return o;
}

/** One S13 fixture object's `<Object>` XML, tokens expanded. */
export function finalXml(name: string, object: string): string {
  return SOURCE.expand(finalObject(name, object).xml);
}

/** The stored B-rep text of one S13 fixture object. */
export function finalBrep(name: string, object: string): string {
  const o = finalObject(name, object);
  if (o.stored === undefined) throw new Error(`${name}: ${object} stores no shape`);
  return SOURCE.breps()[o.stored] as string;
}

export const FINAL_DOCUMENTS = Object.keys(FINAL_CASES);
