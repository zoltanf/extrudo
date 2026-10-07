/**
 * The bridge between QuickJS and the host (ADR-0070 §2).
 *
 * Nothing of the host is in the sandbox: a call comes in as JSON data, and what
 * it gives back is built out of QuickJS values again. The one thing that cannot
 * be JSON is a **handle** — the `FeatureHandle` a `d.box(…)` call returns, the
 * `SketchBuilder` a `d.sketch(…)` callback is given — so a handle is published as
 * a proxy object: its own properties, its getters (lazily, so building a sketch
 * handle doesn't run profile detection), and a method per function on its
 * prototype. The proxy carries the name of its host handle under `@@extrudo`, and
 * that is how an argument comes back as the handle it stands for: `k.dimension(
 * plate.bottom, '40 mm')` hands `plate.bottom` straight to the API.
 *
 * **Every handle this module makes is disposed** when the run ends, before the
 * context and the runtime go: a QuickJS value still alive at `JS_FreeRuntime` is
 * an assertion failure, the same way an undisposed OCCT shape is a leak (the
 * project's rule: OCCT objects must be disposed of). Handles the bridge is
 * *given* — an eval result, a property read — are its own to dispose, and are
 * disposed at once.
 */
import {
  DimensionHandle,
  FeatureHandle,
  ParameterHandle,
  PolygonHandle,
  PolylineHandle,
  RectangleHandle,
  SketchBuilder,
  SketchEntityHandle,
  SketchHandle,
  SlotHandle,
} from '@extrudo/api';
import { isFail, type QuickJSContext, type QuickJSHandle, Scope } from 'quickjs-emscripten-core';
import { ScriptError } from './limits';

/**
 * How far the script QuickJS runs is one line below the source the user wrote:
 * QuickJS's stack frames leave the line number out when it is 1 (measured on
 * quickjs-emscripten 0.31.0), so a script whose first line fails would have no
 * line to report. The runner's leading newline makes every line come out right.
 */
export const LINE_OFFSET = 1;

/** The property a handle proxy carries: the name of its host handle. */
const HANDLE = '@@extrudo';

/** What a handle proxy never carries, however the host object looks. */
const SKIPPED_MEMBERS = new Set(['constructor', 'then']);

/**
 * Every class the API publishes as a handle (ADR-0068 §4 and §5): a feature and
 * a sketch handle, the entity handles, the composite ones a builder returns (a
 * rectangle, a polyline, a slot, a polygon), the sketch builder itself and a
 * parameter handle. A handle is published as a proxy rather than as data, and
 * `handles.test.ts` fails when the API gains one that is missing here.
 */
export const HANDLE_CLASSES: readonly (abstract new (...args: never[]) => object)[] = [
  DimensionHandle,
  FeatureHandle,
  ParameterHandle,
  PolygonHandle,
  PolylineHandle,
  RectangleHandle,
  SketchBuilder,
  SketchEntityHandle,
  SketchHandle,
  SlotHandle,
];

/** Whether a value is one of the API's handles, which become proxies. */
function isHandle(value: object): boolean {
  return HANDLE_CLASSES.some((handle) => value instanceof handle);
}

/**
 * Everything the sandbox needs to talk to the host: value conversion both ways,
 * handle proxies, and the disposal of every handle the run made.
 */
export class Bridge {
  readonly #ctx: QuickJSContext;
  readonly #filename: string;
  readonly #scope = new Scope();
  /** The proxy built for a host object, so `plate.bottom` is one object. */
  readonly #proxies = new WeakMap<object, QuickJSHandle>();
  /** What each proxy stands for. */
  readonly #handles = new Map<string, object>();
  #next = 0;

  constructor(ctx: QuickJSContext, filename: string) {
    this.#ctx = ctx;
    this.#filename = filename;
  }

  /** Frees every handle of the run. After this the context may go. */
  dispose(): void {
    this.#scope.dispose();
  }

  // ----------------------------------------------------------- making values

