/**
 * The shell dialog (P3-03, ADR-0046, FR-FT-06): faces to remove, a wall
 * thickness and the side the walls grow on. Fields are named like the
 * feature's inputs (`faces`, `bodies`, `thickness`, `direction`), so the
 * framework's default mapping turns them into inputs and back.
 *
 * With no face picked the body is hollowed closed (a sealed void), so the
 * Bodies field shows while no face is picked: a body selected before the
 * tool opens fills it. A failure shows its message in the dialog ("A 12 mm
 * wall is too thick for this body (max ≈ 9.9 mm)").
 *
 * **Wall sets (P4-12, ADR-0046's amendment).** Under Direction, "Wall faces"
 * picks faces whose walls get a thickness of their own ("Wall thickness"
 * shows once it has faces: a thicker floor, a thinner lid); set n + 1
 * ("Wall faces 2" …) shows once set n has faces, up to `SHELL_MAX_WALLS`,
 * like fillet's edge sets. Picking a face takes the faces that run smoothly
 * into it too (`tangentChain`), because OCCT gives them the same thickness.
 */
import {
  SHELL_DIRECTIONS,
  SHELL_FACE_KINDS,
  SHELL_MAX_WALLS,
  shellFeature,
  shellWallFacesKey,
  shellWallThicknessKey,
} from '@extrudo/core';
import { type DialogField, type DialogValues, defineFeatureDialog } from './spec';

const count = (values: DialogValues, field: string) => values.refs[field]?.length ?? 0;

const hasWalls = (values: DialogValues, n: number) => count(values, shellWallFacesKey(n)) > 0;

/** The fields of wall set `n` (1-based). */
function wallFields(n: number): DialogField[] {
  const suffix = n === 1 ? '' : ` ${n}`;
  return [
    {
      kind: 'selection',
      name: shellWallFacesKey(n),
      label: `Wall faces${suffix}`,
      accepts: SHELL_FACE_KINDS,
      min: 0,
      prompt: 'Pick faces for another thickness',
      tangentChain: true,
      hint:
        n === 1
          ? 'Faces whose walls get their own thickness, such as a thicker floor. Faces that run smoothly into a picked one come with it.'
          : 'Another set of faces, with its own wall thickness.',
      // A set past the first shows once the one before it has faces.
      ...(n > 1 && { shown: (v: DialogValues) => hasWalls(v, n - 1) || hasWalls(v, n) }),
    },
    {
      kind: 'expression',
      name: shellWallThicknessKey(n),
      label: `Wall thickness${suffix}`,
      unit: 'length',
      default: '4 mm',
      hint: 'The wall thickness of these faces.',
      shown: (v: DialogValues) => hasWalls(v, n),
    },
  ];
}

const DIRECTION_LABELS: Record<(typeof SHELL_DIRECTIONS)[number], string> = {
  inside: 'Inside',
  outside: 'Outside',
};

export const shellDialog = defineFeatureDialog({
  ...shellFeature,
  command: 'shell',
  fields: [
    {
      kind: 'selection',
      name: 'faces',
      label: 'Faces to remove',
      accepts: SHELL_FACE_KINDS,
      min: 0,
      prompt: 'Pick faces',
      hint: 'The openings. Faces of several bodies are fine. Pick none to hollow a body out with a sealed void.',
    },
    {
      kind: 'selection',
      name: 'bodies',
      label: 'Body',
      accepts: ['body'],
      min: 0,
      prompt: 'Pick a body',
      hint: 'A body to hollow out with no opening. Bodies of the picked faces are shelled anyway.',
      shown: (v) => count(v, 'faces') === 0 || count(v, 'bodies') > 0,
    },
    {
      kind: 'expression',
      name: 'thickness',
      label: 'Thickness',
      unit: 'length',
      default: '2 mm',
      hint: 'The wall thickness.',
    },
    {
      kind: 'choice',
      name: 'direction',
      label: 'Direction',
      options: SHELL_DIRECTIONS.map((value) => ({ value, label: DIRECTION_LABELS[value] })),
      default: 'inside',
      hint: 'Inside keeps the outside of the body where it is; outside keeps its surface as the cavity, so the part grows.',
    },
    ...Array.from({ length: SHELL_MAX_WALLS }, (_, i) => wallFields(i + 1)).flat(),
  ],
  validate(values) {
    if (count(values, 'faces') === 0 && count(values, 'bodies') === 0) {
      return { field: 'faces', message: 'Pick a face to remove, or a body to hollow out.' };
    }
    // A face takes one thickness: removed faces have none, and a face in two sets two.
    const removed = new Set((values.refs.faces ?? []).map((ref) => ref.id));
    const seen = new Map<string, number>();
    for (let n = 1; n <= SHELL_MAX_WALLS; n++) {
      const field = shellWallFacesKey(n);
      for (const ref of values.refs[field] ?? []) {
        if (removed.has(ref.id)) {
          return { field, message: 'A removed face has no wall: take it out of this set.' };
        }
        const other = seen.get(ref.id);
        if (other !== undefined && other !== n) {
          return {
            field,
            message: `This face is in wall set ${other} too. A face takes one thickness.`,
          };
        }
        seen.set(ref.id, n);
      }
    }
    return undefined;
  },
  // The result replaces the body it hollows: drawn as the body itself.
  previewStyle: () => 'new',
});
