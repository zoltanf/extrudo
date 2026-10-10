import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, type Group, Quaternion, Vector3 } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Rgba } from './colors';
import { type JointDrawing, jointSegments } from './jointGeometry';
import type { ViewportStore } from './store';

/** Half the drawn axis, as a share of the view size. */
export const JOINT_SIZE = 0.15;
/** Dash and gap, px. */
const DASH = 6;
const GAP = 4;

/**
 * Joints' axes (P6-05, ADR-0081 §6): a dashed line along each drawn joint's axis or
 * direction, an arc for a revolute, an arrowhead for a slider, at a steady size on screen.
 * No depth test, so an axis inside a body shows; never picked.
 */
export function Joints({
  store,
  joints,
  color,
}: {
  store: ViewportStore;
  joints: readonly JointDrawing[];
  color: Rgba;
}) {
  const height = useThree((s) => s.size.height);
  const material = useMemo(
    () =>
      new LineMaterial({
        linewidth: 1.75,
        transparent: true,
        dashed: true,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  material.color = new Color().setRGB(color.r, color.g, color.b, 'srgb');
  material.opacity = color.a;
  useFrame(() => {
    // The lines are drawn in unit space scaled by the group: dashes in that space.
    const size = store.getState().view.size;
    const perPixel = size / Math.max(1, height);
    const scale = size * JOINT_SIZE;
    material.dashSize = (DASH * perPixel) / scale;
    material.gapSize = (GAP * perPixel) / scale;
  });
  return (
    <>
      {joints.map((j) => (
        <JointMarks key={j.id} store={store} joint={j} material={material} />
      ))}
    </>
  );
}

function JointMarks({
  store,
  joint,
  material,
}: {
  store: ViewportStore;
  joint: JointDrawing;
  material: LineMaterial;
}) {
  const group = useRef<Group>(null);
  const line = useMemo(() => {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(jointSegments(joint.type));
    const l = new LineSegments2(geometry, material);
    l.computeLineDistances();
    l.renderOrder = 6;
    l.frustumCulled = false;
    return l;
  }, [joint.type, material]);
  useEffect(() => () => line.geometry.dispose(), [line]);
  const turn = useMemo(
    () =>
      new Quaternion().setFromUnitVectors(
        new Vector3(0, 0, 1),
        new Vector3(...joint.direction).normalize(),
      ),
    [joint.direction],
  );
  useFrame(() => {
    group.current?.scale.setScalar(store.getState().view.size * JOINT_SIZE);
  });
  return (
    <group ref={group} position={[...joint.origin]} quaternion={turn}>
      <primitive object={line} />
    </group>
  );
}
