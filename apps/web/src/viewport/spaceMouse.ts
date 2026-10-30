/**
 * 3D mice (ADR-0114): a 3Dconnexion SpaceMouse or SpaceNavigator read over WebHID, in
 * Chromium browsers and the desktop app. No driver: the HID reports are parsed here and turned
 * into camera motion, so the device moves the view as if the model sat on its cap (push the cap
 * right and the model moves right; twist it and the model turns).
 */
import { orbit, pan, shiftOf, turn, type View, zoomAt } from './camera';

/** What the device is held at, each axis −1…1 in the device's own frame, plus its buttons. */
export interface SpaceInput {
  /** Translation: x right, y towards the user, z down. */
  t: readonly [number, number, number];
  /** Rotation about those axes, right-handed. */
  r: readonly [number, number, number];
  /** One bit per button. */
  buttons: number;
}

export const IDLE: SpaceInput = { t: [0, 0, 0], r: [0, 0, 0], buttons: 0 };

/** The devices asked for: 3Dconnexion's vendor ID, and the older ones made under Logitech's. */
export const SPACE_MOUSE_FILTERS = [
  { vendorId: 0x256f },
  { vendorId: 0x046d, usagePage: 0x01, usage: 0x08 },
] as const;

/** Full deflection, in raw counts (about ±350 on every model). */
const FULL = 350;
/** Below this the cap is at rest: it never reads exactly zero when let go. */
const DEAD_ZONE = 0.04;

function axis(data: DataView, offset: number): number {
  const v = Math.max(-1, Math.min(1, data.getInt16(offset, true) / FULL));
  const a = Math.abs(v);
  if (a < DEAD_ZONE) return 0;
  // Squared, so a light touch is fine control.
  const s = (a - DEAD_ZONE) / (1 - DEAD_ZONE);
  return Math.sign(v) * s * s;
}

const triple = (data: DataView, at: number): [number, number, number] => [
  axis(data, at),
  axis(data, at + 2),
  axis(data, at + 4),
];

/**
 * The input after one HID report. Report 1 carries the translation (and on newer models the
 * rotation after it, 12 bytes), report 2 the rotation, report 3 the buttons; anything else
 * (battery level, LEDs) leaves the input as it was.
 */
export function readReport(input: SpaceInput, reportId: number, data: DataView): SpaceInput {
  if (reportId === 1 && data.byteLength >= 6) {
    const t = triple(data, 0);
    return data.byteLength >= 12 ? { ...input, t, r: triple(data, 6) } : { ...input, t };
  }
  if (reportId === 2 && data.byteLength >= 6) return { ...input, r: triple(data, 0) };
  if (reportId === 3 && data.byteLength >= 1) {
    let buttons = 0;
    for (let i = 0; i < Math.min(4, data.byteLength); i++) buttons |= data.getUint8(i) << (8 * i);
    return { ...input, buttons: buttons >>> 0 };
  }
  return input;
}

export const moving = (input: SpaceInput) =>
  input.t.some((v) => v !== 0) || input.r.some((v) => v !== 0);

/** At full deflection and speed 1: view heights panned, e-fold zoom and radians turned per second. */
const PAN_RATE = 1.2;
const ZOOM_RATE = 1.6;
const TURN_RATE = 2;

/**
 * The view after holding `input` for `dt` seconds. `height` is the viewport's in pixels; `speed`
 * scales everything (the `spaceMouseSpeed` setting). The device frame maps to the camera's as
 * x → right, z → down, y → towards the viewer. The camera moves opposite to the model: the
 * twist turns about world Z like a turntable (the mouse's orbit), tilt and roll about the
 * camera's own axes.
 */
export function spaceMotion(
  view: View,
  input: SpaceInput,
  dt: number,
  options: { height: number; aspect: number; speed: number },
): View {
  const { height, aspect, speed } = options;
  const [tx, ty, tz] = input.t;
  const [rx, ry, rz] = input.r;
  const k = speed * dt;
  let next = view;
  if (tx !== 0 || tz !== 0)
    next = pan(next, tx * PAN_RATE * height * k, tz * PAN_RATE * height * k, height);
  // The cap pulled towards the user brings the model closer.
  if (ty !== 0) next = zoomAt(next, Math.exp(-ty * ZOOM_RATE * k), [shiftOf(next), 0], aspect);
  // Camera-frame rotation of the model: tilt about right (rx), twist about up (−rz), roll
  // about the axis towards the viewer (ry). The camera turns the other way.
  if (rz !== 0) next = orbit(next, rz * TURN_RATE * k, 0);
  if (rx !== 0) next = turn(next, 'x', -rx * TURN_RATE * k);
  if (ry !== 0) next = turn(next, 'z', -ry * TURN_RATE * k);
  return next;
}

