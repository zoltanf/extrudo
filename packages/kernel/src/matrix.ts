/**
 * @extrudo/kernel/matrix: the rigid-transform helpers of `features/matrix.ts` and nothing else,
 * so the app can pose a joint (P6-05 J2, ADR-0081 §4) without loading any OCCT code.
 */
export {
  apply,
  compose,
  determinant,
  IDENTITY,
  type Matrix12,
  mirror,
  rotation,
  translation,
  turnTo,
} from './features/matrix';
