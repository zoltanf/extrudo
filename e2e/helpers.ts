import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Opens a project in the shell from a fresh home screen (P0-08): a blank
 * design, or the Wall bracket template (parameters, a timeline, a body).
 * Each Playwright test has its own browser context, so storage starts empty.
 */
export async function openProject(page: Page, from: 'blank' | 'wall-bracket' = 'blank') {
  await page.goto('./');
  if (from === 'blank') {
    await page.getByRole('button', { name: 'New design' }).click();
  } else {
    await page.getByRole('button', { name: 'Start from the Wall bracket template' }).click();
  }
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  const viewport = page.getByRole('region', { name: 'Viewport' });
  // The viewport is lazy: wait until its first frame is drawn.
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  return viewport;
}

export const saveStatus = (page: Page) => page.getByRole('status', { name: 'Save status' });

/** Waits until the kernel has computed the document (P2-01): chips show their status. */
export async function kernelReady(page: Page) {
  await expect(page.getByRole('status', { name: 'Kernel' })).toHaveAttribute(
    'data-model-status',
    'ready',
    { timeout: 30_000 },
  );
}

/** Opens a sketch on XY and waits for the Top view. Returns a sketch-mm → page-px mapping. */
export async function sketchOnXY(page: Page) {
  await openProject(page);
  return newSketchOnXY(page);
}

/** Starts a sketch on XY in the open project, like `sketchOnXY`. */
export async function newSketchOnXY(page: Page) {
  const viewport = page.getByRole('region', { name: 'Viewport' });
  await pickTool(page, 'Create Sketch');
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XY' })
    .click();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  await expect(viewport).toHaveAttribute('data-camera-up', '0,1,0');
  return mapping(viewport);
}

/**
 * The ID of the sketch that is open (the one Create Sketch just made). Not
 * simply the last entry of `data-sketch-frames`: an older sketch can still be
 * shown, whose frame keeps the attribute non-empty while the new sketch is
 * still being created (a face pick resolves a kernel reference first, AppShell
 * `sketchOnFace`) — that wrong id was the face-outline test's CI flake. So:
 * snapshot the ids shown before the call, wait for one that was not there,
 * and until `data-sketch-frames` carries that id's frame. When the pick was a
 * plane (synchronous) the snapshot already names the sketch, and the overlays
 * — which come up with the commit that lists it — say so.
 */
export async function openSketch(page: Page): Promise<string> {
  const viewport = page.getByRole('region', { name: 'Viewport' });
  const read = async () =>
    ((await viewport.getAttribute('data-sketches')) ?? '').split(' ').filter(Boolean);
  const open = (await viewport.locator('[data-sketch-summary]').count()) > 0;
  const before = await read();
  let ids = before;
  let id = '';
  if (!open) {
    const deadline = Date.now() + 10_000;
    while (id === '' && Date.now() < deadline) {
      await page.waitForTimeout(100);
      ids = await read();
      id = ids.find((s) => !before.includes(s)) ?? '';
    }
  }
  if (id === '') id = ids.at(-1) ?? '';
  await expect
    .poll(async () => {
      const frames = ((await viewport.getAttribute('data-sketch-frames')) ?? '').split(' ');
      return frames.find((entry) => entry.startsWith(`${id}:`)) ?? '';
    })
    .not.toBe('');
  return id;
}

export async function mapping(viewport: Locator) {
  const box = await viewport.boundingBox();
  if (!box) throw new Error('no viewport');
  const [tx = 0, ty = 0] = ((await viewport.getAttribute('data-camera-target')) ?? '')
    .split(',')
    .map(Number);
  const size = Number(await viewport.getAttribute('data-camera-size'));
  // The target shows `shift` (NDC) right of the middle when the browser covered part of the
  // view as it was fitted.
  const shift = Number((await viewport.getAttribute('data-camera-shift')) ?? 0);
  // Orthographic or perspective, the target plane is `size` mm tall on screen.
  const perPixel = size / box.height;
  return (x: number, y: number) => ({
    x: box.x + ((1 + shift) * box.width) / 2 + (x - tx) / perPixel,
    y: box.y + box.height / 2 - (y - ty) / perPixel,
  });
}

/** Entity and constraint counts of the open sketch (the overlay shows while a tool runs). */
export async function counts(page: Page) {
  const summary =
    (await page.locator('[data-sketch-summary]').getAttribute('data-sketch-summary')) ?? '';
  return Object.fromEntries(
    summary.split(' ').map((pair) => {
      const [key, value] = pair.split('=');
      return [key, Number(value)];
    }),
  );
}

/** The toolbar's tabs, in the top bar (ADR-0079). */
export const toolbarTabs = (page: Page) => page.getByRole('tablist', { name: 'Toolbar tabs' });

