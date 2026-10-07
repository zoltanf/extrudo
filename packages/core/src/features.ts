/**
 * Feature registry types (architecture §4.2).
 *
 * Core holds the part of a feature definition that is pure data: its type,
 * label, category, icon and inputs schema. The kernel extends the definition
 * with `evaluate`, the web app with its dialog and manipulators; each keeps
 * its own `FeatureRegistry` of the extended type, keyed by the same `type`.
 */
import type { z } from 'zod';
import type { FaceRole } from './face-roles';
import type { ExtrudoDocument, Feature, FeatureInputs } from './schema';

export type FeatureCategory = 'sketch' | 'create' | 'modify' | 'construct' | 'inspect';

export interface FeatureDefinition<I extends FeatureInputs = FeatureInputs> {
  /** Stored in `Feature.type`. Never rename one; migrate instead. */
  type: string;
  /** Singular noun, also the base of default names ("Extrude" → "Extrude1"). */
  label: string;
  category: FeatureCategory;
  /** Icon ID, resolved by the web app's design system. */
  icon: string;
  /** Validates `Feature.inputs`. Build it from the input schemas in `schema.ts`. */
  inputsSchema: z.ZodType<I>;
  /**
   * The roles the faces of this feature's bodies are named with (ADR-0068 §4),
   * for the features that make or change a body. The kernel's naming is what
   * they list, and a kernel test checks every face it makes is one of them;
   * left out for a feature that makes no body, or names no face of its own.
   */
  faceRoles?: readonly FaceRole[];
  /**
   * A feature whose inputs core can't list (a plugin feature's, ADR-0077 §3):
   * keys starting `prefix`, which the document API takes as one object named
   * `name`. Left out for every feature whose schema lists its inputs.
   */
  openInputs?: OpenInputs;
}

/**
 * What a call through the document API names a feature's open-ended inputs by
 * (ADR-0068, ADR-0077 §3): `d.plugin({ plugin, handler, inputs: { width: '60 mm' } })`
 * stores `in:width`. The API's generator and `storedInputs` read this, so the
 * one open-ended feature type needs no case of its own there.
 */
export interface OpenInputs {
  /** The name of the object a call gives them in. */
  name: string;
  /** What each of its keys is stored under. */
  prefix: string;
  /** What the object holds, for the API's doc comment and reference page. */
  description: string;
}

export interface FeatureIssue {
  featureId: Feature['id'];
  message: string;
}

export class FeatureRegistry<D extends FeatureDefinition = FeatureDefinition> {
  readonly #definitions = new Map<string, D>();

  register(definition: D): this {
    if (this.#definitions.has(definition.type)) {
      throw new Error(`Feature type "${definition.type}" is already registered.`);
    }
    this.#definitions.set(definition.type, definition);
    return this;
  }

  get(type: string): D | undefined {
    return this.#definitions.get(type);
  }

  list(): D[] {
    return [...this.#definitions.values()];
  }

  /**
   * Checks every feature against its definition: unknown types and invalid
   * inputs. The document schema only knows the generic input shapes.
   */
  check(doc: ExtrudoDocument): FeatureIssue[] {
    const issues: FeatureIssue[] = [];
    for (const feature of doc.features) {
      const definition = this.get(feature.type);
      if (!definition) {
        issues.push({ featureId: feature.id, message: `Unknown feature type "${feature.type}".` });
        continue;
      }
      const result = definition.inputsSchema.safeParse(feature.inputs);
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({
            featureId: feature.id,
            message: `${issue.path.join('.') || 'inputs'}: ${issue.message}`,
          });
        }
      }
    }
    return issues;
  }
}

/** The next free default name for a feature: "Extrude3" when Extrude1 and 2 exist. */
export function nextFeatureName(doc: ExtrudoDocument, label: string): string {
  const pattern = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);
  let highest = 0;
  for (const feature of doc.features) {
    const match = pattern.exec(feature.name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `${label}${highest + 1}`;
}
