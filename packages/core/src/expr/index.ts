/** Expressions and parameters (architecture §4.3, FR-PAR). */
export { ExprError, type ExprErrorCode } from './errors';
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
export { evaluateInline, type InlineParameter, inlineParameter } from './inline';
export {
  type EvaluatedParameter,
  evaluateParameters,
  mentions,
  nextModelParameterName,
  type ParameterEvaluation,
  type ParameterOwner,
  parameterNames,
  renameReferences,
  valuesByName,
} from './parameters';
export { type Node, parse, references, type Span, tokenize } from './parser';
export {
  ANGLE,
  type Dim,
  describeDim,
  dimOfKind,
  isUnitless,
  LENGTH,
  lengthFactor,
  sameDim,
  UNIT_NAMES,
  UNITLESS,
  UNITS,
  type Unit,
  unitNamed,
} from './units';
