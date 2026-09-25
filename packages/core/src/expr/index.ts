/** Expressions and parameters (architecture §4.3, FR-PAR). */
export { ExprError } from './errors';
export {
  CONSTANTS,
  closest,
  coerce,
  type EvaluateOptions,
  type EvaluateResult,
  evaluateExpression,
  evaluateNode,
  FUNCTION_NAMES,
  isReservedName,
  type Quantity,
  type Scope,
} from './evaluate';
export { formatQuantity } from './format';
export {
  type EvaluatedParameter,
  evaluateParameters,
  mentions,
  nextModelParameterName,
  type ParameterEvaluation,
  type ParameterOwner,
  parameterNames,
  renameReferences,
} from './parameters';
export { type Node, parse, references, type Span, tokenize } from './parser';
export {
  ANGLE,
  type Dim,
  describeDim,
  dimOfKind,
  LENGTH,
  UNIT_NAMES,
  UNITLESS,
  UNITS,
  type Unit,
} from './units';
