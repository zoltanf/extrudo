/**
 * The desktop app's native-menu integration on the renderer side (P6-01 slice
 * 2, ADR-0075 §2). It turns `Platform.menus` into the small adapter the shell
 * uses: `set` debounces a menu model over `menu:set` (the shell rebuilds it on
 * every mode or availability change) and `reset` cancels a pending send and
 * returns to a bare desktop menu. Open Recent is built in main from main's own
 * list, so nothing about it crosses the renderer (finding 1).
 */
import type { DesktopMenus } from '@extrudo/web';
import type { MenuModel } from '@extrudo/web/menu-model';
import type { ExtrudoApi, OpenedFile } from '../shared/ipc';

/** How long `set` waits before sending; a mode change sends once. */
export const MENU_DEBOUNCE_MS = 150;

export function desktopMenus(api: ExtrudoApi, debounceMs = MENU_DEBOUNCE_MS): DesktopMenus {
  let model: MenuModel[] | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const send = () => {
    if (!model) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (model) api.menus.set(model);
    }, debounceMs);
  };

  return {
    set(next: MenuModel[]) {
      model = next;
      send();
    },
    reset() {
      // Cancel a pending send and forget the model: a project page unmounting
      // must not have the next `recent:changed` re-apply its menu (finding 5).
      if (timer) clearTimeout(timer);
      timer = undefined;
      model = undefined;
      api.menus.reset();
    },
    listening(active: boolean) {
      api.menus.listening(active);
    },
    onRun(handler: (id: string) => void) {
      api.menus.onRun(handler);
      return () => api.menus.offRun();
    },
    onOpenFile(handler: (file: OpenedFile) => void) {
      api.menus.onOpenFile(handler);
      return () => api.menus.offOpenFile();
    },
    forgetRecent(path: string) {
      api.recent.remove(path);
    },
    quit() {
      api.app.quit();
    },
  };
}
