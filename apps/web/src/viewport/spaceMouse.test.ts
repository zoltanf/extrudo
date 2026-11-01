import { describe, expect, it } from 'vitest';
import { basis, homeView, type View } from './camera';
import {
  choosePad,
  createSpaceMouse,
  type Hid,
  IDLE,
  type Pad,
  padKind,
  padName,
  readPad,
  readReport,
  type SpaceInput,
  spaceMotion,
  WHEEL_QUIET_MS,
} from './spaceMouse';

const report = (...values: number[]) => {
  const data = new DataView(new ArrayBuffer(values.length * 2));
  for (const [i, v] of values.entries()) data.setInt16(i * 2, v, true);
  return data;
};

const held = (
  t: [number, number, number],
  r: [number, number, number] = [0, 0, 0],
): SpaceInput => ({
  t,
  r,
  buttons: 0,
});

const options = { height: 600, aspect: 1.5, speed: 1 };

/** Where a world point shows across the view, relative to the target, in camera axes. */
function onScreen(view: View, point: [number, number, number]) {
  const { right, up } = basis(view);
  const [dx, dy, dz] = [
    point[0] - view.target[0],
    point[1] - view.target[1],
    point[2] - view.target[2],
  ];
  return {
    x: dx * right.x + dy * right.y + dz * right.z,
    y: dx * up.x + dy * up.y + dz * up.z,
  };
}

describe('readReport (ADR-0114)', () => {
  it('reads translation and rotation from their own reports (older models)', () => {
    let input = readReport(IDLE, 1, report(350, -350, 0));
    input = readReport(input, 2, report(0, 0, 350));
    expect(input.t).toEqual([1, -1, 0]);
    expect(input.r).toEqual([0, 0, 1]);
  });

  it('reads both from one 12-byte report (newer models)', () => {
    const input = readReport(IDLE, 1, report(0, 0, 175, 350, 0, 0));
    expect(input.t[2]).toBeGreaterThan(0);
    expect(input.t[2]).toBeLessThan(0.5); // squared: half way is a quarter speed
    expect(input.r).toEqual([1, 0, 0]);
  });

  it('treats a cap barely off centre as at rest, and clamps past full', () => {
    expect(readReport(IDLE, 1, report(8, -10, 5)).t).toEqual([0, 0, 0]);
    expect(readReport(IDLE, 1, report(600, 0, 0)).t[0]).toBe(1);
  });

  it('reads the buttons and ignores other reports', () => {
    const data = new DataView(new Uint8Array([0b10, 0]).buffer);
    expect(readReport(IDLE, 3, data).buttons).toBe(2);
    expect(readReport(IDLE, 23, report(1, 2, 3))).toBe(IDLE);
  });
});

const pad = (id: string, axes: number[], pressed: number[] = [], connected = true): Pad => ({
  id,
  connected,
  axes,
  buttons: pressed.map((p) => ({ pressed: p === 1 })),
});

describe('gamepads (ADR-0114 amendment): the 3D mouse the browser lists', () => {
  it('knows 3D mice by the ids Chromium browsers and Firefox give them', () => {
    expect(padKind('SpaceMouse Compact (Vendor: 256f Product: c635)')).toBe('device');
    expect(padKind('SpaceNavigator (STANDARD GAMEPAD Vendor: 046d Product: c626)')).toBe('device');
    expect(padKind('46d-c62b-SpaceMouse Pro')).toBe('device');
    expect(padKind('Unknown Gamepad (Vendor: beef Product: 046d)')).toBe('joystick');
    expect(padKind('beef-046d-Unknown Gamepad')).toBe('joystick');
    for (const id of [
      'Logitech Dual Action (STANDARD GAMEPAD Vendor: 046d Product: c216)',
      '046d-c21d-Logitech Gamepad F310',
      'Xbox 360 Controller (XInput STANDARD GAMEPAD)',
      'beef-046e-Unknown Gamepad',
      'SpaceMouse Pro',
      '',
    ])
      expect(padKind(id), id).toBeUndefined();
  });

  it('names the device without the ids', () => {
    expect(padName('SpaceMouse Compact (Vendor: 256f Product: c635)')).toBe('SpaceMouse Compact');
    expect(padName('SpaceNavigator (STANDARD GAMEPAD Vendor: 046d Product: c626)')).toBe(
      'SpaceNavigator',
    );
    expect(padName('256f-c635-SpaceMouse Compact')).toBe('SpaceMouse Compact');
    expect(padName('Vendor: 256f Product: c635')).toBe('3D mouse');
  });

  it('reads the six axes like the HID reports, and the buttons in order', () => {
    const input = readPad(pad('x', [1, -1, 0.5, 0, 0, Number.NaN], [0, 1]));
    expect(input?.t).toEqual([1, -1, readReport(IDLE, 1, report(0, 0, 175)).t[2]]);
    expect(input?.r).toEqual([0, 0, 0]);
    expect(input?.buttons).toBe(2);
    expect(readPad(pad('x', [1, 1, 1, 1, 1]))).toBeUndefined(); // a joystick with fewer axes
  });

  it('takes the device before the virtual joystick, and only connected ones', () => {
    const device = pad('SpaceMouse Compact (Vendor: 256f Product: c635)', [0, 0, 0, 0, 0, 0]);
    const joystick = pad('beef-046d-Unknown Gamepad', [0, 0, 0, 0, 0, 0]);
    const other = pad('046d-c21d-Logitech Gamepad F310', [0, 0, 0, 0, 0, 0]);
    expect(choosePad([null, joystick, other, device])).toBe(device);
    expect(choosePad([other, joystick])).toBe(joystick);
    expect(choosePad([other, { ...device, connected: false }])).toBeUndefined();
  });
});

