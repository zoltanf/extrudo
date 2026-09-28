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
  await page.getByRole('button', { name: 'Create Sketch' }).click();
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XY' })
    .click();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  await expect(viewport).toHaveAttribute('data-camera-up', '0,1,0');
  return mapping(viewport);
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

/** Picks a tool from the Create group's menu. */
export async function pickTool(page: Page, name: string) {
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
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
