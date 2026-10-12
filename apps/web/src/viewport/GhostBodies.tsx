import type { BodyId, BodyMeta } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import type { Matrix12 } from '@extrudo/kernel/matrix';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  AlwaysStencilFunc,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  KeepStencilOp,
  MeshBasicMaterial,
  NotEqualStencilFunc,
  type Plane,
  ReplaceStencilOp,
  Vector2,
} from 'three';
import type { SectionClip } from '../section/clip';
import { usePose } from './Bodies';
import { ghostBodies } from './bodyGhosts';
import { clipPlanes } from './clipPlanes';
import type { Rgba } from './colors';
import { GHOST_STENCIL_BIT, HALO_SHELLS, haloPatch, smoothNormals } from './ghostHalo';

/**
 * Bodies drawn as ghosts (ADR-0030's amendment, 2026-10-09): a vague grey shape
 * at 30 % opacity, drawn by a small separate component so none of the
 * selection, analysis or section-cap machinery touches it. A ghost takes no
 * picks, no highlights, no silhouettes and no part in Fit. Since the owner's UI
 * review 3 (R3-06) it has **no edge lines** and a soft halo round its outline
 * instead (`ghostHalo.ts`). Its faces and halo are clipped by the section planes
 * like the other bodies (P3-09), with no cap.
 */
export function GhostBodies({
  bodies,
  meta,
  color,
  section,
  posed,
}: {
  bodies: Readonly<Record<BodyId, BodyMesh>>;
  meta: Record<BodyId, BodyMeta>;
  /** The ghost bodies' flat grey, which their halo fades out from. */
  color: Rgba;
  section?: { clips: readonly SectionClip[] };
  /** Ghosts of posed bodies are drawn posed too (P6-05 J2). */
  posed?: Readonly<Record<BodyId, Matrix12>>;
}) {
  const ghosts = useMemo(() => ghostBodies(bodies, meta), [bodies, meta]);
  const planes = useMemo(() => clipPlanes(section?.clips) ?? null, [section?.clips]);
  return ghosts.map(([id, mesh]) => (
    <GhostBody key={id} mesh={mesh} color={color} planes={planes} pose={posed?.[id]} />
  ));
}

/** 30 % opacity: the vague grey a ghost is drawn at. */
const GHOST_OPACITY = 0.3;

/** After the transparent bodies: the faces mark the stencil before their halo tests it. */
const FACES_ORDER = 1;
const HALO_ORDER = 2;

function GhostBody({
  mesh,
  color,
  planes,
  pose,
}: {
  mesh: BodyMesh;
  color: Rgba;
  planes: Plane[] | null;
  pose: Matrix12 | undefined;
}) {
  const group = usePose(pose);
  const size = useThree((s) => s.size);
  const faces = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
    g.setAttribute(
      'haloNormal',
      new BufferAttribute(smoothNormals(mesh.positions, mesh.normals), 3),
    );
    g.setIndex(new BufferAttribute(mesh.indices, 1));
    return g;
  }, [mesh]);
  useEffect(() => () => faces.dispose(), [faces]);

  const faceColor = useMemo(() => new Color().setRGB(color.r, color.g, color.b, 'srgb'), [color]);
  // One material per shell, its width and the view's size as uniforms.
  const resolution = useMemo(() => new Vector2(1, 1), []);
  const shells = useMemo(
    () =>
      HALO_SHELLS.map(({ width, opacity }) => {
        const material = new MeshBasicMaterial({
          transparent: true,
          opacity,
          side: BackSide,
          depthWrite: false,
          // Only outside the ghost: where its faces didn't set the bit.
          stencilWrite: true,
          stencilRef: GHOST_STENCIL_BIT,
          stencilFuncMask: GHOST_STENCIL_BIT,
          stencilWriteMask: 0,
          stencilFunc: NotEqualStencilFunc,
          stencilFail: KeepStencilOp,
          stencilZFail: KeepStencilOp,
          stencilZPass: KeepStencilOp,
        });
        material.onBeforeCompile = haloPatch({
          uHaloWidth: { value: width },
          uHaloResolution: { value: resolution },
        });
        material.customProgramCacheKey = () => 'extrudo-ghost-halo';
        return material;
      }),
    [resolution],
  );
  useEffect(
    () => () => {
      for (const material of shells) material.dispose();
    },
    [shells],
  );
  resolution.set(size.width, size.height);
  for (const material of shells) {
    material.color = faceColor;
    material.clippingPlanes = planes;
  }

  return (
    <group ref={group}>
      <mesh geometry={faces} renderOrder={FACES_ORDER}>
        <meshStandardMaterial
          color={faceColor}
          roughness={0.9}
          metalness={0}
          // `transparent` from creation, never toggled (ADR-0030's amendment:
          // three bakes OPAQUE while it is false and never recompiles).
          transparent
          opacity={GHOST_OPACITY}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
          clippingPlanes={planes}
          // The faces mark where the ghost is, so its halo stays outside it (R3-06).
          stencilWrite
          stencilRef={GHOST_STENCIL_BIT}
          stencilWriteMask={GHOST_STENCIL_BIT}
          stencilFunc={AlwaysStencilFunc}
          stencilZPass={ReplaceStencilOp}
        />
      </mesh>
      {shells.map((material, i) => (
        <mesh
          // biome-ignore lint/suspicious/noArrayIndexKey: a shell is its place in the list
          key={i}
          geometry={faces}
          material={material}
          renderOrder={HALO_ORDER}
          frustumCulled={false}
        />
      ))}
    </group>
  );
}
