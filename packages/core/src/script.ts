/**
 * The `script` feature (P5-02, ADR-0070 §1, FR-PRG-02): code that adds
 * features. Its program runs in a sandbox (QuickJS in the kernel worker,
 * `@extrudo/script`) against a `Design` over the document as it is before the
 * script, may only **add** features through the document API (ADR-0068), and
 * the features it adds are **not stored**: the kernel evaluates them right
 * after the script, in order, as if they stood in the timeline there.
 *
 * | Input | Type | Default |
 * |---|---|---|
 * | `code` | code, at most {@link SCRIPT_MAX_CODE} characters | – |
 * | `language` | enum `ts` / `js` | `ts` |
 *
 * **Generated IDs** are `<script id>.<n>`-style, `<script id>.f3` for the
 * script's third feature (the API's own counter behind the script's ID, so the
 * same code gives the same IDs every run), and their faces are named by their
 * own evaluators (`extrude:<script>.f3:cap:end`). A stored reference into a
 * script's geometry is therefore a dependency on the script itself
 * (`scriptOfGenerated`, which `timeline.ts` uses).
 */
import { codeOf, enumInput } from './feature-inputs';
import type { FeatureDefinition } from './features';
import type { FeatureId } from './ids';
import type { Feature, FeatureInputs } from './schema';
import { z } from './zod';

export const SCRIPT_TYPE = 'script';

/** The feature type's label, and the base of its default names ("Script1"). */
export const SCRIPT_LABEL = 'Script';

/** How long a script's source may be, in characters (ADR-0070 §1, the runner's own limit). */
export const SCRIPT_MAX_CODE = 100_000;

/** What a script is written in: TypeScript (types stripped before it runs) or JavaScript. */
export const SCRIPT_LANGUAGES = ['ts', 'js'] as const;
export type ScriptLanguage = (typeof SCRIPT_LANGUAGES)[number];

/** What separates a script's ID from the API's own ID of a feature it made. */
export const GENERATED_SEPARATOR = '.';

export const ScriptInputsSchema = z.strictObject({
  code: codeOf(SCRIPT_MAX_CODE).describe(
    "The script's source: TypeScript or JavaScript that adds features through `design`, reading `params`. Required.",
  ),
  language: enumInput(SCRIPT_LANGUAGES)
    .optional()
    .describe('What the source is written in: `ts` (its types are stripped) or `js`. Default ts.'),
});
export type ScriptInputs = z.infer<typeof ScriptInputsSchema>;

export const scriptFeature: FeatureDefinition<ScriptInputs> = {
  type: SCRIPT_TYPE,
  label: SCRIPT_LABEL,
  category: 'create',
  icon: 'script',
  inputsSchema: ScriptInputsSchema,
  // No `faceRoles`: a script names no face itself. Its generated features do,
  // under their own IDs and roles (`extrude:<script>.f3:cap:end`).
};

/** A script's settings with the defaults filled in. */
export interface ScriptSettings {
  code: string;
  language: ScriptLanguage;
}

export function scriptSettings(inputs: FeatureInputs): ScriptSettings {
  const code = inputs.code?.kind === 'code' ? inputs.code.value : '';
  const language = inputs.language?.kind === 'enum' ? inputs.language.value : 'ts';
  return { code, language: language === 'js' ? 'js' : 'ts' };
}

/** A script's stored inputs. */
export function scriptInputs(settings: { code: string; language?: ScriptLanguage }): FeatureInputs {
  const inputs: FeatureInputs = { code: { kind: 'code', value: settings.code } };
  if (settings.language && settings.language !== 'ts') {
    inputs.language = { kind: 'enum', value: settings.language };
  }
  return inputs;
}

/** A script feature. The caller makes the ID and the name. */
export function scriptFeatureOf(
  id: FeatureId,
  name: string,
  settings: { code: string; language?: ScriptLanguage },
): Feature {
  return { id, type: SCRIPT_TYPE, name, suppressed: false, inputs: scriptInputs(settings) };
}

/**
 * The ID of the feature a script generated: the script's own ID, the
 * separator, and the API's ID of it (`<script>.f3`).
 */
export function generatedFeatureId(script: FeatureId, local: string): FeatureId {
  return `${script}${GENERATED_SEPARATOR}${local}` as FeatureId;
}

/**
 * The script that made a generated feature, when `id` is one of the document's
 * scripts' generated IDs (`<script>.f3` → `<script>`), else `undefined`. The
 * app's feature IDs (UUIDs) and the API's (`f1`) hold no separator, and only an ID that is not itself a feature is read this way; a sketch
 * entity's sub-ID (`<text>.<n>`) is not a feature ID, and its prefix is not
 * one either.
 */
export function scriptOfGenerated(
  id: string,
  features: ReadonlySet<string>,
): FeatureId | undefined {
  if (features.has(id)) return undefined;
  // The last separator: the API's own part (`f3`) has none, a script's ID may.
  const at = id.lastIndexOf(GENERATED_SEPARATOR);
  if (at <= 0) return undefined;
  const prefix = id.slice(0, at);
  return features.has(prefix) ? (prefix as FeatureId) : undefined;
}
