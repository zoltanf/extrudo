import { expect, test } from '@playwright/test';
import { openProject } from './helpers';

// ADR-0076: software rendering where possible, a clear message where not.

const NO_WEBGL = `
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') return null;
    return original.call(this, kind, ...rest);
  };
`;

async function openWithoutWebgl(page: import('@playwright/test').Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New design' }).click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
}

test.describe('no WebGL at all', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(NO_WEBGL);
  });

  test('the view says so and the rest of the app works', async ({ page }) => {
    await openWithoutWebgl(page);
    const panel = page.getByRole('region', { name: '3D view unavailable' });
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-webgl', 'none');
    await expect(
      panel.getByRole('heading', { name: "Extrudo can't draw the 3D view in this browser" }),
    ).toBeVisible();
    await expect(panel.getByText('Your design is safe')).toBeVisible();
    const command = panel.locator('[data-swiftshader-command]');
    await expect(command).toContainText('--enable-unsafe-swiftshader');
    await expect(command).toContainText(new URL(page.url()).origin);

    // The shell is mounted: the timeline and the Parameters dialog work.
    await expect(page.getByRole('status', { name: 'Status', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Parameters/ }).click();
    await expect(page.getByRole('dialog', { name: /Parameters/ })).toBeVisible();
  });

  test('Try again probes again', async ({ page }) => {
    await openWithoutWebgl(page);
    const panel = page.getByRole('region', { name: '3D view unavailable' });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Try again' }).click();
    // Still no WebGL: the panel stays instead of a white page.
    await expect(panel).toBeVisible();
  });
});

test('a context that fails after detection ends in the same panel', async ({ page }) => {
  // The detection probes (detached canvases) get a real context; three.js's own request (the
  // canvas in the page) fails,
  // as on the owner's VM ("THREE.WebGLRenderer: Error creating WebGL context.").
  await page.addInitScript(`
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
      if (kind === 'webgl2' && this.isConnected) return null;
      return original.call(this, kind, ...rest);
    };
  `);
  const errors: string[] = [];
  page.on('console', (m) => errors.push(m.text()));
  await openWithoutWebgl(page);
  const panel = page.getByRole('region', { name: '3D view unavailable' });
  await expect(panel).toBeVisible();
  expect(errors.join('\n')).toMatch(/Error creating WebGL context/);
  await expect(panel.locator('[data-swiftshader-command]')).toContainText(
    '--enable-unsafe-swiftshader',
  );
});

test.describe('software rendering', () => {
  // The config pre-dismisses the toast for every spec; this one wants it.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('is announced once and can be dismissed for good', async ({ page }) => {
    const viewport = await openProject(page);
    await expect(viewport).toHaveAttribute('data-ready', 'true');
    // The e2e browser draws WebGL with SwiftShader.
    await expect(page.locator('[data-renderer="software"]')).toBeVisible();
    const toast = page
      .getByRole('status')
      .filter({ hasText: 'draws 3D without the graphics card' });
    await expect(toast).toBeVisible();

    await toast.getByRole('button', { name: "Don't show again" }).click();
    await expect(toast).toBeHidden();

    await page.reload();
    await expect(page.getByRole('region', { name: 'Viewport' })).toHaveAttribute(
      'data-ready',
      'true',
    );
    await expect(page.locator('[data-renderer="software"]')).toBeVisible();
    await expect(page.getByText('draws 3D without the graphics card')).toHaveCount(0);
  });
});

test('a crash nothing else catches shows a message, not a white page', async ({ page }) => {
  await page.goto('./#/debug/crash');
  const alert = page.getByRole('alert').filter({ hasText: 'Something went wrong' });
  await expect(alert).toBeVisible();
  await expect(alert.getByText('Your work is saved')).toBeVisible();
  await expect(alert.getByText('Crash requested by #/debug/crash.')).toBeVisible();
  await expect(alert.getByRole('button', { name: 'Reload' })).toBeVisible();

  await page.evaluate("history.replaceState(null, '', '#/')");
  await alert.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByRole('button', { name: 'New design' })).toBeVisible();
});

test('a lost context shows the reset overlay and clears when restored', async ({ page }) => {
  const viewport = await openProject(page);
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  const lostOverlay = page.locator('[data-webgl="lost"]');
  await expect(lostOverlay).toHaveCount(0);
  await page.evaluate(`(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas.getContext('webgl2');
    window.__lose = gl.getExtension('WEBGL_lose_context');
    window.__lose.loseContext();
  })()`);
  await expect(lostOverlay).toBeVisible();
  await expect(lostOverlay.getByRole('button', { name: 'Reload view' })).toBeVisible();
  await page.evaluate('window.__lose.restoreContext()');
  await expect(lostOverlay).toHaveCount(0);
});
