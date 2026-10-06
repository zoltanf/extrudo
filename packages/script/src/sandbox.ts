/**
 * The globals a script runs with (ADR-0070 §2), and nothing else.
 *
 * There is no DOM, no `fetch`, no timers and no module loading: QuickJS has none
 * of them, and a script that reaches for one gets `undefined` (or, for
 * `import()`, a failure — see `ASYNC_MESSAGE`). What it gets is `design`, the
 * API's methods over a design it may only add to; `params`, the document's
 * parameter values, frozen; `console.log` (and `info`, `warn`, `error`, which
 * go to the same lines); a `Math.random` seeded from its own feature ID; and a
 * `Date` frozen at 0.
 */
import type { SketchBuilder } from '@extrudo/api';
import { isFail, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten-core';
import type { Bridge } from './bridge';
import { ScriptError } from './limits';
import type { ScriptLog } from './log';
import { seededRandom } from './random';
import { SCRIPT_METHODS, type ScriptDesign } from './restricted';
import type { ScriptRequest } from './types';
import { parameterValues } from './values';

/** Puts the globals in place. Every handle is the bridge's to dispose. */
export function giveGlobals(
  ctx: QuickJSContext,
  bridge: Bridge,
  script: ScriptDesign,
  request: ScriptRequest,
  log: ScriptLog,
): void {
  const global = ctx.global;
  bridge.set(global, 'design', designObject(ctx, bridge, script));
  const params = request.params ?? parameterValues(request.design.doc);
  bridge.set(global, 'params', bridge.freeze(bridge.toValue(params)));
  bridge.set(global, 'console', consoleObject(bridge, log));
  const random = seededRandom(request.featureId);
  const math = ctx.getProp(global, 'Math');
  try {
    ctx.setProp(
      math,
      'random',
      bridge.newFunction('random', () => bridge.toValue(random())),
    );
  } finally {
    math.dispose();
  }
  giveFrozenDate(ctx);
}

/**
 * The `Date` the sandbox has: frozen at 0, so a script cannot read a clock and
 * two runs of the same script agree.
 *
 * It is a constant of this module evaluated *inside* QuickJS rather than built
 * from host functions, because a host function in QuickJS is not a constructor
 * and `new Date()` has to work. It is not user code: the only source a script
 * reaches `evalCode` with is its own.
 */
const FROZEN_DATE = `globalThis.Date = class FrozenDate {
  constructor() {
    this.time = 0;
  }
  getTime() {
    return 0;
  }
  valueOf() {
    return 0;
  }
  getTimezoneOffset() {
    return 0;
  }
  toISOString() {
    return '1970-01-01T00:00:00.000Z';
  }
  toJSON() {
    return '1970-01-01T00:00:00.000Z';
  }
  toString() {
    return 'Thu Jan 01 1970 00:00:00 GMT+0000';
  }
  static now() {
    return 0;
  }
  static parse() {
    return 0;
  }
  static UTC() {
    return 0;
  }
};`;

/** Puts the frozen `Date` in the sandbox's global object. */
function giveFrozenDate(ctx: QuickJSContext): void {
  const result = ctx.evalCode(FROZEN_DATE, 'frozen-date.js', { type: 'global' });
  if (isFail(result)) {
    result.error.dispose();
    throw new ScriptError('The sandbox could not be set up: its Date is broken.');
  }
  result.value.dispose();
}

/**
 * `design`: one QuickJS function per name in `SCRIPT_METHODS`, each marshalling
 * its arguments as JSON to the host's restricted design. Two names are not plain
 * calls: `origin` is a value, as on `Design`, and `sketch` takes a function,
 * which is run here rather than marshalled.
 */
function designObject(ctx: QuickJSContext, bridge: Bridge, script: ScriptDesign): QuickJSHandle {
  const object = bridge.newObject();
  for (const name of SCRIPT_METHODS) {
    if (name === 'origin') {
      bridge.set(object, name, bridge.toValue(script.origin));
    } else if (name === 'sketch') {
      bridge.set(
        object,
        name,
        bridge.newFunction('sketch', (...args) => {
          const build = args[1] ?? ctx.undefined;
          if (ctx.typeof(build) !== 'function') {
            throw new ScriptError('design.sketch() takes a function that draws the sketch.');
          }
          return bridge.toValue(
            script.sketch(
              bridge.fromValue(args[0] ?? ctx.undefined),
              (builder) => bridge.runBuilder(build, builder as SketchBuilder),
              bridge.fromValue(args[2] ?? ctx.undefined),
            ),
          );
        }),
      );
    } else {
      bridge.set(
        object,
        name,
        bridge.newFunction(name, (...args) =>
          bridge.toValue(
            script.call(
              name,
              args.map((argument) => bridge.fromValue(argument)),
            ),
          ),
        ),
      );
    }
  }
  return object;
}

/** `console`: every line goes into the run's log, as one line of text. */
function consoleObject(bridge: Bridge, log: ScriptLog): QuickJSHandle {
  const object = bridge.newObject();
  for (const name of ['log', 'info', 'warn', 'error']) {
    bridge.set(
      object,
      name,
      bridge.newFunction(name, (...args) => {
        log.line(args.map((argument) => bridge.text(argument)).join(' '));
        return bridge.toValue(undefined);
      }),
    );
  }
  return object;
}
