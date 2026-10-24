import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachPointerInput, type PointerHandlers, type ScreenPointer } from './pointer';
import type { ViewportStore } from './store';

// A fake requestAnimationFrame: frames run when the test says so.
let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const runFrame = () => {
  const due = [...frames.values()];
  frames = new Map();
  for (const f of due) f(0);
};

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => {
    frames.set(nextFrame, f);
    return nextFrame++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => {
  vi.unstubAllGlobals();
  frames = new Map();
});

function setup() {
  const el = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 300 }),
    setPointerCapture: () => {},
  }) as unknown as HTMLElement;
  const win = new EventTarget();
  const viewport = {
    getState: () => ({ preset: 'spindle', tool: undefined }),
    subscribe: () => () => {},
  } as unknown as ViewportStore;
  const log: string[] = [];
  const handlers: PointerHandlers = {
    onMove: (p: ScreenPointer) => log.push(`move ${p.x},${p.y}`),
    onClick: (p: ScreenPointer) => log.push(`click ${p.x},${p.y}`),
    onLeave: () => log.push('leave'),
  };
  const detach = attachPointerInput(el, viewport, handlers, () => {}, win);
  const pointer = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
    el.dispatchEvent(
      Object.assign(new Event(type), {
        clientX: x,
        clientY: y,
        pointerId: 1,
        button: 0,
        buttons: 0,
        ...extra,
      }),
    );
  return { log, pointer, detach };
}

describe('pointer input: one report per frame (ADR-0102 §2)', () => {
  it('two moves in a frame make one report, at the last position', () => {
    const { log, pointer } = setup();
    pointer('pointermove', 20, 30);
    pointer('pointermove', 50, 60);
    expect(log).toEqual([]);
    runFrame();
    expect(log).toEqual(['move 40,40']);
    runFrame();
    expect(log).toEqual(['move 40,40']);
  });

  it('a press flushes the pending report before it is handled', () => {
    const { log, pointer } = setup();
    pointer('pointermove', 20, 30);
    pointer('pointerdown', 20, 30, { buttons: 1 });
    expect(log).toEqual(['move 10,10']);
    pointer('pointerup', 20, 30);
    expect(log).toEqual(['move 10,10', 'click 10,10']);
    runFrame();
    expect(log).toEqual(['move 10,10', 'click 10,10']);
  });

  it('a release flushes the move before the click, and a leave before the leave', () => {
    const { log, pointer } = setup();
    pointer('pointerdown', 20, 30, { buttons: 1 });
    pointer('pointermove', 22, 31, { buttons: 1 });
    pointer('pointerup', 22, 31);
    expect(log).toEqual(['move 12,11', 'click 12,11']);
    pointer('pointermove', 100, 100);
    pointer('pointerleave', 100, 100);
    expect(log.slice(2)).toEqual(['move 90,80', 'leave']);
  });

  it('detaching cancels a pending report', () => {
    const { log, pointer, detach } = setup();
    pointer('pointermove', 20, 30);
    detach();
    runFrame();
    expect(log).toEqual([]);
  });
});
