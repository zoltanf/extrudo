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
 * Heavy work belongs in the C++ facade (ADR-0037); this scope is for small,
 * read-only uses of the raw API. Since toolchain 3.1.0 `delete()` frees the C++
 * object (taucad/opencascade.js#40 fixed), so never track an object another
 * OCCT object still references, and `Clear()` is no longer needed against the
 * old leak.
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
