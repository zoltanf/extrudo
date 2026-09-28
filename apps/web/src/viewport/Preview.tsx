import type { BodyMesh, PreviewToolStyle } from '@extrudo/kernel';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, FrontSide, MeshBasicMaterial } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { ViewPreview } from '../features/preview';
import { edgeSegments } from './Bodies';
import type { Rgba, SceneColors } from './colors';

/**
 * A feature dialog's live preview (UI spec §3.4, ADR-0027): the draft's
 * tools (or the bodies it changed) as translucent ghosts over the model,
 * coloured by what they do: new bodies in the preview blue, joins green,
 * cuts red, intersections violet. They are drawn through the bodies (no
 * depth test), so a cut inside a part shows where it removes material.
 * The model's bodies stay underneath, drawn and picked as usual. A dimmed
 * preview (invalid input, a failing draft) is fainter.
 */
export function PreviewShapes({
  preview,
  colors,
}: {
  preview: ViewPreview | undefined;
  colors: SceneColors;
}) {
  if (!preview) return null;
  return preview.shapes.map((shape, i) => (
    <PreviewShape
      // biome-ignore lint/suspicious/noArrayIndexKey: shapes have no identity; a new preview replaces them all.
      key={i}
      mesh={shape.mesh}
      color={styleColor(shape.style, colors)}
      dimmed={preview.dimmed}
    />
  ));
}

export function styleColor(style: PreviewToolStyle, colors: SceneColors): Rgba {
  switch (style) {
    case 'join':
      return colors.previewJoin;
    case 'cut':
      return colors.previewCut;
    case 'intersect':
      return colors.previewIntersect;
    default:
      return colors.preview;
  }
}

function PreviewShape({ mesh, color, dimmed }: { mesh: BodyMesh; color: Rgba; dimmed: boolean }) {
  const faces = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
    g.setIndex(new BufferAttribute(mesh.indices, 1));
    return g;
  }, [mesh]);
  const edges = useMemo(() => {
    const segments = edgeSegments(mesh);
    if (segments.length === 0) return undefined;
    const g = new LineSegmentsGeometry();
    g.setPositions(segments);
    return g;
  }, [mesh]);
  const fill = useMemo(
    () =>
      new MeshBasicMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: FrontSide,
      }),
    [],
  );
  const lines = useMemo(
    () => new LineMaterial({ linewidth: 1.5, transparent: true, depthTest: false }),
    [],
  );
  const outline = useMemo(
    () => (edges ? new LineSegments2(edges, lines) : undefined),
    [edges, lines],
  );
  useEffect(
    () => () => {
      faces.dispose();
      edges?.dispose();
    },
    [faces, edges],
  );
  useEffect(
    () => () => {
      fill.dispose();
      lines.dispose();
    },
    [fill, lines],
  );
  const rgb = new Color().setRGB(color.r, color.g, color.b, 'srgb');
  const fade = dimmed ? 0.4 : 1;
  fill.color = rgb;
  fill.opacity = color.a * fade;
  lines.color = rgb;
  lines.opacity = Math.min(1, color.a * 2.2) * fade;
  if (outline) outline.renderOrder = 9;
  return (
    <group>
      <mesh geometry={faces} material={fill} renderOrder={8} />
      {outline && <primitive object={outline} />}
    </group>
  );
}
