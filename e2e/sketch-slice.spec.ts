import { expect, type Locator, test } from '@playwright/test';
import { attr, chip, primitive } from './benchmark-helpers';
import { kernelReady, openProject, pickTool, projector } from './helpers';

// P4-12: the sketch palette's Slice (ADR-0031 §5). While a sketch is open
// and Slice is on, the bodies are cut away on the camera's side of the
// sketch plane, so a sketch on a face inside a model sees its plane. View
// state only: the palette's own section (ADR-0045) is untouched, and the
// slice's clip is listed last in `data-section-clip`.

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** Waits until the camera has stopped moving. */
async function settled(viewport: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const now = await Promise.all(
        ['size', 'target', 'direction', 'shift'].map((k) => attr(viewport, `data-camera-${k}`)),
      ).then((v) => v.join(' '));
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
}

/** The last clip of `data-section-clip` ("origin:normal"). */
async function lastClip(viewport: Locator) {
  const clips = (await attr(viewport, 'data-section-clip')).split(';').filter(Boolean);
  return clips[clips.length - 1] ?? '';
}

test('slices the bodies at the sketch plane while the sketch is open', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);

  // A Box 40 × 40 × 20: x, y ±20, z 0…20. No sketch open yet, so nothing about the slice.
  await primitive(page, 'Box', { Length: '40 mm', Width: '40 mm', Height: '20 mm' });
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:40,40,20');
  await expect(viewport).not.toHaveAttribute('data-sketch-slice', /./);

  // A section the person added before the sketch: the XZ plane, through the
  // middle — its normal −Y removes the half of the box nearer the home view.
  await page.keyboard.press('Shift+S');
  const section = page.getByRole('region', { name: 'Section Analysis' });
  await expect(section).toHaveAttribute('data-section-state', 'choosing');
  await section.getByRole('button', { name: 'XZ plane' }).click();
  await expect(section).toHaveAttribute('data-section-state', 'on');
  await expect(viewport).toHaveAttribute('data-section', 'origin:xz offset=0 mm on');
  await expect(viewport).toHaveAttribute('data-section-clip', '0,0,0:0,-1,0');
  await page.keyboard.press('Escape');

  // Create Sketch on the box's top face (kept side of the person's section).
  const at = await projector(viewport);
  await settled(viewport);
  await pickTool(page, 'Create Sketch');
  const prompt = page.getByRole('region', { name: 'Create Sketch' });
  await expect(prompt).toBeVisible();
  await expect(viewport).not.toHaveAttribute('data-sketch-slice', /./);
  // Off the origin planes' squares (x 0 and y 0 would tie with a plane pick).
  const top = at([5, 10, 20]);
  await page.mouse.move(top.x, top.y);
  await page.mouse.click(top.x, top.y);
  await expect(chip(page, 'Sketch1')).toBeVisible();
  await settled(viewport);

  // Slice is off until the palette says otherwise: the person's section is
  // suspended while a sketch is open (ADR-0045), so nothing is clipped.
  const palette = page.getByRole('region', { name: 'Sketch palette' });
  await expect(viewport).toHaveAttribute('data-sketch-slice', 'off');
  await expect(viewport).not.toHaveAttribute('data-section-clip', /./);
  await palette.getByRole('checkbox', { name: 'Slice' }).click();

  // The slice's clip is the sketch plane, the removed side the one the
  // camera is on — above, looking down at the sketch — after the person's
  // own plane, which stays in the list.
  await expect(viewport).toHaveAttribute('data-sketch-slice', 'on');
  await expect(viewport).toHaveAttribute('data-section-clip', '0,0,0:0,-1,0;0,0,20:0,0,1');
  const direction = (await attr(viewport, 'data-camera-direction')).split(',').map(Number) as [
    number,
    number,
    number,
  ];
  expect(direction[2]).toBeLessThan(0); // the camera looks down at the sketch
  expect(await lastClip(viewport)).toBe('0,0,20:0,0,1');

  // Orbiting to the other side does not flip the cut under the person.
  await page.keyboard.press('Shift+3');
  await settled(viewport);
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,1');
  await expect(viewport).toHaveAttribute('data-section-clip', '0,0,0:0,-1,0;0,0,20:0,0,1');
  await expect(viewport).toHaveAttribute('data-sketch-slice', 'on');

  // Finishing the sketch takes the slice away at once; the person's
  // section stays as it was.
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(viewport).not.toHaveAttribute('data-sketch-slice', /./);
  await expect(viewport).toHaveAttribute('data-section-clip', '0,0,0:0,-1,0');

  // The preference survives a reload: opening the sketch again clips at once.
  await page.reload();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await expect(viewport).not.toHaveAttribute('data-section-clip', /./);
  await chip(page, 'Sketch1').dblclick();
  await expect(viewport).toHaveAttribute('data-sketch-slice', 'on');
  await expect(viewport).toHaveAttribute('data-section-clip', '0,0,20:0,0,1');
  await expect(await lastClip(viewport)).toBe('0,0,20:0,0,1');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(viewport).not.toHaveAttribute('data-sketch-slice', /./);
  await expect(viewport).not.toHaveAttribute('data-section-clip', /./);
});
