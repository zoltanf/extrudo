import { House, RotateCcw, RotateCw, Triangle } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useLayoutEffect, useRef, useState } from 'react';
import { Matrix4, Quaternion } from 'three';
import { useStore } from 'zustand';
import { Tooltip } from '../design-system';
import { basis, orbit, turn, type Vec3, type View } from './camera';
import { ORBIT_RATE } from './navigation';
import type { ViewportStore } from './store';
import { type CubeFace, FACES, faceCells, faceOn, type Hotspot } from './viewcube';

/**
 * The ViewCube (FR-VP-02, UI spec §2): a CSS 3D cube of real buttons, so it
 * is crisp, themed by the tokens and reachable by keyboard and tests. Faces,
 * edges and corners turn the camera to that direction; dragging the cube
 * orbits; the house goes home. When the view is face-on, arrows turn to the
 * neighbouring faces and roll the view by 90°.
 *
 * The cube's transform follows the camera through a store subscription, not
 * React renders. No CSS perspective: the cube is drawn orthographically.
 */

/** Half the cube's edge, in px. */
const HALF = 30;
const DRAG_THRESHOLD = 3;

const back = (view: View): Vec3 => {
  const b = basis(view).back;
  return [b.x, b.y, b.z];
};

/** World → CSS screen for the cube: the camera's inverse rotation, with y flipped (CSS y points down). */
function cubeTransform(view: View): string {
  const rotation = new Matrix4().makeRotationFromQuaternion(
    new Quaternion(...view.orientation).invert(),
  );
  const m = new Matrix4().makeScale(1, -1, 1).multiply(rotation);
  return `matrix3d(${m.elements.map((e) => e.toFixed(6)).join(',')})`;
}

/** Face placement: columns are the label's right and down and the outward normal. */
function faceTransform(face: CubeFace): string {
  const [r, d, n] = [face.right, face.down, face.normal];
  const e = [...r, 0, ...d, 0, ...n, 0, n[0] * HALF, n[1] * HALF, n[2] * HALF, 1];
  return `matrix3d(${e.join(',')})`;
}

export function ViewCube({ store }: { store: ViewportStore }) {
  const cube = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string>();
  const drag = useRef<{ x: number; y: number; dragging: boolean }>(undefined);
  const faceOnName = useStore(store, (s) =>
    s.transition ? undefined : faceOn(back(s.view))?.name,
  );

  useLayoutEffect(() => {
    const apply = (view: View) => {
      if (cube.current) cube.current.style.transform = cubeTransform(view);
    };
    apply(store.getState().view);
    return store.subscribe((s, prev) => {
      if (s.view !== prev.view) apply(s.view);
    });
  }, [store]);

  const go = (h: Hotspot) => store.getState().lookFrom(h.direction);
  const turnBy = (axis: 'x' | 'y' | 'z', angle: number) => {
    const { view, animateTo } = store.getState();
    animateTo(turn(view, axis, angle));
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, dragging: false };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.dragging) {
      d.dragging = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    const { view, setView } = store.getState();
    setView(orbit(view, -dx * ORBIT_RATE, -dy * ORBIT_RATE));
    d.x = e.clientX;
    d.y = e.clientY;
  };
  const onPointerUp = () => {
    // A drag's click lands on the cube root, not on a hotspot, so no view change follows.
    drag.current = undefined;
  };

  const arrow = 'absolute grid size-6 place-items-center rounded-full text-muted hover:text-accent';

  return (
    <fieldset
      aria-label="ViewCube"
      className="absolute top-2 right-2 size-[132px] touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="absolute top-1/2 left-1/2"
        style={{ transformStyle: 'preserve-3d' }}
        ref={cube}
      >
        {FACES.map((face) => (
          <div
            key={face.name}
            className="absolute grid grid-cols-[22%_56%_22%] grid-rows-[22%_56%_22%] overflow-hidden rounded-[3px] border border-line"
            style={{
              width: HALF * 2,
              height: HALF * 2,
              left: -HALF,
              top: -HALF,
              transform: faceTransform(face),
              backfaceVisibility: 'hidden',
              background: 'color-mix(in srgb, var(--x-raised) 94%, transparent)',
            }}
          >
            {faceCells(face).map((cell) => (
              <button
                key={cell.name}
                type="button"
                aria-label={cell.name}
                tabIndex={cell.kind === 'face' ? 0 : -1}
                onClick={() => go(cell)}
                onPointerEnter={() => setHover(cell.name)}
                onPointerLeave={() => setHover((h) => (h === cell.name ? undefined : h))}
                className={`outline-none focus-visible:bg-accent-soft ${
                  hover === cell.name ? 'bg-accent-soft' : ''
                } ${cell.kind === 'face' ? 'text-[9.5px] font-semibold tracking-[0.08em] text-muted uppercase' : ''}`}
              >
                {cell.kind === 'face' && <span aria-hidden="true">{face.name}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>

      <Tooltip label="Home" hint="Front, right and top, fitted to the model.">
        <button
          type="button"
          aria-label="Home view"
          onClick={() => store.getState().home()}
          className="absolute top-0 left-0 grid size-6 place-items-center rounded-control text-muted hover:bg-accent-soft hover:text-ink"
        >
          <House size={14} strokeWidth={1.75} />
        </button>
      </Tooltip>

      {faceOnName && (
        <>
          <button
            type="button"
            aria-label="Turn to the face above"
            className={`${arrow} top-0 left-1/2 -translate-x-1/2`}
            onClick={() => turnBy('x', -Math.PI / 2)}
          >
            <Triangle size={9} fill="currentColor" strokeWidth={0} />
          </button>
          <button
            type="button"
            aria-label="Turn to the face below"
            className={`${arrow} bottom-0 left-1/2 -translate-x-1/2 rotate-180`}
            onClick={() => turnBy('x', Math.PI / 2)}
          >
            <Triangle size={9} fill="currentColor" strokeWidth={0} />
          </button>
          <button
            type="button"
            aria-label="Turn to the face on the left"
            className={`${arrow} top-1/2 left-0 -translate-y-1/2 -rotate-90`}
            onClick={() => turnBy('y', -Math.PI / 2)}
          >
            <Triangle size={9} fill="currentColor" strokeWidth={0} />
          </button>
          <button
            type="button"
            aria-label="Turn to the face on the right"
            className={`${arrow} top-1/2 right-0 -translate-y-1/2 rotate-90`}
            onClick={() => turnBy('y', Math.PI / 2)}
          >
            <Triangle size={9} fill="currentColor" strokeWidth={0} />
          </button>
          <button
            type="button"
            aria-label="Roll the view counter-clockwise"
            className={`${arrow} right-6 bottom-0`}
            onClick={() => turnBy('z', -Math.PI / 2)}
          >
            <RotateCcw size={13} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label="Roll the view clockwise"
            className={`${arrow} right-0 bottom-0`}
            onClick={() => turnBy('z', Math.PI / 2)}
          >
            <RotateCw size={13} strokeWidth={1.75} />
          </button>
        </>
      )}
    </fieldset>
  );
}
