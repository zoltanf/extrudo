/**
 * The hole dialog (P3-04, ADR-0049, FR-FT-07): a plane or flat face the
 * holes start on (picked like Create Sketch's plane; **a click on a face
 * also places the hole where you clicked**, as X and Y in the face's
 * sketch frame), or sketch points (Points: every point drops onto the plane
 * and gets a hole), the shape (simple, counterbore, countersink), how far
 * (blind or through all), the sizes, and a Preset that fills the sizes for
 * an M2 to M8 clearance hole or a heat-set insert.
 *
 * Fields are named like the feature's inputs, so the framework's default
 * mapping turns them into inputs and back; **Preset is the one field that
 * isn't an input**: choosing it fills the size fields (`onChange`), and the
 * dropdown always shows the preset the sizes match, else Custom. In a
 * document with a `tolerance` parameter the sizes a preset fills are
 * `<nominal> mm + 2 * tolerance`, and the dropdown recognises them (P4-08,
 * ADR-0062).
 *
 * `propose` fills in what the user hasn't set: the XY plane when none is
 * picked (the plane of the first sketch point, when there are points), and
 * the face's centre as X and Y.
 */
import {
  type FeatureDefinition,
  type GeomRef,
  HOLE_DEFAULT_PLANE,
  HOLE_EXTENTS,
  HOLE_KINDS,
  HOLE_NUMBERS,
  HOLE_PLANE_KINDS,
  HOLE_POINT_KINDS,
  HOLE_PRESETS,
  type HoleExtent,
  type HoleKind,
  holeFeature,
  holePreset,
  parseSketchEntityRefId,
  presetMatches,
  presetSizes,
  readSketch,
  sketchToWorld,
  toleranceParameter,
  type Vec3,
  worldToSketch,
} from '@extrudo/core';
import { isFlatFace } from '../sketch/facePick';
import { sketchFrame } from '../sketch/frame';
import { faceFrame } from './geometry';
import { placementFrame } from './primitives';
import {
  type DialogContext,
  type DialogField,
  type DialogValues,
  defineFeatureDialog,
  type FeatureDialogSpec,
  type Manipulator,
  type ManipulatorContext,
  type ProposeContext,
} from './spec';
import { defaultFromInputs, defaultInputs } from './values';

const KIND_LABELS: Record<HoleKind, string> = {
  simple: 'Simple',
  counterbore: 'Counterbore',
  countersink: 'Countersink',
};
const EXTENT_LABELS: Record<HoleExtent, string> = { blind: 'Blind', through: 'Through all' };

/** Where the dropdowns start (and what the dialog stores when they are untouched). */
const DEFAULT_TYPE: HoleKind = 'simple';
const DEFAULT_EXTENT: HoleExtent = 'through';

const CUSTOM = 'custom';

const type = (v: DialogValues): HoleKind => (v.choices.type ?? DEFAULT_TYPE) as HoleKind;
const extent = (v: DialogValues): HoleExtent => (v.choices.extent ?? DEFAULT_EXTENT) as HoleExtent;
const noPoints = (v: DialogValues) => (v.refs.points?.length ?? 0) === 0;

/** Whether a size field applies to the hole these values describe. */
function relevant(name: string, v: DialogValues): boolean {
  switch (name) {
    case 'x':
    case 'y':
      return noPoints(v);
    case 'depth':
    case 'tipAngle':
      return extent(v) === 'blind';
    case 'cbDiameter':
    case 'cbDepth':
      return type(v) === 'counterbore';
    case 'csDiameter':
    case 'csAngle':
      return type(v) === 'countersink';
    default:
      return true;
  }
}

const HINTS: Record<string, string> = {
  x: 'Where the hole sits along the face’s X.',
  y: 'Where the hole sits along the face’s Y.',
  diameter: 'The hole’s diameter.',
  depth: 'From the face to the end of the full diameter. The drill point comes on top of it.',
  tipAngle: 'The drill point’s full angle. 0° makes a flat bottom.',
  cbDiameter: 'The wider step at the top.',
  cbDepth: 'How deep the step goes, from the face.',
  csDiameter: 'The cone’s diameter at the face.',
  csAngle: 'The cone’s full opening angle: 90° for metric screws, 82° for imperial.',
};

