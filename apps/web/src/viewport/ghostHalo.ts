/**
 * The halo of a ghost body (the owner's UI review 3, R3-06; ADR-0030's amendment of
 * 2026-10-11): a ghost has no edge lines, and a soft, blurred outline round its silhouette
 * instead. The outline is a few shells of the ghost's own mesh, each pushed out along its
 * normals by a constant number of screen pixels and drawn faintly, back faces only, wider
 * shells fainter, so the ghost's grey fades out over a few pixels past its outline. The
 * shells are drawn only outside the ghost (a stencil bit its faces set), so the inside keeps
 * its plain 30 % grey. Pure parts here, so unit tests don't load three's renderer.
 */
import type { WebGLProgramParametersWithUniforms } from 'three';

/** The shells, innermost first: how far each reaches past the outline (CSS px) and its opacity. */
export const HALO_SHELLS: readonly { width: number; opacity: number }[] = [
  { width: 2, opacity: 0.3 },
  { width: 4, opacity: 0.15 },
  { width: 7, opacity: 0.07 },
];

/** The stencil bit a ghost's faces set, so its halo is drawn only outside it. */
export const GHOST_STENCIL_BIT = 0x80;

/**
 * Normals averaged over every node at the same position: the display mesh splits its nodes
 * at sharp edges, and shells pushed out along split normals would crack open at every corner.
 * Nodes are matched by their position rounded to 1e-5 mm.
 */
export function smoothNormals(positions: Float32Array, normals: Float32Array): Float32Array {
  const count = Math.floor(positions.length / 3);
  const key = (i: number) =>
    `${Math.round((positions[i * 3] ?? 0) * 1e5)},${Math.round((positions[i * 3 + 1] ?? 0) * 1e5)},${Math.round((positions[i * 3 + 2] ?? 0) * 1e5)}`;
  const sums = new Map<string, [number, number, number]>();
  for (let i = 0; i < count; i++) {
    const k = key(i);
    const sum = sums.get(k) ?? [0, 0, 0];
    sum[0] += normals[i * 3] ?? 0;
    sum[1] += normals[i * 3 + 1] ?? 0;
    sum[2] += normals[i * 3 + 2] ?? 0;
    sums.set(k, sum);
  }
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = sums.get(key(i)) ?? [0, 0, 0];
    const length = Math.hypot(x, y, z);
    if (length < 1e-9) {
      // Opposite normals cancelled out (a sheet seen from both sides): keep the node's own.
      out[i * 3] = normals[i * 3] ?? 0;
      out[i * 3 + 1] = normals[i * 3 + 1] ?? 0;
      out[i * 3 + 2] = normals[i * 3 + 2] ?? 0;
    } else {
      out[i * 3] = x / length;
      out[i * 3 + 1] = y / length;
      out[i * 3 + 2] = z / length;
    }
  }
  return out;
}

/**
 * The vertex patch of a shell's material: after three's projection the node moves `width`
 * CSS px along its normal as the screen sees it, whatever the zoom, in both projections.
 * Clipping (a section analysis) still uses the node's own position.
 */
export function haloPatch(uniforms: {
  uHaloWidth: { value: number };
  uHaloResolution: { value: { x: number; y: number } };
}) {
  return (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 haloNormal;
uniform float uHaloWidth;
uniform vec2 uHaloResolution;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
  vec2 haloDir = (projectionMatrix * vec4(normalize(normalMatrix * haloNormal), 0.0)).xy;
  float haloLength = length(haloDir);
  if (haloLength > 1e-6) {
    gl_Position.xy += haloDir / haloLength * (2.0 * uHaloWidth / uHaloResolution) * gl_Position.w;
  }
}`,
      );
  };
}
