/**
 * Platform interfaces (architecture §8, NFR-08). Everything the browser and
 * Electron do differently goes through here: preferences now; files, dialogs,
 * project storage and slicer launch later.
 */
import { type Preferences, webPreferences } from './preferences';

export interface Platform {
  preferences: Preferences;
}

export function webPlatform(): Platform {
  return { preferences: webPreferences() };
}

export { memoryPreferences, type Preferences, webPreferences } from './preferences';
