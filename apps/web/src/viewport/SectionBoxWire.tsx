import { useEffect, useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments } from 'three';
import type { SectionBox } from '../section/clip';
import type { Rgba } from './colors';

/**
 * The section box's twelve edges as a thin wire (P4-12, ADR-0045): view geometry only, never
 * picked and never clipped (it marks the cut, it isn't the model).
 */
export function SectionBoxWire({ box, color }: { box: SectionBox; color: Rgba }) {
  const wire = useMemo(() => {
    const { center: c, half: h } = box;
    const corner = (i: number) => [
      c[0] + (i & 1 ? h[0] : -h[0]),
      c[1] + (i & 2 ? h[1] : -h[1]),
      c[2] + (i & 4 ? h[2] : -h[2]),
    ];
    const positions: number[] = [];
    // Corners that differ in exactly one bit share an edge.
    for (let i = 0; i < 8; i++)
      for (const bit of [1, 2, 4]) if (!(i & bit)) positions.push(...corner(i), ...corner(i | bit));
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const material = new LineBasicMaterial({ transparent: true, opacity: 0.85 });
    const lines = new LineSegments(geometry, material);
    lines.frustumCulled = false;
    lines.renderOrder = 5;
    return lines;
  }, [box]);
  useEffect(() => {
    const material = wire.material as LineBasicMaterial;
    material.color.setRGB(color.r, color.g, color.b, 'srgb');
  }, [wire, color]);
  useEffect(
    () => () => {
      wire.geometry.dispose();
      (wire.material as LineBasicMaterial).dispose();
    },
    [wire],
  );
  return <primitive object={wire} />;
}