function numberField(name: string): DialogField {
  const number = HOLE_NUMBERS.find((n) => n.name === name);
  if (!number) throw new Error(`A hole has no number "${name}".`);
  const hint = HINTS[name];
  return {
    kind: 'expression',
    name,
    label: number.label,
    unit: number.unit,
    default: number.default,
    shown: (v) => relevant(name, v),
    ...(hint && { hint }),
  };
}

// ------------------------------------------------------------------ presets

/**
 * The preset the values match: every number it sets that applies to this
 * hole (in either form, with or without the tolerance), and the dropdowns
 * it sets. `custom` when none does.
 */
export function presetOf(values: DialogValues): string {
  for (const preset of HOLE_PRESETS) {
    // Only the sizes this hole has can match: a simple hole has no counterbore.
    const sizes: Record<string, string> = {};
    for (const name of Object.keys(preset.exprs)) {
      if (relevant(name, values) && values.exprs[name] !== undefined) {
        sizes[name] = values.exprs[name] as string;
      }
    }
    const same =
      presetMatches(preset, sizes) &&
      Object.entries(preset.choices ?? {}).every(([name, value]) => values.choices[name] === value);
    if (same) return preset.id;
  }
  return CUSTOM;
}

/**
 * What changing `field` does to the rest (`FeatureDialogSpec.onChange`):
 * choosing a preset fills its sizes and dropdowns; any other change leaves
 * the Preset dropdown showing the preset the values now match.
 *
 * In a document with a `tolerance` parameter a preset writes its diameters as
 * `3.4 mm + 2 * tolerance`, so the printed hole really is a clearance hole
 * (P4-08, ADR-0062).
 */
export function holeOnChange(
  field: string,
  values: DialogValues,
  ctx: Pick<DialogContext, 'doc'>,
): Partial<DialogValues> | undefined {
  if (field === 'preset') {
    const preset = holePreset(values.choices.preset ?? CUSTOM);
    if (!preset) return undefined;
    const exprs = presetSizes(preset, Boolean(toleranceParameter(ctx.doc)));
    return { exprs, choices: { ...preset.choices, preset: preset.id } };
  }
  const now = presetOf(values);
  return now === (values.choices.preset ?? CUSTOM) ? undefined : { choices: { preset: now } };
}

