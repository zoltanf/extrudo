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

/** A press that moves: what the drag becomes, by preset and by who listens (ADR-0090's amendment). */
function setupDrag(options: {
  preset?: string;
  box?: boolean;
  takes?: boolean;
  dragEnd?: boolean;
}) {
  const el = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
    setPointerCapture: () => {},
  }) as unknown as HTMLElement;
  const win = new EventTarget();
  const log: string[] = [];
  let view = { orientation: [0, 0, 0, 1] as [number, number, number, number] };
  const viewport = {
    getState: () => ({
      preset: options.preset ?? 'slicer',
      tool: undefined,
      view,
      setView: (v: typeof view) => {
        view = v;
        log.push('view');
      },
    }),
    subscribe: () => () => {},
  } as unknown as ViewportStore;
  const handlers: PointerHandlers = {
    onMove: () => {},
    onClick: (p: ScreenPointer) => log.push(`click ${p.x},${p.y}`),
    onLeave: () => {},
    onDragStart: () => {
      log.push('dragStart');
      return options.takes ?? false;
    },
    ...(options.dragEnd !== false && { onDragEnd: () => log.push('dragEnd') }),
    ...(options.box && { onBox: () => log.push('box') }),
  };
  attachPointerInput(
    el,
    viewport,
    handlers,
    (box) => log.push(box ? 'drawing' : 'undrawn'),
    win,
    (action) => log.push(`nav ${action}`),
  );
  const pointer = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
    el.dispatchEvent(
      Object.assign(new Event(type), {
        clientX: x,
        clientY: y,
        pointerId: 1,
        button: 0,
        buttons: 1,
        ...extra,
      }),
    );
  const drag = (extra: Record<string, unknown> = {}) => {
    pointer('pointerdown', 20, 30, extra);
    pointer('pointermove', 40, 50, extra);
    pointer('pointermove', 60, 50, extra);
    pointer('pointerup', 60, 50, { ...extra, buttons: 0 });
  };
  return { log, pointer, drag, view: () => view };
}

describe('a free left-drag in the Slicer preset', () => {
  it('orbits where a selection box would be drawn, and says so for the cursor', () => {
    const { log, drag, view } = setupDrag({ box: true });
    drag();
    expect(log).toEqual(['dragStart', 'nav orbit', 'view', 'view', 'nav undefined']);
    expect(view().orientation).not.toEqual([0, 0, 0, 1]);
  });

  it('orbits where nobody listens to the drag (plane picking)', () => {
    const { log, drag } = setupDrag({ dragEnd: false });
    drag();
    expect(log).toEqual(['dragStart', 'nav orbit', 'view', 'view', 'nav undefined']);
  });

  it('keeps the box with Shift, Ctrl or ⌘ (add to the selection)', () => {
    for (const mod of ['shiftKey', 'ctrlKey', 'metaKey']) {
      const { log, drag } = setupDrag({ box: true });
      drag({ [mod]: true });
      expect(log).toEqual(['dragStart', 'drawing', 'drawing', 'undrawn', 'box']);
    }
  });

  it("leaves a drag that a tool takes, and a drawing tool's untaken drag, to the tool", () => {
    const taken = setupDrag({ box: true, takes: true });
    taken.drag();
    expect(taken.log).toEqual(['dragStart', 'dragEnd']);
    const drawing = setupDrag({ takes: false });
    drawing.drag();
    expect(drawing.log).toEqual(['dragStart', 'dragEnd']);
  });

  it('still clicks, and orbits by the whole drag when its moves were coalesced away', () => {
    const { log, pointer, view } = setupDrag({ box: true });
    pointer('pointerdown', 20, 30);
    pointer('pointerup', 21, 30, { buttons: 0 });
    expect(log).toEqual(['click 21,30']);
    pointer('pointerdown', 20, 30);
    pointer('pointerup', 80, 90, { buttons: 0 });
    expect(log.slice(1)).toEqual(['dragStart', 'nav orbit', 'view', 'nav undefined']);
    expect(view().orientation).not.toEqual([0, 0, 0, 1]);
  });

  it('draws the box in every other preset', () => {
    const { log, drag } = setupDrag({ preset: 'spindle', box: true });
    drag();
    expect(log).toEqual(['dragStart', 'drawing', 'drawing', 'undrawn', 'box']);
  });
});
