import { readFileSync } from 'node:fs';
import {
  EMBOSS_DEFAULT_DEPTH,
  EMBOSS_FACE_KINDS,
  EMBOSS_PROFILE_KINDS,
  EmbossInputsSchema,
  type EmbossMethod,
  type ExtrudoDocument,
  embossInputs,
  embossSettings,
  type Feature,
  type FeatureId,
  insertFeature,
  type OriginPlaneId,
  originPlaneRef,
  type SelectionItem,
  type SketchData,
  type SketchEntityId,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { loadFont } from '@extrudo/sketch/text';
import { beforeAll, describe, expect, it } from 'vitest';
import { embossDialog, embossManipulators } from './emboss';
import { featureDialogs, specForCommand } from './registry';
import type { DialogValues, Manipulator, ManipulatorContext } from './spec';
import { BOX, CYLINDER, cylinderMesh, faceItem, namedBoxMesh, setupDialogs } from './testing';
import { defaultValues, inputsFor, mergeValues, valuesFor } from './values';

const FONTS_DIR = new URL('../../../../packages/fonts/fonts/', import.meta.url);

/** The 10 mm test box's top face (z = 10); its centre is (5, 5). */
const TOP = { kind: 'face', id: 'box:top' } as const;
const RECT = { kind: 'profile', id: 'SK/r1' } as const;

const bodies = { [BOX]: namedBoxMesh() };

const values = (over: Partial<DialogValues> = {}): DialogValues =>
  mergeValues(defaultValues(embossDialog), over);

const round = (v: readonly number[]): number[] => v.map((c) => Number(c.toFixed(3)) + 0);
/** The world point a handle sits at, rounded (a handle's origin is a `Vec3`). */
const at = (handle: Manipulator | undefined): number[] =>
  round(handle?.kind === 'distance' ? handle.origin : []);
/** The unit direction of a handle. */
const way = (handle: Manipulator | undefined): number[] =>
  round(handle?.kind === 'distance' ? handle.direction : []);

beforeAll(() => {
  loadFont('inter-regular@1', readFileSync(new URL('inter-regular.ttf', FONTS_DIR)));
});

/**
 * A document with one sketch on XY: a rectangle off the centre, (0, 0)…(4, 2),
 * and a text `A` 5 mm tall from its anchor at (10, 0). Its profile and whole
 * text references.
 */
function withSketch(plane: OriginPlaneId = 'origin:xy', more?: (b: SketchBuilder) => void) {
  const t = setupDialogs([embossDialog]);
  const b = new SketchBuilder();
  b.line(0, 0, 4, 0);
  b.line(4, 0, 4, 2);
  b.line(4, 2, 0, 2);
  b.line(0, 2, 0, 0);
  more?.(b);
  const anchor = b.point(10, 0);
  const top = b.point(10, 5);
  const text = b.id('t');
  b.entities[text] = {
    type: 'text',
    anchor: anchor as SketchEntityId,
    top: top as SketchEntityId,
    text: 'A',
    font: 'inter-regular@1',
    align: 'left',
    construction: false,
  };
  const data = b.sketch as SketchData;
  const regions = detectProfiles(data);
  const region = regions[0];
  if (!region) throw new Error('the rectangle is not a profile');
  const sketch: Feature = {
    id: 'SK' as FeatureId,
    type: 'sketch',
    name: 'Sketch1',
    suppressed: false,
    inputs: sketchInputs(originPlaneRef(plane), data),
  };
  t.store.getState().dispatch(insertFeature({ feature: sketch, index: 1 }));
  return {
    ...t,
    profile: { kind: 'profile' as const, id: `SK/${region.id}` },
    // Every region of the sketch, so a test can pick one `more` added.
    profiles: regions.map((q) => ({ kind: 'profile' as const, id: `SK/${q.id}` })),
    text: { kind: 'sketchEntity' as const, id: `SK/${text}` },
  };
}

describe('the emboss dialog', () => {
  it('is the app’s dialog for the Emboss tool, a create feature', () => {
    expect(specForCommand(featureDialogs(), 'emboss')).toBe(embossDialog);
    expect(featureDialogs().get('emboss')).toBe(embossDialog);
    expect(embossDialog.category).toBe('create');
    expect(embossDialog.command).toBe('emboss');
    expect(embossDialog.fields.map((f) => f.name)).toEqual([
      'profiles',
      'face',
      'depth',
      'mode',
      'method',
    ]);
    expect(embossDialog.fields.map((f) => f.label)).toEqual([
      'Profiles',
      'Face',
      'Depth',
      'Mode',
      'Method',
    ]);
  });

  it('says how the kernel put the profiles on the face, once a preview has (P4-12)', () => {
    const field = embossDialog.fields.find((f) => f.name === 'method');
    if (field?.kind !== 'info') throw new Error('no method line');
    const values = { refs: {}, exprs: {}, choices: {}, toggles: {} } as never;
    const ctx = (method?: EmbossMethod) =>
      ({
        doc: {},
        bodies: {},
        ...(method && { draftEmboss: { kind: 'emboss', method } }),
      }) as never;
    expect(field.shown?.(values, ctx())).toBe(false);
    expect(field.shown?.(values, ctx('wrapped-cone'))).toBe(true);
    expect(field.text(values, ctx('wrapped-cone'))).toBe('Wrapped round the cone');
    expect(field.text(values, ctx('wrapped-cylinder'))).toBe('Wrapped round the cylinder');
    expect(field.text(values, ctx('projected'))).toBe('Projected onto the face');
    expect(field.text(values, ctx('moved'))).toBe('Moved onto the face');
  });

  it('takes profiles and whole texts, one face, and says what it needs', () => {
    expect(embossDialog.fields.find((f) => f.name === 'profiles')).toMatchObject({
      kind: 'selection',
      accepts: EMBOSS_PROFILE_KINDS,
      wholeTexts: true,
      prompt: 'Pick profiles or a text',
    });
    expect(embossDialog.fields.find((f) => f.name === 'face')).toMatchObject({
      kind: 'selection',
      accepts: EMBOSS_FACE_KINDS,
      max: 1,
    });
    expect(embossDialog.fields.find((f) => f.name === 'depth')).toMatchObject({
      kind: 'expression',
      unit: 'length',
      default: `${EMBOSS_DEFAULT_DEPTH} mm`,
    });
    expect(embossDialog.fields.find((f) => f.name === 'mode')).toMatchObject({
      kind: 'choice',
      options: [
        { value: 'emboss', label: 'Emboss' },
        { value: 'deboss', label: 'Deboss' },
      ],
      default: 'emboss',
    });
  });

  it('makes valid inputs the kernel reads, and reads them back', () => {
    const ctx = { doc: setupDialogs().store.getState().doc, bodies };
    const inputs = inputsFor(
      embossDialog,
      values({
        refs: { profiles: [RECT], face: [TOP] },
        exprs: { depth: '2 mm' },
        choices: { mode: 'deboss' },
      }),
      ctx,
    );
    expect(EmbossInputsSchema.safeParse(inputs).success).toBe(true);
    expect(Object.keys(inputs).sort()).toEqual(['depth', 'face', 'mode', 'profiles']);
    expect(embossSettings(inputs as never)).toMatchObject({
      profiles: [RECT],
      face: TOP,
      depth: 'depth',
      mode: 'deboss',
    });
    const back = valuesFor(
      embossDialog,
      { id: 'E', type: 'emboss', name: 'Emboss1', inputs } as Feature,
      ctx,
    );
    expect(back.refs.face).toEqual([TOP]);
    expect(back.exprs.depth).toBe('2 mm');
    expect(back.choices.mode).toBe('deboss');
  });

  it('reads a feature stored by embossInputs', () => {
    const ctx = { doc: setupDialogs().store.getState().doc, bodies };
    const feature = {
      id: 'E',
      type: 'emboss',
      name: 'Emboss1',
      inputs: embossInputs([RECT], TOP, { depth: '0.5 mm' }),
    } as Feature;
    const v = valuesFor(embossDialog, feature, ctx);
    expect(v.exprs.depth).toBe('0.5 mm');
    expect(v.choices.mode).toBe('emboss');
  });

  it('wants profiles and a face, and a depth above 0', () => {
    const t = withSketch();
    t.controller.start('emboss');
    // Nothing picked: the first field asks for itself.
    expect(t.open()?.pickField).toBe('profiles');
    expect(t.open()?.checked.fields).toEqual({
      profiles: 'Pick profiles or a text.',
      face: 'Pick a face.',
    });
    expect(t.controller.ok()).toBe(false);
    t.controller.setRefs('profiles', [t.profile]);
    expect(t.open()?.checked.fields).toEqual({ face: 'Pick a face.' });
    t.controller.setRefs('face', [TOP]);
    expect(t.open()?.checked.first).toBeUndefined();
    expect(t.open()?.draft.inputs.depth).toMatchObject({
      kind: 'expr',
      expr: '1 mm',
      unit: 'length',
    });
    t.controller.setExpr('depth', '0 mm');
    expect(t.open()?.checked.first).toEqual({
      field: 'depth',
      message: 'The depth must be greater than 0.',
    });
    expect(t.controller.ok()).toBe(false);
    t.controller.setExpr('depth', '-2 mm');
    expect(t.open()?.checked.fields.depth).toBe('The depth must be greater than 0.');
    // A depth the dialog can't read itself is the framework's business, not this one's.
    t.controller.setExpr('depth', 'd1');
    expect(t.open()?.checked.first).toBeUndefined();
  });

  it('a selected profile and a face fill the fields, in field order', () => {
    const t = withSketch();
    const items: SelectionItem[] = [faceItem(1), t.profile];
    t.session.getState().select(items);
    t.controller.start('emboss');
    expect(t.open()?.values.refs).toEqual({ profiles: [t.profile], face: [TOP] });
    expect(t.open()?.checked.first).toBeUndefined();
    expect(EmbossInputsSchema.safeParse(t.open()?.draft.inputs).success).toBe(true);
  });

  it('a selected text goes to Profiles, and the feature stores that reference', () => {
    const t = withSketch();
    t.session.getState().select([t.text, faceItem(1)]);
    t.controller.start('emboss');
    expect(t.open()?.values.refs.profiles).toEqual([t.text]);
    expect(t.open()?.values.refs.face).toEqual([TOP]);
    expect(t.controller.ok()).toBe(true);
    const feature = t.store.getState().doc.features.at(-1);
    expect(feature).toMatchObject({ type: 'emboss', name: 'Emboss1' });
    expect(feature?.inputs.profiles).toEqual({ kind: 'ref', refs: [t.text] });
  });

  it('draws the preview as the join it makes, and the cut a deboss is', () => {
    expect(embossDialog.previewStyle?.(values())).toBe('join');
    expect(embossDialog.previewStyle?.(values({ choices: { mode: 'deboss' } }))).toBe('cut');
  });
});

describe('the depth arrow', () => {
  const arrows = (doc: ExtrudoDocument, v: DialogValues) =>
    embossManipulators(v, { doc, bodies, value: () => 1 } as ManipulatorContext);

  it('stands on the face at the profiles’ centre, along its outward normal', () => {
    const t = withSketch();
    const handles = arrows(
      t.store.getState().doc,
      values({ refs: { profiles: [t.profile], face: [TOP] } }),
    );
    expect(handles).toHaveLength(1);
    expect(at(handles[0])).toEqual([2, 1, 10]);
    expect(way(handles[0])).toEqual([0, 0, 1]);
  });

  it('goes the other way for a deboss', () => {
    const t = withSketch();
    const handles = arrows(
      t.store.getState().doc,
      values({ refs: { profiles: [t.profile], face: [TOP] }, choices: { mode: 'deboss' } }),
    );
    expect(way(handles[0])).toEqual([0, 0, -1]);
  });

  it('stands among the letters of a whole text, not at the face’s centre', () => {
    const t = withSketch();
    const handles = arrows(
      t.store.getState().doc,
      values({ refs: { profiles: [t.text], face: [TOP] } }),
    );
    // The `A` is 5 mm tall from its anchor at (10, 0), so its ink is around
    // x ≈ 11.7, y ≈ 1.7; the face's own centre is (5, 5).
    const origin = at(handles[0]);
    expect(origin[2]).toBe(10);
    expect(origin[0]).toBeGreaterThan(10);
    expect(origin[0]).toBeLessThan(14);
    expect(origin[1]).toBeGreaterThan(0);
    expect(origin[1]).toBeLessThan(5);
  });

  it('stands on a round face among the letters, pointing out of it', () => {
    // A second rectangle on an XZ sketch: its middle is (4, 0, 2) in world mm,
    // inside a Ø20 cylinder's wall.
    const t = withSketch('origin:xz', (b) => {
      b.line(2, 1, 6, 1);
      b.line(6, 1, 6, 3);
      b.line(6, 3, 2, 3);
      b.line(2, 3, 2, 1);
    });
    const patch = t.profiles[1];
    if (!patch) throw new Error('the second rectangle is not a profile');
    const doc = t.store.getState().doc;
    const wall = { kind: 'face' as const, id: 'cylinder:side:wall' };
    const outside = { [CYLINDER]: cylinderMesh() };
    const inside = { [CYLINDER]: cylinderMesh(10, 20, 12, true) };
    const handles = (v: DialogValues, bodies = outside) =>
      embossManipulators(v, { doc, bodies, value: () => 1 } as ManipulatorContext);
    const picked = values({ refs: { profiles: [patch], face: [wall] } });

    // The arrow stands on the wall nearest the letters, on the radius of 10, and
    // points straight out of it.
    const out = handles(picked);
    expect(out).toHaveLength(1);
    const where = at(out[0] as Manipulator);
    const [x = 0, y = 0, z = 0] = where;
    expect(Math.hypot(x, y)).toBeCloseTo(10, 3);
    expect(z).toBeGreaterThanOrEqual(0);
    expect(z).toBeLessThanOrEqual(20);
    const [dx = 0, dy = 0, dz = 0] = way(out[0] as Manipulator);
    expect(Math.hypot(dx, dy)).toBeCloseTo(1, 3);
    expect(dx).toBeCloseTo(x / 10, 3);
    expect(dy).toBeCloseTo(y / 10, 3);
    expect(dz).toBe(0);

    // A deboss goes the other way, and so does an emboss on a hole's wall: its
    // normals point into the hole's free space, which is where the letters grow.
    const flipped = [dx, dy, dz].map((c) => (c === 0 ? 0 : -c));
    expect(way(handles({ ...picked, choices: { mode: 'deboss' } })[0])).toEqual(flipped);
    const inward = handles(picked, inside);
    expect(way(inward[0])).toEqual(flipped);
    expect(at(inward[0])).toEqual(where);
  });

  it('falls back to the face’s centre, and needs a face at all', () => {
    const t = withSketch();
    const doc = t.store.getState().doc;
    const stands = (v: DialogValues) => at(arrows(doc, v)[0]);
    expect(stands(values({ refs: { face: [TOP] } }))).toEqual([5, 5, 10]);
    // A reference that isn't there any more: still the face's centre.
    expect(
      stands(values({ refs: { profiles: [{ kind: 'profile', id: 'gone' }], face: [TOP] } })),
    ).toEqual([5, 5, 10]);
    expect(arrows(doc, values({ refs: { profiles: [t.profile] } }))).toEqual([]);
  });
});
