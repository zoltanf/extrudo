import { expect, type Page, test } from '@playwright/test';
import {
  addParameter,
  chip,
  clickEdge,
  closeParameters,
  homeView,
  openParameters,
  setParameters,
  viewportOf,
} from './benchmark-helpers';
import { kernelReady, openProject, pickTool, projector } from './helpers';

test.use({ viewport: { width: 1280, height: 900 } });
test.setTimeout(90_000);
const panel = (page: Page, edit = false) =>
  page.getByRole('region', { name: edit ? 'Edit Script1 dialog' : 'Script dialog', exact: true });
const editor = (page: Page) => page.getByRole('textbox', { name: 'Script code' });
async function replace(page: Page, code: string) {
  await editor(page).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(code);
}
async function start(page: Page) {
  await pickTool(page, 'Script');
  await expect(editor(page)).toBeVisible();
  await expect(panel(page)).toHaveAttribute('data-preview-status', 'ok', { timeout: 30_000 });
}
async function ready(page: Page, edit = false) {
  await expect(panel(page, edit)).toHaveAttribute('data-preview-status', 'ok', { timeout: 30_000 });
}
async function commit(page: Page, edit = false) {
  await ready(page, edit);
  await panel(page, edit).getByRole('button', { name: /^OK/ }).click();
  await expect(panel(page, edit)).toBeHidden();
  await kernelReady(page);
}
const plate = `// A plate with a ring of through holes.\ndesign.box({ length: 60, width: 60, height: 5 });\nfor (let i = 0; i < params.count; i++) {\n  const angle = i * Math.PI * 2 / params.count;\n  design.hole({ x: 20 * Math.cos(angle), y: 20 * Math.sin(angle), diameter: 4, extent: 'through', flip: true });\n}\nconsole.log('hello', 2);`;

test.beforeEach(async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
});

test('a lazy editor previews a box, commits one step, edits and cancels', async ({ page }) => {
  const fetched: string[] = [];
  page.on('request', (request) => fetched.push(request.url()));
  expect(
    await page.evaluate(
      "performance.getEntriesByType('resource').some((entry) => entry.name.includes('scriptEditor'))",
    ),
  ).toBe(false);
  const began = Date.now();
  await pickTool(page, 'Script');
  await expect(editor(page)).toBeVisible();
  const opened = Date.now();
  await ready(page);
  console.log(
    `Script first-open ${opened - began} ms; first preview including debounce/worker load ${Date.now() - began} ms`,
  );
  const worker = page.workers().find((w) => w.url().includes('kernelWorker'));
  expect(worker).toBeDefined();
  console.log(
    `QuickJS worker lazy load ${await worker?.evaluate("performance.getEntriesByName('extrudo-script-host-load')[0]?.duration")} ms`,
  );
  console.log(
    `Script first preview request-to-result ${await page.evaluate("performance.getEntriesByName('extrudo-preview').find((entry) => entry.detail?.type === 'script')?.duration")} ms`,
  );
  expect(fetched.some((url) => url.includes('scriptEditor'))).toBe(true);
  await expect(viewportOf(page)).toHaveAttribute('data-preview', /new/);
  await expect(editor(page)).toContainText('design.box');
  const original = await editor(page).innerText();
  await commit(page);
  await expect(chip(page, 'Script1')).toBeVisible();
  await expect(viewportOf(page)).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
  await chip(page, 'Script1').hover();
  await expect(page.getByRole('tooltip')).toContainText('made 1 features');
  await chip(page, 'Script1').dblclick();
  await expect.poll(() => editor(page).innerText()).toBe(original);
  await replace(page, 'design.sphere({ diameter: 10 });');
  await panel(page, true)
    .getByRole('button', { name: /^Cancel Esc/ })
    .click();
  await expect(viewportOf(page)).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
  await page.keyboard.press('Control+z');
  await expect(chip(page, 'Script1')).toHaveCount(0);
  await expect(viewportOf(page)).not.toHaveAttribute('data-bodies', /Body1/);
});

test('a loop reads a parameter, logs, and reruns after its value changes', async ({ page }) => {
  await openParameters(page);
  await addParameter(page, 'count', '4', 'unitless');
  await closeParameters(page);
  await start(page);
  await replace(page, plate);
  await ready(page);
  await expect(page.getByRole('region', { name: 'Script output' })).toContainText('hello 2');
  await expect(panel(page).locator('[data-script-made]')).toHaveText('Made 5 features');
  await commit(page);
  await expect(viewportOf(page)).toHaveAttribute('data-bodies', 'Body1:10:60,60,5');
  await setParameters(page, { count: '6' });
  await expect(viewportOf(page)).toHaveAttribute('data-bodies', 'Body1:12:60,60,5', {
    timeout: 30_000,
  });
});

