/**
 * The Electron renderer entry (P6-01, ADR-0075 §1): it boots the web app's own
 * UI (`bootDesktop` lives in `@extrudo/web`, so the styles and components are
 * the same ones the web build uses) with `desktopPlatform()`.
 */
import { bootDesktop } from '@extrudo/web';
import { desktopPlatform, desktopPreferences } from './platform';

// The preference map comes over `invoke`, so the theme is applied once it is
// read; `desktopPlatform` shares the same once-read promise (P6-01's review).
void desktopPreferences(window.extrudo).then((preferences) =>
  bootDesktop(desktopPlatform, preferences),
);
