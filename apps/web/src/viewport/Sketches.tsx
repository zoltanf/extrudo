import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Rgba } from './colors';
import { createDotMaterial } from './dots';
import { type SketchDrawing, sketchSegments } from './sketchGeometry';
import type { ViewportStore } from './store';

/**
 * Sketch geometry in 3D (P1-01, UI spec §4): curves as screen-space lines on
 * their plane, construction curves dashed, and the points of the sketch being
 * edited as dots. Constraint status colours (fully constrained, conflicting)
 * arrive with the solver (P1-08); until then every curve is `sketch` blue.
 */

export interface SketchesProps {
  store: ViewportStore;
  sketches: readonly SketchDrawing[];
  /** Under-constrained geometry. */
  sketch: Rgba;
  /** Construction geometry (`muted`). */
  construction: Rgba;
  /** Draw the points of the sketch being edited. */
  showPoints: boolean;
}

/** Construction dashes, in px (docs/05-brand.md §3.4). */
const DASH = 6;
const GAP = 4;

export function Sketches({ store, sketches, sketch, construction, showPoints }: SketchesProps) {
  return sketches.map((s) => (
    <Sketch
      key={s.id}
      store={store}
      drawing={s}
      color={sketch}
      construction={construction}
      showPoints={showPoints}
    />
  ));
}

const color = (c: Rgba) => new Color().setRGB(c.r, c.g, c.b, 'srgb');

function Sketch({
  store,
  drawing,
  color: c,
  construction,
  showPoints,
}: {
  store: ViewportStore;
  drawing: SketchDrawing;
  color: Rgba;
  construction: Rgba;
  showPoints: boolean;
}) {
  const { data, frame, active } = drawing;
  const segments = useMemo(() => sketchSegments(data, frame), [data, frame]);

  const { solid, dashed, points } = useMemo(() => {
    const solid = new LineSegmentsGeometry();
    if (segments.solid.length > 0) solid.setPositions(segments.solid);
    const dashed = new LineSegmentsGeometry();
    if (segments.construction.length > 0) dashed.setPositions(segments.construction);
    const points = new BufferGeometry();
    points.setAttribute('position', new BufferAttribute(segments.points, 3));
    return { solid, dashed, points };
  }, [segments]);

  const materials = useMemo(
    () => ({
      solid: new LineMaterial({ linewidth: 1.75, transparent: true }),
      dashed: new LineMaterial({ linewidth: 1.25, transparent: true, dashed: true }),
      dots: createDotMaterial(),
    }),
    [],
  );
  const lines = useMemo(() => {
    const solidLines = new LineSegments2(solid, materials.solid);
    const dashedLines = new LineSegments2(dashed, materials.dashed);
    // Needs positions: an empty geometry has no instanceStart attribute.
    if (segments.construction.length > 0) dashedLines.computeLineDistances();
    for (const l of [solidLines, dashedLines]) {
      l.renderOrder = 4;
      l.frustumCulled = false;
    }
    return { solid: solidLines, dashed: dashedLines };
  }, [solid, dashed, materials, segments]);

  useEffect(
    () => () => {
      solid.dispose();
      dashed.dispose();
      points.dispose();
    },
    [solid, dashed, points],
  );
  useEffect(
    () => () => {
      materials.solid.dispose();
      materials.dashed.dispose();
      materials.dots.material.dispose();
    },
    [materials],
  );

  // Sketches that aren't being edited stay visible, but step back.
  const alpha = active ? 1 : 0.55;
  materials.solid.color = color(c);
  materials.solid.opacity = c.a * alpha;
  materials.dashed.color = color(construction);
  materials.dashed.opacity = construction.a * alpha;
  materials.dots.uniforms.uColor.value = color(c);
  materials.dots.uniforms.uAlpha.value = c.a;

  // Keep the dashes a steady size on screen: the view size is the visible height in mm.
  const height = useThree((s) => s.size.height);
  useFrame(() => {
    const perPixel = store.getState().view.size / Math.max(1, height);
    materials.dashed.dashSize = DASH * perPixel;
    materials.dashed.gapSize = GAP * perPixel;
  });

  return (
    <group>
      {segments.solid.length > 0 && <primitive object={lines.solid} />}
      {segments.construction.length > 0 && <primitive object={lines.dashed} />}
      {active && showPoints && segments.points.length > 0 && (
        <points
          geometry={points}
          material={materials.dots.material}
          renderOrder={5}
          frustumCulled={false}
          onBeforeRender={(renderer) => {
            materials.dots.uniforms.uSize.value = 5 * renderer.getPixelRatio();
          }}
        />
      )}
    </group>
  );
}