  /**
   * A value of ours as a QuickJS one: primitives, arrays, objects, handles.
   *
   * The four constants come from the context's own `undefined`, `null`, `true`
   * and `false`, which quickjs-emscripten makes `StaticLifetime`s whose `dispose`
   * does nothing — so returning one to a host function, which the library takes
   * ownership of, is safe. Every other value is a handle this run owns and frees.
   */
  toValue(value: unknown): QuickJSHandle {
    const ctx = this.#ctx;
    if (value === undefined) return ctx.undefined;
    if (value === null) return ctx.null;
    if (typeof value === 'boolean') return value ? ctx.true : ctx.false;
    if (typeof value === 'number') return this.#keep(ctx.newNumber(value));
    if (typeof value === 'bigint') return this.#keep(ctx.newString(String(value)));
    if (typeof value === 'string') return this.#keep(ctx.newString(value));
    if (typeof value !== 'object') return this.#keep(ctx.newString(String(value)));
    if (isHandle(value)) return this.#proxy(value);
    if (Array.isArray(value)) {
      const array = this.#keep(ctx.newArray());
      for (const [index, item] of value.entries()) {
        ctx.setProp(array, index, this.toValue(item));
      }
      return array;
    }
    if (value instanceof Date) return this.#keep(ctx.newString(value.toISOString()));
    if (value instanceof Set) return this.toValue([...value]);
    if (value instanceof Map) return this.toValue(Object.fromEntries(value));
    const object = this.#keep(ctx.newObject());
    for (const [key, own] of Object.entries(value as Record<string, unknown>)) {
      if (own === undefined) continue;
      ctx.setProp(object, key, this.toValue(own));
    }
    return object;
  }

  /**
   * A QuickJS value as one of ours: a handle where there is a handle, else the
   * JSON it dumps as (`revive` puts the handles inside it back).
   *
   * The dump is also what tells an array from an object, since QuickJS has no
   * `isArray` through this API and a feature's own `length` input (a box's) is
   * not an array's length.
   */
  fromValue(handle: QuickJSHandle): unknown {
    const type = this.#ctx.typeof(handle);
    if (type !== 'object' && type !== 'function') return this.#ctx.dump(handle);
    return this.#hostOf(handle) ?? this.revive(this.#ctx.dump(handle));
  }

