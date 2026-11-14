/**
 * The `insertDesign` feature (P6-26, ADR-0140, issue #75): another `.extrudo`
 * design, **copied** into this one as one timeline feature whose bodies make
 * one component named after the file. No link to the file is kept (Linked
 * mode is ADR-0140 §7's later step).
 *
 * The copy is JSON, like everything a design stores (ADR-0003): the source's
 * parameters and the features before its timeline marker, in the feature's
 * `design` input (`EmbeddedDesign`). Nothing geometric is stored. The kernel
 * **expands** the feature the way it expands a Script (ADR-0070 §1): the
 * source's features are evaluated right after the insert, as if they stood in
 * the timeline there, under IDs of their own, and they see only the bodies the
 * insert made (ADR-0140 §3).
 *
 * | Input | Type | Default |
 * |---|---|---|
 * | `design` | design (the copied design) | – |
 *
 * **Nothing can clash** (ADR-0140 §4), by construction rather than by renaming:
 *
 * - IDs: every feature the expansion makes is `<insert>.<source feature>`
 *   (`generatedFeatureId`), and each reference inside the copy is rewritten
 *   token by token to those IDs (`prefixIds`), so a body is
 *   `<insert>.<feature>:0` and a face `extrude:<insert>.<feature>:cap:end`.
 *   Inserting a design into itself, or the same design twice, is fine.
 * - Parameter names: the copy's numbers are evaluated against **its own**
 *   parameters, in its own unit, and reach the expansion as plain values
 *   (`12.5 mm`, `30 deg`) with no `paramName`. The host's parameter table never
 *   sees a name of the copy, and the copy never reads one of the host's.
 */
import { CommandError, defineCommand } from './commands';
import { copyComponentName } from './components';
import { evaluateParameters } from './expr/parameters';
import type { FeatureDefinition } from './features';
import type { AttachmentId, BodyId, ComponentId, FeatureId } from './ids';
import { PLUGIN_TYPE } from './plugin-feature';
import {
  type Attachment,
  type BodyMeta,
  DesignInputSchema,
  type EmbeddedDesign,
  EmbeddedDesignSchema,
  type EmbeddedFeature,
  type ExtrudoDocument,
  type Feature,
  type FeatureInputs,
  type GeomRef,
  type UnitKind,
} from './schema';
import { GENERATED_SEPARATOR, generatedFeatureId, SCRIPT_TYPE } from './script';
import { dimensionUnit } from './sketch/dimensions';
import { attachmentFontId, type SketchDimension } from './sketch/schema';
import { z } from './zod';

export const INSERT_DESIGN_TYPE = 'insertDesign';

/** The feature type's label. An insert is named after its file, not "Insert Design1". */
export const INSERT_DESIGN_LABEL = 'Insert Design';

/** The `design` input's metadata, read by the API's generator (ADR-0068 §3). */
export interface DesignInputMeta {
  kind: 'design';
}

export const InsertDesignInputsSchema = z.strictObject({
  design: DesignInputSchema.meta({ input: { kind: 'design' } satisfies DesignInputMeta }).describe(
    "The copied design: its name, length unit, parameters and the features before its timeline marker, as the source file stored them. Evaluated in its own ID and parameter space, so nothing in it clashes with this design's. Required.",
  ),
});
export type InsertDesignInputs = z.infer<typeof InsertDesignInputsSchema>;

export const insertDesignFeature: FeatureDefinition<InsertDesignInputs> = {
  type: INSERT_DESIGN_TYPE,
  label: INSERT_DESIGN_LABEL,
  category: 'create',
  icon: 'component',
  inputsSchema: InsertDesignInputsSchema,
  // No `faceRoles`: the insert names no face itself. The features it expands to
  // do, under their own IDs and roles (`extrude:<insert>.<feature>:cap:end`).
};

/** Feature types an inserted design can't hold yet (ADR-0140 §5): each would expand inside an expansion. */
const NOT_INSERTABLE: Readonly<Record<string, string>> = {
  [SCRIPT_TYPE]: 'a Script',
  [PLUGIN_TYPE]: 'a plugin feature',
  [INSERT_DESIGN_TYPE]: 'an inserted design',
};

