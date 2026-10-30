import { describe, expect, it } from 'vitest';
import { basis, homeView, type View } from './camera';
import {
  createSpaceMouse,
  type Hid,
  IDLE,
  readReport,
  type SpaceInput,
  spaceMotion,
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
    const mouse = createSpaceMouse(new FakeHid([device]), (cb) => frames.push(cb));
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
    const mouse = createSpaceMouse(hid, () => 0);
    let changes = 0;
    mouse.subscribe(() => changes++);
    await mouse.connect();
    expect(mouse.devices()).toEqual(['SpaceNavigator']);
    hid.dispatchEvent(Object.assign(new Event('disconnect'), { device }));
    expect(mouse.devices()).toEqual([]);
    expect(changes).toBe(2);
  });

  it('is unsupported without WebHID', () => {
    expect(createSpaceMouse(undefined).supported).toBe(false);
  });
});
