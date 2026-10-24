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
import type {
  AppRenderJob,
  PictureRenderer,
  RenderProgress,
  RenderResult,
} from '../../platform/render';
import { viewToThreeCamera } from './camera';
import { woodTexture, worktopTexture } from './finishes';
import { buildScene, type EnvironmentKind } from './scenes';

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
      renderer?.dispose();
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

/** Makes a preset's environment with this renderer; returns its disposer. */
function makeEnvironment(renderer: WebGLRenderer) {
  return (scene: Scene, kind: EnvironmentKind) => {
    const pmrem = new PMREMGenerator(renderer);
    scene.environmentRotation.set(Z_UP_ROTATION, 0, 0);
    scene.backgroundRotation.set(Z_UP_ROTATION, 0, 0);
    if (kind.kind === 'room') {
      const room = new RoomEnvironment();
      const target = pmrem.fromScene(room, 0.04);
      room.dispose();
      pmrem.dispose();
      scene.environment = target.texture;
      scene.environmentIntensity = kind.intensity;
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
    const target = pmrem.fromCubemap(cube.texture);
    pmrem.dispose();
    scene.background = cube.texture;
    scene.backgroundIntensity = SKY_BACKGROUND;
    scene.environment = target.texture;
    scene.environmentIntensity = SKY_ENVIRONMENT;
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
    // slice 2: the path tracer for Standard and High (ADR-0101 §6.2); until then they render like Draft.
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
