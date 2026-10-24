/**
 * The in-app renderer's finishes (ADR-0101 §6.3): one `MeshPhysicalMaterial`
 * per finish, the body's colour as the base colour, after `render.py`'s
 * `finish_material`. Wood's grain and the workbench's worktop are drawn to a
 * `CanvasTexture` at runtime: no image files.
 */
import type { RenderFinish } from '@extrudo/core';
import {
  CanvasTexture,
  Color,
  MeshPhysicalMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

export const DEFAULT_BODY_COLOR = '#cccccc';

/** The base colour of a body: `#rrggbb` (sRGB), absent or unreadable → the default grey. */
export function bodyColor(color: string | undefined): Color {
  const text = color && /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_BODY_COLOR;
  return new Color().setStyle(text, SRGBColorSpace);
}

/** A 512 × 512 canvas filled pixel by pixel with `shade(u, v)` (0–1 → grey), or undefined without a 2D context. */
function shadeCanvas(shade: (u: number, v: number) => number): HTMLCanvasElement | undefined {
  if (typeof document === 'undefined') return undefined;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const g = Math.round(255 * Math.min(1, Math.max(0, shade(x / size, y / size))));
      const i = (y * size + x) * 4;
      image.data[i] = g;
      image.data[i + 1] = g;
      image.data[i + 2] = g;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function repeating(canvas: HTMLCanvasElement | undefined, repeat: number): Texture {
  const texture = new CanvasTexture(canvas as HTMLCanvasElement);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  return texture;
}

const TAU = Math.PI * 2;
/** A cheap tileable "noise": sines of whole frequencies, so the texture repeats seamlessly. */
const wobble = (u: number, v: number) =>
  0.5 * Math.sin(TAU * (2 * u + v)) +
  0.3 * Math.sin(TAU * (5 * u - 3 * v) + 1.3) +
  0.2 * Math.sin(TAU * (11 * u + 7 * v) + 0.7);

/** Grain lines across one tile of `woodTexture`. */
export const WOOD_LINES = 24;

/**
 * Wood grain: thin dark lines (sin(v + noise), the noise wobbling them) on
 * lighter wood, from 0.4 (`render.py`'s `darker(color, 0.4)`) to 1. Grey, so
 * the material's colour (the body's) tints it. A tile holds `WOOD_LINES`
 * lines along u; repeat it more across the grain than along it (the script
 * stretches its noise 8× along the grain).
 */
export function woodTexture(): Texture {
  return repeating(
    shadeCanvas((u, v) => {
      // Uneven spacing: the phase drifts with a slower wave across the grain.
      const phase = TAU * WOOD_LINES * v + 2.5 * Math.sin(TAU * 5 * v) + 3 * wobble(u, v);
      const t = 0.5 + 0.5 * Math.sin(phase);
      // Mostly light wood; the dark lines are the top of each wave (the script's ramp, 0.42–0.58).
      const line = Math.min(1, Math.max(0, (t - 0.8) / 0.2)) ** 2;
      const tone = 0.8 + 0.2 * (0.5 + 0.5 * Math.sin(TAU * 7 * v + 2 * wobble(v, u)));
      return 0.4 + (tone - 0.4) * (1 - 0.45 * line);
    }),
    1,
  );
}

/**
 * The workbench's worktop: fine dark noise with a thin lighter line every
 * 10 mm, like `render.py`'s cutting mat (#2e2e32, lines #4a4a52). One tile is
 * 50 mm; the slab sets the repeat from its size.
 */
export function worktopTexture(): Texture {
  const base = 0x2e / 255;
  const line = 0x4a / 255;
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return repeating(
    shadeCanvas((u, v) => {
      const onLine = (w: number) => (w * 5) % 1 < 0.012;
      if (onLine(u) || onLine(v)) return line;
      return base * (0.85 + 0.3 * random());
    }),
    1,
  );
}

export interface FinishTextures {
  wood(): Texture;
}

/**
 * The material of a body by its finish (`finish_material`). `size` is the
 * model's largest side in millimetres (translucent bodies' `thickness`).
 */
export function finishMaterial(
  finish: RenderFinish,
  color: string | undefined,
  size: number,
  textures: FinishTextures = { wood: woodTexture },
): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({ color: bodyColor(color), roughness: 0.6 });
  material.name = finish;
  switch (finish) {
    case 'matte':
      material.roughness = 0.6;
      material.metalness = 0;
      break;
    case 'glossy':
      material.roughness = 0.15;
      material.clearcoat = 1;
      material.clearcoatRoughness = 0.1;
      break;
    case 'translucent':
      material.transmission = 0.9;
      material.thickness = size / 10;
      material.ior = 1.5;
      material.roughness = 0.1;
      break;
    case 'resin':
      material.roughness = 0.3;
      material.sheen = 0.3;
      material.sheenColor.copy(material.color);
      material.sheenRoughness = 0.5;
      break;
    case 'metal':
      material.metalness = 1;
      material.roughness = 0.35;
      break;
    case 'wood':
      material.roughness = 0.5;
      material.map = textures.wood();
      // UVs are in model sizes (`bodyGeometry`): about ten lines across the model.
      material.map.repeat.set(0.05, 0.4);
      break;
  }
  return material;
}
