import { describe, expect, it } from 'vitest';
import { detectWebgl, isContextError } from './webglSupport';

interface Fake {
  /** Renderer string, or undefined for no debug extension. */
  renderer?: string;
  /** Contexts that fail when failIfMajorPerformanceCaveat is set. */
  caveat?: boolean;
  /** No context at all. */
  none?: boolean;
  throws?: boolean;
}

function canvasFactory(fake: Fake) {
  const lost: number[] = [];
  let made = 0;
  const create = () => {
    const id = made++;
    return {
      getContext(kind: string, attributes?: { failIfMajorPerformanceCaveat?: boolean }) {
        if (fake.throws) throw new Error('boom');
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
