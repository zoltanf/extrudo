/**
 * The emboss dialog (P4-04, ADR-0060 §4, FR-FT-16): the profiles or texts to
 * put **onto** a face and how deep they stand out of it (Emboss) or go into it
 * (Deboss). Fields are named like the feature's inputs (`profiles`, `face`,
 * `depth`, `mode`), so the framework's default mapping turns them into inputs
 * and back.
 *
 * The sketch the profiles come from may lie in any plane parallel to the face,
 * on either side of it and any distance away: the kernel moves them onto the
 * face (`features/emboss.ts`), so there is nothing to place here. What the
 * dialog must get right is the picking: a click on a letter picks the whole
 * text (`wholeTexts`, P4-03) and the field counts it as one, and the face is
 * picked in the model, so its reference is the face's own name.
 *
 * The kernel decides how the profiles go on the face (P4-12, ADR-0060's
 * amendment): moved onto a flat one, wrapped round a cylinder or a cone,
 * projected along the sketch's normal onto anything else. The read-only
 * "Method" line says which, from the preview's `EmbossReport`.
 *
 * A depth arrow stands on the face among the letters, along the face's
 * outward normal (or against it for a deboss), as the kernel grows them: on a
 * round face that is the radius where the letters are. The preview is drawn as
 * the join it makes (a cut for a deboss), like the extrude's.
 */
import {
  EMBOSS_DEFAULT_DEPTH,
  EMBOSS_FACE_KINDS,
  EMBOSS_MODES,
  EMBOSS_PROFILE_KINDS,
  type EmbossMode,
  type ExtrudoDocument,
  embossFeature,
  embossMethodText,
  evaluateParameters,
  type GeomRef,
  parseSketchEntityRefId,
  readSketch,
  sketchToWorld,
  type Vec3,
} from '@extrudo/core';
import { profileCentroid } from '@extrudo/sketch/profiles';
import { sketchFrame } from '../sketch/frame';
import { sketchProfiles } from '../sketch/profiles';
import { type Frame, profileFrame, surfaceFrame, surfaceFrameNear } from './geometry';
import {
  type DialogValues,
  defineFeatureDialog,
  type FeatureDialogSpec,
  type Manipulator,
  type ManipulatorContext,
} from './spec';

const MODES = EMBOSS_MODES.map((value) => ({
  value,
  label: value === 'emboss' ? 'Emboss' : 'Deboss',
}));

const mode = (values: DialogValues): EmbossMode => (values.choices.mode ?? 'emboss') as EmbossMode;

export const embossDialog: FeatureDialogSpec = defineFeatureDialog({
  ...embossFeature,
  command: 'emboss',
  fields: [
    {
      kind: 'selection',
      name: 'profiles',
      label: 'Profiles',
      accepts: EMBOSS_PROFILE_KINDS,
      prompt: 'Pick profiles or a text',
      wholeTexts: true,
      hint: 'Sketch profiles or a whole text, beside the face: parallel to a flat face, along the axis of a cylinder or a cone. They are moved, wrapped or projected onto the face, so the sketch can lie anywhere beside it.',
    },
    {
      kind: 'selection',
      name: 'face',
      label: 'Face',
      accepts: EMBOSS_FACE_KINDS,
      max: 1,
      prompt: 'Pick a face',
      hint: 'The face the letters go on. Round a cylinder or a cone the sketch plane has to run along its axis, and the letters are wrapped round it so they keep their width; on a sphere or any other curved face they are projected along the sketch’s normal. Only the body that owns the face is changed.',
    },
    {
      kind: 'expression',
      name: 'depth',
      label: 'Depth',
      unit: 'length',
      default: `${EMBOSS_DEFAULT_DEPTH} mm`,
      hint: 'How far the letters stand out of the face, or go into it.',
    },
    {
      kind: 'choice',
      name: 'mode',
      label: 'Mode',
      options: MODES,
      default: 'emboss',
    },
    {
      kind: 'info',
      name: 'method',
      label: 'Method',
      shown: (_values, ctx) => ctx?.draftEmboss !== undefined,
      text: (_values, ctx) => (ctx.draftEmboss ? embossMethodText(ctx.draftEmboss.method) : ''),
    },
  ],
  // Both fields filled is the framework's own check (a pick count each); this is
  // the one thing it can't know: a depth of zero would leave the body untouched.
  validate(values, ctx) {
    const depth = evaluateParameters(ctx.doc).evaluate(values.exprs.depth ?? '', 'length');
    if (depth.ok && depth.value <= 0) {
      return { field: 'depth', message: 'The depth must be greater than 0.' };
    }
    return undefined;
  },
  manipulators: embossManipulators,
  // The letters are part of the face's own body: shown as a join, or a cut.
  previewStyle: (values) => (mode(values) === 'deboss' ? 'cut' : 'join'),
});

