import { Color, ShaderMaterial } from 'three';

/**
 * Round dots with a fixed size in pixels, for `<points>`: the origin point
 * and sketch points. Set `uSize` in device pixels before each render.
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
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uSize;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      void main() {
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
