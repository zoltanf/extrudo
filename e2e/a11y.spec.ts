import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { kernelReady, openProject } from './helpers';

// P3-13 (NFR-07): an axe audit of the main screens. Each screen is checked
// against WCAG 2.1 A and AA; the test fails on any violation not listed in
// KNOWN (rules we have looked at and decided to leave for now, each with the
// reason), so new problems show up in review.

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);

/**
 * Violations we have looked at and leave for now: the rule, a piece of the
 * failing node's HTML, and why. A violation is let through only if every
 * node it names matches an entry.
 */
const KNOWN: { rule: string; node: string; why: string }[] = [
  {
    rule: 'color-contrast',
    node: '<kbd class="font-mono text-xs opacity-70">Enter</kbd>',
    why: "The feature dialog OK button's key hint (light theme, 3.9:1) is in features/FeatureDialog.tsx, which P3-04/P3-08 are changing; fix it there (drop the opacity on accent buttons).",
  },
];

async function audit(page: Page, screen: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const known = (rule: string, html: string) =>
    KNOWN.some((k) => k.rule === rule && html.includes(k.node));
  const found = results.violations
    .filter((v) => !v.nodes.every((n) => known(v.id, n.html)))
    .map((v) => ({
      screen,
      rule: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes
        .slice(0, 4)
        .map(
          (n) => `${n.target.join(' ')} :: ${n.html.slice(0, 220)} :: ${n.failureSummary ?? ''}`,
        ),
    }));
  // Every screen is audited even when an earlier one fails.
  expect.soft(found).toEqual([]);
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        `localStorage.setItem('extrudo.theme', ${JSON.stringify(JSON.stringify(theme))});`,
      );
    });

    test('home screen', async ({ page }) => {
      await page.goto('./');
      await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
      await audit(page, `${theme} home`);
    });

    test('project shell, sketch mode and dialogs', async ({ page }) => {
      await openProject(page, 'wall-bracket');
      await kernelReady(page);
      await audit(page, `${theme} shell`);

      // A feature dialog.
      await page
        .getByRole('list', { name: 'Features' })
        .getByRole('button', { name: /^Extrude1/ })
        .dblclick();
      await expect(page.getByRole('region', { name: 'Edit Extrude1 dialog' })).toBeVisible();
      await audit(page, `${theme} feature dialog`);
      await page.getByRole('button', { name: 'Cancel Esc' }).click();

      // Parameters.
      await page.getByRole('button', { name: 'Parameters', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Parameters' })).toBeVisible();
      await audit(page, `${theme} parameters`);
      await page.keyboard.press('Escape');

      // Versions.
      await page.keyboard.press('Control+s');
      await expect(page.getByRole('dialog', { name: 'Versions' })).toBeVisible();
      await audit(page, `${theme} versions`);
      await page.keyboard.press('Escape');

      // Command palette.
      await page.keyboard.press('Control+k');
      await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
      await audit(page, `${theme} command palette`);
      await page.keyboard.press('Escape');

      // Export.
      await page.getByRole('button', { name: 'File menu' }).click();
      await page.getByRole('menuitem', { name: /^Export 3MF/ }).click();
      await expect(page.getByRole('dialog', { name: 'Export model' })).toBeVisible();
      await audit(page, `${theme} export`);
      await page.keyboard.press('Escape');

      // Panels: Measure, Section Analysis, Print Info, the notification history.
      await page.keyboard.press('i');
      await expect(page.getByRole('region', { name: 'Measure' })).toBeVisible();
      await audit(page, `${theme} measure`);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Shift+S');
      const section = page.getByRole('region', { name: 'Section Analysis' });
      await expect(section).toBeVisible();
      await audit(page, `${theme} section`);
      await section.getByRole('button', { name: /^Done/ }).click();
      await page
        .getByRole('tablist', { name: 'Toolbar tabs' })
        .getByRole('tab', { name: '3D Print' })
        .click();
      await page.getByRole('button', { name: 'Print Info' }).click();
      await expect(page.getByRole('region', { name: 'Print Info' })).toBeVisible();
      await audit(page, `${theme} print info`);
      await page.keyboard.press('Escape');
      await page.getByRole('tab', { name: 'Solid' }).click();
      await page.keyboard.press('Control+k');
      await page.keyboard.type('Notification History');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: 'Notification history' })).toBeVisible();
      await audit(page, `${theme} notification history`);
      await page.keyboard.press('Escape');

      // Sketch mode: the Wall bracket's first sketch.
      await page
        .getByRole('list', { name: 'Features' })
        .getByRole('button', { name: /^Sketch1/ })
        .dblclick();
      await expect(page.getByRole('region', { name: 'Sketch palette' })).toBeVisible();
      await audit(page, `${theme} sketch`);
    });
  });
}
