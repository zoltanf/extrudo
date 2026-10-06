/**
 * The wall-thickness shading (P5-06, ADR-0072): a patch to three's standard material that
 * paints the triangles the analysis flags, with the same rule as `print/thickness.ts` (a
 * measured thickness below the minimum). The flag is a per-vertex attribute (`aThin`), 1 on
 * the nodes of a thin triangle, so nothing else changes colour and a hover or selection tint
 * still shows through the mix. The colour is a token (`--x-error`, the overhang's).
 *
 * It mixes after the overhang shading (`viewport/overhangShading.ts` patches
 * `<color_fragment>`, this one `<alphatest_fragment>`, which the shader runs later), so on a
 * triangle that is both thin and an overhang the thin colour wins, whatever order the two
 * patches are applied in. Clipping (a section analysis) is a material property that runs
 * before all of it: what is cut away is never shaded.
 */
import { Color, type IUniform, type WebGLProgramParametersWithUniforms } from 'three';
import type { Rgba } from './colors';

/** How strongly a flagged fragment takes the colour (0…1). */
const STRENGTH = 0.82;

export interface ThicknessShading {
  /** For the material's `onBeforeCompile`. */
  onBeforeCompile(shader: WebGLProgramParametersWithUniforms): void;
  /** Sets the colour to mix; `undefined` switches the shading off. */
  set(color: Rgba | undefined): void;
  /** The material's `customProgramCacheKey`: the patch is one program for every setting. */
  cacheKey(): string;
}

export function createThicknessShading(): ThicknessShading {
  const on: IUniform<number> = { value: 0 };
  const paint: IUniform<Color> = { value: new Color() };
  const uniforms: Record<string, IUniform> = {
    uThinOn: on,
    uThinColor: paint,
  };
  return {
    onBeforeCompile(shader) {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float aThin;
varying float vThin;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vThin = aThin;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uThinOn;
uniform vec3 uThinColor;
varying float vThin;`,
        )
        .replace(
          // After the overhang's `<color_fragment>` patch: thin wins where both flag a triangle.
          '#include <alphatest_fragment>',
          `#include <alphatest_fragment>
if (uThinOn > 0.5 && vThin > 0.5) {
  diffuseColor.rgb = mix(diffuseColor.rgb, uThinColor, ${STRENGTH.toFixed(2)});
}`,
        );
    },
    set(color) {
      // The uniform objects are shared with compiled programs: update their values in place.
      on.value = color ? 1 : 0;
      if (color) paint.value.setRGB(color.r, color.g, color.b, 'srgb');
    },
    cacheKey: () => 'extrudo-thickness',
  };
}
