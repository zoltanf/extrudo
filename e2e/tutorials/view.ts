import type { Page } from '@playwright/test';
import { settled, viewportOf } from '../benchmark-helpers';

// Camera moves for the tutorials' pictures (P6-06): the pictures are the whole page, so a
// step that draws somewhere off to the side pans it to the middle of the free part of the
// view (between the browser and the palette or dialog) before the shot.

/** Where a picture's subject should sit: the middle of the view between the browser and a right-hand panel. */
export const MIDDLE = { x: 690, y: 440 };

/** Pans (default preset: right-drag) so that the page point `from` lands on `to`, then waits for the camera. */
export async function panTo(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number } = MIDDLE,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'right' });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
  }
  await page.mouse.up({ button: 'right' });
  await settled(viewportOf(page));
}

/** Orbits (default preset: middle-drag) by a drag of `dx`, `dy` page pixels, then waits for the camera. */
export async function orbitBy(page: Page, dx: number, dy: number) {
  const from = MIDDLE;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'middle' });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
  }
  await page.mouse.up({ button: 'middle' });
  await settled(viewportOf(page));
}
