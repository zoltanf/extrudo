/**
 * The overhang shading (P3-10, ADR-0048): a patch to three's standard material that paints
 * the fragments the analysis flags, with the same rule as `print/overhang.ts` (a normal more
 * than N° below the horizontal, `normal · down > sin N`, bed contact excepted). It reads the
 * interpolated node normal, so a curved face is cut along a crisp line at the angle instead of
 * a triangle at a time, and it costs no CPU: changing the angle or the direction only changes
 * uniforms. The colour is a token (`--x-error`); the flagged fragment takes it over the body
 * colour (and over a hover or selection tint, which still shows through faintly).
 *
 * Clipping (a section analysis) is a material property that runs before this: what is cut away
 * is never shaded.
 */
import { Color, type IUniform, Vector3, type WebGLProgramParametersWithUniforms } from 'three';
import { BED_TOLERANCE, type OverhangView } from '../print/overhang';
import type { Rgba } from './colors';

/** How strongly a flagged fragment takes the overhang colour (0…1). */
const STRENGTH = 0.82;

export interface OverhangShading {
  /** For the material's `onBeforeCompile`. */
  onBeforeCompile(shader: WebGLProgramParametersWithUniforms): void;
  /** Sets what is shaded; `undefined` switches the shading off. */
  set(view: OverhangView | undefined, color: Rgba): void;
  /** The material's `customProgramCacheKey`: the patch is one program for every setting. */
  cacheKey(): string;
}

export function createOverhangShading(): OverhangShading {
  const on: IUniform<number> = { value: 0 };
  const down: IUniform<Vector3> = { value: new Vector3(0, 0, -1) };
  const threshold: IUniform<number> = { value: 1 };
  const bed: IUniform<number> = { value: 0 };
  const paint: IUniform<Color> = { value: new Color() };
  const uniforms: Record<string, IUniform> = {
    uOverhangOn: on,
    uOverhangDown: down,
    uOverhangThreshold: threshold,
    uOverhangBed: bed,
    uOverhangColor: paint,
  };
  return {
    onBeforeCompile(shader) {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform vec3 uOverhangDown;
varying float vOverhangAlong;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vOverhangAlong = dot((modelMatrix * vec4(position, 1.0)).xyz, uOverhangDown);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uOverhangOn;
uniform vec3 uOverhangDown;
uniform float uOverhangThreshold;
uniform float uOverhangBed;
uniform vec3 uOverhangColor;
varying float vOverhangAlong;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
if (uOverhangOn > 0.5) {
  vec3 overhangNormal = normalize(vNormal);
  vec3 overhangDown = normalize((viewMatrix * vec4(uOverhangDown, 0.0)).xyz);
  bool overhangOnBed = vOverhangAlong >= uOverhangBed - ${BED_TOLERANCE.toFixed(4)};
  if (!overhangOnBed && dot(overhangNormal, overhangDown) > uOverhangThreshold) {
    diffuseColor.rgb = mix(diffuseColor.rgb, uOverhangColor, ${STRENGTH.toFixed(2)});
  }
}`,
        );
    },
    set(view, color) {
      // The uniform objects are shared with compiled programs: update their values in place.
      on.value = view ? 1 : 0;
      if (view) {
        down.value.set(...view.down);
        threshold.value = view.threshold;
        bed.value = view.bed;
        paint.value.setRGB(color.r, color.g, color.b, 'srgb');
      }
    },
    cacheKey: () => 'extrudo-overhang',
  };
}