/**
 * A depth arrow standing on the face at the picked profiles' centre, along the
 * face's outward normal for an emboss and against it for a deboss: the way the
 * letters grow, as the kernel's `EmbossOutputData` has it. On a **round** face
 * the face's middle is on the axis, so the point of the wall nearest the
 * letters is taken instead and its radius is the direction: the arrow stands
 * among them, radially, out of a boss's wall and into a hole's. No face picked
 * yet, no arrow (there is no direction without it).
 */
export function embossManipulators(values: DialogValues, ctx: ManipulatorContext): Manipulator[] {
  const ref = values.refs.face?.[0];
  const centre = profilesCentre(values.refs.profiles ?? [], ctx);
  const frame =
    ref && (centre ? surfaceFrameNear(ctx.bodies, ref, centre) : surfaceFrame(ctx.bodies, ref));
  if (!frame) return [];
  const outward = frame.normal;
  return [
    {
      kind: 'distance',
      field: 'depth',
      origin: round(frame) ? frame.origin : ontoFace(centre ?? frame.origin, frame),
      direction: mode(values) === 'deboss' ? negate(outward) : outward,
    },
  ];
}

/** Whether the frame is a point of a curve's surface rather than a whole face's. */
const round = (face: Frame) => face.flatness === undefined;

/** `point` dropped onto the face's plane along its normal: where the letters start. */
function ontoFace(point: Vec3, face: Frame): Vec3 {
  const n = face.normal;
  const shift = dot(sub(face.origin, point), n);
  return add(point, scale(n, shift));
}

/**
 * The mean of the picked profiles' and texts' centres, world mm: where the
 * letters are, so the arrow stands among them. Undefined when none of them is
 * in the document (a reference the kernel lost).
 */
export function profilesCentre(
  refs: readonly GeomRef[],
  ctx: Pick<ManipulatorContext, 'doc' | 'sketches' | 'construction'>,
): Vec3 | undefined {
  return mean(
    refs.map((ref) => centreOf(ref, ctx)).filter((point): point is Vec3 => point !== undefined),
  );
}

/** A picked profile's or whole text's centre in world mm, from the document. */
function centreOf(
  ref: GeomRef,
  ctx: Pick<ManipulatorContext, 'doc' | 'sketches' | 'construction'>,
): Vec3 | undefined {
  if (ref.kind === 'profile') {
    return profileFrame(ctx.doc, ref, ctx.sketches, ctx.construction)?.origin;
  }
  return textCentre(ref, ctx.doc, ctx);
}

/**
 * A whole text's ink centre in world mm: the mean of the centres of its ink
 * regions (P4-03's `Profile.text`), which is what the whole-text reference
 * sweeps and what stays right while the string is edited. Its anchor while the
 * font isn't in yet and the text has no ink.
 */
function textCentre(
  ref: GeomRef,
  doc: ExtrudoDocument,
  ctx: Pick<ManipulatorContext, 'sketches' | 'construction'>,
): Vec3 | undefined {
  const parsed = parseSketchEntityRefId(ref.id);
  const feature = parsed && doc.features.find((f) => f.id === parsed.feature);
  const sketch = feature && readSketch(feature);
  const entity = parsed && sketch?.data.entities[parsed.entity];
  if (!sketch || !parsed || entity?.type !== 'text') return undefined;
  const frame = sketchFrame(feature.id, sketch.plane, ctx.sketches, ctx.construction);
  if (!frame) return undefined;
  const ink = sketchProfiles(sketch.data).filter((p) => p.text === parsed.entity);
  if (ink.length > 0) {
    return mean(ink.map((profile) => sketchToWorld(frame, profileCentroid(profile))));
  }
  const anchor = sketch.data.entities[entity.anchor];
  return anchor?.type === 'point' ? sketchToWorld(frame, [anchor.x, anchor.y]) : undefined;
}

function mean(points: readonly Vec3[]): Vec3 | undefined {
  if (points.length === 0) return undefined;
  return [
    points.reduce((sum, p) => sum + (p[0] ?? 0), 0) / points.length,
    points.reduce((sum, p) => sum + (p[1] ?? 0), 0) / points.length,
    points.reduce((sum, p) => sum + (p[2] ?? 0), 0) / points.length,
  ];
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
const negate = (v: Vec3): Vec3 => scale(v, -1);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
