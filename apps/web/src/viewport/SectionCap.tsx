import type { BodyMesh } from '@extrudo/kernel';
import { useEffect, useMemo } from 'react';
import {
  AlwaysStencilFunc,
  BackSide,
  type BufferGeometry,
  Color,
  DecrementWrapStencilOp,
  DoubleSide,
  FrontSide,
  IncrementWrapStencilOp,
  Mesh,
  MeshBasicMaterial,
  NotEqualStencilFunc,
  type Plane,
  PlaneGeometry,
  ReplaceStencilOp,
  ShaderMaterial,
  type StencilOp,
  Vector3,
} from 'three';
import type { SectionClip } from '../section/clip';
import { boundsOf } from './bodyGeometry';
import type { Rgba } from './colors';

/** Hatch lines are this many CSS px apart. */
const HATCH_PITCH_PX = 9;

const linear = (c: Rgba): Color => new Color().setRGB(c.r, c.g, c.b, 'srgb');

/**
 * The cap of a section on one body (P3-09, ADR-0045), by the stencil method: the body's faces
 * are drawn clipped by the section plane into the stencil buffer, back faces counting up and
 * front faces counting down, so a pixel is left non-zero exactly where the view ray is inside
 * the solid at the plane; a quad lying in the plane then paints those pixels and clears the
 * stencil for the next body. The quad is opaque, flat and hatched in screen space (diagonal
 * lines that keep their weight while zooming), and takes part in the depth test, so faces on the
 * kept side of the plane hide it as they should. Each body has its own three render orders
 * (`order`…`order + 2`), which keeps the passes of different bodies apart.
 */
export function SectionCap({
  faces,
  mesh,
  clip,
  planes,
  fill,
  hatch,
  order,
}: {
  faces: BufferGeometry;
  mesh: BodyMesh;
  clip: SectionClip;
  /** The clipping plane in three.js terms, kept in step with `clip`. */
  planes: Plane[];
  fill: Rgba;
  hatch: Rgba;
  order: number;
}) {
  const stencil = useMemo(() => {
    const pass = (side: typeof BackSide | typeof FrontSide, op: StencilOp) =>
      new MeshBasicMaterial({
        side,
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        stencilWrite: true,
        stencilFunc: AlwaysStencilFunc,
        stencilFail: op,
        stencilZFail: op,
        stencilZPass: op,
      });
    return {
      back: pass(BackSide, IncrementWrapStencilOp),
      front: pass(FrontSide, DecrementWrapStencilOp),
    };
  }, []);
  const cap = useMemo(() => {
    const uniforms = {
      uFill: { value: new Color() },
      uHatch: { value: new Color() },
      uPitch: { value: HATCH_PITCH_PX },
    };
    const material = new ShaderMaterial({
      uniforms,
      side: DoubleSide,
      // Wins over faces lying in the plane itself.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      // Paint where the stencil is not zero, and leave it zero everywhere it looked at.
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: NotEqualStencilFunc,
      stencilFail: ReplaceStencilOp,
      stencilZFail: ReplaceStencilOp,
      stencilZPass: ReplaceStencilOp,
      vertexShader: /* glsl */ `
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uFill;
        uniform vec3 uHatch;
        uniform float uPitch;
        void main() {
          float d = (gl_FragCoord.x + gl_FragCoord.y) / (uPitch * 1.41421356);
          float edge = fwidth(d);
          // fract(d) runs 0…1 across a period; a line is where it is near either end.
          float dist = min(fract(d), 1.0 - fract(d));
          float line = 1.0 - smoothstep(0.06 - edge, 0.06 + edge, dist);
          gl_FragColor = vec4(mix(uFill, uHatch, line), 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    const quad = new Mesh(new PlaneGeometry(1, 1), material);
    quad.frustumCulled = false;
    quad.onBeforeRender = (renderer) => {
      uniforms.uPitch.value = HATCH_PITCH_PX * renderer.getPixelRatio();
    };
    // The stencil is left as the quad found it; clear what other bodies' passes may have set.
    quad.onAfterRender = (renderer) => renderer.clearStencil();
    return { uniforms, material, quad };
  }, []);
  useEffect(
    () => () => {
      stencil.back.dispose();
      stencil.front.dispose();
      cap.material.dispose();
      cap.quad.geometry.dispose();
    },
    [stencil, cap],
  );

  // The quad covers the body's bounding sphere, as seen from the plane.
  const sphere = useMemo(() => boundsOf([mesh]), [mesh]);
  const { origin: o, normal: n } = clip;
  if (sphere) {
    const [cx, cy, cz] = sphere.center;
    const d = (cx - o[0]) * n[0] + (cy - o[1]) * n[1] + (cz - o[2]) * n[2];
    const size = sphere.radius * 2.2 + 1;
    cap.quad.position.set(cx - n[0] * d, cy - n[1] * d, cz - n[2] * d);
    cap.quad.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...n));
    cap.quad.scale.set(size, size, 1);
    cap.quad.visible = true;
  } else cap.quad.visible = false;
  cap.quad.renderOrder = order + 2;
  cap.uniforms.uFill.value.copy(linear(fill));
  cap.uniforms.uHatch.value.copy(linear(hatch));
  stencil.back.clippingPlanes = planes;
  stencil.front.clippingPlanes = planes;

  return (
    <>
      <mesh geometry={faces} material={stencil.back} renderOrder={order} frustumCulled={false} />
      <mesh
        geometry={faces}
        material={stencil.front}
        renderOrder={order + 1}
        frustumCulled={false}
      />
      <primitive object={cap.quad} />
    </>
  );
}