/**
 * Why `source` can't be inserted, or `undefined` when it can: it has nothing
 * before its timeline marker, or something there that expands into features
 * of its own (a Script, a plugin feature, another insert: nested components
 * are an ADR-0081 deferral).
 */
export function insertDesignProblem(
  source: Pick<ExtrudoDocument, 'name' | 'features' | 'timelineMarker'>,
): string | undefined {
  const active = source.features.slice(0, source.timelineMarker);
  if (active.length === 0) return `${source.name} has no features to insert.`;
  // A suppressed Script or plugin feature is inert; a suppressed insert would still hold a
  // `design` input, which an inserted design can't (the schema keeps nesting out).
  const blocked = active.find(
    (f) => NOT_INSERTABLE[f.type] && (!f.suppressed || f.type === INSERT_DESIGN_TYPE),
  );
  if (blocked) {
    return `${source.name} can't be inserted yet: ${blocked.name} is ${NOT_INSERTABLE[blocked.type]}, which an inserted design can't run.`;
  }
  return undefined;
}

/** What an insert stores of `source`: its parameters and active features, without components. */
export function embedDesign(source: ExtrudoDocument): EmbeddedDesign {
  return {
    name: source.name,
    units: source.settings.units,
    parameters: copy(source.parameters),
    features: source.features.slice(0, source.timelineMarker).map((feature) => {
      const { component: _stamp, ...rest } = copy(feature);
      return rest as EmbeddedFeature;
    }),
  };
}

/** The `insertDesign` command's payload: everything the caller decided, IDs included. */
export interface InsertDesignPayload {
  /** The Insert Design feature, with its `design` input and its component stamp. */
  feature: Feature;
  /** The component its bodies make, named after the file. */
  component: { id: ComponentId; name: string };
  /** The copied bodies' metadata (names, colours, visibility) under their new IDs, in the component. */
  bodies: Record<BodyId, BodyMeta>;
  /** The source's files the copy needs (fonts, imported models), under the IDs the copy names. */
  attachments: Record<AttachmentId, Attachment>;
  /** Where in the timeline; default the marker. */
  index?: number;
}

/**
 * Everything one Copied insert of `source` into `host` adds, for
 * `insertDesign` (ADR-0140 §2): deterministic given the IDs the caller makes
 * (`ids.attachment` is called only for a source file whose ID the host
 * already gives another file). Throws `CommandError` when `source` can't be
 * inserted (`insertDesignProblem`).
 */