  /**
   * Plain data as ours again: a JSON dump can carry handle proxies inside it (a
   * script may put one in an inputs object), which `revive` puts back.
   */
  revive(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.revive(item));
    if (value !== null && typeof value === 'object') {
      const entries = value as Record<string, unknown>;
      const name = entries[HANDLE];
      const host = typeof name === 'string' ? this.#handles.get(name) : undefined;
      if (host) return host;
      return Object.fromEntries(
        Object.entries(entries).map(([key, own]) => [key, this.revive(own)]),
      );
    }
    return value;
  }

  // ------------------------------------------------------ the run's globals

  /**
   * A QuickJS function, disposed with the run.
   *
   * The arguments come as they are: quickjs-emscripten 0.31 *types* a host
   * function as `(this, ...args)`, but passes the arguments alone (measured on
   * the release-sync, debug-sync and asyncify builds of 0.31.0), so nothing here
   * reads a `this`. The cast below is the price of that mismatch; every test in
   * `runner.test.ts` passes its arguments through here, so a build that changed
   * it would fail loudly rather than quietly shift them.
   */
  newFunction(name: string, call: (...args: QuickJSHandle[]) => QuickJSHandle): QuickJSHandle {
    return this.#keep(
      this.#ctx.newFunction(name, call as unknown as Parameters<QuickJSContext['newFunction']>[1]),
    );
  }

  /** A QuickJS object, disposed with the run. */
  newObject(): QuickJSHandle {
    return this.#keep(this.#ctx.newObject());
  }

  /**
   * The value at a path of properties (`exports.features['name-plate']`), kept
   * by the run, or `undefined` where a step is missing or not an object.
   */
  property(object: QuickJSHandle, path: readonly string[]): QuickJSHandle | undefined {
    let at = object;
    for (const key of path) {
      const type = this.#ctx.typeof(at);
      if (type !== 'object' && type !== 'function') return undefined;
      try {
        at = this.#keep(this.#ctx.getProp(at, key));
      } catch {
        // `null` is an object to `typeof`, and has no properties to read.
        return undefined;
      }
    }
    return at;
  }

  /** Sets one property of an object we made. */
  set(object: QuickJSHandle, key: string, value: QuickJSHandle): void {
    this.#ctx.setProp(object, key, value);
  }

  /** `Object.freeze` on an object we made, through QuickJS's own. */
  freeze(object: QuickJSHandle): QuickJSHandle {
    const ctx = this.#ctx;
    return this.#withProp(ctx.global, 'Object', (globalObject) =>
      this.#withProp(globalObject, 'freeze', (freeze) => {
        const result = ctx.callFunction(freeze, globalObject, object);
        if (isFail(result)) result.error.dispose();
        else result.value.dispose();
        return object;
      }),
    );
  }

  /**
   * Plain data as a QuickJS value frozen all the way down (`Object.freeze` on
   * every object and array in it), for what a handler reads and must not change:
   * a plugin's `inputs` and `ctx` (ADR-0077 §2). A handle is published as its
   * proxy, unfrozen, as `toValue` would.
   */
  freezeDeep(value: unknown): QuickJSHandle {
    if (value === null || typeof value !== 'object' || isHandle(value)) return this.toValue(value);
    const ctx = this.#ctx;
    if (Array.isArray(value)) {
      const array = this.#keep(ctx.newArray());
      for (const [index, item] of value.entries()) ctx.setProp(array, index, this.freezeDeep(item));
      return this.freeze(array);
    }
    const object = this.#keep(ctx.newObject());
    for (const [key, own] of Object.entries(value as Record<string, unknown>)) {
      if (own === undefined) continue;
      ctx.setProp(object, key, this.freezeDeep(own));
    }
    return this.freeze(object);
  }

  /** A value as a short line of text, for `console.log`. */
  text(handle: QuickJSHandle): string {
    const type = this.#ctx.typeof(handle);
    if (type === 'string') return this.#ctx.getString(handle);
    if (type === 'undefined') return 'undefined';
    const host = type === 'object' || type === 'function' ? this.#hostOf(handle) : undefined;
    if (host) return shortLabel(host);
    const dumped = this.#ctx.dump(handle);
    return typeof dumped === 'string' ? dumped : safeStringify(dumped);
  }

  /**
   * A sketch's build callback as a host one: it runs the function inside QuickJS
   * with a proxy of the builder, and turns what it threw into a host error that
   * names the line inside the callback.
   */
  runBuilder(callback: QuickJSHandle, builder: SketchBuilder): void {
    const result = this.#ctx.callFunction(callback, this.#ctx.undefined, this.#proxy(builder));
    if (isFail(result)) {
      const failure = this.readError(result.error);
      result.error.dispose();
      throw new ScriptError(
        failure.line === undefined ? failure.message : `${failure.message} (line ${failure.line})`,
      );
    }
    result.value.dispose();
  }

  /**
   * A QuickJS exception as a `ScriptError`: its message (with QuickJS's own name
   * in front of it, as a user reads it) and the line of the script, from the
   * stack trace. QuickJS's release build gives lines and no columns, so `column`
   * stays unset unless a build says otherwise.
   */
  readError(error: QuickJSHandle): ScriptError {
    const name = this.#stringProp(error, 'name');
    const message = this.#stringProp(error, 'message');
    const stack = this.#stringProp(error, 'stack') ?? '';
    const position = positionInStack(stack, this.#filename);
    const reported = this.#numberProp(error, 'lineNumber') ?? position?.line;
    const column = this.#numberProp(error, 'column') ?? position?.column;
    const line = reported === undefined ? undefined : reported - LINE_OFFSET;
    return new ScriptError(withName(name, message), {
      ...(line === undefined || line < 1 ? {} : { line }),
      ...(column === undefined ? {} : { column }),
    });
  }

  // ------------------------------------------------------------------ private

  #keep(handle: QuickJSHandle): QuickJSHandle {
    return this.#scope.manage(handle);
  }

  /** The host handle a proxy stands for, or `undefined` for anything else. */
  #hostOf(handle: QuickJSHandle): object | undefined {
    const marker = this.#withProp(handle, HANDLE, (prop) =>
      this.#ctx.typeof(prop) === 'string' ? this.#ctx.getString(prop) : undefined,
    );
    return marker === undefined ? undefined : this.#handles.get(marker);
  }

  #stringProp(handle: QuickJSHandle, key: string): string | undefined {
    return this.#withProp(handle, key, (prop) =>
      this.#ctx.typeof(prop) === 'string' ? this.#ctx.getString(prop) : undefined,
    );
  }

  #numberProp(handle: QuickJSHandle, key: string): number | undefined {
    return this.#withProp(handle, key, (prop) =>
      this.#ctx.typeof(prop) === 'number' ? this.#ctx.getNumber(prop) : undefined,
    );
  }

  /** Reads one property and disposes the handle it came in, whatever happens. */
  #withProp<T>(handle: QuickJSHandle, key: string | number, read: (prop: QuickJSHandle) => T): T {
    const prop = this.#ctx.getProp(handle, key);
    try {
      return read(prop);
    } finally {
      prop.dispose();
    }
  }

  /**
   * A host object as a QuickJS one: its own properties, then its prototype's
   * getters (a getter runs when the script reads it) and methods. The proxy is
   * remembered, so the same handle is the same object in the script.
   */
  #proxy(host: object): QuickJSHandle {
    const remembered = this.#proxies.get(host);
    if (remembered?.alive) return remembered;
    const ctx = this.#ctx;
    const name = String(++this.#next);
    this.#handles.set(name, host);
    const object = this.#keep(ctx.newObject());
    this.#proxies.set(host, object);
    ctx.setProp(object, HANDLE, this.#keep(ctx.newString(name)));
    for (const [key, own] of Object.entries(host)) {
      if (own === undefined || SKIPPED_MEMBERS.has(key)) continue;
      ctx.setProp(object, key, this.toValue(own));
    }
    for (const [key, member] of members(host)) {
      if (Object.hasOwn(host, key) || SKIPPED_MEMBERS.has(key)) continue;
      if (member.kind === 'get') {
        // A getter is a function QuickJS calls when the script reads the
        // property, so it runs in the host and costs nothing until then.
        const read = () => this.toValue(member.read());
        ctx.defineProp(object, key, { get: read, enumerable: true, configurable: true });
      } else {
        ctx.setProp(
          object,
          key,
          this.newFunction(key, (...args) =>
            this.toValue(member.call(args.map((argument) => this.fromValue(argument)))),
          ),
        );
      }
    }
    return object;
  }
}

