import { expect, type Page, test } from '@playwright/test';
import { type FitGroup, fitToolbar } from '../apps/web/src/shell/toolbarFit';
import {
  appMenu,
  newSketchOnXY,
  openAppMenu,
  openProject,
  pickMenuItem,
  railToggle,
  saveStatus,
} from './helpers';

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

test('the tabs share the wordmark baseline and search, undo and redo line up', async ({ page }) => {
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
      glyphs: ['Search', 'Undo', 'Redo'].map(centre),
    };
  })()`)) as { word: number; tabs: number[]; glyphs: number[] };
  console.log(
    `baselines: wordmark ${m.word}, tabs ${m.tabs.join(' ')}; glyph centres ${m.glyphs.join(' ')}`,
  );
  expect(m.tabs.length).toBe(5);
  for (const y of m.tabs) expect(Math.abs(y - m.word)).toBeLessThanOrEqual(1);
  expect(Math.max(...m.glyphs) - Math.min(...m.glyphs)).toBeLessThanOrEqual(1);
});

test('one top bar: the tabs in order, no File menu, undo, redo and search work', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page);
  await expect(tabs(page)).toHaveText(['Home', 'Solid', 'Modify', 'Construct', '3D Print']);
  await expect(tabs(page).filter({ hasText: 'Solid' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /^File/ })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Insert' })).toHaveCount(0);
  // The tabs and the buttons are in one header, the toolbar's tools under it.
  const header = page.locator('header');
  await expect(header.getByRole('tablist', { name: 'Toolbar tabs' })).toBeVisible();
  for (const name of ['Search', 'Undo', 'Redo']) {
    await expect(header.getByRole('button', { name, exact: true })).toBeVisible();
  }
  const chrome = await page.evaluate(
    `document.querySelector('#toolbar-groups').parentElement.getBoundingClientRect().bottom`,
  );
  console.log(`chrome above the view: ${chrome} px`);
  // The top bar (40 px) plus the toolbar row (92 px, ADR-0079 round 3) plus its border.
  expect(chrome).toBeLessThanOrEqual(134);

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

  // Search opens the search.
  await header.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Search', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  // The Home tab holds what the File menu had.
  await page.getByRole('tab', { name: 'Home' }).click();
  for (const tool of ['newDesign', 'allDesigns', 'saveVersion', 'versionHistory', 'importBody']) {
    await expect(page.locator(`[data-tool="${tool}"]`)).toBeVisible();
  }
  await page.locator('[data-tool="saveVersion"]').click();
  await expect(page.getByRole('dialog', { name: 'Versions' })).toBeVisible();
});

test('a sketch shows Home and Sketch only (R3-11)', async ({ page }) => {
  await openProject(page);
  // Opened from the 3D Print tab, a sketch selects its own tab.
  await tabs(page).filter({ hasText: '3D Print' }).click();
  await expect(tabs(page).filter({ hasText: '3D Print' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Create Sketch');
  await page.keyboard.press('Enter');
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XY' })
    .click();
  await expect(tabs(page)).toHaveText(['Home', 'Sketch']);
  await expect(tabs(page).filter({ hasText: 'Sketch' })).toHaveAttribute('aria-selected', 'true');
  // Finishing it brings the model's tabs back.
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(tabs(page)).toHaveText(['Home', 'Solid', 'Modify', 'Construct', '3D Print']);
  await expect(tabs(page).filter({ hasText: 'Solid' })).toHaveAttribute('aria-selected', 'true');
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
  await expect(toolbar).toHaveAttribute('data-toolbar-fit', '0,0,0,0,0,0');
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
  await expect(toolbar).toHaveAttribute('data-toolbar-fit', '0,0,0,0,0,0');
  for (const id of wide.groups.flatMap((g) => g.ids)) {
    await expect(page.locator(`#toolbar-groups [data-tool="${id}"]`)).toBeVisible();
  }
});

// ---- Round 2 (2026-10-08): Settings, Toolbox, the centred title --------------------------

const header = (page: Page) => page.locator('header');
const box = async (page: Page, name: string) => {
  const b = await header(page).getByRole('button', { name, exact: true }).boundingBox();
  if (!b) throw new Error(`no ${name} button`);
  return b;
};

