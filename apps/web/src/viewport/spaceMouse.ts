/**
 * 3D mice (ADR-0114): a 3Dconnexion SpaceMouse or SpaceNavigator read over WebHID, in
 * Chromium browsers and the desktop app, or as the gamepad the browser lists it as (the
 * amendment of 2026-10-31). No driver: the HID reports are parsed here and turned into camera
 * motion, so the device moves the view as if the model sat on its cap (push the cap right and
 * the model moves right; twist it and the model turns).
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

/** A deflection −1…1 shaped for the camera: the dead zone, then squared so a light touch is fine control. */
function shape(v: number): number {
  const a = Math.abs(v);
  if (!(a >= DEAD_ZONE)) return 0; // NaN included
  const s = (Math.min(1, a) - DEAD_ZONE) / (1 - DEAD_ZONE);
  return Math.sign(v) * s * s;
}

const axis = (data: DataView, offset: number) => shape(data.getInt16(offset, true) / FULL);

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

/** The slice of the Gamepad API used here. */
export interface Pad {
  readonly id: string;
  readonly connected: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
}

/** The older devices' product IDs under Logitech's vendor ID (usb.ids); Logitech's gamepads share the vendor. */
const LOGITECH_3D_MICE = new Set([
  0xc603, 0xc605, 0xc606, 0xc621, 0xc623, 0xc625, 0xc626, 0xc627, 0xc628, 0xc629, 0xc62b,
]);

/**
 * What a gamepad is, from the id the browser gives it (`SpaceMouse Compact (Vendor: 256f
 * Product: c635)` in Chromium browsers, `256f-c635-SpaceMouse Compact` in Firefox): the device
 * itself, 3DxWare's virtual joystick (which can carry the cap's six axes where the browser doesn't
 * list the device), or neither.
 */
export function padKind(id: string): 'device' | 'joystick' | undefined {
  const m =
    /Vendor: ([0-9a-f]{1,4}) Product: ([0-9a-f]{1,4})/i.exec(id) ??
    /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id);
  if (!m) return undefined;
  const [vendor, product] = [Number.parseInt(m[1] ?? '', 16), Number.parseInt(m[2] ?? '', 16)];
  if (vendor === 0x256f) return 'device';
  if (vendor === 0x046d) return LOGITECH_3D_MICE.has(product) ? 'device' : undefined;
  return vendor === 0xbeef && product === 0x046d ? 'joystick' : undefined;
}

/** The gamepad's name without the ids the browser appends or prepends. */
export const padName = (id: string) =>
  (/Vendor: /.test(id)
    ? id.replace(/\s*\(?(STANDARD GAMEPAD )?Vendor: .*$/i, '')
    : id.replace(/^[^-]*-[^-]*-/, '')) || '3D mouse';

/**
 * The input a 3D mouse reports as a gamepad: six axes −1…1 in the device's own order and signs
 * (its ±350 scaled by the browser), fewer than six is no 3D mouse; the buttons in order.
 */
export function readPad(pad: Pad): SpaceInput | undefined {
  if (pad.axes.length < 6) return undefined;
  const a = (i: number) => shape(pad.axes[i] ?? 0);
  let buttons = 0;
  for (const [i, b] of pad.buttons.slice(0, 32).entries()) if (b.pressed) buttons |= 1 << i;
  return { t: [a(0), a(1), a(2)], r: [a(3), a(4), a(5)], buttons: buttons >>> 0 };
}

/** The 3D mouse among the gamepads listed: the first device, else the first virtual joystick. */
export function choosePad(pads: readonly (Pad | null)[]): Pad | undefined {
  let joystick: Pad | undefined;
  for (const pad of pads) {
    if (!pad?.connected) continue;
    const kind = padKind(pad.id);
    if (kind === 'device') return pad;
    if (kind === 'joystick') joystick ??= pad;
  }
  return joystick;
}

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
  /** False where the browser has neither WebHID nor gamepads. */
  readonly supported: boolean;
  /** True where a device can be asked for (WebHID: Chromium browsers and the desktop app). */
  readonly connectable: boolean;
  /** Names of the devices read (the same array until one appears or goes). */
  devices(): readonly string[];
  subscribe(listener: () => void): () => void;
  /** Asks for a device (needs a click: the browser shows its device chooser). */
  connect(): Promise<void>;
  /** Routes motion to `sink` until the returned function is called. */
  attach(sink: SpaceSink): () => void;
  /**
   * Whether the cap is off centre, or was within the last `WHEEL_QUIET_MS`. 3DxWare, the
   * vendor's driver, also turns the cap's motion into mouse-wheel turns for programs it has no
   * profile for, browsers included; the app drops every wheel event while this is true (see
   * `start`), since the cap is read here. The driver sends them only well past the dead zone,
   * never at rest, so a wheel turn with the cap at rest is the user's. Reads the gamepad first:
   * the driver's first wheel turn of a push can come before the next poll.
   */
  recentlyMoving(now?: number): boolean;
}

export const WHEEL_QUIET_MS = 150;
const MAX_DT = 0.05;
/** How often the gamepads are looked at while the cap rests (there is no event for its motion). */
const POLL_MS = 50;

