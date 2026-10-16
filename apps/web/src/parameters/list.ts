/**
 * The Parameters dialog's list, as data (ADR-0086): its sections, where a
 * move puts a parameter, how a use of a parameter reads, and the commands
 * its switch writes. Pure, so the
 * rules are tested without the dialog, which draws in a portal.
 */
import {
  type Command,
  type EvaluatedParameter,
  type ExtrudoDocument,
  type Parameter,
  type ParameterId,
  type ParameterUse,
  setParameterCustomizer,
} from '@extrudo/core';

/**
 * What the Customizer switch writes (P4-07, ADR-0059 §1): an empty
 * `customizer` object exposes the parameter, switching it off leaves it out
 * again (one command, one undo step). Exposed and unexposed are different
 * settings, so exposing a parameter that was in the panel before starts its
 * range afresh.
 */
export function starCommand(id: ParameterId, starred: boolean): Command<unknown> {
  return setParameterCustomizer({ id, customizer: starred ? undefined : {} });
}

/** The feature a model parameter belongs to, by its name. */
export function featureName(doc: ExtrudoDocument, p: EvaluatedParameter): string {
  if (p.owner.type === 'user') return '';
  const { featureId } = p.owner;
  return doc.features.find((f) => f.id === featureId)?.name ?? '';
}

/** One section of the user parameters: a group, or every parameter when none has one. */
export interface ListSection {
  /** The group; `undefined` for the parameters without one. */
  group: string | undefined;
  /** The heading: the group's name, "General" for no group, "User parameters" when flat. */
  title: string;
  ids: ParameterId[];
}

/**
 * The sections of the list (ADR-0086 §1). While no parameter has a group the
 * list is flat: one "User parameters" section. Once one has, parameters
 * without a group come first under "General" (as the customizer panel shows
 * them first), then each group in order of first appearance, each in list
 * order. An empty "General" is left out unless `keepGeneral` (a drag offers it
 * as a place to drop).
 */
export function listSections(parameters: readonly Parameter[], keepGeneral = false): ListSection[] {
  const groups: string[] = [];
  for (const p of parameters)
    if (p.group !== undefined && !groups.includes(p.group)) groups.push(p.group);
  if (groups.length === 0) {
    return [{ group: undefined, title: 'User parameters', ids: parameters.map((p) => p.id) }];
  }
  const general = parameters.filter((p) => p.group === undefined).map((p) => p.id);
  return [
    ...(general.length > 0 || keepGeneral
      ? [{ group: undefined, title: 'General', ids: general }]
      : []),
    ...groups.map((group) => ({
      group,
      title: group,
      ids: parameters.filter((p) => p.group === group).map((p) => p.id),
    })),
  ];
}

/** The groups in use, in order of first appearance. */
export function groupNames(parameters: readonly Parameter[]): string[] {
  const groups: string[] = [];
  for (const p of parameters)
    if (p.group !== undefined && !groups.includes(p.group)) groups.push(p.group);
  return groups;
}

/**
 * Where a dragged parameter lands (`moveParameter`'s index): just before
 * `before`, or after the last parameter of `group` when there is no `before`
 * (the end of the list when the group has none). The index counts the list
 * without the dragged parameter, which is where it is inserted.
 */
export function dropIndex(
  parameters: readonly Parameter[],
  id: ParameterId,
  target: { before?: ParameterId; group: string | undefined },
): number {
  const rest = parameters.filter((p) => p.id !== id);
  if (target.before !== undefined) {
    const at = rest.findIndex((p) => p.id === target.before);
    if (at >= 0) return at;
  }
  let last = -1;
  rest.forEach((p, i) => {
    if (p.group === target.group) last = i;
  });
  return last >= 0 ? last + 1 : rest.length;
}

/**
 * Where Move up / Move down puts a parameter: past its neighbour in the same
 * group (or the flat list), or `undefined` at that end of it. The index is the
 * neighbour's, which is where the parameter ends up either way.
 */
export function stepIndex(
  parameters: readonly Parameter[],
  id: ParameterId,
  direction: -1 | 1,
): number | undefined {
  const self = parameters.find((p) => p.id === id);
  if (!self) return undefined;
  const same = parameters.filter((p) => p.group === self.group);
  const neighbour = same[same.indexOf(self) + direction];
  return neighbour ? parameters.indexOf(neighbour) : undefined;
}

const FIELD_LABELS = { min: 'Min', max: 'Max', step: 'Step' } as const;

/** How a use reads on its chip under "Used by" (ADR-0086 §4). */
export function labelOfUse(use: ParameterUse): string {
  switch (use.kind) {
    case 'parameter':
      return use.name;
    case 'range':
      return `${use.name} · ${FIELD_LABELS[use.field]}`;
    case 'feature':
      return use.paramName ? `${use.feature} · ${use.paramName}` : use.feature;
    case 'joint':
      return `${use.joint} · ${use.end === 'min' ? 'minimum' : 'maximum'} ${use.quantity}`;
  }
}