test('the cluster is Search, Undo, Redo; no Toolbox or theme button (R3-05)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page);
  const xs: number[] = [];
  for (const name of ['Search', 'Undo', 'Redo']) xs.push((await box(page, name)).x);
  expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  const ys = await Promise.all(
    ['Search', 'Undo', 'Redo'].map(async (n) => {
      const b = await box(page, n);
      return b.y + b.height / 2;
    }),
  );
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(1);
  await expect(header(page).getByRole('button', { name: 'Theme', exact: true })).toHaveCount(0);
  await expect(header(page).getByRole('button', { name: 'Toolbox', exact: true })).toHaveCount(0);
  await expect(header(page).getByRole('button', { name: 'Search commands' })).toHaveCount(0);
});

test('the right side is Version history and Menu; no Help button (ADR-0090)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page);
  const history = await box(page, 'Version history');
  const menu = await box(page, 'Menu');
  expect(history.x).toBeLessThan(menu.x);
  await expect(header(page).getByRole('button', { name: 'Help', exact: true })).toHaveCount(0);
  await expect(header(page).getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
});

test('the app menu panel: the rail, the App and Learn columns and the strip', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page);
  const panel = await openAppMenu(page);
  // The rail: mouse controls, the toggles between two dividers, the theme.
  await expect(
    panel.getByRole('radiogroup', { name: 'Mouse controls' }).getByRole('radio'),
  ).toHaveCount(6);
  await expect(panel.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio')).toHaveText([
    '',
    '',
    '',
  ]);
  // Two columns side by side, whatever the window.
  const app = (await panel.getByRole('menu', { name: 'App' }).boundingBox()) as {
    x: number;
    y: number;
  };
  const learn = (await panel.getByRole('menu', { name: 'Learn' }).boundingBox()) as {
    x: number;
    y: number;
  };
  expect(learn.x).toBeGreaterThan(app.x);
  expect(Math.abs(learn.y - app.y)).toBeLessThan(2);
  await expect(panel.getByRole('menu', { name: 'App' }).getByRole('menuitem')).toHaveText([
    /^Search…/,
    /^Settings…/,
    'Report a bug',
    'About Extrudo',
    'Close design',
  ]);
  await expect(panel.getByRole('menuitem', { name: /^Quit/ })).toHaveCount(0);
  await expect(panel.getByRole('menuitem', { name: 'Online Tutorials' })).toBeVisible();
  // The panel is as wide as its rail.
  const rail = (await panel.getByRole('radiogroup', { name: 'Mouse controls' }).boundingBox()) as {
    x: number;
  };
  const theme = (await panel.getByRole('radiogroup', { name: 'Theme' }).boundingBox()) as {
    x: number;
    width: number;
  };
  const whole = (await panel.boundingBox()) as { x: number; width: number };
  expect(rail.x - whole.x).toBeLessThan(16);
  expect(whole.x + whole.width - (theme.x + theme.width)).toBeLessThan(16);
  await pickMenuItem(page, 'App', 'Close design');
  await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
});

