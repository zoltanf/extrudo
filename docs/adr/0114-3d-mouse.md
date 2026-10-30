# ADR-0114: 3D mice over WebHID

- **Status:** Accepted, 2026-10-30 (the owner, after a user asked for 3D mouse control)
- **Task:** P6-20 (`docs/03-roadmap.md`), FR-VP-08.
- **Builds on:** ADR-0008 (the viewport's own camera controller), ADR-0082
  (the Settings screen), ADR-0087's amendment of 2026-10-18 (what the desktop
  renderer may ask for).
- **Schema change:** none. One display preference, `viewport.spaceMouseSpeed`.

## Context

CAD users often navigate with a 3D mouse (a 3Dconnexion SpaceMouse or
SpaceNavigator) in the left hand: one puck pans, zooms, tilts and turns the
view at once while the right hand keeps the normal mouse for picking. A user
asked for it. The app is a web page first and an Electron app second, under
COOP/COEP and a CSP that allows no other origin.

## Decision

**Read the device over WebHID and parse its reports ourselves**
(`apps/web/src/viewport/spaceMouse.ts`). No driver is needed. The protocol is
small and the same on every 3Dconnexion model since the SpaceNavigator: report
1 is the translation as three little-endian int16 (on newer models followed by
the rotation, 12 bytes), report 2 the rotation, report 3 a button bitmask;
full deflection is about ±350. The device frame is x right, y towards the
user, z down.

- **Object mode:** the model follows the cap. Push it right and the model
  moves right, pull it towards you and the model comes closer (zoom), tip it
  away and the model tips away, twist it and the model turns. The twist turns
  about world Z like the mouse's orbit (a turntable); tilt and roll turn about
  the camera's own axes. A small dead zone, then a squared response for fine
  control; rates per second at full deflection, times a speed setting
  (0.25 … 4, a slider in powers of two with 1× in the middle, not an
  expression: it is a multiplier, not a quantity, and is best tuned while
  trying the cap).
- **Motion runs once per animation frame while the cap is off centre**, from
  the last report, not per report: some models send only on change.
  `dt` is capped at 50 ms. The input is reset when the window loses the focus
  or the device goes away, so a held cap never keeps the view spinning.
- **Buttons:** the left one is Home, the right one Fit (the first two bits;
  bigger models' extra buttons do nothing yet).
- **One connection for the app** (`spaceMouse`), one viewport on screen
  attached to it (`useSpaceMouse` in `Viewport.tsx`; the last attached wins).
  Settings › View and navigation has **Connect…** (the browser's device
  chooser needs a click) and the speed. Devices allowed once are opened by
  themselves on the next start (`hid.getDevices()`) and when plugged in.
- **The devices asked for:** vendor 0x256f (3Dconnexion), or vendor 0x046d
  (Logitech, which made the older ones) with the multi-axis-controller usage.

**Desktop:** Electron has WebHID but no chooser. Main answers
`select-hid-device` with the first device in the request's list that
`isSpaceMouse` accepts (vendor 0x256f, or 0x046d with a 0xc6xx product ID) and
grants the same devices in `setDevicePermissionHandler`, so they reconnect
after a restart. Any other HID device is refused. The permission request
handler is unchanged (HID isn't one of its permissions).

## Rejected

- **3Dconnexion's web SDK** (3DxWare's local WebSocket): a connection to
  another origin, a proprietary library and a driver to install. It would
  give the vendor's settings panel and every button; not worth breaking the
  CSP for.
- **spacenavd or `node-hid` in the desktop main process:** desktop only, a
  native module, and WebHID already works in Electron.
- **The Gamepad API:** some platforms expose the device as a gamepad, most
  don't, and the axes aren't labelled.
- **Per-axis inversion and a camera mode** (the camera, not the model,
  follows the cap): left out until someone asks; object mode is the
  convention.

## Consequences

- Chromium only (Chrome, Edge, Opera, the desktop app); Firefox and Safari
  have no WebHID, and the Settings row says so.
- Not tested on hardware when written: the axis signs follow the published
  report layout; unit tests pin the mapping.
- The SpaceMouse Enterprise and the bigger models' extra buttons use other
  report IDs and are ignored.
