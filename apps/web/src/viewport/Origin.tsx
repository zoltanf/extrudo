import type { OriginPlaneId } from '@extrudo/core';
import { type ThreeElements, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  type Group,
  Line,
  ShaderMaterial,
} from 'three';
import type { Rgba } from './colors';
import { createDotMaterial } from './dots';
import { GRID_RADIUS } from './Grid';
import type { OriginItem, ViewportStore } from './store';

/**
 * The origin (FR-VP-04): the point, the Z axis (X and Y are drawn by the
 * grid) and the three origin planes. They keep a steady size on screen: the
 * planes span a fixed share of the view, the Z axis runs as far as the grid.
 */

/** Half the width of an origin plane, as a share of the view size. */
const PLANE_HALF = 0.16;

const color = (c: Rgba) => new Color().setRGB(c.r, c.g, c.b, 'srgb');

export interface OriginProps {
  store: ViewportStore;
  visible: Record<OriginItem, boolean>;
  point: Rgba;
  axisZ: Rgba;
  construct: Rgba;
  /** Create Sketch is waiting for a plane: show all three and make them pickable. */
  picking?: boolean;
  /** The plane under the pointer (or under the prompt's button) while picking. */
  hover?: OriginPlaneId;
  /** Hover colour (`preselect`). */
  highlight?: Rgba;
  onHover?(plane: OriginPlaneId): void;
  /** The pointer left `plane`. Clear the hover only if it is still `plane`: events can arrive out of order. */
  onLeave?(plane: OriginPlaneId): void;
  onPick?(plane: OriginPlaneId): void;
}

const PLANES: readonly { item: 'xy' | 'xz' | 'yz'; rotation: [number, number, number] }[] = [
  { item: 'xy', rotation: [0, 0, 0] },
  { item: 'xz', rotation: [Math.PI / 2, 0, 0] },
  { item: 'yz', rotation: [0, Math.PI / 2, 0] },
];

/** A click that moved further than this (px) was a drag, not a pick. */
const CLICK_SLOP = 4;

export function Origin({
  store,
  visible,
  point,
  axisZ,
  construct,
  picking = false,
  hover,
  highlight = construct,
  onHover,
  onLeave,
  onPick,
}: OriginProps) {
  const axis = useRef<Group>(null);
  const planes = useRef<Group>(null);

  useFrame(() => {
    const { size } = store.getState().view;
    axis.current?.scale.set(1, 1, size * GRID_RADIUS);
    planes.current?.scale.setScalar(size * PLANE_HALF);
  });

  return (
    <>
      {visible.point && <OriginPoint color={point} />}
      <group ref={axis} visible={visible.z}>
        <ZAxis color={axisZ} />
      </group>
      <group ref={planes}>
        {PLANES.map(({ item, rotation }) => {
          const id = `origin:${item}` as const;
          if (!picking && !visible[item]) return null;
          const hovered = picking && hover === id;
          return (
            <Plane
              key={item}
              color={hovered ? highlight : construct}
              strong={hovered}
              rotation={rotation}
              events={
                picking
                  ? {
                      onPointerMove: (e) => {
                        // The nearest plane under the pointer wins.
                        e.stopPropagation();
                        onHover?.(id);
                      },
                      onPointerOut: () => onLeave?.(id),
                      onClick: (e) => {
                        if (e.delta > CLICK_SLOP) return;
                        e.stopPropagation();
                        onPick?.(id);
                      },
                    }
                  : undefined
              }
            />
          );
        })}
      </group>
    </>
  );
}

/** A round dot with a fixed size in pixels. */
function OriginPoint({ color: c }: { color: Rgba }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3));
    return g;
  }, []);
  const { material, uniforms } = useMemo(createDotMaterial, []);
  uniforms.uColor.value = color(c);
  uniforms.uAlpha.value = c.a * 0.9;
  return (
    <points
      geometry={geometry}
      material={material}
      renderOrder={3}
      frustumCulled={false}
      onBeforeRender={(renderer) => {
        uniforms.uSize.value = 7 * renderer.getPixelRatio();
      }}
    />
  );
}

/** The Z axis from −1 to 1 (scaled by the parent), fading out towards both ends like the grid axes. */
function ZAxis({ color: c }: { color: Rgba }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const z = [-1, -0.5, -0.1, 0.1, 0.5, 1];
    const alpha = [0, 0.5, 1, 1, 0.5, 0];
    g.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(z.flatMap((v) => [0, 0, v])), 3),
    );
    g.setAttribute('alpha', new BufferAttribute(new Float32Array(alpha), 1));
    return g;
  }, []);
  const uniforms = useMemo(() => ({ uColor: { value: new Color() } }), []);
  const line = useMemo(
    () =>
      new Line(
        geometry,
        new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          uniforms,
          vertexShader: /* glsl */ `
          attribute float alpha;
          varying float vAlpha;
          void main() {
            vAlpha = alpha;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
          fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          varying float vAlpha;
          void main() {
            gl_FragColor = vec4(uColor, vAlpha * 0.85);
            #include <colorspace_fragment>
          }
        `,
        }),
      ),
    [geometry, uniforms],
  );
  uniforms.uColor.value = color(c);
  return <primitive object={line} frustumCulled={false} renderOrder={2} />;
}

type PlaneEvents = Pick<ThreeElements['mesh'], 'onPointerMove' | 'onPointerOut' | 'onClick'>;

/** A square origin plane from −1 to 1 (scaled by the parent): a faint fill and an outline. */
function Plane({
  color: c,
  rotation,
  strong = false,
  events,
}: {
  color: Rgba;
  rotation: [number, number, number];
  strong?: boolean;
  events?: PlaneEvents;
}) {
  const outline = useMemo(() => {
    const g = new BufferGeometry();
    const corners = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];
    g.setAttribute('position', new BufferAttribute(new Float32Array(corners), 3));
    return g;
  }, []);
  const col = color(c);
  return (
    <group rotation={rotation}>
      <mesh renderOrder={2} {...events}>
        <planeGeometry args={[2, 2]} />
        <meshBasicMaterial
          color={col}
          transparent
          opacity={strong ? 0.3 : 0.1}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineLoop geometry={outline} renderOrder={2}>
        <lineBasicMaterial color={col} transparent opacity={strong ? 1 : 0.6} depthWrite={false} />
      </lineLoop>
    </group>
  );
}