// The slice of WebHID used here (not in TypeScript's DOM library).
interface HidDevice extends EventTarget {
  readonly opened: boolean;
  readonly productName: string;
  open(): Promise<void>;
}
interface HidInputReportEvent extends Event {
  readonly device: HidDevice;
  readonly reportId: number;
  readonly data: DataView;
}
interface HidConnectionEvent extends Event {
  readonly device: HidDevice;
}
export interface Hid extends EventTarget {
  getDevices(): Promise<HidDevice[]>;
  requestDevice(options: { filters: readonly object[] }): Promise<HidDevice[]>;
}

/** Where the motion goes: the viewport on screen (one at a time). */
export interface SpaceSink {
  /** Holding `input` for `dt` seconds. */
  move(input: SpaceInput, dt: number): void;
  /** A button went down (0 the left one, 1 the right one). */
  press(button: number): void;
}

export interface SpaceMouse {
  /** False where the browser has no WebHID (Firefox, Safari). */
  readonly supported: boolean;
  /** Names of the open devices (the same array until one opens or closes). */
  devices(): readonly string[];
  subscribe(listener: () => void): () => void;
  /** Asks for a device (needs a click: the browser shows its device chooser). */
  connect(): Promise<void>;
  /** Routes motion to `sink` until the returned function is called. */
  attach(sink: SpaceSink): () => void;
}

const MAX_DT = 0.05;

/**
 * Opens the devices already allowed, and any that is plugged in later, and turns their reports
 * into `move` calls once per animation frame while the cap is off centre.
 */
export function createSpaceMouse(
  hid: Hid | undefined,
  frame: (cb: (now: number) => void) => number = (cb) => requestAnimationFrame(cb),
): SpaceMouse {
  const open = new Set<HidDevice>();
  const listeners = new Set<() => void>();
  let sink: SpaceSink | undefined;
  let input = IDLE;
  let last: number | undefined;
  let scheduled = false;
  let started = false;
  let names: readonly string[] = [];

  const changed = () => {
    names = [...open].map((d) => d.productName || '3D mouse');
    for (const l of listeners) l();
  };

  const tick = (now: number) => {
    scheduled = false;
    if (!moving(input)) {
      last = undefined;
      return;
    }
    const dt = last === undefined ? 1 / 60 : Math.min(MAX_DT, (now - last) / 1000);
    last = now;
    sink?.move(input, dt);
    schedule();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    frame(tick);
  };

  const onReport = (e: Event) => {
    const { reportId, data } = e as HidInputReportEvent;
    const before = input.buttons;
    input = readReport(input, reportId, data);
    const pressed = input.buttons & ~before;
    for (let b = 0; b < 32; b++) if (pressed & (1 << b)) sink?.press(b);
    if (moving(input)) schedule();
  };

  const add = async (device: HidDevice) => {
    if (open.has(device)) return;
    try {
      if (!device.opened) await device.open();
    } catch {
      return; // Held by another program, or unplugged meanwhile.
    }
    open.add(device);
    device.addEventListener('inputreport', onReport);
    changed();
  };

  const start = () => {
    if (started || !hid) return;
    started = true;
    hid.addEventListener('connect', (e) => void add((e as HidConnectionEvent).device));
    hid.addEventListener('disconnect', (e) => {
      const { device } = e as HidConnectionEvent;
      if (!open.delete(device)) return;
      device.removeEventListener('inputreport', onReport);
      input = IDLE;
      changed();
    });
    // A held cap must not keep the view spinning while another window has the focus.
    globalThis.addEventListener?.('blur', () => {
      input = IDLE;
    });
    void hid.getDevices().then((devices) => Promise.all(devices.map(add)));
  };

  return {
    supported: hid !== undefined,
    devices: () => names,
    subscribe(listener) {
      start();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async connect() {
      if (!hid) return;
      start();
      const devices = await hid.requestDevice({ filters: SPACE_MOUSE_FILTERS });
      await Promise.all(devices.map(add));
    },
    attach(next) {
      start();
      sink = next;
      return () => {
        if (sink === next) sink = undefined;
      };
    },
  };
}

/** The app's one 3D mouse connection. */
export const spaceMouse: SpaceMouse = createSpaceMouse(
  (globalThis.navigator as { hid?: Hid } | undefined)?.hid,
);