test('rail toggles and the theme change preferences and leave the panel open', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page);
  const body = await railToggle(page, 'Auto-project body edges');
  const face = await railToggle(page, 'Auto-project face outline');
  await expect(body).toHaveAttribute('aria-pressed', 'true');
  await expect(face).toHaveAttribute('aria-pressed', 'false');
  const panel = await openAppMenu(page);
  await panel.getByRole('radio', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(panel).toBeVisible();

  // The panel and a sketch's palette share the preferences.
  await body.click();
  await face.click();
  await expect(body).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(appMenu(page)).toBeFocused();
  await newSketchOnXY(page);
  await expect(page.getByRole('checkbox', { name: 'Auto-project', exact: true })).not.toBeChecked();
  await (await railToggle(page, 'Auto-project body edges')).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('checkbox', { name: 'Auto-project', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Auto-project face outline' })).toBeChecked();
});

test('the arrow keys move within a rail group or a column, Tab between them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page);
  const panel = await openAppMenu(page);
  const spindle = panel.getByRole('radio', { name: 'Spindle', exact: true });
  await spindle.focus();
  await page.keyboard.press('ArrowRight');
  await expect(panel.getByRole('radio', { name: 'Glide', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(panel.getByRole('radio', { name: 'Trackpad', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: 'Auto-project body edges' })).toBeFocused();
  await panel.getByRole('menu', { name: 'Learn' }).getByRole('menuitem').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(panel.getByRole('menuitem', { name: 'Tutorial', exact: true })).toBeFocused();
  // Nothing changed by moving: Spindle is still the preset.
  await expect(spindle).toHaveAttribute('aria-checked', 'true');
});

test('the Radial toggle is in step with the command', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page);
  const radial = await railToggle(page, 'Radial right-click menu');
  await expect(radial).toHaveAttribute('aria-pressed', 'true');
  await expect(radial).toHaveAccessibleName('Radial right-click menu');

  // The toggle changes what the command offers…
  await radial.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('right-click menu');
  await expect(page.getByRole('option', { name: /^Right-Click Menu: Use the Ring/ })).toBeVisible();

  // …and the command changes the toggle.
  await page.getByRole('option', { name: /^Right-Click Menu: Use the Ring/ }).click();
  await expect(await railToggle(page, 'Radial right-click menu')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
});

test('the home screen has the same bar: About, Docs, GitHub and the app menu', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  const nav = page.getByRole('navigation', { name: 'Extrudo' });
  await expect(nav.getByRole('link')).toHaveText(['Docs', 'GitHub']);
  await expect(nav.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/zoltanf/extrudo',
  );
  // About is a button that opens the dialog, not a link to the landing site (ADR-0085).
  await nav.getByRole('button', { name: 'About' }).click();
  await expect(page.getByRole('dialog', { name: /about/ })).toBeVisible();
  await page.keyboard.press('Escape');
  // The bar is as tall as a design's, and the old Settings and Theme buttons are gone.
  expect((await header(page).boundingBox())?.height).toBe(40);
  await expect(header(page).getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  await expect(header(page).getByRole('button', { name: 'Theme', exact: true })).toHaveCount(0);
  const panel = await openAppMenu(page);
  // Nothing to close and no command search here, and no tool to help with.
  await expect(panel.getByRole('menu', { name: 'App' }).getByRole('menuitem')).toHaveText([
    /^Settings…/,
    'Report a bug',
    'About Extrudo',
  ]);
  await expect(panel.getByRole('menu', { name: 'Learn' }).getByRole('menuitem').first()).toHaveText(
    'User Guide',
  );
  await page.keyboard.press('Escape');
});

test('the web build has no desktop-only commands in Home or the app menu', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page);
  await page.getByRole('tab', { name: 'Home' }).click();
  for (const name of ['Open File', 'Save As', 'Quit']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  const panel = await openAppMenu(page);
  await expect(panel.getByRole('menuitem', { name: 'Online Tutorials' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Check now' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', { name: 'Search commands' });
  for (const text of ['open file', 'save as', 'quit', 'check for updates']) {
    await search.fill(text);
    await expect(
      page.getByRole('option', { name: /^(Open File|Save As|Quit|Check for Updates)/ }),
    ).toHaveCount(0);
  }
});

test.describe('with a light system theme and nothing stored', () => {
  test.use({ colorScheme: 'light' });
  test('the default theme is the system one', async ({ page }) => {
    await openProject(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});

/** The title group's centre against the middle of the gap between the cluster and the history button. */
async function titleCentring(page: Page) {
  // The cluster ends with Redo since R3-05 (Search, Undo, Redo).
  const last = await box(page, 'Redo');
  const history = await box(page, 'Version history');
  const group = (await page.locator('[data-title-group]').boundingBox()) as {
    x: number;
    width: number;
  };
  const gapMiddle = (last.x + last.width + history.x) / 2;
  return { offset: group.x + group.width / 2 - gapMiddle, group };
}

test('the title and save state are centred between the cluster and Version history', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page);
  await expect(saveStatus(page)).toHaveText('Saved');
  const { offset } = await titleCentring(page);
  console.log(`title centring offset at 1440: ${offset.toFixed(2)} px`);
  expect(Math.abs(offset)).toBeLessThanOrEqual(2);
});

test('narrow: the save word goes first, then the name is cut with an ellipsis', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page);
  const name = 'A rather long design name for a narrow window';
  await page.getByRole('button', { name: /^Project name/ }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill(name);
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  const group = page.locator('[data-title-group]');
  await expect(group).toHaveAttribute('data-title-fit', 'full');
  const word = saveStatus(page);
  const visible = async () => ((await word.boundingBox())?.width ?? 0) > 2;
  expect(await visible()).toBe(true);

  let sawDot = false;
  let truncated = false;
  for (let w = 1400; w >= 700; w -= 20) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(60);
    const fit = await group.getAttribute('data-title-fit');
    if (fit === 'dot') {
      sawDot = true;
      expect(await visible()).toBe(false);
      await expect(saveStatus(page)).toHaveText('Saved');
    }
    if (fit === 'truncate') {
      truncated = true;
      expect(sawDot).toBe(true);
      break;
    }
  }
  expect(sawDot && truncated).toBe(true);
  const nameButton = page.getByRole('button', { name: /^Project name/ });
  const cut = (await page.evaluate(
    "(() => { const el = document.querySelector('[data-title-group] button'); return el.scrollWidth > el.clientWidth; })()",
  )) as boolean;
  expect(cut).toBe(true);
  await expect(nameButton).toHaveAttribute('title', name);
});

// ---- Tiles first (round 2, part 8) -----------------------------------------------------

test('Home and Construct show every tool as a tile at 1440 px, each 64 px wide', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page);
  const toolbar = page.locator('#toolbar-groups');
  for (const tab of ['Home', 'Construct']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
    const fit = (await toolbar.getAttribute('data-toolbar-fit')) ?? '';
    expect(fit.split(',').every((n) => n === '0')).toBe(true);
    // Every ordinary tile is the fixed 64 px, and no label line overflows its box.
    const bad = await page.evaluate(`(() => {
      const bad = [];
      for (const t of document.querySelectorAll('#toolbar-groups button[data-tool]')) {
        const box = t.getBoundingClientRect();
        if (Math.round(box.width) !== 64) bad.push(t.dataset.tool + ':w=' + box.width);
        for (const line of t.querySelectorAll('span > span'))
          if (line.scrollWidth > line.clientWidth + 1) bad.push(t.dataset.tool + ':cut');
      }
      return bad.join(',');
    })()`);
    expect(bad).toBe('');
    // Home's Import and Export groups have no menu; Construct no fixed ▾ menu on Planes.
    const planes = toolbar.locator('[data-toolbar-group="Planes"] button[aria-haspopup]');
    if (tab === 'Construct') await expect(planes).toHaveCount(0);
  }
  await page.getByRole('tab', { name: 'Home' }).click();
  const group = async (name: string) =>
    (await page.evaluate(
      `[...document.querySelectorAll('[data-toolbar-group="${name}"] button[data-tool]')].map((t) => t.dataset.tool).join(',')`,
    )) as string;
  // R3-09: Import and Export instead of one Files group; no Extend group (R3-12).
  expect(await group('Import')).toBe('importProject,importBody,importDrawing,canvas');
  expect(await group('Export')).toMatch(
    /^exportProject,exportScript,export(,saveToLinkedFolder)?$/,
  );
  await expect(toolbar.locator('[data-toolbar-group="Files"]')).toHaveCount(0);
  await expect(toolbar.locator('[data-toolbar-group="Extend"]')).toHaveCount(0);
  for (const name of ['Import .extrudo', 'Import Model', 'Import Drawing', 'Export Model']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await page.getByRole('tab', { name: 'Construct' }).click();
  for (const name of ['3-Point Plane', 'Plane Along Path', 'Angled Midplane']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  // Inspect's tools are Construct's fourth group (R3-10).
  expect(await group('Inspect')).toBe('measure,section');

  // 1024 px: the Home tab's groups still fit the row (some tiles in their group menus).
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.waitForTimeout(150);
  expect(
    await page.evaluate(
      `(() => { const r = document.querySelector('#toolbar-groups'); return r.scrollWidth - r.clientWidth; })()`,
    ),
  ).toBeLessThanOrEqual(0);
  console.log(`fit at 1024 px, Home: ${await toolbar.getAttribute('data-toolbar-fit')}`);
  await page.setViewportSize({ width: 1440, height: 900 });

  // 900 px: the fit numbers for the two tabs.
  await page.setViewportSize({ width: 900, height: 900 });
  for (const tab of ['Home', 'Construct']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(150);
    console.log(`fit at 900 px, ${tab}: ${await toolbar.getAttribute('data-toolbar-fit')}`);
  }
});
