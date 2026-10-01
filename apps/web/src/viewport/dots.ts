import { Color, ShaderMaterial } from 'three';

/**
 * Round dots with a fixed size in pixels, for `<points>`: the origin point,
 * sketch points and a body's picked vertices. Set `uSize` in device pixels
 * before each render. Section clipping planes (`material.clippingPlanes`)
 * hide the dots on the removed side (P3-17).
 */
export function createDotMaterial() {
  const uniforms = {
    uColor: { value: new Color() },
    uAlpha: { value: 1 },
    uSize: { value: 7 },
  };
  const material = new ShaderMaterial({
    transparent: true,
    depthTest: false,
    clipping: true,
    uniforms,
    vertexShader: /* glsl */ `
      #include <clipping_planes_pars_vertex>
      uniform float uSize;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = uSize;
        #include <clipping_planes_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <clipping_planes_pars_fragment>
      uniform vec3 uColor;
      uniform float uAlpha;
      void main() {
        #include <clipping_planes_fragment>
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = 1.0 - smoothstep(0.7, 1.0, r);
        if (a <= 0.0) discard;
        gl_FragColor = vec4(uColor, a * uAlpha);
        #include <colorspace_fragment>
      }
    `,
  });
  return { material, uniforms };
}
