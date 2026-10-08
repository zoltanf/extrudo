import { expect, type Page, test } from '@playwright/test';
import { type FitGroup, fitToolbar } from '../apps/web/src/shell/toolbarFit';
import { openProject, sketchOnXY } from './helpers';

// The top bar (ADR-0079): one row with the logo, the tabs, undo/redo/search, the
// design's name and the right-hand buttons; the selected tab's tools in the row below,
// fitted to the window.

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Toolbar tabs' }).getByRole('tab');

/** Where an element's text baseline is, through a zero-size inline-block probe. */
const BASELINE = `(el) => {
  const probe = document.createElement('span');
  probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  el.appendChild(probe);
  const y = probe.getBoundingClientRect().top;
  probe.remove();
  return y;
}`;

test('the tabs share the wordmark baseline and undo, redo and search line up', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page);
  const m = (await page.evaluate(`(() => {
    const baseline = ${BASELINE};
    const centre = (name) => {
      const svg = document.querySelector('header button[aria-label="' + name + '"] svg');
      const b = svg.getBBox();
      const ctm = svg.getScreenCTM();
      return ctm.b * (b.x + b.width / 2) + ctm.d * (b.y + b.height / 2) + ctm.f;
    };
    return {
      word: baseline(document.querySelector('[data-topbar-logo] span')),
      tabs: [...document.querySelectorAll('[role=tab][data-tab]')].map(baseline),
      glyphs: ['Undo', 'Redo', 'Search commands'].map(centre),
    };
  })()`)) as { word: number; tabs: number[]; glyphs: number[] };
  console.log(
    `baselines: wordmark ${m.word}, tabs ${m.tabs.join(' ')}; glyph centres ${m.glyphs.join(' ')}`,
  );
  expect(m.tabs.length).toBe(6);
  for (const y of m.tabs) expect(Math.abs(y - m.word)).toBeLessThanOrEqual(1);
  expect(Math.max(...m.glyphs) - Math.min(...m.glyphs)).toBeLessThanOrEqual(1);
});