test('a line-three syntax error is underlined; fixing it enables OK', async ({ page }) => {
  await start(page);
  await replace(page, '// first\n// second\nconst broken = ;');
  await expect(panel(page)).toHaveAttribute('data-preview-status', 'error');
  await expect(panel(page).getByRole('status', { name: 'Feature status' })).toContainText(
    'Line 3:',
  );
  await expect(panel(page).locator('.cm-lintRange-error')).toHaveCount(1);
  await expect(panel(page).locator('.cm-line').nth(2).locator('.cm-lintRange-error')).toHaveCount(
    1,
  );
  await expect(panel(page).getByRole('button', { name: /^OK/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await replace(page, 'design.box({});');
  await ready(page);
  await expect(panel(page).locator('.cm-lintRange-error')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /^OK/ })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('completions, editor undo and keyboard escape stay inside the editor', async ({ page }) => {
  await openParameters(page);
  await addParameter(page, 'count', '4', 'unitless');
  await closeParameters(page);
  await start(page);
  await replace(page, 'design');
  await page.keyboard.type('.');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('box');
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeVisible();
  await replace(page, 'params');
  await page.keyboard.type('.');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('count');
  await page.keyboard.press('Escape');
  await replace(page, '// ');
  await page.keyboard.type('elqs');
  await expect(editor(page)).toContainText('elqs');
  await expect(page.locator('[data-feature-dialog]')).toHaveAttribute(
    'data-feature-dialog',
    'script',
  );
  await page.keyboard.press('Control+z');
  await expect(panel(page)).toBeVisible();
  await expect(editor(page)).not.toContainText('elqs');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect(editor(page)).not.toBeFocused();
  await panel(page)
    .getByRole('button', { name: /^Cancel Esc/ })
    .click();
});

test('language and text edits are one undo step, runtime errors lose the QuickJS prefix', async ({
  page,
}) => {
  await start(page);
  await commit(page);
  await chip(page, 'Script1').dblclick();
  await panel(page, true).getByRole('combobox', { name: 'Language' }).selectOption('js');
  await replace(page, "// one\n// two\nthrow new Error('no luck');");
  await expect(panel(page, true)).toHaveAttribute('data-preview-status', 'error');
  await expect(panel(page, true).getByRole('status', { name: 'Feature status' })).toHaveText(
    'Line 3: no luck',
  );
  await replace(page, 'design.box({ length: 30 });');
  await commit(page, true);
  await expect(viewportOf(page)).toHaveAttribute('data-bodies', 'Body1:6:30,20,20');
  await page.keyboard.press('Control+z');
  await expect(viewportOf(page)).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');
  await chip(page, 'Script1').dblclick();
  await expect(panel(page, true).getByRole('combobox', { name: 'Language' })).toHaveValue('ts');
  await panel(page, true)
    .getByRole('button', { name: /^Cancel Esc/ })
    .click();
});

test('a later fillet resolves a script edge after a parameter change; Delete refuses its source', async ({
  page,
}) => {
  await openParameters(page);
  await addParameter(page, 'count', '4', 'unitless');
  await closeParameters(page);
  await start(page);
  await replace(page, plate);
  await commit(page);
  await homeView(page);
  const project = await projector(viewportOf(page));
  await clickEdge(page, project, [0, -30, 5]);
  await page.keyboard.press('f');
  const fillet = page.getByRole('region', { name: 'Fillet dialog' });
  await fillet.getByRole('textbox', { name: 'Radius', exact: true }).fill('1 mm');
  await expect(fillet).toHaveAttribute('data-preview-status', 'ok');
  await fillet.getByRole('button', { name: /^OK/ }).click();
  await expect(chip(page, 'Fillet1')).toBeVisible();
  await setParameters(page, { count: '6' });
  await kernelReady(page);
  await expect(chip(page, 'Fillet1')).not.toHaveAttribute('data-feature-status', 'error');
  await expect(viewportOf(page)).toHaveAttribute('data-bodies', /^Body1:13:/);
  await chip(page, 'Script1').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Delete/ }).click();
  await expect(page.getByRole('alert')).toContainText(/Fillet1|used|uses|refers/);
  await expect(chip(page, 'Script1')).toBeVisible();
});
