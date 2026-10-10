/**
 * What the view draws for a joint (P6-05, ADR-0081 §6): its axis or direction as a dashed line,
 * with a small arc round it for a revolute or an arrowhead for a slider. Pure: unit-sized
 * segments along +Z, which `Joints.tsx` turns onto the joint's direction and scales with the
 * view so they keep a steady size on screen.
 */
import type { JointType } from '@extrudo/core';

/** A joint to draw: the kernel's axis (`JointReport.axis`). */
export interface JointDrawing {
  id: string;
  type: JointType;
  origin: readonly [number, number, number];
  direction: readonly [number, number, number];
}

/** Arc segments round the axis. */
const ARC_STEPS = 18;
/** The arc's radius and the arrowhead's size, as a share of the half line. */
const ARC_RADIUS = 0.25;
const HEAD = 0.12;

/** Segment end points (x, y, z per point, two points per segment) along +Z, half length 1. */
export function jointSegments(type: JointType): number[] {
  const out: number[] = [0, 0, -1, 0, 0, 1];
  if (type === 'revolute') {
    // Three quarters of a turn, right-handed about +Z, with an arrowhead at its end.
    const end = (3 * Math.PI) / 2;
    for (let i = 0; i < ARC_STEPS; i++) {
      const a = (end * i) / ARC_STEPS;
      const b = (end * (i + 1)) / ARC_STEPS;
      out.push(
        ARC_RADIUS * Math.cos(a),
        ARC_RADIUS * Math.sin(a),
        0,
        ARC_RADIUS * Math.cos(b),
        ARC_RADIUS * Math.sin(b),
        0,
      );
    }
    // At the end (0, -r), heading +x: the head's two barbs point back.
    out.push(0, -ARC_RADIUS, 0, -HEAD, -ARC_RADIUS + HEAD * 0.6, 0);
    out.push(0, -ARC_RADIUS, 0, -HEAD, -ARC_RADIUS - HEAD * 0.6, 0);
  } else if (type === 'slider') {
    out.push(0, 0, 1, HEAD * 0.6, 0, 1 - HEAD, 0, 0, 1, -HEAD * 0.6, 0, 1 - HEAD);
  }
  return out;
}
