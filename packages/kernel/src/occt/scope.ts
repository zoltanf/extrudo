/** A raw libcascade object: anything embind hands out with a `delete()`. */
export interface OcctObject {
  delete(): void;
  /** Present on BRepAlgoAPI_* and collections; releases what the object owns. */
  Clear?(): void;
}

/**
 * Disposal scope for raw OCCT bindings: `using scope = new OcctScope()`, then
 * `scope.track(new oc.gp_Pnt(…))`. On dispose it deletes every tracked object
 * in reverse order, calling `Clear()` first where the object has one.
 * libcascade's `delete()` alone doesn't free what a boolean builder owns
 * (taucad/opencascade.js#40), so heavy work belongs in the C++ facade instead;
 * this scope is for small, read-only uses of the raw API.
 */
export class OcctScope implements Disposable {
  readonly #objects: OcctObject[] = [];

  track<T extends OcctObject>(object: T): T {
    this.#objects.push(object);
    return object;
  }

  [Symbol.dispose](): void {
    for (const object of this.#objects.reverse()) {
      object.Clear?.();
      object.delete();
    }
    this.#objects.length = 0;
  }
}
