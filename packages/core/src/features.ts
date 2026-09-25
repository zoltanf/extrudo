/**
 * Feature registry types (architecture §4.2).
 *
 * Core holds the part of a feature definition that is pure data: its type,
 * label, category, icon and inputs schema. The kernel extends the definition
 * with `evaluate`, the web app with its dialog and manipulators; each keeps
 * its own `FeatureRegistry` of the extended type, keyed by the same `type`.
 */
import type { z } from 'zod';
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
