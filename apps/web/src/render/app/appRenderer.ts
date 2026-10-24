/**
 * The app's own picture renderer (ADR-0101 §6): the same four scenes and six
 * finishes as the Blender script, rendered with three.js on a hidden canvas
 * of its own (never the viewport's), in the browser and the desktop app alike.
 *
 * Draft is one rasterised frame: the scene into a multisampled HDR target,
 * then three's `OutputPass` (ACES filmic, sRGB) into an 8-bit target, read
 * back with `readRenderTargetPixelsAsync`, flipped and encoded as PNG. The
 * second pass is needed because three applies tone mapping and the output
 * colour space only when it draws to the canvas, not to a render target.
 * Everything a render makes is disposed when it ends; the `WebGLRenderer`
 * lives until `dispose()`.
 *
 * Standard and High trace the same scene with three-gpu-pathtracer (§6.2): a
 * `WebGLPathTracer` per renderer (made on the first traced render, kept until
 * `dispose()`), one tile per animation frame, then the tracer's linear HDR
 * target through the same `OutputPass` and read-back.
 */
import {
  ACESFilmicToneMapping,
  CubeCamera,
  HalfFloatType,
  PCFShadowMap,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLCubeRenderTarget,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { DenoiseMaterial, WebGLPathTracer } from 'three-gpu-pathtracer';
import type {
  AppRenderJob,
  PictureRenderer,
  RenderProgress,
  RenderResult,
} from '../../platform/render';
import { viewToThreeCamera } from './camera';
import { woodTexture, worktopTexture } from './finishes';
import {
  BOUNCES,
  DENOISE,
  type GpuFence,
  SAMPLES,
  type TracerLike,
  tracePicture,
} from './pathTrace';
import { buildScene, type EnvironmentKind, type RenderMode } from './scenes';

export interface AppRenderer extends PictureRenderer {
  /** Frees the WebGL context (the dialog calls it when it goes away). */
  dispose(): void;
}

/** What a render needs from three's renderer: a seam for unit tests. */
export interface RendererLike {
  capabilities: { maxTextureSize: number };
  dispose(): void;
}

/** Draws one picture; returns the PNG, or undefined when cancelled. */
export type DrawPicture = (
  renderer: never,
  job: AppRenderJob,
  onProgress: (progress: RenderProgress) => void,
  cancelled: () => boolean,
) => Promise<Uint8Array | undefined>;

export interface AppRendererOptions {
  makeRenderer?: () => RendererLike;
  draw?: DrawPicture;
}

const BUSY = 'A render is already running.';

// One WebGLPathTracer per renderer (it prints a deprecation warning when made,
// and builds its BVH and uniforms): made on the first traced render, kept
// across renders, freed with the renderer.
const tracers = new WeakMap<object, WebGLPathTracer>();

function getTracer(renderer: WebGLRenderer): WebGLPathTracer {
  let tracer = tracers.get(renderer);
  if (!tracer) {
    tracer = new WebGLPathTracer(renderer);
    tracers.set(renderer, tracer);
  }
  return tracer;
}

function disposeTracer(renderer: object): void {
  tracers.get(renderer)?.dispose();
  tracers.delete(renderer);
}

/** The engine behind the Render dialog's "In the app" (ADR-0101 §6.3). */
export function createAppRenderer(options: AppRendererOptions = {}): AppRenderer {
  const makeRenderer = options.makeRenderer ?? makeWebGLRenderer;
  const draw = options.draw ?? (drawPicture as DrawPicture);
  let renderer: RendererLike | undefined;
  let running = false;
  let cancelled = false;
  return {
    async render(job, onProgress): Promise<RenderResult> {
      if (running) return { ok: false, message: BUSY };
      running = true;
      cancelled = false;
      try {
        onProgress({ phase: 'starting', fraction: 0 });
        renderer ??= makeRenderer();
        const max = renderer.capabilities.maxTextureSize;
        if (job.width > max || job.height > max) {
          return {
            ok: false,
            message: `This size is too large for this computer's graphics: up to ${max} × ${max}.`,
          };
        }
        const png = await draw(renderer as never, job, onProgress, () => cancelled);
        if (!png || cancelled) return { ok: false, message: 'Render cancelled.', cancelled: true };
        return { ok: true, png };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      } finally {
        running = false;
      }
    },
    cancel() {
      if (running) cancelled = true;
    },
    dispose() {
      cancelled = true;
      if (renderer) {
        disposeTracer(renderer);
        renderer.dispose();
      }
      renderer = undefined;
    },
  };
}

function makeWebGLRenderer(): WebGLRenderer {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  // three 0.186 removed PCFSoftShadowMap (it falls back with a warning); PCF with a radius is as soft.
  renderer.shadowMap.type = PCFShadowMap;
  return renderer;
}

/** Lets the dialog paint between the steps (and Cancel land). */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * The environments are Y up (three's convention); the render scene is Z up:
 * turn the lookups so the environment's sky is overhead.
 */
const Z_UP_ROTATION = Math.PI / 2;

/**
 * Makes a preset's environment with this renderer; returns its disposer. Both
 * modes bake it into a `WebGLCubeRenderTarget` (256, HalfFloat) with a
 * `CubeCamera`: the rasteriser turns the cube into a PMREM texture (three needs
 * one for `MeshStandardMaterial`), the tracer takes the cube directly (a PMREM
 * texture is not supported, ADR-0101 §6.2).
 */
function makeEnvironment(renderer: WebGLRenderer) {
  return (scene: Scene, kind: EnvironmentKind, mode: RenderMode) => {
    scene.environmentRotation.set(Z_UP_ROTATION, 0, 0);
    scene.backgroundRotation.set(Z_UP_ROTATION, 0, 0);
    if (kind.kind === 'room') {
      const room = new RoomEnvironment();
      const cube = new WebGLCubeRenderTarget(256, { type: HalfFloatType });
      new CubeCamera(1, 10000, cube).update(renderer, room);
      room.dispose();
      scene.environmentIntensity = kind.intensity;
      if (mode === 'trace') {
        scene.environment = cube.texture;
        return () => cube.dispose();
      }
      const pmrem = new PMREMGenerator(renderer);
      const target = pmrem.fromCubemap(cube.texture);
      pmrem.dispose();
      cube.dispose();
      scene.environment = target.texture;
      return () => target.dispose();
    }
    // Outdoor: three's sky (Preetham), baked once into a cube map, is the background and
    // the environment. The sun's direction, Z up → the sky's Y up: (x, y, z) → (x, z, -y).
    const { elevation, rotation } = kind;
    const sun = new Vector3(
      -Math.sin(rotation) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(rotation) * Math.cos(elevation),
    );
    const sky = new Sky();
    sky.scale.setScalar(1000);
    const uniforms = sky.material.uniforms;
    uniforms.sunPosition?.value.copy(sun);
    if (uniforms.showSunDisc) uniforms.showSunDisc.value = 0; // the key light casts the shadows
    if (uniforms.cloudCoverage) uniforms.cloudCoverage.value = 0;
    if (uniforms.turbidity) uniforms.turbidity.value = 2;
    const skyScene = new Scene();
    skyScene.add(sky);
    const cube = new WebGLCubeRenderTarget(256, { type: HalfFloatType });
    new CubeCamera(1, 10000, cube).update(renderer, skyScene);
    sky.geometry.dispose();
    sky.material.dispose();
    scene.background = cube.texture;
    scene.backgroundIntensity = SKY_BACKGROUND;
    scene.environmentIntensity = SKY_ENVIRONMENT;
    if (mode === 'trace') {
      scene.environment = cube.texture;
      return () => cube.dispose();
    }
    const pmrem = new PMREMGenerator(renderer);
    const target = pmrem.fromCubemap(cube.texture);
    pmrem.dispose();
    scene.environment = target.texture;
    return () => {
      target.dispose();
      cube.dispose();
    };
  };
}

/** Three's Preetham sky is bright: like the script's 0.05 strength, keep it a fill. */
const SKY_BACKGROUND = 0.5;
const SKY_ENVIRONMENT = 0.3;

async function drawPicture(
  renderer: WebGLRenderer,
  job: AppRenderJob,
  onProgress: (progress: RenderProgress) => void,
  cancelled: () => boolean,
): Promise<Uint8Array | undefined> {
  if (job.quality === 'draft') return drawDraft(renderer, job, onProgress, cancelled);
  return drawTraced(renderer, job, onProgress, cancelled);
}

/** Draft: one rasterised frame (ADR-0101 §6.2). */
async function drawDraft(
  renderer: WebGLRenderer,
  job: AppRenderJob,
  onProgress: (progress: RenderProgress) => void,
  cancelled: () => boolean,
): Promise<Uint8Array | undefined> {
  const { width, height } = job;
  await tick();
  if (cancelled()) return undefined;
  const built = buildScene(job, undefined, {
    wood: woodTexture,
    worktop: worktopTexture,
    environment: makeEnvironment(renderer),
  });
  const hdr = new WebGLRenderTarget(width, height, { samples: 4, type: HalfFloatType });
  const out = new WebGLRenderTarget(width, height);
  const output = new OutputPass();
  try {
    onProgress({ phase: 'importing', fraction: 0.05 });
    await tick();
    if (cancelled()) return undefined;
    const camera = viewToThreeCamera(job.camera, built.placement, width / height);
    onProgress({ phase: 'rendering', fraction: 0.1 });
    await tick();
    if (cancelled()) return undefined;
    renderer.setRenderTarget(hdr);
    renderer.clear();
    renderer.render(built.scene, camera);
    output.render(renderer, out, hdr, 0, false);
    renderer.setRenderTarget(null);
    const pixels = new Uint8Array(width * height * 4);
    await renderer.readRenderTargetPixelsAsync(out, 0, 0, width, height, pixels);
    onProgress({ phase: 'rendering', fraction: 0.95 });
    if (cancelled()) return undefined;
    onProgress({ phase: 'saving', fraction: 0.97 });
    await tick();
    return await encodePng(pixels, width, height);
  } finally {
    renderer.setRenderTarget(null);
    output.dispose();
    hdr.dispose();
    out.dispose();
    built.dispose();
    renderer.renderLists.dispose();
  }
}

/** Standard and High: the path tracer, one tile per frame (ADR-0101 §6.2). */
async function drawTraced(
  renderer: WebGLRenderer,
  job: AppRenderJob,
  onProgress: (progress: RenderProgress) => void,
  cancelled: () => boolean,
): Promise<Uint8Array | undefined> {
  const { width, height } = job;
  await tick();
  if (cancelled()) return undefined;
  const built = buildScene(
    job,
    undefined,
    {
      wood: woodTexture,
      worktop: worktopTexture,
      environment: makeEnvironment(renderer),
    },
    'trace',
  );
  const out = new WebGLRenderTarget(width, height);
  const smooth = new WebGLRenderTarget(width, height);
  const output = new OutputPass();
  const denoise = new DenoiseMaterial({ map: out.texture, ...DENOISE });
  denoise.toneMapped = false;
  const quad = new FullScreenQuad(denoise);
  const tracer = getTracer(renderer);
  try {
    onProgress({ phase: 'importing', fraction: 0.05 });
    await tick();
    if (cancelled()) return undefined;
    const camera = viewToThreeCamera(job.camera, built.placement, width / height);
    // The tracer sizes its target from the drawing buffer, so the hidden canvas must
    // already be the picture's size at pixel ratio 1.
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    tracer.renderToCanvas = false;
    tracer.bounces = BOUNCES;
    tracer.transmissiveBounces = 10;
    tracer.filterGlossyFactor = 0.5;
    tracer.minSamples = 1;
    tracer.dynamicLowRes = false;
    tracer.renderDelay = 0;
    tracer.setScene(built.scene, camera);
    onProgress({ phase: 'rendering', fraction: 0.1 });
    await tick();
    if (cancelled()) return undefined;
    const done = await tracePicture(tracer as unknown as TracerLike, {
      target: job.quality === 'high' ? SAMPLES.high : SAMPLES.standard,
      width,
      height,
      onProgress: (fraction) => onProgress({ phase: 'rendering', fraction }),
      cancelled,
      fence: webglFence(renderer.getContext() as WebGL2RenderingContext),
    });
    if (!done) return undefined;
    // The tracer's target is linear HDR: ACES and sRGB apply through OutputPass, as in Draft.
    output.render(renderer, out, tracer.target, 0, false);
    // Then one edge-preserving blur on those display values (the threshold is a colour
    // difference as seen): both targets are 8-bit with no colour space, so neither tone
    // mapping nor an sRGB conversion happens twice.
    renderer.setRenderTarget(smooth);
    quad.render(renderer);
    renderer.setRenderTarget(null);
    const pixels = new Uint8Array(width * height * 4);
    await renderer.readRenderTargetPixelsAsync(smooth, 0, 0, width, height, pixels);
    onProgress({ phase: 'rendering', fraction: 0.95 });
    if (cancelled()) return undefined;
    onProgress({ phase: 'saving', fraction: 0.97 });
    await tick();
    return await encodePng(pixels, width, height);
  } finally {
    renderer.setRenderTarget(null);
    renderer.setSize(1, 1, false);
    output.dispose();
    quad.dispose();
    denoise.dispose();
    smooth.dispose();
    out.dispose();
    built.dispose();
    renderer.renderLists.dispose();
  }
}

/** Bottom-up RGBA rows → a PNG (top-down), through a 2D canvas. */
async function encodePng(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("The picture can't be drawn: no 2D canvas.");
  const image = ctx.createImageData(width, height);
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    image.data.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  }
  // The target is opaque everywhere (a background or a sky); keep alpha so.
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
  ctx.putImageData(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error("The picture couldn't be encoded as PNG.");
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * A WebGL2 fence for the trace loop: placed after a tile's commands (and
 * flushed, so the GPU starts on them), polled without waiting.
 */
export function webglFence(gl: WebGL2RenderingContext): GpuFence {
  let sync: WebGLSync | null = null;
  const clear = () => {
    if (sync) gl.deleteSync(sync);
    sync = null;
  };
  return {
    place() {
      clear();
      sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
    },
    passed() {
      if (!sync) return true;
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) return false;
      // ALREADY_SIGNALED, CONDITION_SATISFIED, or WAIT_FAILED (a lost context): go on.
      clear();
      return true;
    },
    dispose: clear,
  };
}
