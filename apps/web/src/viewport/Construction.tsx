import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type Group,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Rgba } from './colors';
import {
  CONSTRUCTION_AXIS_HALF,
  CONSTRUCTION_PLANE_HALF,
  type ConstructionDrawing,
  type ConstructionState,
} from './constructionGeometry';
import { createDotMaterial } from './dots';
import { Plane } from './Origin';
import type { ViewportStore } from './store';

/**
 * Construction planes, axes and points (P3-05, FR-FT-13): what the kernel
 * reported for each shown construction feature. They keep a steady size on
 * screen like the origin planes; hovered and selected ones take the
 * highlight colour, a dialog's preview the preview colour (fainter while
 * dimmed). Picking is the view's (`selection/pick.ts`), not R3F events.
 */
export function Construction({
  store,
  items,
  color,
  highlight,
  preview,
  states,
}: {
  store: ViewportStore;
  items: readonly ConstructionDrawing[];
  color: Rgba;
  highlight: Rgba;
  preview: Rgba;
  /** Hover and selection by feature ID. */
  states: ReadonlyMap<string, ConstructionState>;
}) {
  return (
    <>
      {items.map((item) => {
        const state = states.get(item.id);
        const tint = item.preview ? preview : state ? highlight : color;
        const faded = item.dimmed ? { ...tint, a: tint.a * 0.4 } : tint;
        const { report } = item;
        if (report.kind === 'plane') {
          return (
            <PlaneShape
              key={`${item.id}${item.preview ? ':preview' : ''}`}
              store={store}
              frame={report.frame}
              anchor={report.anchor}
              color={faded}
              strong={state !== undefined || item.preview === true}
            />
          );
        }
        if (report.kind === 'axis') {
          return (
            <AxisLine
              key={`${item.id}${item.preview ? ':preview' : ''}`}
              store={store}
              origin={report.origin}
              direction={report.direction}
              color={faded}
              width={state ? 3 : 2}
            />
          );
        }
        return (
          <PointDot
            key={`${item.id}${item.preview ? ':preview' : ''}`}
            at={report.point}
            color={faded}
            big={state !== undefined}
          />
        );
      })}
    </>
  );
}

const rgb = (c: Rgba) => new Color().setRGB(c.r, c.g, c.b, 'srgb');

/** A plane's square: the frame's X and Y span it, scaled to a share of the view size. */
function PlaneShape({
  store,
  frame,
  anchor,
  color,
  strong,
}: {
  store: ViewportStore;
  frame: { x: readonly number[]; y: readonly number[]; normal: readonly number[] };
  anchor: readonly number[];
  color: Rgba;
  strong: boolean;
}) {
  const group = useRef<Group>(null);
  const rotation = useMemo(() => {
    const [x, y, n] = [frame.x, frame.y, frame.normal].map(
      (v) => new Vector3(v[0], v[1], v[2]),
    ) as [Vector3, Vector3, Vector3];
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, n));
  }, [frame.x, frame.y, frame.normal]);
  useFrame(() => {
    group.current?.scale.setScalar(store.getState().view.size * CONSTRUCTION_PLANE_HALF);
  });
  return (
    <group
      ref={group}
      position={[anchor[0] ?? 0, anchor[1] ?? 0, anchor[2] ?? 0]}
      quaternion={rotation}
    >
      <Plane color={color} strong={strong} rotation={[0, 0, 0]} />
    </group>
  );
}

/** A line through `origin` along `direction`, a share of the view size each way. */
function AxisLine({
  store,
  origin,
  direction,
  color,
  width,
}: {
  store: ViewportStore;
  origin: readonly number[];
  direction: readonly number[];
  color: Rgba;
  width: number;
}) {
  const group = useRef<Group>(null);
  const line = useMemo(() => {
    const g = new LineSegmentsGeometry();
    g.setPositions([-1, 0, 0, 1, 0, 0]);
    const m = new LineMaterial({ linewidth: width, transparent: true });
    const l = new LineSegments2(g, m);
    l.renderOrder = 4;
    l.frustumCulled = false;
    return l;
  }, [width]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      line.material.dispose();
    },
    [line],
  );
  line.material.color = rgb(color);
  line.material.opacity = color.a;
  const rotation = useMemo(
    () =>
      new Quaternion().setFromUnitVectors(
        new Vector3(1, 0, 0),
        new Vector3(direction[0], direction[1], direction[2]).normalize(),
      ),
    [direction],
  );
  useFrame(() => {
    group.current?.scale.setScalar(store.getState().view.size * CONSTRUCTION_AXIS_HALF);
  });
  return (
    <group
      ref={group}
      position={[origin[0] ?? 0, origin[1] ?? 0, origin[2] ?? 0]}
      quaternion={rotation}
    >
      <primitive object={line} />
    </group>
  );
}

/** A round dot with a fixed size in pixels. */
function PointDot({ at, color, big }: { at: readonly number[]; color: Rgba; big: boolean }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([at[0] ?? 0, at[1] ?? 0, at[2] ?? 0]), 3),
    );
    return g;
  }, [at]);
  const { material, uniforms } = useMemo(createDotMaterial, []);
  uniforms.uColor.value = rgb(color);
  uniforms.uAlpha.value = color.a;
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return (
    <points
      geometry={geometry}
      material={material}
      renderOrder={4}
      frustumCulled={false}
      onBeforeRender={(renderer) => {
        uniforms.uSize.value = (big ? 11 : 8) * renderer.getPixelRatio();
      }}
    />
  );
}
