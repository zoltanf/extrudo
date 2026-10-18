import { describe, expect, it } from 'vitest';
import { type DisposeSymbols, installDisposeSymbols } from './polyfills';

/** The lookup Babel's `usingCtx` helper makes for a `using` declaration, as Vite ships it. */
function disposerOf(value: object, Sym: DisposeSymbols): unknown {
  const dispose = (value as Record<symbol, unknown>)[Sym.dispose || Sym.for('Symbol.dispose')];
  if (typeof dispose !== 'function') throw new TypeError('Object is not disposable.');
  return dispose;
}

/** What `kernel.scope()` builds: `{ close, [Symbol.dispose]: close }`. */
function scopeLike(Sym: DisposeSymbols) {
  const close = () => {};
  return { close, [Sym.dispose as unknown as symbol]: close };
}

describe('installDisposeSymbols', () => {
  it('gives an engine without Symbol.dispose the symbol the `using` helper falls back to', () => {
    const Sym: DisposeSymbols = { for: Symbol.for };

    const before = scopeLike(Sym);
    expect(Object.keys(before)).toEqual(['close', 'undefined']);
    expect(() => disposerOf(before, Sym)).toThrow('Object is not disposable.');

    installDisposeSymbols(Sym);
    expect(Sym.dispose).toBe(Symbol.for('Symbol.dispose'));
    expect(Sym.asyncDispose).toBe(Symbol.for('Symbol.asyncDispose'));
    const after = scopeLike(Sym);
    expect(Object.keys(after)).toEqual(['close']);
    expect(disposerOf(after, Sym)).toBe(after.close);
  });

  it('leaves native symbols alone', () => {
    const dispose = Symbol('dispose');
    const asyncDispose = Symbol('asyncDispose');
    const Sym: DisposeSymbols = { dispose, asyncDispose, for: Symbol.for };
    installDisposeSymbols(Sym);
    expect(Sym.dispose).toBe(dispose);
    expect(Sym.asyncDispose).toBe(asyncDispose);
  });

  it('is applied to the global Symbol on import', () => {
    // core's lib is es2023: the symbols are not in SymbolConstructor's type there.
    const Sym: DisposeSymbols = Symbol;
    expect(typeof Sym.dispose).toBe('symbol');
    expect(typeof Sym.asyncDispose).toBe('symbol');
  });
});
