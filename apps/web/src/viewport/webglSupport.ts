/**
 * What kind of WebGL this page can get (ADR-0076). three.js r186 needs WebGL 2.
 * `software` means the browser draws without the graphics card (llvmpipe, WARP,
 * SwiftShader): it works, slowly, so the app keeps going and says so. `blocked`
 * on `none` means the browser has WebGL but holds it back from this page after
 * lost contexts (#259).
 */
export type WebglSupport =
  | { kind: 'hardware'; renderer?: string }
  | { kind: 'software'; renderer?: string; reason: string }
  | { kind: 'none'; reason: string; blocked?: true };

/** Unmasked renderer strings of software rasterisers. */
export const SOFTWARE_RENDERER =
  /swiftshader|llvmpipe|softpipe|lavapipe|basic render driver|microsoft basic|warp/i;

interface ProbeContext {
  getExtension(name: string): unknown;
  getParameter(name: number): unknown;
}

const ATTRIBUTES = { alpha: true, stencil: true, antialias: false } as const;

/**
 * Chrome's reason (`webglcontextcreationerror`'s `statusMessage`) when it holds
 * WebGL back from a page whose context was lost twice in a row: "Web page
 * caused context loss and was blocked".
 */
const BLOCKED = /caused context loss|was blocked/i;

function tryContext(
  canvas: HTMLCanvasElement,
  attributes: WebGLContextAttributes,
  refused?: (status: string) => void,
): WebGL2RenderingContext | undefined {
  try {
    // Fired while `getContext` runs. Test fakes have no listeners.
    canvas.addEventListener?.('webglcontextcreationerror', (event) =>
      refused?.((event as WebGLContextEvent).statusMessage ?? ''),
    );
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
  let status = '';
  try {
    plain = tryContext(create(), ATTRIBUTES, (text) => {
      status = text;
    });
  } catch {
    plain = undefined;
  }
  if (!plain && BLOCKED.test(status)) {
    return { kind: 'none', reason: `The browser's reason: ${status}.`, blocked: true };
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

/**
 * Samples of an offscreen render target (the thumbnail's): none when the
 * browser refused the antialiasing asked of the screen's context, since a
 * multisampled target then asks the same of a driver that can't (#259).
 */
export function targetSamples(requested: boolean, granted: boolean | undefined): number {
  return requested && granted === false ? 0 : 4;
}

let losses = 0;

/** Counts a lost context of the 3D view (`webglcontextlost`). */
export function noteContextLost(): void {
  losses++;
}

/**
 * Lost contexts since the page loaded. After one, the pictures nobody asked
 * for (the autosave's thumbnail) stop: a second loss soon after the first
 * makes the browser block WebGL for the site (#259).
 */
export function contextLosses(): number {
  return losses;
}

/**
 * Whether a missing context is the browser holding WebGL back after lost
 * contexts, not a browser without WebGL (#259): the browser said so, or this
 * page lost a context before. Chrome lifts the block after a few minutes or
 * when the page is reloaded from the browser (measured on Chromium 155:
 * refused for between one and four and a half minutes; given again after the
 * browser's reload, not after `location.reload()`).
 */
export function heldBack(
  support: WebglSupport = webglSupport(),
  lost: number = contextLosses(),
): boolean {
  return lost > 0 || (support.kind === 'none' && support.blocked === true);
}
