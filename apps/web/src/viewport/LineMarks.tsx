import { useEffect, useMemo } from 'react';
import { Color } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Rgba } from './colors';

/** World-space line segments (xyz pairs) drawn over a sketch: picked curves, marked regions. */
export function LineMarks({
  positions,
  color: c,
  width,
}: {
  positions: Float32Array;
  color: Rgba;
  width: number;
}) {
  const line = useMemo(() => {
    if (positions.length === 0) return undefined;
    const g = new LineSegmentsGeometry();
    g.setPositions(positions);
    const l = new LineSegments2(g, new LineMaterial({ linewidth: width, transparent: true }));
    l.renderOrder = 5;
    l.frustumCulled = false;
    return l;
  }, [positions, width]);
  useEffect(
    () => () => {
      line?.geometry.dispose();
      line?.material.dispose();
    },
    [line],
  );
  if (!line) return null;
  line.material.color = new Color().setRGB(c.r, c.g, c.b, 'srgb');
  line.material.opacity = c.a;
  return <primitive object={line} />;
}