// ---------------------------------------------------------------- geometry

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A length as an expression to 0.01 mm, for clicked points: "12.35 mm". */
function mm(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${Object.is(rounded, -0) ? 0 : rounded} mm`;
}

/** The world place of a sketch point reference (`<sketch>/<point>`), or undefined. */
export function sketchPointWorld(
  ref: GeomRef,
  ctx: Pick<DialogContext, 'doc' | 'sketches' | 'construction'>,
): Vec3 | undefined {
  const parsed = parseSketchEntityRefId(ref.id);
  const feature = parsed && ctx.doc.features.find((f) => f.id === parsed.feature);
  const sketch = feature && readSketch(feature);
  const entity = parsed && sketch?.data.entities[parsed.entity];
  if (!feature || !sketch || entity?.type !== 'point') return undefined;
  const frame = sketchFrame(feature.id, sketch.plane, ctx.sketches, ctx.construction);
  return frame && sketchToWorld(frame, [entity.x, entity.y]);
}

/** The plane a sketch point's sketch sits on, as a reference. */
function sketchPlaneOf(ref: GeomRef, ctx: Pick<DialogContext, 'doc'>): GeomRef | undefined {
  const parsed = parseSketchEntityRefId(ref.id);
  const feature = parsed && ctx.doc.features.find((f) => f.id === parsed.feature);
  return feature && readSketch(feature)?.plane;
}

/** Where the first hole starts and which way it goes, for the arrows. */
function firstHole(values: DialogValues, ctx: ManipulatorContext) {
  const plane = values.refs.plane?.[0] ?? HOLE_DEFAULT_PLANE;
  const frame = placementFrame(plane, ctx);
  if (!frame) return undefined;
  const value = (name: string) =>
    ctx.value(name) ?? HOLE_NUMBERS.find((n) => n.name === name)?.value ?? 0;
  const first = values.refs.points?.[0];
  let start: Vec3;
  if (first) {
    const world = sketchPointWorld(first, ctx);
    if (!world) return undefined;
    start = sub(world, scale(frame.normal, dot(sub(world, frame.origin), frame.normal)));
  } else {
    start = add(add(frame.origin, scale(frame.x, value('x'))), scale(frame.y, value('y')));
  }
  const flip = values.toggles.flip ?? false;
  const direction = scale(frame.normal, flip ? 1 : -1);
  return { start, direction, frame, value };
}

/**
 * Arrows on the first hole: its diameter (from the axis to the wall) and,
 * for a blind hole, its depth along the drilling direction; a counterbore's
 * or countersink's diameter and a counterbore's depth. Dragging one writes
 * the field.
 */
export function holeManipulators(values: DialogValues, ctx: ManipulatorContext): Manipulator[] {
  const hole = firstHole(values, ctx);
  if (!hole) return [];
  const { start, direction, frame, value } = hole;
  const distance = (field: string, along: Vec3, from: Vec3 = start, reach = 1): Manipulator => ({
    kind: 'distance',
    field,
    origin: from,
    direction: along,
    ...(reach !== 1 && { scale: reach }),
  });
  const out: Manipulator[] = [distance('diameter', frame.x, start, 0.5)];
  if (extent(values) === 'blind') out.push(distance('depth', direction));
  if (type(values) === 'counterbore') {
    out.push(distance('cbDiameter', frame.y, start, 0.5));
    const edge = add(start, scale(frame.y, value('cbDiameter') / 2));
    out.push(distance('cbDepth', direction, edge));
  } else if (type(values) === 'countersink') {
    out.push(distance('csDiameter', frame.y, start, 0.5));
  }
  return out;
}

/**
 * A click on the plane or face: the hole goes there (X and Y in the plane's
 * sketch frame), and sketch points, if there were any, are let go.
 */
export function holePlaceAt(
  world: Vec3,
  values: DialogValues,
  ctx: ManipulatorContext,
): Partial<DialogValues> | undefined {
  const frame = placementFrame(values.refs.plane?.[0], ctx);
  if (!frame) return undefined;
  const [x, y] = worldToSketch(frame, world);
  return { refs: { points: [] }, exprs: { x: mm(x), y: mm(y) } };
}

/**
 * The XY plane when no plane is picked (the plane the first sketch point
 * lies in, when there are points), and, with no points, the centre of a
 * picked face as X and Y.
 */
export function proposeHole(
  values: DialogValues,
  ctx: Pick<ProposeContext, 'doc' | 'bodies' | 'construction' | 'sketches' | 'value'> &
    Partial<Pick<ProposeContext, 'chosen'>>,
): Partial<DialogValues> | undefined {
  const picked = values.refs.plane ?? [];
  const points = values.refs.points ?? [];
  const out: { refs?: DialogValues['refs']; exprs?: Record<string, string> } = {};
  const first = points[0];
  // Until the user picks a plane, the points' own sketch plane is the one (else XY).
  const own = first && !ctx.chosen?.('plane') ? sketchPlaneOf(first, ctx) : undefined;
  const plane = own ?? picked[0] ?? (first && sketchPlaneOf(first, ctx)) ?? HOLE_DEFAULT_PLANE;
  if (own || picked.length === 0) out.refs = { plane: [plane] };
  if (points.length === 0) {
    const centre = plane.kind === 'face' ? faceCentre(plane, ctx) : [0, 0];
    if (centre) out.exprs = { x: mm(centre[0] ?? 0), y: mm(centre[1] ?? 0) };
  }
  return out;
}

/** A face's area centroid in its sketch frame, from the meshes (the fingerprint's until then). */
function faceCentre(
  ref: GeomRef,
  ctx: Pick<DialogContext, 'bodies' | 'construction'>,
): readonly number[] | undefined {
  const frame = placementFrame(ref, ctx);
  const centroid = faceFrame(ctx.bodies, ref)?.origin ?? ref.fingerprint?.at;
  return frame && centroid && worldToSketch(frame, centroid);
}

/** Whether a picked face is one the view's meshes show as curved (the kernel says the rest). */
function isCurvedFace(ref: GeomRef, ctx: Pick<DialogContext, 'bodies'>): boolean {
  for (const mesh of Object.values(ctx.bodies)) {
    const face = mesh.faceIds?.indexOf(ref.id) ?? -1;
    if (face >= 0) return !isFlatFace(mesh, face);
  }
  return false;
}

// -------------------------------------------------------------------- dialog

export const holeDialog: FeatureDialogSpec = defineFeatureDialog({
  ...(holeFeature as FeatureDefinition),
  command: 'hole',
  fields: [
    {
      kind: 'selection',
      name: 'plane',
      label: 'Plane',
      accepts: HOLE_PLANE_KINDS,
      max: 1,
      prompt: 'Pick a plane or flat face',
      hint: 'The face or plane the holes start on. Click a face to put the hole where you click.',
    },
    {
      kind: 'selection',
      name: 'points',
      label: 'Points',
      accepts: HOLE_POINT_KINDS,
      min: 0,
      sketchPoints: true,
      noun: ['point', 'points'],
      prompt: 'Or pick sketch points',
      hint: 'Sketch points: one hole at each, dropped onto the plane. Show the sketch to pick its points.',
    },
    numberField('x'),
    numberField('y'),
    {
      kind: 'choice',
      name: 'preset',
      label: 'Preset',
      options: [
        { value: CUSTOM, label: 'Custom' },
        ...HOLE_PRESETS.map((p) => ({ value: p.id, label: p.label })),
      ],
      default: CUSTOM,
      hint: 'Fills the sizes: an M2 to M8 clearance hole (normal fit, with its counterbore and countersink), or a heat-set insert.',
    },
    {
      kind: 'choice',
      name: 'type',
      label: 'Type',
      options: HOLE_KINDS.map((value) => ({ value, label: KIND_LABELS[value] })),
      default: DEFAULT_TYPE,
    },
    {
      kind: 'choice',
      name: 'extent',
      label: 'Extent',
      options: HOLE_EXTENTS.map((value) => ({ value, label: EXTENT_LABELS[value] })),
      default: DEFAULT_EXTENT,
    },
    numberField('diameter'),
    numberField('depth'),
    numberField('tipAngle'),
    numberField('cbDiameter'),
    numberField('cbDepth'),
    numberField('csDiameter'),
    numberField('csAngle'),
    {
      kind: 'toggle',
      name: 'flip',
      label: 'Flip',
      default: false,
      hint: 'Drills the other way: into a face, the default; against it, flipped.',
    },
  ],
  // The Preset dropdown isn't an input: the stored inputs are the plain sizes.
  toInputs(values) {
    const { preset: _preset, ...inputs } = defaultInputs(holeDialog, values);
    return inputs;
  },
  fromInputs(inputs) {
    const stored = defaultFromInputs(holeDialog, inputs);
    // A hole stored without a plane starts on XY.
    const plane = stored.refs?.plane?.length ? stored.refs.plane : [HOLE_DEFAULT_PLANE];
    const values: DialogValues = {
      refs: { ...stored.refs, plane },
      exprs: stored.exprs ?? {},
      choices: stored.choices ?? {},
      toggles: stored.toggles ?? {},
    };
    // The stored inputs lack the dialog's defaults: read the preset from what is there.
    const filled = {
      ...values,
      exprs: {
        ...Object.fromEntries(HOLE_NUMBERS.map((n) => [n.name, n.default])),
        ...values.exprs,
      },
      choices: { type: DEFAULT_TYPE, extent: DEFAULT_EXTENT, ...values.choices },
    };
    return {
      ...stored,
      refs: values.refs,
      choices: { ...stored.choices, preset: presetOf(filled) },
    };
  },
  validate(values, ctx) {
    const plane = values.refs.plane?.[0];
    if (plane?.kind === 'face' && isCurvedFace(plane, ctx)) {
      return { field: 'plane', message: 'Pick a flat face or a plane.' };
    }
    for (const point of values.refs.points ?? []) {
      const parsed = parseSketchEntityRefId(point.id);
      const feature = parsed && ctx.doc.features.find((f) => f.id === parsed.feature);
      const entity = feature && readSketch(feature)?.data.entities[parsed.entity];
      // A sketch the document doesn't have is the kernel's to report.
      if (entity && entity.type !== 'point') {
        return { field: 'points', message: 'Pick sketch points, not curves.' };
      }
    }
    return undefined;
  },
  propose: (values, ctx) => proposeHole(values, ctx),
  onChange: holeOnChange,
  placeAt: holePlaceAt,
  manipulators: holeManipulators,
  previewStyle: () => 'cut',
});
