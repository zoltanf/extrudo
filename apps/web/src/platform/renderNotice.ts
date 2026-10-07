/**
 * The notice that the browser draws 3D without the graphics card (ADR-0076):
 * a one-time info toast with "Don't show again" (the preference
 * `render.softwareNotice`). Pure over a push function, the preferences and the
 * detected support, so the rules are unit tests.
 */
import type { ToastOptions, ToastTone } from '../design-system/notifications';
import type { WebglSupport } from '../viewport/webglSupport';
import type { Preferences } from './preferences';

export const SOFTWARE_NOTICE_TEXT =
  "Your browser draws 3D without the graphics card, so the view may be slow. Turn on hardware acceleration in your browser's settings, or update your graphics driver.";
export const SOFTWARE_NOTICE_PREFERENCE = 'render.softwareNotice';
export const SOFTWARE_NOTICE_MS = 20_000;

export type Push = (tone: ToastTone, text: string, options?: ToastOptions) => void;

/** At most once per session (the page); a hook may run again on a remount. */
const session = { shown: false };

export function resetSoftwareNoticeSession(): void {
  session.shown = false;
}

/** Whether the toast should show: software rendering, not dismissed, not yet shown. */
export function shouldNotifySoftware(support: WebglSupport, preferences: Preferences): boolean {
  return (
    support.kind === 'software' &&
    !session.shown &&
    preferences.get<string>(SOFTWARE_NOTICE_PREFERENCE, '') !== 'dismissed'
  );
}

/** Shows the toast when it applies; returns whether it did. */
export function showSoftwareNotice(
  support: WebglSupport,
  preferences: Preferences,
  push: Push,
): boolean {
  if (!shouldNotifySoftware(support, preferences)) return false;
  session.shown = true;
  push('info', SOFTWARE_NOTICE_TEXT, {
    lifetime: SOFTWARE_NOTICE_MS,
    action: {
      label: "Don't show again",
      available: () => preferences.get<string>(SOFTWARE_NOTICE_PREFERENCE, '') !== 'dismissed',
      run: () => preferences.set(SOFTWARE_NOTICE_PREFERENCE, 'dismissed'),
    },
  });
  return true;
}
