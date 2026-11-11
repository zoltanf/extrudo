/**
 * Features a plugin's command made, turned into ordinary features of the
 * design (P6-03 slice 2, ADR-0077 §5). The sandbox gives them a Script's IDs
 * (`cmd.f1`, `cmd.f2`…) and names ("Three holes › Sketch1"); stored as they
 * are, they would read as a script's generated features (`scriptOfGenerated`)
 * and could collide with the next command's. So each gets a fresh ID from the
 * caller (`newId()`: commands stay deterministic), the name the app would give
 * it ("Sketch3"), and every stored reference that names one of them — a
 * profile `cmd.f1/<region>`, a face `extrude:cmd.f2:cap:end`, a projection's
 * source, a feature ref — names the new ID instead, token by token in the
 * grammar `timeline.ts` reads dependencies with.
 */
import { nextFeatureName } from './features';
import type { BodyId, FeatureId } from './ids';
import type { Annotation, ExtrudoDocument, Feature, FeatureInputs, GeomRef } from './schema';
import type { Sheet } from './sheet-schema';

/** The characters of one token in a stored reference's ID (`timeline.ts`'s separators' complement). */
const TOKEN = /[A-Za-z0-9_.~-]+/g;

/** Rewrites every token of a stored reference's ID that names one of `features` to its new ID. */
function renamer(
  features: readonly Pick<Feature, 'id'>[],
  ids: readonly FeatureId[],
): (id: string) => string {
  if (ids.length !== features.length) throw new Error('One new ID per feature.');
  const map = new Map<string, string>(features.map((f, i) => [f.id, ids[i] as string]));
  return (id: string) => id.replace(TOKEN, (token) => map.get(token) ?? token);
}

export function remintFeatures(
  features: readonly Feature[],
  doc: Pick<ExtrudoDocument, 'features'>,
  ids: readonly FeatureId[],
): Feature[] {
  const rename = renamer(features, ids);
  const ref = (r: GeomRef): GeomRef => ({ ...r, id: rename(r.id) });
  const named: Feature[] = [];
  return features.map((feature, i) => {
    const local = feature.name.split(' › ').at(-1) ?? feature.name;
    const label = local.replace(/\d+$/, '') || feature.type;
    const name = nextFeatureName(
      { features: [...doc.features, ...named] } as ExtrudoDocument,
      label,
    );
    const inputs: FeatureInputs = {};
    for (const [key, input] of Object.entries(feature.inputs)) {
      if (input.kind === 'ref') inputs[key] = { ...input, refs: input.refs.map(ref) };
      else if (input.kind === 'sketchData' && input.sketch.projections) {
        const projections = Object.fromEntries(
          Object.entries(input.sketch.projections).map(([id, record]) => [
            id,
            { ...record, ref: ref(record.ref) },
          ]),
        );
        inputs[key] = { ...input, sketch: { ...input.sketch, projections } };
      } else inputs[key] = input;
    }
    const out = { ...feature, id: ids[i] as FeatureId, name, inputs } as Feature;
    named.push(out);
    return out;
  });
}

/**
 * Annotations that came with reminted features (ADR-0126 §3): a `model`
 * anchor's reference (`extrude:cmd.f2:cap:end`, a `<sketch>/<entity>`) and a
 * `sketch` anchor's sketch name the new IDs, like `remintFeatures`' references.
 */
export function remintAnnotations(
  annotations: readonly Annotation[],
  features: readonly Pick<Feature, 'id'>[],
  ids: readonly FeatureId[],
): Annotation[] {
  const rename = renamer(features, ids);
  return annotations.map((annotation) => {
    const { anchor } = annotation;
    if (anchor.kind === 'model') {
      return {
        ...annotation,
        anchor: { ...anchor, ref: { ...anchor.ref, id: rename(anchor.ref.id) } },
      };
    }
    if (anchor.kind === 'sketch') {
      return { ...annotation, anchor: { ...anchor, sketch: rename(anchor.sketch) as FeatureId } };
    }
    return annotation;
  });
}

/**
 * Sheets that came with reminted features (ADR-0143): a view's `bodies`
 * (`<feature>:<n>`) and a dimension's anchor references name the new IDs,
 * like `remintFeatures`' references.
 */
export function remintSheets(
  sheets: readonly Sheet[],
  features: readonly Pick<Feature, 'id'>[],
  ids: readonly FeatureId[],
): Sheet[] {
  const rename = renamer(features, ids);
  return sheets.map((sheet) => ({
    ...sheet,
    views: sheet.views.map((view) =>
      view.bodies ? { ...view, bodies: view.bodies.map((b) => rename(b) as BodyId) } : view,
    ),
    items: sheet.items.map((item) =>
      item.kind === 'dimension'
        ? {
            ...item,
            anchors: item.anchors.map((anchor) =>
              'ref' in anchor
                ? { ...anchor, ref: { ...anchor.ref, id: rename(anchor.ref.id) } }
                : anchor,
            ),
          }
        : item,
    ),
  }));
}
