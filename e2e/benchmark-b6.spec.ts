import { expect, test } from '@playwright/test';
import {
  addParameter,
  chip,
  clickAt,
  clickEdge,
  clickWhere,
  closeParameters,
  expectNoProblems,
  exportModel,
  exportProject,
  objectsOf3mf,
  ok,
  openParameters,
  primitive,
  renameProject,
  setParameters,
  solidFacts,
  solidTab,
  turnView,
  viewportOf,
  zoomOutTo,
} from './benchmark-helpers';
import { kernelReady, openProject, pickTool } from './helpers';

// P3-08: benchmark B6 (requirements §7) built through the UI: a wall hook. A
// back plate (`wall` thick, `width` × `height`), an arm (`reach` long, `arm`
// wide, `wall` thick) and a lip at its tip (`lip` high) are three boxes
// joined into one body. Draft1 tilts the arm's sides and top by `taper` about
// the plate's front face (pull out of the wall), so the arm narrows towards
// the tip; Fillet1 rounds the plate's four top edges, which meet at its
// corners, and the inside corner where the arm leaves the plate, by `radius`.
// Parameters change the hook; its 3MF export is one closed solid.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('B6: a wall hook with a draft and fillets on intersecting edges', async ({ page }) => {
  // Three boxes, a draft and a fillet picked in the view, a parameter edit and
  // an export, each waiting for the kernel.
  test.setTimeout(150_000);
  await openProject(page);
  const viewport = viewportOf(page);
  await renameProject(page, 'B6 Wall hook');

  await openParameters(page);
  await addParameter(page, 'wall', '5 mm');
  await addParameter(page, 'width', '30 mm');
  await addParameter(page, 'height', '60 mm');
  await addParameter(page, 'arm', '16 mm');
  await addParameter(page, 'reach', '40 mm');
  await addParameter(page, 'lip', '15 mm');
  await addParameter(page, 'taper', '3 deg', 'angle');
  await addParameter(page, 'radius', '2 mm');
  await closeParameters(page);
  await kernelReady(page);

  // The plate against the wall (the YZ plane), the arm out along X, the lip up at its tip.
  await primitive(page, 'Box', { Length: 'wall', Width: 'width', Height: 'height', X: 'wall / 2' });
  await primitive(
    page,
    'Box',
    { Length: 'reach', Width: 'arm', Height: 'wall', X: 'reach / 2' },
    'join',
  );
  await primitive(
    page,
    'Box',
    { Length: 'wall', Width: 'arm', Height: 'lip', X: 'reach - wall / 2' },
    'join',
  );
  await expect(viewport).toHaveAttribute('data-bodies', /^Body1:\d+:40,30,60$/);
  await expectNoProblems(page);

  // See the whole hook: zoom out, then the home view.
  const box0 = await viewport.boundingBox();
  if (!box0) throw new Error('no viewport');
  await zoomOutTo(page, { x: box0.x + box0.width / 2, y: box0.y + box0.height / 2 }, 160);
  let at = await turnView(page, 'Shift+1');

  // Draft1: the arm's top and its two sides (each one face with the lip's side), about
  // the plate's front face, whose normal (+X) pulls out of the wall.
  await pickTool(page, 'Draft');
  const draft = page.getByRole('region', { name: 'Draft dialog' });
  await expect(draft).toBeVisible();
  const faces = draft.getByRole('button', { name: 'Faces', exact: true });
  await clickWhere(page, at, [20, 0, 5], /^face:/);
  await expect(faces).toHaveText('1 face');
  await clickWhere(page, at, [20, -8, 2.5], /^face:/);
  await expect(faces).toHaveText('2 faces');
  // The other side faces away from the home view: pick it from the back (+Y).
  at = await turnView(page, 'Shift+5');
  await clickWhere(page, at, [20, 8, 2.5], /^face:/);
  await expect(faces).toHaveText('3 faces');
  at = await turnView(page, 'Shift+1');
  await draft.getByRole('button', { name: 'Plane', exact: true }).click();
  // A plane field picks like Create Sketch (no model hover): the plate's front, above the arm.
  await clickAt(page, at, [5, -10, 45]);
  await expect(draft.getByRole('button', { name: 'Plane', exact: true })).toHaveText('1 face');
  await draft.getByRole('textbox', { name: 'Angle', exact: true }).fill('taper');
  await ok(page, draft);
  await expect(chip(page, 'Draft1')).toBeVisible();
  await expectNoProblems(page);

  // Fillet1: the plate's top edges, which meet at its four top corners, and the inside
  // corner where the arm's (drafted) top leaves the plate.
  await pickTool(page, 'Fillet');
  const fillet = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(fillet).toBeVisible();
  const edges = fillet.getByRole('button', { name: 'Edges', exact: true });
  const picks: [number, number, number][] = [
    [5, 0, 60],
    [2.5, -15, 60],
    [0, 0, 60],
    [2.5, 15, 60],
    [5, 0, 5],
  ];
  for (const [i, p] of picks.entries()) {
    await clickEdge(page, at, p);
    await expect(edges).toHaveText(i === 0 ? '1 edge' : `${i + 1} edges`);
  }
  await fillet.getByRole('textbox', { name: 'Radius', exact: true }).fill('radius');
  await ok(page, fillet);
  await expect(chip(page, 'Fillet1')).toBeVisible();
  await expectNoProblems(page);
  await expect(viewport).toHaveAttribute('data-bodies', /^Body1:\d+:40,30,60$/);

  // The 3MF export is one closed solid of that size.
  const hook = objectsOf3mf(await exportModel(page, '3MF'));
  expect(hook).toHaveLength(1);
  const facts = solidFacts((hook[0] as (typeof hook)[number]).mesh);
  expect(facts.size.map((v) => Math.round(v * 10) / 10)).toEqual([40, 30, 60]);
  await solidTab(page);

  // Parameters change the hook: a longer arm, a steeper draft, smaller rounds.
  // (The plate is 5 mm thick: its front and back top fillets meet above 2.5 mm.)
  await setParameters(page, { reach: '50 mm', taper: '5 deg', radius: '1.5 mm' });
  await kernelReady(page);
  await expectNoProblems(page);
  await expect(viewport).toHaveAttribute('data-bodies', /^Body1:\d+:50,30,60$/);
  await setParameters(page, { reach: '40 mm', taper: '3 deg', radius: '2 mm' });
  await kernelReady(page);
  await expectNoProblems(page);

  await exportProject(page, 'b6-wall-hook.extrudo');
});
