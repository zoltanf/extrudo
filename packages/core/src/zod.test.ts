// ADR-0067 H1: zod must never create a function. Its JIT compiles a schema's
// parser with `new Function`, and it probes whether it may even try when the
// schema is built, so the app's content policy needed `'unsafe-eval'` for zod
// alone. `z.config({ jitless: true })` runs in ./zod before any schema exists;
// this proves it with a stub that records every attempt to evaluate a string.
//
// Nothing here is imported statically: the whole module graph has to be built
// while `Function` is the stub, or zod's one-shot probe would have run before it
// and this would prove nothing.
import { describe, expect, it, vi } from 'vitest';

/**
 * `globalThis.Function` as a stub that throws, recording the code it was given.
 * Nothing in a strict policy lets it through, and any recorded code is a hole.
 */
function blockFunctions(): { attempts: string[]; restore: () => void } {
  const attempts: string[] = [];
  const original = globalThis.Function;
  globalThis.Function = function FunctionStub(...args: unknown[]) {
    attempts.push(String(args[0]));
    throw new EvalError('blocked by the test');
  } as unknown as FunctionConstructor;
  return {
    attempts,
    restore: () => {
      globalThis.Function = original;
    },
  };
}

describe('zod without dynamic code execution', () => {
  it('builds and parses a document with Function blocked, and still validates', async () => {
    // A fresh module registry, so the schemas are built while the stub is in
    // place: zod's probe is one of the calls the stub would record.
    vi.resetModules();
    const blocked = blockFunctions();
    try {
      const [{ DocumentSchema }, { loadDocument }, { sampleDocument }] = await Promise.all([
        import('./schema'),
        import('./migrations'),
        import('./testing'),
      ]);
      const document = sampleDocument();
      expect(DocumentSchema.parse(document)).toEqual(document);
      expect(loadDocument(document).doc).toEqual(document);
      // Still the runtime parser, so it still refuses a document it must.
      expect(() => DocumentSchema.parse({ ...document, nonsense: 1 })).toThrow();
      expect(blocked.attempts).toEqual([]);
    } finally {
      blocked.restore();
    }
  });
});
