/**
 * Finding a stored object by the string a script gives: its name first, then
 * its ID, so an object named like another's ID (a component named `cmp2`) is
 * the one the name says. A handle names its object by ID and doesn't come here.
 */

/**
 * The item `wanted` names. `foldCase` for lists whose names are unique
 * whatever their case (components, sheets, a sheet's views): an exact-case
 * name wins, then a name in another case, then an ID.
 */
export function byNameThenId<T extends { readonly id: string; readonly name: string }>(
  items: readonly T[],
  wanted: string,
  foldCase: boolean,
): T | undefined {
  const exact = items.find((x) => x.name === wanted);
  if (exact) return exact;
  if (foldCase) {
    const lower = wanted.toLowerCase();
    const folded = items.find((x) => x.name.toLowerCase() === lower);
    if (folded) return folded;
  }
  return items.find((x) => x.id === wanted);
}