export interface SpaceMouseEnvironment {
  /** The animation frame (the motion runs once per frame). */
  frame?: (cb: (now: number) => void) => unknown;
  /** The clock `frame` and `recentlyMoving` share, in milliseconds. */
  now?: () => number;
  /** The gamepads the browser lists (`navigator.getGamepads`), or undefined without the API. */
  gamepads?: () => readonly (Pad | null)[];
  /** A repeating timer, for the gamepad poll. */
  interval?: (cb: () => void, ms: number) => unknown;
  /** Where focus loss and wheel turns are listened for (the window). */
  target?: EventTarget;
}

/**
 * Opens the devices already allowed, and any that is plugged in later, and turns their reports
 * into `move` calls once per animation frame while the cap is off centre. Until an open HID
 * device has sent a report, reads the 3D mouse the browser lists as a gamepad instead (Chromium
 * browsers list the device itself; no chooser needed, but a gamepad appears only once it has been
 * moved on the page). A device allowed once is opened again on every visit, and one that stays
 * silent (a receiver with nothing paired, another device picked in the chooser) must not leave
 * the cap dead.
 */
export function createSpaceMouse(
  hid: Hid | undefined,
  env: SpaceMouseEnvironment = {},
): SpaceMouse {
  const {
    frame = (cb) => requestAnimationFrame(cb),
    now = () => performance.now(),
    gamepads,
    interval = (cb, ms) => setInterval(cb, ms),
    target = typeof globalThis.addEventListener === 'function' ? globalThis : undefined,
  } = env;
  const open = new Set<HidDevice>();
  /** The open devices that have sent a report: while there is one, the gamepad is not read. */
  const live = new Set<HidDevice>();
  const listeners = new Set<() => void>();
  let sink: SpaceSink | undefined;
  let input = IDLE;
  let movedAt: number | undefined;
  let last: number | undefined;
  let scheduled = false;
  let started = false;
  let names: readonly string[] = [];
  let padId: string | undefined;

  const changed = () => {
    const hidNames = [...(live.size > 0 ? live : open)].map((d) => d.productName || '3D mouse');
    // The same device can be both an open HID device and the gamepad: name it once.
    names = live.size === 0 && padId !== undefined ? [padName(padId)] : hidNames;
    for (const l of listeners) l();
  };

  const take = (next: SpaceInput) => {
    const pressed = next.buttons & ~input.buttons;
    // Moving until this reading, or from it: some models report only on change.
    if (moving(input) || moving(next)) movedAt = now();
    input = next;
    if (moving(input)) schedule();
    for (let b = 0; b < 32; b++) if (pressed & (1 << b)) sink?.press(b);
  };

  /** Reads the gamepad, while no HID device has sent a report. */
  const poll = () => {
    if (!gamepads || live.size > 0) return;
    const pad = choosePad(gamepads());
    const next = pad && readPad(pad);
    if (pad?.id !== padId) {
      padId = pad?.id;
      changed();
    }
    take(next ?? IDLE);
  };

  const tick = (t: number) => {
    scheduled = false;
    poll();
    if (!moving(input)) {
      last = undefined;
      return;
    }
    const dt = last === undefined ? 1 / 60 : Math.min(MAX_DT, (t - last) / 1000);
    last = t;
    movedAt = now();
    sink?.move(input, dt);
    schedule();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    frame(tick);
  };

  const onReport = (e: Event) => {
    const { device, reportId, data } = e as HidInputReportEvent;
    if (!live.has(device)) {
      // The device takes over from the gamepad: none of the gamepad's reading carries over.
      const first = live.size === 0;
      live.add(device);
      if (first) {
        input = IDLE;
        padId = undefined;
      }
      changed();
    }
    take(readReport(input, reportId, data));
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

  function recentlyMoving(t = now()): boolean {
    if (!scheduled) poll(); // While the motion runs, every frame has just read it.
    return moving(input) || (movedAt !== undefined && t - movedAt <= WHEEL_QUIET_MS);
  }

  const start = () => {
    if (started) return;
    started = true;
    // A held cap must not keep the view spinning while another window has the focus.
    target?.addEventListener('blur', () => {
      input = IDLE;
    });
    // The driver's wheel turns go to whatever is under the pointer (a panel, the page itself
    // with Ctrl: the browser's zoom), so they are dropped before anything sees them.
    target?.addEventListener(
      'wheel',
      (e) => {
        if (!recentlyMoving()) return;
        e.preventDefault();
        e.stopPropagation();
      },
      { capture: true, passive: false },
    );
    if (gamepads) interval(poll, POLL_MS);
    if (!hid) return;
    hid.addEventListener('connect', (e) => void add((e as HidConnectionEvent).device));
    hid.addEventListener('disconnect', (e) => {
      const { device } = e as HidConnectionEvent;
      if (!open.delete(device)) return;
      live.delete(device);
      device.removeEventListener('inputreport', onReport);
      input = IDLE;
      changed();
    });
    void hid.getDevices().then((devices) => Promise.all(devices.map(add)));
  };

  return {
    supported: hid !== undefined || gamepads !== undefined,
    connectable: hid !== undefined,
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
    recentlyMoving,
  };
}

/** The app's one 3D mouse connection. */
export const spaceMouse: SpaceMouse = (() => {
  const nav = globalThis.navigator as
    | { hid?: Hid; getGamepads?: () => readonly (Pad | null)[] }
    | undefined;
  return createSpaceMouse(nav?.hid, {
    gamepads: nav?.getGamepads ? () => nav.getGamepads?.() ?? [] : undefined,
  });
})();
