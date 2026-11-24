/**
 * Appending and prepending a list whose length the opened file sets (P6-25 S13, ADR-0144): such
 * a list is never spread into a call (`push(...list)`), so these loop.
 */

/** Appends `items` to `into`, in order. */
export function append<T>(into: T[], items: Iterable<T>): T[] {
  for (const item of items) into.push(item);
  return into;
}

/** Puts `items` in front of what `into` holds, in order. */
export function prepend<T>(into: T[], items: Iterable<T>): T[] {
  const rest = into.splice(0);
  append(into, items);
  return append(into, rest);
}