describe('spaceMotion: the model follows the cap', () => {
  const home = homeView();
  const origin: [number, number, number] = [0, 0, 0];

  it('pans: cap right moves the model right, cap down moves it down', () => {
    const right = spaceMotion(home, held([1, 0, 0]), 0.1, options);
    expect(onScreen(right, origin).x).toBeGreaterThan(0);
    const down = spaceMotion(home, held([0, 0, 1]), 0.1, options);
    expect(onScreen(down, origin).y).toBeLessThan(0);
  });

  it('zooms: cap pulled towards the user brings the model closer', () => {
    expect(spaceMotion(home, held([0, 1, 0]), 0.1, options).size).toBeLessThan(home.size);
    expect(spaceMotion(home, held([0, -1, 0]), 0.1, options).size).toBeGreaterThan(home.size);
  });

  it('twists like a turntable: the model turns the way the cap does', () => {
    // The cap twisted clockwise seen from above (+z is down): a point in front of the target
    // (−Y) swings to the left on screen.
    const v = spaceMotion(home, held([0, 0, 0], [0, 0, 1]), 0.1, options);
    expect(onScreen(v, [0, -10, 0]).x).toBeLessThan(onScreen(home, [0, -10, 0]).x);
  });

  it('tilts: the cap tipped away tips the model away (its top goes back)', () => {
    // A right-handed turn about the device's x (right) axis tips the cap's top towards the user,
    // so −rx tips it away: the point straight above the target on screen moves away from the
    // camera.
    const { up } = basis(home);
    const top: [number, number, number] = [up.x * 10, up.y * 10, up.z * 10];
    const v = spaceMotion(home, held([0, 0, 0], [-1, 0, 0]), 0.1, options);
    const { back } = basis(v);
    expect(top[0] * back.x + top[1] * back.y + top[2] * back.z).toBeLessThan(0);
  });

  it('scales with time and speed, and leaves the view alone at rest', () => {
    const slow = spaceMotion(home, held([0, 1, 0]), 0.1, { ...options, speed: 0.5 });
    const fast = spaceMotion(home, held([0, 1, 0]), 0.05, { ...options, speed: 1 });
    expect(slow.size).toBeCloseTo(fast.size);
    expect(spaceMotion(home, IDLE, 0.1, options)).toBe(home);
  });
});

class FakeDevice extends EventTarget {
  opened = false;
  constructor(readonly productName: string) {
    super();
  }
  async open() {
    this.opened = true;
  }
  send(reportId: number, data: DataView) {
    this.dispatchEvent(Object.assign(new Event('inputreport'), { device: this, reportId, data }));
  }
}

class FakeHid extends EventTarget implements Hid {
  constructor(
    readonly allowed: FakeDevice[],
    readonly offered: FakeDevice[] = [],
  ) {
    super();
  }
  async getDevices() {
    return this.allowed;
  }
  async requestDevice() {
    return this.offered;
  }
}

