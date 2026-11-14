import { describe, expect, it } from 'vitest';
import {
  contextLosses,
  detectWebgl,
  heldBack,
  isContextError,
  noteContextLost,
  targetSamples,
} from './webglSupport';

interface Fake {
  /** Renderer string, or undefined for no debug extension. */
  renderer?: string;
  /** Contexts that fail when failIfMajorPerformanceCaveat is set. */
  caveat?: boolean;
  /** No context at all. */
  none?: boolean;
  /** With `none`: the browser's reason, sent as `webglcontextcreationerror` while `getContext` runs. */
  refusal?: string;
  throws?: boolean;
}

function canvasFactory(fake: Fake) {
  const lost: number[] = [];
  let made = 0;
  const create = () => {
    const id = made++;
    let refused: ((event: { statusMessage: string }) => void) | undefined;
    return {
      addEventListener(type: string, listener: typeof refused) {
        if (type === 'webglcontextcreationerror') refused = listener;
      },
      getContext(kind: string, attributes?: { failIfMajorPerformanceCaveat?: boolean }) {
        if (fake.throws) throw new Error('boom');
        if (fake.none && fake.refusal !== undefined) refused?.({ statusMessage: fake.refusal });
        if (fake.none || kind !== 'webgl2') return null;
        if (fake.caveat && attributes?.failIfMajorPerformanceCaveat) return null;
        return {
          getExtension(name: string) {
            if (name === 'WEBGL_lose_context') return { loseContext: () => lost.push(id) };
            if (name === 'WEBGL_debug_renderer_info' && fake.renderer !== undefined)
              return { UNMASKED_RENDERER_WEBGL: 1 };
            return null;
          },
          getParameter: () => fake.renderer,
        };
      },
    } as unknown as HTMLCanvasElement;
  };
  return { create, lost, made: () => made };
}

describe('detectWebgl', () => {
  it('is hardware for a GPU renderer', () => {
    const f = canvasFactory({ renderer: 'ANGLE (NVIDIA GeForce RTX 3060)' });
    expect(detectWebgl(f.create)).toEqual({
      kind: 'hardware',
      renderer: 'ANGLE (NVIDIA GeForce RTX 3060)',
    });
  });

  it('is hardware when the renderer is masked', () => {
    expect(detectWebgl(canvasFactory({}).create).kind).toBe('hardware');
  });

  it.each(['SwiftShader', 'llvmpipe (LLVM 15)', 'Microsoft Basic Render Driver', 'Mesa lavapipe'])(
    'is software for %s',
    (renderer) => {
      expect(detectWebgl(canvasFactory({ renderer }).create).kind).toBe('software');
    },
  );

  it('is software when only the strict context fails', () => {
    const result = detectWebgl(canvasFactory({ renderer: 'Mystery', caveat: true }).create);
    expect(result.kind).toBe('software');
  });

  it('is none without a context, or when getContext throws', () => {
    expect(detectWebgl(canvasFactory({ none: true }).create).kind).toBe('none');
    expect(detectWebgl(canvasFactory({ throws: true }).create).kind).toBe('none');
    // A canvas without listeners (the other fakes' shape) still probes.
    const bare = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(detectWebgl(() => bare)).toEqual({
      kind: 'none',
      reason: 'The browser gave no WebGL 2 context.',
    });
  });

  it('is none and blocked when the browser says the page lost its contexts (#259)', () => {
    const refusal = 'Web page caused context loss and was blocked';
    expect(detectWebgl(canvasFactory({ none: true, refusal }).create)).toEqual({
      kind: 'none',
      reason: `The browser's reason: ${refusal}.`,
      blocked: true,
    });
    const other = detectWebgl(canvasFactory({ none: true, refusal: 'WebGL is disabled' }).create);
    expect(other).toEqual({ kind: 'none', reason: 'The browser gave no WebGL 2 context.' });
  });

  it('loses every probe context', () => {
    const f = canvasFactory({ renderer: 'GPU' });
    detectWebgl(f.create);
    expect(f.lost.sort()).toEqual([0, 1]);
  });
});

describe('isContextError', () => {
  const works = () => ({ kind: 'hardware' }) as const;
  const gone = () => ({ kind: 'none', reason: 'x' }) as const;

  it('recognises three.js and browser wording', () => {
    expect(
      isContextError(new Error('THREE.WebGLRenderer: Error creating WebGL context.'), works),
    ).toBe(true);
    expect(
      isContextError(new Error('A WebGL context could not be created. Reason: x'), works),
    ).toBe(true);
    expect(
      isContextError(new Error('Could not create a WebGL context, VENDOR = 0xffff'), works),
    ).toBe(true);
  });

  it('does not take other errors that mention context', () => {
    expect(isContextError(new Error('useContext must be used within a Provider'), works)).toBe(
      false,
    );
    expect(
      isContextError(
        new TypeError("Cannot read properties of undefined (reading 'context')"),
        works,
      ),
    ).toBe(false);
    expect(isContextError(new Error('x is not a function'), works)).toBe(false);
  });

  it('takes any error when WebGL is gone at the time', () => {
    expect(isContextError(new Error('x is not a function'), gone)).toBe(true);
  });
});

describe('targetSamples', () => {
  it('multisamples when the screen got its antialiasing', () => {
    expect(targetSamples(true, true)).toBe(4);
  });

  it('does not when the browser refused the antialiasing asked for (#259)', () => {
    expect(targetSamples(true, false)).toBe(0);
  });

  it('multisamples where none was asked for (software rendering) or the answer is unknown', () => {
    expect(targetSamples(false, false)).toBe(4);
    expect(targetSamples(true, undefined)).toBe(4);
  });
});

describe('contextLosses', () => {
  it('counts the lost contexts of the page', () => {
    expect(contextLosses()).toBe(0);
    noteContextLost();
    noteContextLost();
    expect(contextLosses()).toBe(2);
  });
});

describe('heldBack (#259)', () => {
  it('is true once this page lost a context, or when the browser says it blocked the page', () => {
    expect(heldBack({ kind: 'none', reason: 'x' }, 0)).toBe(false);
    expect(heldBack({ kind: 'hardware' }, 0)).toBe(false);
    expect(heldBack({ kind: 'hardware' }, 1)).toBe(true);
    expect(heldBack({ kind: 'none', reason: 'x', blocked: true }, 0)).toBe(true);
  });
});