export function insertDesignPayload(
  host: ExtrudoDocument,
  source: ExtrudoDocument,
  ids: { feature: FeatureId; component: ComponentId; attachment: () => AttachmentId },
  name: string,
): InsertDesignPayload {
  const problem = insertDesignProblem(source);
  if (problem) throw new CommandError(problem);
  const design = embedDesign(source);
  const checked = EmbeddedDesignSchema.safeParse(design);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    throw new CommandError(
      `${source.name} can't be inserted: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim(),
    );
  }

  // The files the copy names become the host's: the same bytes are one file,
  // and an ID the host already gives other bytes gets a new one in the copy.
  const attachments: Record<AttachmentId, Attachment> = {};
  const renamed = new Map<AttachmentId, AttachmentId>();
  for (const id of embeddedAttachments(design)) {
    const record = source.attachments?.[id];
    if (!record) continue;
    const same = Object.entries(host.attachments ?? {}).find(([, a]) => a.sha256 === record.sha256);
    if (same) {
      if (same[0] !== id) renamed.set(id, same[0] as AttachmentId);
      continue;
    }
    const target = host.attachments?.[id] ? ids.attachment() : id;
    if (target !== id) renamed.set(id, target);
    attachments[target] = copy(record);
  }
  if (renamed.size > 0) renameAttachments(design, renamed);

  const taken = (host.components ?? []).some((c) => c.name.toLowerCase() === name.toLowerCase());
  const componentName = taken ? copyComponentName(host, name) : name;

  // The bodies keep the metadata the source gave them, now in the new component.
  const own = new Set<string>(design.features.map((f) => f.id));
  const bodies: Record<BodyId, BodyMeta> = {};
  for (const [id, meta] of Object.entries(source.bodies)) {
    const at = id.lastIndexOf(':');
    if (at <= 0 || !own.has(id.slice(0, at))) continue;
    const { component: _was, ...rest } = meta;
    bodies[prefixIds(id, own, ids.feature) as BodyId] = { ...rest, component: ids.component };
  }

  const feature: Feature = {
    id: ids.feature,
    type: INSERT_DESIGN_TYPE,
    name: componentName,
    suppressed: false,
    inputs: { design: { kind: 'design', design } },
    component: ids.component,
  };
  return { feature, component: { id: ids.component, name: componentName }, bodies, attachments };
}

/**
 * Inserts a design (ADR-0140): the files it needs, its component, the feature
 * (stamped with that component) at the marker or `index`, and its bodies'
 * metadata. One undo step.
 */
export const insertDesign = defineCommand<InsertDesignPayload>(
  'feature.insertDesign',
  'Insert design',
  (draft, { feature, component, bodies, attachments, index = draft.timelineMarker }) => {
    if (feature.type !== INSERT_DESIGN_TYPE || feature.component !== component.id) {
      throw new CommandError(
        'An insert must be an Insert Design feature stamped with its component.',
      );
    }
    if (draft.features.some((f) => f.id === feature.id)) {
      throw new CommandError(`Feature ${feature.id} already exists.`);
    }
    if (!Number.isInteger(index) || index < 0 || index > draft.features.length) {
      throw new CommandError(`Can't insert a feature at position ${index}.`);
    }
    if ((draft.components ?? []).some((c) => c.id === component.id)) {
      throw new CommandError(`Component ${component.id} already exists.`);
    }
    if (
      (draft.components ?? []).some((c) => c.name.toLowerCase() === component.name.toLowerCase())
    ) {
      throw new CommandError(`There is already a component named ${component.name}.`);
    }
    for (const [id, attachment] of Object.entries(attachments)) {
      const stored = draft.attachments?.[id as AttachmentId];
      if (stored && stored.sha256 !== attachment.sha256) {
        throw new CommandError(`This design already has a file with the ID ${id}.`);
      }
    }
    for (const [id, attachment] of Object.entries(attachments)) {
      draft.attachments ??= {};
      draft.attachments[id as AttachmentId] ??= attachment;
    }
    draft.components = [
      ...(draft.components ?? []),
      { id: component.id, name: component.name, visible: true },
    ];
    draft.features.splice(index, 0, feature);
    if (index <= draft.timelineMarker) draft.timelineMarker += 1;
    for (const [id, meta] of Object.entries(bodies)) draft.bodies[id as BodyId] = meta;
  },
);

/** The attachment IDs the copy's features name: their `file` inputs and their texts' fonts. */
function embeddedAttachments(design: EmbeddedDesign): Set<AttachmentId> {
  const out = new Set<AttachmentId>();
  for (const feature of design.features) {
    for (const input of Object.values(feature.inputs)) {
      if (input.kind === 'file') out.add(input.id);
      if (input.kind !== 'sketchData') continue;
      for (const entity of Object.values(input.sketch.entities)) {
        if (entity.type !== 'text') continue;
        const font = attachmentFontId(entity.font);
        if (font) out.add(font);
      }
    }
  }
  return out;
}

/** Points the copy's file inputs and fonts at the IDs the host gives those files. */
function renameAttachments(
  design: EmbeddedDesign,
  renamed: ReadonlyMap<AttachmentId, AttachmentId>,
): void {
  for (const feature of design.features) {
    for (const input of Object.values(feature.inputs)) {
      if (input.kind === 'file') input.id = renamed.get(input.id) ?? input.id;
      if (input.kind !== 'sketchData') continue;
      for (const entity of Object.values(input.sketch.entities)) {
        if (entity.type !== 'text') continue;
        const font = attachmentFontId(entity.font);
        const to = font && renamed.get(font);
        if (to) entity.font = `attachment:${to}` as typeof entity.font;
      }
    }
  }
}

/** The plain IDs inside a reference or a persistent name (`timeline.ts`'s separators). */
const ID_TOKEN = /[A-Za-z0-9_.~-]+/g;

/**
 * A reference ID, persistent name or body ID of the copy with each of its
 * feature IDs (`ids`) put under the insert: `extrude:f3:cap:end` →
 * `extrude:<insert>.f3:cap:end`. Token by token, never by substring, so the
 * API's short IDs (`f1`, `f12`) can't catch each other.
 */
