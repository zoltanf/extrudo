import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Rgba } from './colors';
import { createDotMaterial } from './dots';
import { type EntityStatus, type SketchDrawing, STATUSES, sketchSegments } from './sketchGeometry';
import type { ViewportStore } from './store';

/**
 * Sketch geometry in 3D (P1-01, UI spec §4): curves as screen-space lines on
 * their plane, construction curves dashed, and the points of the sketch being
 * edited as dots. The sketch being edited takes its constraint status
 * colours (P1-08): under-constrained `sketch` blue, fully constrained `ink`,
 * over-constrained `error` red. Construction geometry stays grey.
 */

export interface SketchesProps {
  store: ViewportStore;
  sketches: readonly SketchDrawing[];
  /** Curve and point colours by constraint status (`free` is also the colour without one). */
  colors: Readonly<Record<EntityStatus, Rgba>>;
  /** Construction geometry (`muted`). */
  construction: Rgba;
  /** Draw the points of the sketch being edited. */
  showPoints: boolean;
}

/** Construction dashes, in px (docs/05-brand.md §3.4). */
const DASH = 6;
const GAP = 4;

export function Sketches({ store, sketches, colors, construction, showPoints }: SketchesProps) {
  return sketches.map((s) => (
    <Sketch
      key={s.id}
      store={store}
      drawing={s}
      colors={colors}
      construction={construction}
      showPoints={showPoints}
    />
  ));
}

const color = (c: Rgba) => new Color().setRGB(c.r, c.g, c.b, 'srgb');

function Sketch({
  store,
  drawing,
  colors,
  construction,
  showPoints,
}: {
  store: ViewportStore;
  drawing: SketchDrawing;
  colors: Readonly<Record<EntityStatus, Rgba>>;
  construction: Rgba;
  showPoints: boolean;
}) {
  const { data, frame, active, status } = drawing;
  const segments = useMemo(() => sketchSegments(data, frame, status), [data, frame, status]);

  const geometries = useMemo(() => {
    const byStatus = (s: EntityStatus) => {
      const lines = new LineSegmentsGeometry();
      if (segments.curves[s].length > 0) lines.setPositions(segments.curves[s]);
      const points = new BufferGeometry();
      points.setAttribute('position', new BufferAttribute(segments.points[s], 3));
      return { lines, points };
    };
    const dashed = new LineSegmentsGeometry();
    if (segments.construction.length > 0) dashed.setPositions(segments.construction);
    return {
      status: Object.fromEntries(STATUSES.map((s) => [s, byStatus(s)])) as Record<
        EntityStatus,
        ReturnType<typeof byStatus>
      >,
      dashed,
    };
  }, [segments]);

  const materials = useMemo(
    () => ({
      status: Object.fromEntries(
        STATUSES.map((s) => [
          s,
          {
            lines: new LineMaterial({ linewidth: 1.75, transparent: true }),
            dots: createDotMaterial(),
          },
        ]),
      ) as Record<
        EntityStatus,
        { lines: LineMaterial; dots: ReturnType<typeof createDotMaterial> }
      >,
      dashed: new LineMaterial({ linewidth: 1.25, transparent: true, dashed: true }),
    }),
    [],
  );
  const lines = useMemo(() => {
    const dashed = new LineSegments2(geometries.dashed, materials.dashed);
    // Needs positions: an empty geometry has no instanceStart attribute.
    if (segments.construction.length > 0) dashed.computeLineDistances();
    const solid = Object.fromEntries(
      STATUSES.map((s) => [
        s,
        new LineSegments2(geometries.status[s].lines, materials.status[s].lines),
      ]),
    ) as Record<EntityStatus, LineSegments2>;
    for (const l of [dashed, ...Object.values(solid)]) {
      l.renderOrder = 4;
      l.frustumCulled = false;
    }
    return { solid, dashed };
  }, [geometries, materials, segments]);

  useEffect(
    () => () => {
      geometries.dashed.dispose();
      for (const g of Object.values(geometries.status)) {
        g.lines.dispose();
        g.points.dispose();
      }
    },
    [geometries],
  );
  useEffect(
    () => () => {
      materials.dashed.dispose();
      for (const m of Object.values(materials.status)) {
        m.lines.dispose();
        m.dots.material.dispose();
      }
    },
    [materials],
  );

  // Sketches that aren't being edited stay visible, but step back.
  const alpha = active ? 1 : 0.55;
  for (const s of STATUSES) {
    const c = colors[s];
    const m = materials.status[s];
    m.lines.color = color(c);
    m.lines.opacity = c.a * alpha;
    m.dots.uniforms.uColor.value = color(c);
    m.dots.uniforms.uAlpha.value = c.a;
  }
  materials.dashed.color = color(construction);
  materials.dashed.opacity = construction.a * alpha;

  // Keep the dashes a steady size on screen: the view size is the visible height in mm.
  const height = useThree((s) => s.size.height);
  useFrame(() => {
    const perPixel = store.getState().view.size / Math.max(1, height);
    materials.dashed.dashSize = DASH * perPixel;
    materials.dashed.gapSize = GAP * perPixel;
  });

  return (
    <group>
      {STATUSES.map(
        (s) => segments.curves[s].length > 0 && <primitive key={s} object={lines.solid[s]} />,
      )}
      {segments.construction.length > 0 && <primitive object={lines.dashed} />}
      {active &&
        showPoints &&
        STATUSES.map(
          (s) =>
            segments.points[s].length > 0 && (
              <points
                key={s}
                geometry={geometries.status[s].points}
                material={materials.status[s].dots.material}
                renderOrder={5}
                frustumCulled={false}
                onBeforeRender={(renderer) => {
                  materials.status[s].dots.uniforms.uSize.value = 5 * renderer.getPixelRatio();
                }}
              />
            ),
        )}
    </group>
  );
}