test('one top bar: the tabs in order, no File menu, undo, redo and search work', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page);
  await expect(tabs(page)).toHaveText([
    'Home',
    'Solid',
    'Modify',
    'Construct',
    'Inspect',
    '3D Print',
  ]);
  await expect(tabs(page).filter({ hasText: 'Solid' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /^File/ })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Insert' })).toHaveCount(0);
  // The tabs and the buttons are in one header, the toolbar's tools under it.
  const header = page.locator('header');
  await expect(header.getByRole('tablist', { name: 'Toolbar tabs' })).toBeVisible();
  for (const name of ['Undo', 'Redo', 'Search commands']) {
    await expect(header.getByRole('button', { name, exact: true })).toBeVisible();
  }
  const chrome = await page.evaluate(
    `document.querySelector('#toolbar-groups').parentElement.getBoundingClientRect().bottom`,
  );
  console.log(`chrome above the view: ${chrome} px`);
  expect(chrome).toBeLessThanOrEqual(130);

  // Undo and redo from the top bar: a Box, undone and redone.
  const undo = header.getByRole('button', { name: 'Undo', exact: true });
  const redo = header.getByRole('button', { name: 'Redo', exact: true });
  await expect(undo).toBeDisabled();
  await page.getByRole('button', { name: 'Box', exact: true }).click();
  const dialog = page.getByRole('region', { name: 'Box dialog' });
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 30_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  const viewport = page.getByRole('region', { name: 'Viewport' });
  await expect(viewport).toHaveAttribute('data-bodies', /Body1:6:/);
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(viewport).not.toHaveAttribute('data-bodies', /Body1/);
  await redo.click();
  await expect(viewport).toHaveAttribute('data-bodies', /Body1:6:/);

  // Search opens the palette.
  await header.getByRole('button', { name: 'Search commands', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The Home tab holds what the File menu had.
  await page.getByRole('tab', { name: 'Home' }).click();
  for (const tool of ['newDesign', 'allDesigns', 'saveVersion', 'versionHistory', 'importBody']) {
    await expect(page.locator(`[data-tool="${tool}"]`)).toBeVisible();
  }
  await page.locator('[data-tool="saveVersion"]').click();
  await expect(page.getByRole('dialog', { name: 'Versions' })).toBeVisible();
});

test('a sketch shows Home, Sketch and 3D Print', async ({ page }) => {
  await sketchOnXY(page);
  await expect(tabs(page)).toHaveText(['Home', 'Sketch', '3D Print']);
  await expect(tabs(page).filter({ hasText: 'Sketch' })).toHaveAttribute('aria-selected', 'true');
});

/** What the fit rule needs, read from the toolbar the way the toolbar reads it. */
async function measure(page: Page) {
  return (await page.evaluate(`(() => {
    const row = document.querySelector('#toolbar-groups');
    const groups = [...row.querySelectorAll('[data-toolbar-group]')].map((g) => ({
      name: g.dataset.toolbarGroup,
      tiles: [...g.querySelectorAll('[data-toolbar-tiles] > *')].map((t) => t.offsetWidth + 2),
      ids: [...g.querySelectorAll('[data-toolbar-tiles] > *')].map((t) => t.dataset.tool),
      names: [...g.querySelectorAll('[data-toolbar-tiles] > *')].map((t) => t.dataset.label),
      menu: !!g.querySelector('button[aria-haspopup]'),
      label: g.querySelector('[data-group-label-text]').offsetWidth + 12,
    }));
    const last = row.lastElementChild.getBoundingClientRect();
    const content = last.right - row.getBoundingClientRect().left + parseFloat(getComputedStyle(row).paddingRight);
    return { groups, content };
  })()`)) as {
    groups: (FitGroup & { name: string; ids: string[]; names: string[] })[];
    content: number;
  };
}

test('the toolbar moves tiles into their group menus to fit a narrow window, and back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page);
  const toolbar = page.locator('#toolbar-groups');
  await expect(toolbar).toHaveAttribute('data-toolbar-fit', '0,0,0,0,0');
  const wide = await measure(page);
  const chrome =
    wide.content -
    wide.groups.reduce(
      (sum, g) =>
        sum +
        Math.max(
          g.tiles.reduce((a, b) => a + b, 0),
          (g.label ?? 0) + (g.menu ? 12 : 0),
        ),
      0,
    );

  await page.setViewportSize({ width: 900, height: 900 });
  const available = (await page.evaluate(
    `document.querySelector('#toolbar-groups').clientWidth`,
  )) as number;
  const expected = fitToolbar(wide.groups, available, chrome);
  console.log(`fit at 900 px (toolbar ${available} px): ${expected.join(',')}`);
  expect(expected.some((n) => n > 0)).toBe(true);
  await expect(toolbar).toHaveAttribute('data-toolbar-fit', expected.join(','));

  // Each group that gave tiles shows its ▾, listing them first.
  for (const [i, group] of wide.groups.entries()) {
    const hidden = expected[i] ?? 0;
    if (hidden === 0) continue;
    const moved = group.ids.slice(group.ids.length - hidden);
    const fieldset = page.locator(`[data-toolbar-group="${group.name}"]`);
    for (const id of moved) await expect(fieldset.locator(`[data-tool="${id}"]`)).toHaveCount(0);
    await fieldset.getByRole('button', { name: group.name, exact: true }).click();
    const items = page.getByRole('menuitem');
    for (const [k, name] of group.names.slice(group.names.length - hidden).entries()) {
      await expect(items.nth(k)).toHaveText(new RegExp(`^${name}`));
    }
    await page.keyboard.press('Escape');
    await expect(items).toHaveCount(0);
  }
  // Solid's Create group is the fullest: it gives first (Coil, then Loft, then Sweep).
  expect(expected[0]).toBeGreaterThan(0);

  // Widening brings every tile back.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(toolbar).toHaveAttribute('data-toolbar-fit', '0,0,0,0,0');
  for (const id of wide.groups.flatMap((g) => g.ids)) {
    await expect(page.locator(`#toolbar-groups [data-tool="${id}"]`)).toBeVisible();
  }
});