/** Selects a toolbar tab by its label ("Home", "Solid", "Modify", "3D Print"…). */
export async function selectTab(page: Page, name: string) {
  const tab = toolbarTabs(page).getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A tile of the selected tab: its accessible name, or the tool's full name (`data-label`). */
const tileNamed = (page: Page, name: string) =>
  page
    .locator('#toolbar-groups button[data-tool]')
    .and(page.getByRole('button', { name, exact: true }).or(page.locator(`[data-label="${name}"]`)))
    .first();

/** A group menu's item: its label, then the key it may show ("Text Shift+T"). */
const menuItemNamed = (page: Page, name: string) =>
  page.getByRole('menuitem', {
    name: new RegExp(`^${escapeRegExp(name)}( (Shift\\+|Ctrl\\+|⌘)?[A-Z0-9]{1,3})?$`),
  });

/**
 * Runs a toolbar tool by its name wherever it is (ADR-0079): a tile of the
 * selected tab, else a tile of another visible tab (each tab in order), else an
 * item of a group's ▾ menu (tools that never have a tile, or tiles a narrow
 * window moved there).
 */
export async function pickTool(page: Page, name: string) {
  const tabs = toolbarTabs(page).getByRole('tab');
  if ((await tileNamed(page, name).count()) > 0) {
    await tileNamed(page, name).click();
    return;
  }
  const count = await tabs.count();
  for (let i = 0; i < count; i++) {
    const tab = tabs.nth(i);
    if ((await tab.getAttribute('aria-selected')) === 'true') continue;
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    if ((await tileNamed(page, name).count()) > 0) {
      await tileNamed(page, name).click();
      return;
    }
  }
  for (let i = 0; i < count; i++) {
    const tab = tabs.nth(i);
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    const triggers = page.locator('#toolbar-groups button[aria-haspopup="menu"]');
    const menus = await triggers.count();
    for (let j = 0; j < menus; j++) {
      await triggers.nth(j).click();
      const item = menuItemNamed(page, name);
      await expect(page.getByRole('menu')).toBeVisible();
      if ((await item.count()) > 0) {
        await item.first().click();
        return;
      }
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
    }
  }
  throw new Error(`No toolbar tool named "${name}"`);
}

/**
 * Runs what used to be a File menu item (ADR-0079): a tile of the Home tab, or
 * an item of its Files ▾ menu. `label` is the command's name ("Export .extrudo",
 * "Save to Linked Folder", "Plugins…", "Import" for STEP, mesh and OpenSCAD).
 */
export async function fileAction(page: Page, label: string) {
  await selectTab(page, 'Home');
  const tile = tileNamed(page, label);
  if ((await tile.count()) > 0) {
    await tile.click();
    return;
  }
  const triggers = page.locator('#toolbar-groups button[aria-haspopup="menu"]');
  const menus = await triggers.count();
  for (let j = 0; j < menus; j++) {
    await triggers.nth(j).click();
    await expect(page.getByRole('menu')).toBeVisible();
    const item = menuItemNamed(page, label);
    if ((await item.count()) > 0) {
      await item.first().click();
      return;
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
  throw new Error(`No Home tab command named "${label}"`);
}

/** Whether the Home tab offers a command (a tile or a Files ▾ menu item). */
export async function hasFileAction(page: Page, label: string): Promise<boolean> {
  await selectTab(page, 'Home');
  if ((await tileNamed(page, label).count()) > 0) return true;
  const triggers = page.locator('#toolbar-groups button[aria-haspopup="menu"]');
  const menus = await triggers.count();
  for (let j = 0; j < menus; j++) {
    await triggers.nth(j).click();
    await expect(page.getByRole('menu')).toBeVisible();
    const found = (await menuItemNamed(page, label).count()) > 0;
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    if (found) return true;
  }
  return false;
}

type At = Awaited<ReturnType<typeof sketchOnXY>>;

export function clicker(page: Page, at: At) {
  return async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
  };
}

/**
 * A world (mm) → page (px) mapping for the Viewport region's camera, in
 * either projection (P2-03): the camera attributes give the view direction,
 * up, target, size and projection. Read it again after the camera moves.
 */
export async function projector(viewport: Locator) {
  const box = await viewport.boundingBox();
  if (!box) throw new Error('no viewport');
  const read = async (name: string) =>
    ((await viewport.getAttribute(name)) ?? '').split(',').map(Number) as [number, number, number];
  const dir = await read('data-camera-direction');
  const up = await read('data-camera-up');
  const target = await read('data-camera-target');
  const [size = 1] = await read('data-camera-size');
  const perspective = (await viewport.getAttribute('data-camera-projection')) === 'perspective';
  const [shift = 0] = await read('data-camera-shift');
  const dot = (a: readonly number[], b: readonly number[]) =>
    (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
  // right = direction × up
  const right = [
    dir[1] * up[2] - dir[2] * up[1],
    dir[2] * up[0] - dir[0] * up[2],
    dir[0] * up[1] - dir[1] * up[0],
  ];
  const half = size / 2;
  const aspect = box.width / box.height;
  // Vertical field of view 35° (viewport/camera.ts FOV).
  const focal = half / Math.tan((17.5 * Math.PI) / 180);
  const eye = target.map((t, i) => t - (dir[i] ?? 0) * focal);
  return (p: readonly [number, number, number]) => {
    let nx: number;
    let ny: number;
    if (perspective) {
      const rel = p.map((c, i) => c - (eye[i] ?? 0));
      const scale = (dot(rel, dir) * half) / focal;
      nx = dot(rel, right) / (scale * aspect);
      ny = dot(rel, up) / scale;
    } else {
      const rel = p.map((c, i) => c - (target[i] ?? 0));
      nx = dot(rel, right) / (half * aspect);
      ny = dot(rel, up) / half;
    }
    return {
      x: box.x + ((nx + shift + 1) / 2) * box.width,
      y: box.y + ((1 - ny) / 2) * box.height,
    };
  };
}