describe('createSpaceMouse', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('opens allowed devices, moves the sink once per frame while held, and presses buttons', async () => {
    const device = new FakeDevice('SpaceMouse Compact');
    const frames: ((now: number) => void)[] = [];
    const mouse = createSpaceMouse(new FakeHid([device]), { frame: (cb) => frames.push(cb) });
    const moves: number[] = [];
    const presses: number[] = [];
    mouse.attach({ move: (_input, dt) => moves.push(dt), press: (b) => presses.push(b) });
    await flush();
    expect(mouse.devices()).toEqual(['SpaceMouse Compact']);

    device.send(1, report(350, 0, 0));
    device.send(1, report(350, 0, 0));
    expect(frames).toHaveLength(1); // one frame scheduled, however many reports
    frames.shift()?.(1000);
    frames.shift()?.(1020);
    expect(moves).toEqual([1 / 60, 0.02]);

    device.send(1, report(0, 0, 0));
    frames.shift()?.(1040);
    expect(frames).toHaveLength(0); // at rest: no more frames
    expect(moves).toHaveLength(2);

    device.send(3, new DataView(new Uint8Array([0b11]).buffer));
    device.send(3, new DataView(new Uint8Array([0b11]).buffer));
    expect(presses).toEqual([0, 1]); // once per press, not per report
  });

  it('connects a device the user picks and forgets it when unplugged', async () => {
    const device = new FakeDevice('SpaceNavigator');
    const hid = new FakeHid([], [device]);
    const mouse = createSpaceMouse(hid, { frame: () => 0 });
    let changes = 0;
    mouse.subscribe(() => changes++);
    await mouse.connect();
    expect(mouse.devices()).toEqual(['SpaceNavigator']);
    hid.dispatchEvent(Object.assign(new Event('disconnect'), { device }));
    expect(mouse.devices()).toEqual([]);
    expect(changes).toBe(2);
  });

  it('is unsupported without WebHID or gamepads, and not connectable without WebHID', () => {
    expect(createSpaceMouse(undefined).supported).toBe(false);
    const pads = createSpaceMouse(undefined, { gamepads: () => [] });
    expect(pads.supported).toBe(true);
    expect(pads.connectable).toBe(false);
  });

  it('reads the gamepad while no HID device is open: polled at rest, every frame while held', async () => {
    let listed: (Pad | null)[] = [];
    let poll: (() => void) | undefined;
    const frames: ((now: number) => void)[] = [];
    const mouse = createSpaceMouse(new FakeHid([]), {
      frame: (cb) => frames.push(cb),
      gamepads: () => listed,
      interval: (cb) => {
        poll = cb;
      },
    });
    const moves: SpaceInput[] = [];
    const presses: number[] = [];
    mouse.attach({ move: (input) => moves.push(input), press: (b) => presses.push(b) });
    let changes = 0;
    mouse.subscribe(() => changes++);
    expect(poll).toBeDefined();
    poll?.();
    expect(mouse.devices()).toEqual([]);
    expect(frames).toHaveLength(0);

    // The browser lists the device once it has been moved on the page.
    listed = [null, pad('SpaceMouse Compact (Vendor: 256f Product: c635)', [1, 0, 0, 0, 0, 0])];
    poll?.();
    expect(mouse.devices()).toEqual(['SpaceMouse Compact']);
    expect(changes).toBe(1);
    expect(frames).toHaveLength(1);
    frames.shift()?.(1000);
    expect(moves.map((m) => m.t[0])).toEqual([1]);
    // Each frame reads the pad afresh, without waiting for the poll.
    listed = [null, pad('SpaceMouse Compact (Vendor: 256f Product: c635)', [0, 0, 0, 0, 0, -1])];
    frames.shift()?.(1020);
    expect(moves.map((m) => m.r[2])).toEqual([0, -1]);
    listed = [
      null,
      pad('SpaceMouse Compact (Vendor: 256f Product: c635)', [0, 0, 0, 0, 0, 0], [1]),
    ];
    frames.shift()?.(1040);
    expect(frames).toHaveLength(0);
    expect(moves).toHaveLength(2);
    expect(presses).toEqual([0]);
    // Unplugged: forgotten.
    listed = [];
    poll?.();
    expect(mouse.devices()).toEqual([]);
  });

  it('reads the gamepad until an open HID device sends a report, then leaves it alone', async () => {
    const device = new FakeDevice('SpaceMouse Compact');
    const id = 'SpaceMouse Compact (Vendor: 256f Product: c635)';
    let listed = [pad(id, [1, 0, 0, 0, 0, 0])];
    let poll: (() => void) | undefined;
    const frames: ((now: number) => void)[] = [];
    const mouse = createSpaceMouse(new FakeHid([device]), {
      frame: (cb) => frames.push(cb),
      gamepads: () => listed,
      interval: (cb) => {
        poll = cb;
      },
      target: new EventTarget(),
    });
    const moves: SpaceInput[] = [];
    mouse.attach({ move: (input) => moves.push(input), press: () => {} });
    await flush();
    // Opened again from an earlier visit, but silent: the gamepad still drives the view.
    expect(mouse.devices()).toEqual(['SpaceMouse Compact']);
    poll?.();
    expect(mouse.devices()).toEqual(['SpaceMouse Compact']); // the same device, named once
    frames.shift()?.(1000);
    expect(moves.map((m) => m.t[0])).toEqual([1]);

    // The device reports: it takes over, and the gamepad's push does not carry over.
    device.send(2, report(0, 0, 350));
    expect(mouse.devices()).toEqual(['SpaceMouse Compact']);
    frames.shift()?.(1020);
    expect(moves[1]?.t).toEqual([0, 0, 0]);
    expect(moves[1]?.r).toEqual([0, 0, 1]);
    listed = [pad(id, [-1, 0, 0, 0, 0, 0])];
    poll?.();
    device.send(2, report(0, 0, 0));
    frames.shift()?.(1040);
    expect(frames).toHaveLength(0); // at rest: the gamepad's reading is ignored
    expect(moves).toHaveLength(2);
  });

  it('reads the gamepad afresh when asked whether the cap moves (the first wheel turn of a push)', () => {
    const id = 'SpaceMouse Compact (Vendor: 256f Product: c635)';
    let listed = [pad(id, [0, 0, 0, 0, 0, 0])];
    let poll: (() => void) | undefined;
    const mouse = createSpaceMouse(undefined, {
      frame: () => 0,
      now: () => 1000,
      gamepads: () => listed,
      interval: (cb) => {
        poll = cb;
      },
      target: new EventTarget(),
    });
    mouse.attach({ move: () => {}, press: () => {} });
    poll?.();
    expect(mouse.recentlyMoving()).toBe(false);
    listed = [pad(id, [0, 0.5, 0, 0, 0, 0])]; // pushed since the last poll
    expect(mouse.recentlyMoving()).toBe(true);
  });

  it('drops wheel events anywhere in the app while the cap moves, and only then', async () => {
    const device = new FakeDevice('SpaceMouse Compact');
    const target = new EventTarget();
    let clock = 1000;
    const mouse = createSpaceMouse(new FakeHid([device]), {
      frame: () => 0,
      now: () => clock,
      target,
    });
    mouse.attach({ move: () => {}, press: () => {} });
    await flush();
    const wheel = () => {
      const e = new Event('wheel', { cancelable: true });
      target.dispatchEvent(e);
      return e;
    };
    let e = wheel();
    expect(e.defaultPrevented).toBe(false);
    expect(e.cancelBubble).toBe(false);
    device.send(1, report(0, 200, 0));
    e = wheel();
    expect(e.defaultPrevented).toBe(true); // no page zoom, no panel scrolling
    expect(e.cancelBubble).toBe(true); // nor the view's own zoom
    device.send(1, report(0, 0, 0));
    clock += WHEEL_QUIET_MS + 1;
    expect(wheel().defaultPrevented).toBe(false);
  });

  it('reports the cap as recently moving for a moment after it comes to rest (the wheel filter)', async () => {
    const device = new FakeDevice('SpaceMouse Compact');
    let clock = 1000;
    const mouse = createSpaceMouse(new FakeHid([device]), { frame: () => 0, now: () => clock });
    mouse.attach({ move: () => {}, press: () => {} });
    await flush();
    expect(mouse.recentlyMoving()).toBe(false);
    device.send(1, report(0, 200, 0));
    expect(mouse.recentlyMoving()).toBe(true);
    clock += 10_000;
    expect(mouse.recentlyMoving()).toBe(true); // still held
    device.send(1, report(0, 0, 0));
    expect(mouse.recentlyMoving()).toBe(true);
    expect(mouse.recentlyMoving(clock + WHEEL_QUIET_MS)).toBe(true);
    expect(mouse.recentlyMoving(clock + WHEEL_QUIET_MS + 1)).toBe(false);
    // A cap resting inside the dead zone never counts.
    device.send(1, report(5, 0, 0));
    expect(mouse.recentlyMoving(clock + 1000)).toBe(false);
  });
});
