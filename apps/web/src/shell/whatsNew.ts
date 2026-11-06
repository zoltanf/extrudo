/**
 * What's new after an update (ADR-0133). The app remembers the last version
 * that ran (`whatsNew.lastVersion`); the first start of a newer one says
 * "Updated to Extrudo X.Y.Z." with a What's new button, once. A first install
 * says nothing (it only records the version), and neither does an edge build,
 * whose version moves with every commit. The dialog's open state is one small
 * store, so the toast and About › What's new open the same dialog wherever it
 * is mounted (the home screen, a project).
 */
/// <reference path="../release-notes.d.ts" />
import { createStore } from 'zustand/vanilla';
import type { BuildChannel } from '../../pwa/build-info';
import type { ReleaseNotes } from '../../pwa/release-notes';
import type { Preferences } from '../platform/preferences';
import type { Push } from '../platform/updateNotice';

export const WHATS_NEW_KEY = 'whatsNew.lastVersion';
export const WHATS_NEW_ACTION = "What's new";
export const WHATS_NEW_TOAST_MS = 30_000;
export const updatedText = (version: string) => `Updated to Extrudo ${version}.`;

/** `0.10.0+edge.3` → `0.10.0`. */
export const baseVersion = (version: string) => version.split('+')[0] ?? version;

/** Compares X.Y.Z versions numerically (`0.10.0` > `0.9.0`); NaN parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = baseVersion(a).split('.').map(Number);
  const pb = baseVersion(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

export interface WhatsNewCheck {
  channel: BuildChannel;
  /** The build's version (`BUILD.version`). */
  version: string;
  /**
   * Someone who used the app before this check could run (a version without
   * it wrote no `lastVersion`): the tour was offered and answered, or a design
   * is open. Without a stored version and not returning, it is a first install.
   */
  returning: boolean;
}

/**
 * Whether to announce this version, recording it as seen either way (so the
 * toast comes once per update, whether or not it is read). Edge records
 * nothing and announces nothing.
 */
export function checkWhatsNew(
  preferences: Preferences,
  { channel, version, returning }: WhatsNewCheck,
): boolean {
  if (channel === 'edge') return false;
  const current = baseVersion(version);
  const last = preferences.get<string | null>(WHATS_NEW_KEY, null);
  if (last === current) return false;
  preferences.set(WHATS_NEW_KEY, current);
  return last === null ? returning : compareVersions(current, last) > 0;
}

/** The dialog's state, shared by every page of the session. */
export const whatsNewStore = createStore<{ open: boolean }>()(() => ({ open: false }));
export const openWhatsNew = () => whatsNewStore.setState({ open: true });
export const setWhatsNewOpen = (open: boolean) => whatsNewStore.setState({ open });

/** The build's notes, a chunk of their own loaded on first use. */
export const loadReleaseNotes = (): Promise<ReleaseNotes | null> =>
  import('virtual:release-notes').then((m) => m.default);

/**
 * The once-per-update toast. `notes` is only asked for when the version is
 * announced; a version without notes says nothing.
 */
export async function announceUpdate(
  preferences: Preferences,
  check: WhatsNewCheck,
  push: Push,
  notes: () => Promise<ReleaseNotes | null> = loadReleaseNotes,
): Promise<boolean> {
  if (!checkWhatsNew(preferences, check)) return false;
  const loaded = await notes().catch(() => null);
  if (!loaded) return false;
  push('info', updatedText(loaded.version), {
    lifetime: WHATS_NEW_TOAST_MS,
    action: { label: WHATS_NEW_ACTION, run: openWhatsNew },
  });
  return true;
}
