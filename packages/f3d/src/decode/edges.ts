/**
 * Edge selections of fillets and chamfers.
 *
 * A fillet or chamfer names its edges through construction-operand groups
 * (one per edge set) in its reference table. Each member of a group is an
 * edge operand that names an edge recipe: the faces the edge lies between,
 * each as a token and the design record of the feature that made the face
 * (the same pair the B-rep's `generic_tag_attrib_def` carries on the face),
 * then `edge_recipe_data` and a small program saying how those faces bound
 * the edge. The first two faces are the edge's own (its support faces); later
 * ones bound its ends.
 */
import { F3dFormatError } from '../bytes';
import type { Segment } from '../segment';
import { readPrologue } from '../segment';

export const OPERAND_GROUP = '2CA5A1CD-C99B-4C9B-91AF-57989148E841';
export const EDGE_OPERAND = '5662F619-2281-4AD9-93DC-1FCFDA1062E7';
export const EDGE_RECIPE = '7ACC2A03-0261-4879-A14A-A93D661A5BDC';

/** One tag a face carries: a token and the design records it was made by. */
export interface FaceTag {
  token: string;
  /** Signed design references (a negative one is the same record, reversed). */
  designs: number[];
}

/** A face as a recipe names it: by every tag it carries. */
export interface FaceRef {
  tags: FaceTag[];
}

export interface EdgeRecipe {
  id: number;
  faces: FaceRef[];
}

/**
 * u32 1, u32 3, u32 n faces; each face u32 tag count and per tag: LP-ASCII
 * token, u32 0, u32 reference count, that many i32 design references, u32 0.
 * The program after `edge_recipe_data` is not read.
 */
export function readEdgeRecipe(seg: Segment, id: number): EdgeRecipe {
  const r = seg.reader(id);
  const p = readPrologue(r);
  if (p.leading) throw new F3dFormatError(`Edge recipe #${id}: leading block.`);
  r.u32();
  r.u32();
  const n = r.u32();
  if (n > 256) throw new F3dFormatError(`Edge recipe #${id}: ${n} faces.`);
  const faces: FaceRef[] = [];
  for (let i = 0; i < n; i++) {
    const count = r.u32();
    if (count > 64) throw new F3dFormatError(`Edge recipe #${id}: ${count} tags.`);
    const tags: FaceTag[] = [];
    for (let t = 0; t < count; t++) {
      const token = r.str8(256);
      r.u32();
      const refs = r.u32();
      if (refs > 64) throw new F3dFormatError(`Edge recipe #${id}: ${refs} design references.`);
      const designs: number[] = [];
      for (let k = 0; k < refs; k++) designs.push(r.i32());
      r.u32();
      tags.push({ token, designs });
    }
    faces.push({ tags });
  }
  return { id, faces };
}
