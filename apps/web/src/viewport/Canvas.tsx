import type { AttachmentId } from '@extrudo/core';
import { useEffect, useMemo, useState } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { useStore } from 'zustand';
import { type CanvasDrawing, canvasSize } from './canvasGeometry';
import {
  type CanvasImage,
  canvasImage,
  canvasPixelsStore,
  releaseCanvasImage,
} from './canvasImages';
import type { Rgba } from './colors';
import { createDotMaterial } from './dots';

/**
 * Canvas images (P4-06, ADR-0066 §5, FR-IO-07): a reference picture on a
 * plane, drawn as one textured quad — centred at X, Y in the plane's frame,
 * `width` wide and as tall as the picture's aspect, turned about the normal
 * and mirrored by Flip. It is view geometry, not a shape: the kernel reports
 * the frame and the bytes never leave the UI thread.
 *
 * The quad is drawn before the bodies (a canvas behind a body is hidden by
 * it, one in front lies over it) and under the sketches, so a trace draws
 * over its picture. It is **never picked** (`raycast` off): clicks pass
 * through to the model or to whatever the plane picker is doing (ADR-0049's
 * `placeAt` calibrates with them).
 */
export function Canvases({ items }: { items: readonly CanvasDrawing[] }) {
  return items.map((item) => <CanvasQuad key={item.id} item={item} />);
}

/** One canvas: its frame, its size, and the picture from its attachment. */
function CanvasQuad({ item }: { item: CanvasDrawing }) {
  const pixels = useStore(canvasPixelsStore, (s) => s.pixels[item.image]);
  const image = useCanvasImage(item.image);
  const size = canvasSize(item, pixels);
  const basis = useMemo(() => {
    const [x, y, n] = [item.frame.x, item.frame.y, item.frame.normal].map(
      (v) => new Vector3(v[0], v[1], v[2]),
    ) as [Vector3, Vector3, Vector3];
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, n));
  }, [item.frame.x, item.frame.y, item.frame.normal]);
  // Nothing to draw until the picture is decoded, and a preview that is out
  // of date is fainter, like construction's (P3-05).
  if (!image) return null;
  const opacity = item.dimmed ? item.opacity * 0.4 : item.opacity;
  const origin = item.frame.origin;
  return (
    <group position={[origin[0] ?? 0, origin[1] ?? 0, origin[2] ?? 0]} quaternion={basis}>
      <mesh
        position={[item.x, item.y, 0]}
        rotation={[0, 0, (item.rotation * Math.PI) / 180]}
        // Flip mirrors the picture left–right; the material is two-sided, so
        // the quad is seen from behind the plane too.
        scale={[item.flip ? -1 : 1, 1, 1]}
        renderOrder={0}
        raycast={never}
      >
        <planeGeometry args={[size[0], size[1]]} />
        <meshBasicMaterial
          map={image.texture}
          transparent
          opacity={opacity}
          // A canvas lies on the model: it never hides what is in front of it.
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
}

/** An attachment's decoded picture for this canvas, released when it goes. */
function useCanvasImage(id: AttachmentId): CanvasImage | undefined {
  const [image, setImage] = useState<CanvasImage>();
  useEffect(() => {
    let live = true;
    void canvasImage(id).then((loaded) => {
      if (live) setImage(loaded);
    });
    return () => {
      live = false;
      releaseCanvasImage(id);
    };
  }, [id]);
  return image;
}

/** Never picked: a click over a canvas is a click on what is behind it. */
const never = () => null;

const rgb = (c: Rgba) => new Color().setRGB(c.r, c.g, c.b, 'srgb');

/**
 * The two points a calibration marked, as dots with a line between them, in
 * the accent colour: what the user is measuring against (ADR-0066 §5). They
 * live on the plane the dialog picked, in world mm, so the view needs no
 * more than the points.
 */
export function CalibrationMarks({
  points,
  color,
}: {
  points: readonly (readonly number[])[];
  color: Rgba;
}) {
  if (points.length === 0) return null;
  return (
    <>
      {/* The points are world points: their coordinates are their identity. */}
      {points.map((at) => (
        <MarkDot key={at.join(',')} at={at} color={color} />
      ))}
      {points.length === 2 && <MarkLine points={points} color={color} />}
    </>
  );
}

function MarkDot({ at, color }: { at: readonly number[]; color: Rgba }) {
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
  uniforms.uAlpha.value = 1;
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return <points geometry={geometry} material={material} renderOrder={9} frustumCulled={false} />;
}

function MarkLine({ points, color }: { points: readonly (readonly number[])[]; color: Rgba }) {
  const line = useMemo(() => {
    const [a, b] = points as [readonly number[], readonly number[]];
    const g = new LineSegmentsGeometry();
    g.setPositions([a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, b[0] ?? 0, b[1] ?? 0, b[2] ?? 0]);
    const m = new LineMaterial({ linewidth: 2, transparent: true });
    const l = new LineSegments2(g, m);
    l.renderOrder = 9;
    l.frustumCulled = false;
    return l;
  }, [points]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      line.material.dispose();
    },
    [line],
  );
  line.material.color = rgb(color);
  line.material.opacity = color.a;
  return <primitive object={line} />;
}
