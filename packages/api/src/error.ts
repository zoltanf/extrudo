/**
 * The one error the API throws (ADR-0068 §2): a bad call, never a half-written
 * document. Inputs are checked against the feature's schema before anything is
 * dispatched, so a call that throws leaves the design as it was.
 *
 * `path` is the input path the schema complained about (`profiles`, `distance`,
 * `profiles[1].kind`), `featureType` the feature the call was for, and
 * `featureId` the feature it made or edited (only `validate()` sets it).
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  /** The input path the schema rejected, when one call's inputs did. */
  readonly path: string | undefined;
  /** The feature type the call was for, when it was for one. */
  readonly featureType: string | undefined;
  /** The feature at fault, when it is a document feature (`validate()`). */
  readonly featureId: string | undefined;

  constructor(
    message: string,
    options: { path?: string; featureType?: string; featureId?: string } = {},
  ) {
    super(message);
    this.path = options.path;
    this.featureType = options.featureType;
    this.featureId = options.featureId;
  }
}
