/**
 * What `params` holds in the sandbox (ADR-0070 §2): the document's parameter
 * values, plain numbers in mm, degrees or as they are, frozen so a script can
 * only read them.
 */
import { type ExtrudoDocument, evaluateParameters } from '@extrudo/core';

/**
 * Every parameter of the document by name, in mm for a length, degrees for an
 * angle, plain otherwise. A parameter whose expression doesn't evaluate in the
 * document as it stands is left out, as the API's own `ParameterHandle.value()`
 * leaves it undefined.
 */
export function parameterValues(doc: ExtrudoDocument): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [name, parameter] of evaluateParameters(doc).parameters) {
    if (parameter.result.ok) values[name] = parameter.result.value;
  }
  return values;
}
