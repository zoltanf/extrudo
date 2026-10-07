/**
 * What kind of WebGL this page can get (ADR-0076). three.js r186 needs WebGL 2.
 * `software` means the browser draws without the graphics card (llvmpipe, WARP,
 * SwiftShader): it works, slowly, so the app keeps going and says so.
 */
export type WebglSupport =
  | { kind: 'hardware'; renderer?: string }
  | { kind: 'software'; renderer?: string; reason: string }
  | { kind: 'none'; reason: string };

/** Unmasked renderer strings of software rasterisers. */
export const SOFTWARE_RENDERER =
  /swiftshader|llvmpipe|softpipe|lavapipe|basic render driver|microsoft basic|warp/i;

interface ProbeContext {
  getExtension(name: string): unknown;
  getParameter(name: number): unknown;
}

const ATTRIBUTES = { alpha: true, stencil: true, antialias: false } as const;

function tryContext(
  canvas: HTMLCanvasElement,
  attributes: WebGLContextAttributes,
): WebGL2RenderingContext | undefined {
  try {
    return (canvas.getContext('webgl2', attributes) as WebGL2RenderingContext | null) ?? undefined;
  } catch {
    return undefined;
  }
}

function lose(context: WebGL2RenderingContext | undefined): void {
  try {
    (context?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
  } catch {
    // Already lost: nothing to free.
  }
}

function rendererOf(context: WebGL2RenderingContext): string | undefined {
  try {
    const info = (context as unknown as ProbeContext).getExtension('WEBGL_debug_renderer_info') as {
      UNMASKED_RENDERER_WEBGL: number;
    } | null;
    if (!info) return undefined;
    const value = (context as unknown as ProbeContext).getParameter(info.UNMASKED_RENDERER_WEBGL);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Probes the browser with throwaway canvases. `create` makes the canvas (tests
 * inject fakes); every probe context is lost again so probes don't eat the
 * browser's context budget.
 */
export function detectWebgl(
  create: () => HTMLCanvasElement = () => document.createElement('canvas'),
): WebglSupport {
  let plain: WebGL2RenderingContext | undefined;
  try {
    plain = tryContext(create(), ATTRIBUTES);
  } catch {
    plain = undefined;
  }
  if (!plain) return { kind: 'none', reason: 'The browser gave no WebGL 2 context.' };
  const renderer = rendererOf(plain);
  lose(plain);

  if (renderer && SOFTWARE_RENDERER.test(renderer)) {
    return { kind: 'software', renderer, reason: `The browser draws with ${renderer}.` };
  }
  let strict: WebGL2RenderingContext | undefined;
  try {
    strict = tryContext(create(), { ...ATTRIBUTES, failIfMajorPerformanceCaveat: true });
  } catch {
    strict = undefined;
  }
  lose(strict);
  if (!strict) {
    return {
      kind: 'software',
      ...(renderer && { renderer }),
      reason: 'The browser reports a major performance caveat.',
    };
  }
  return { kind: 'hardware', ...(renderer && { renderer }) };
}

let cached: WebglSupport | undefined;

/** `detectWebgl` once per page; `refresh` probes again ("Try again"). */
export function webglSupport(refresh = false): WebglSupport {
  if (!cached || refresh) cached = detectWebgl();
  return cached;
}

/** The wording of three.js and the browser when no WebGL context can be made. */
const CONTEXT_ERROR =
  /Error creating WebGL context|WebGL context could not be created|Could not create a WebGL context/i;

/**
 * Whether an error thrown while rendering is a failure to get a WebGL context:
 * three.js's or the browser's own wording, or WebGL being gone when it is caught.
 */
export function isContextError(
  error: unknown,
  probe: () => WebglSupport = () => webglSupport(true),
): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return CONTEXT_ERROR.test(text) || probe().kind === 'none';
}
