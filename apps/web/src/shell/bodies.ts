/**
 * The bodies the browser lists and the view names (P2-06, ADR-0028): the
 * model's live bodies, which the kernel makes (`<feature>:<n>` IDs), with
 * the document's metadata (`doc.bodies`: name, colour, visibility) where it
 * has an entry. A body without one is shown as "Body<n>", numbered in
 * timeline order, until something stores metadata for it (its eye, P2-08's
 * rename). Metadata of bodies that no longer exist is kept but not listed.
 */
import type { BodyId, BodyMeta, ExtrudoDocument } from '@extrudo/core';

export interface BodyEntry {
  id: BodyId;
  meta: BodyMeta;
  /** Whether `meta` is stored in the document (false: a derived name). */
  stored: boolean;
}

/** The live bodies in timeline order (the feature that made each, then its number). */
export function bodyEntries(
  doc: Pick<ExtrudoDocument, 'bodies' | 'features'>,
  live: Readonly<Record<BodyId, unknown>>,
): BodyEntry[] {
  const order = new Map(doc.features.map((f, i) => [f.id as string, i]));
  const key = (id: BodyId) => {
    const at = id.lastIndexOf(':');
    const feature = at < 0 ? id : id.slice(0, at);
    const n = at < 0 ? 0 : Number(id.slice(at + 1)) || 0;
    return [order.get(feature) ?? Number.MAX_SAFE_INTEGER, n] as const;
  };
  const ids = (Object.keys(live) as BodyId[]).sort((a, b) => {
    const [fa, na] = key(a);
    const [fb, nb] = key(b);
    return fa - fb || na - nb || a.localeCompare(b);
  });
  const taken = new Set(Object.values(doc.bodies).map((m) => m.name));
  let next = 1;
  return ids.map((id) => {
    const stored = doc.bodies[id];
    if (stored) return { id, meta: stored, stored: true };
    while (taken.has(`Body${next}`)) next++;
    const name = `Body${next}`;
    taken.add(name);
    return { id, meta: { name, visible: true }, stored: false };
  });
}

/** The metadata of every live body (derived names included), for the view. */
export function bodyMetaOf(entries: readonly BodyEntry[]): Record<BodyId, BodyMeta> {
  return Object.fromEntries(entries.map((e) => [e.id, e.meta])) as Record<BodyId, BodyMeta>;
}