/** One getter or method of a host object's prototype. */
type Member =
  | { kind: 'get'; read: () => unknown }
  | { kind: 'call'; call: (args: unknown[]) => unknown };

/**
 * The getters and methods a host object's prototype chain has, under their own
 * names. An own property of the object wins, and `constructor` and `then` are
 * never published: a proxy that answered `then` would look like a promise.
 */
function members(host: object): [string, Member][] {
  const found: [string, Member][] = [];
  for (
    let prototype = Object.getPrototypeOf(host);
    prototype && prototype !== Object.prototype;
    prototype = Object.getPrototypeOf(prototype)
  ) {
    for (const key of Object.getOwnPropertyNames(prototype)) {
      if (SKIPPED_MEMBERS.has(key) || found.some(([name]) => name === key)) continue;
      const member = Object.getOwnPropertyDescriptor(prototype, key);
      if (typeof member?.get === 'function') {
        found.push([key, { kind: 'get', read: () => member.get?.call(host) }]);
      } else if (typeof member?.value === 'function') {
        const method = member.value as (...args: unknown[]) => unknown;
        found.push([key, { kind: 'call', call: (args) => method.apply(host, args) }]);
      }
    }
  }
  return found;
}

/** `[Extrude1]` — how a handle reads in `console.log`. */
function shortLabel(host: object): string {
  const named = host as { name?: unknown; id?: unknown };
  const name = typeof named.name === 'string' ? named.name : undefined;
  const id = typeof named.id === 'string' ? named.id : undefined;
  return `[${name ?? id ?? host.constructor.name}]`;
}

/** The line and column of the first stack frame of the script's own file. */
function positionInStack(
  stack: string,
  file: string,
): { line: number; column?: number } | undefined {
  const first = stack.split('\n').find((frame) => frame.includes(`${file}:`));
  if (!first) return undefined;
  const at = first.lastIndexOf(`${file}:`);
  const [line = 0, column = 0] = first
    .slice(at + file.length + 1)
    .replace(/[):\s].*$/, '')
    .split(':')
    .map((part) => Number(part));
  if (!Number.isFinite(line) || line < 1) return undefined;
  return Number.isFinite(column) && column > 0 ? { line, column } : { line };
}

/**
 * JavaScript's own error name in front of its message, as a user reads it
 * ("TypeError: cannot read property 'x' of null"). A host error of ours carries
 * its own class name (`ApiError`, `ScriptError`), which says nothing useful to a
 * user, so only the built-in names are prefixed.
 */
const JS_ERROR_NAMES = new Set([
  'Error',
  'EvalError',
  'InternalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
]);

function withName(name: string | undefined, message: string | undefined): string {
  const text = message ?? 'The script failed.';
  return !name || !JS_ERROR_NAMES.has(name) || text.startsWith(name) ? text : `${name}: ${text}`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
