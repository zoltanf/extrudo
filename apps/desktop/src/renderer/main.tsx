/**
 * The Electron renderer entry (P6-01, ADR-0075 §1): it boots the web app's own
 * UI (`bootDesktop` lives in `@extrudo/web`, so the styles and components are
 * the same ones the web build uses) with `desktopPlatform()`.
 *
 * It also wires the native menu's file sends (slice 2): once the platform is
 * up it registers the open-file handler and tells main the renderer is ready,
 * so a `.extrudo` the app was launched with can be delivered.
 */
import { appNotifications, bootDesktop, openExternalFile } from '@extrudo/web';
import { desktopPlatform, desktopPreferences } from './platform';

// The preference map comes over `invoke`, so the theme is applied once it is
// read; `desktopPlatform` shares the same once-read promise (P6-01's review).
void desktopPreferences(window.extrudo).then((preferences) =>
  bootDesktop(desktopPlatform, preferences, (platform) => {
    platform.menus?.onOpenFile((file) => {
      // Main refused the file (over the size cap, or not a `.extrudo`): say so.
      if (file.error) {
        appNotifications.getState().push('error', file.error);
        return;
      }
      void openExternalFile(platform, file).catch((error: unknown) => {
        // A corrupt file leaves the recent list rather than staying to fail again.
        platform.menus?.forgetRecent(file.path);
        const message = error instanceof Error ? error.message : String(error);
        appNotifications.getState().push('error', `Couldn't open the file: ${message}`);
      });
    });
    window.extrudo.app.ready();
  }),
);