export function prefixIds(text: string, ids: ReadonlySet<string>, insert: FeatureId): string {
  return text.replace(ID_TOKEN, (token) =>
    ids.has(token) ? `${insert}${GENERATED_SEPARATOR}${token}` : token,
  );
}

function prefixRef(ref: GeomRef, ids: ReadonlySet<string>, insert: FeatureId): GeomRef {
  const out: GeomRef = { ...ref, id: prefixIds(ref.id, ids, insert) };
  if (ref.fingerprint) {
    out.fingerprint = { ...ref.fingerprint };
    if (ref.fingerprint.adj)
      out.fingerprint.adj = ref.fingerprint.adj.map((a) => prefixIds(a, ids, insert));
  }
  return out;
}

/** A value as an expression of its unit that reads in any design (`12.5 mm`, `30 deg`). */
function literal(value: number, unit: UnitKind): string {
  const n = Object.is(value, -0) ? 0 : value;
  if (unit === 'length') return `${n} mm`;
  if (unit === 'angle') return `${n} deg`;
  return String(n);
}

/**
 * The features an insert expands to (ADR-0140 §3), or what is wrong with its
 * copy as a message: each of the copy's features under `<insert>.<id>`, named
 * `<insert name> › <name>`, its references put under the insert, and every
 * expression replaced by its value from the copy's own parameters.
 */
export function insertedFeatures(
  insert: Pick<Feature, 'id' | 'name'>,
  design: EmbeddedDesign,
): Feature[] | string {
  const evaluation = evaluateParameters({
    format: 'extrudo',
    formatVersion: 2,
    id: insert.id,
    name: design.name,
    settings: { units: design.units, precision: 2 },
    parameters: design.parameters,
    features: design.features as Feature[],
    timelineMarker: design.features.length,
    bodies: {},
    views: [],
    meta: {
      created: '1970-01-01T00:00:00.000Z',
      modified: '1970-01-01T00:00:00.000Z',
      appVersion: '',
    },
  } as unknown as ExtrudoDocument);
  const ids = new Set<string>(design.features.map((f) => f.id));
  const out: Feature[] = [];
  for (const source of design.features) {
    const values = evaluation.inputs.get(source.id);
    const inputs: FeatureInputs = {};
    for (const [name, input] of Object.entries(source.inputs)) {
      switch (input.kind) {
        case 'expr': {
          const result = values?.get(name);
          if (!result?.ok) {
            if (source.suppressed) {
              inputs[name] = {
                kind: 'expr',
                expr: input.expr,
                ...(input.unit && { unit: input.unit }),
              };
              continue;
            }
            const why = result ? result.error.message : 'it has no value.';
            return `${source.name}: ${name}: ${why}`;
          }
          const unit = input.unit ?? 'length';
          inputs[name] = {
            kind: 'expr',
            expr: literal(result.value, unit),
            ...(input.unit && { unit: input.unit }),
          };
          continue;
        }
        case 'ref':
          inputs[name] = {
            kind: 'ref',
            refs: input.refs.map((ref) => prefixRef(ref, ids, insert.id)),
          };
          continue;
        case 'sketchData': {
          const sketch = copy(input.sketch);
          const dims = evaluation.dimensions.get(source.id);
          for (const [id, dimension] of Object.entries(sketch.dimensions) as [
            string,
            SketchDimension,
          ][]) {
            delete dimension.paramName;
            const result = dims?.get(id);
            if (result?.ok) dimension.expr = literal(result.value, dimensionUnit(dimension));
          }
          for (const record of Object.values(sketch.projections ?? {}) as { ref: GeomRef }[]) {
            record.ref = prefixRef(record.ref, ids, insert.id);
          }
          inputs[name] = { kind: 'sketchData', sketch };
          continue;
        }
        default:
          inputs[name] = copy(input);
      }
    }
    out.push({
      id: generatedFeatureId(insert.id, source.id),
      type: source.type,
      name: `${insert.name} › ${source.name}`,
      suppressed: source.suppressed,
      ...(source.visible !== undefined && { visible: source.visible }),
      inputs,
    });
  }
  return out;
}

/** A deep copy of plain JSON (core has no DOM, so no `structuredClone`). */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
