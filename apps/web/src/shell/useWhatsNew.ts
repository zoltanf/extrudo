import { useEffect } from 'react';
import { tourOffered } from '../onboarding/state';
import type { Platform } from '../platform';
import type { Push } from '../platform/updateNotice';
import { BUILD } from '../version';
import { announceUpdate } from './whatsNew';

/** Once per session, on whichever page mounts first (ADR-0133). */
let started = false;

/**
 * Says "Updated to Extrudo X.Y.Z." with a What's new button on the first
 * start of a newer version (`whatsNew.ts`). Whether the person used the app
 * before is read at once, before a click can create a design: a stored design,
 * or the tour answered.
 */
export function useWhatsNew(push: Push, platform: Pick<Platform, 'preferences' | 'projects'>) {
  useEffect(() => {
    if (started) return;
    started = true;
    const answeredTour = !tourOffered(platform.preferences);
    void platform.projects
      .list()
      .then(
        (list) => list.length > 0,
        () => false,
      )
      .then((hasDesigns) =>
        announceUpdate(
          platform.preferences,
          {
            channel: BUILD.channel,
            version: BUILD.version,
            returning: answeredTour || hasDesigns,
          },
          push,
        ),
      );
  }, [push, platform]);
}
