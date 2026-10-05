/**
 * What a feature dialog's live preview draws (UI spec §3.4, ADR-0027): the
 * draft's preview tools, styled by what they do (new and join translucent,
 * cut red), or, for a feature whose evaluator gives none, the bodies the
 * draft made or changed, in the spec's style. The model's own bodies stay
 * drawn and pickable underneath.
 *
 * A `skip` tool (P4-12: what a pattern's skipped instance would have been) is
 * **beside** the rest, never instead of it: a pattern of bodies has no other
 * tools to show, and its ghosts say where the instances it left out are.
 */
import type {
  BodyId,
  CanvasReport,
  ConstructionReport,
  FeatureId,
  FeatureStatus,
} from '@extrudo/core';
import type { BodyMesh, Preview, PreviewToolStyle } from '@extrudo/kernel';
import type { CanvasDrawing } from '../viewport/canvasGeometry';
import type { ConstructionDrawing } from '../viewport/constructionGeometry';

export interface PreviewShape {
  mesh: BodyMesh;
  style: PreviewToolStyle;
}

export interface PreviewDrawing {
  shapes: readonly PreviewShape[];
  /** Whether the shapes are tools (true) or changed bodies (false). */
  tools: boolean;
  /** A construction feature's plane, axis or point (P3-05): drawn in place of shapes. */
  construction?: ConstructionReport;
  /** A canvas's frame (P4-06, ADR-0066 §5): drawn as the draft's own image. */
  canvas?: CanvasReport;
}

/** The shapes to draw for a preview, compared with the model's bodies. */
export function previewDrawing(
  preview: Preview,
  model: Readonly<Record<BodyId, BodyMesh>>,
  style: PreviewToolStyle,
): PreviewDrawing {
  if (preview.construction) return { shapes: [], tools: false, construction: preview.construction };
  if (preview.canvas) return { shapes: [], tools: false, canvas: preview.canvas };
  const ghosts = preview.tools.filter((tool) => tool.style === 'skip');
  const tools = preview.tools.filter((tool) => tool.style !== 'skip');
  const asShapes = (list: typeof preview.tools): PreviewShape[] =>
    list.map(({ mesh, style }) => ({ mesh, style }));
  if (tools.length > 0) {
    return { shapes: [...asShapes(tools), ...asShapes(ghosts)], tools: true };
  }
  const shapes: PreviewShape[] = [];
  for (const [id, mesh] of Object.entries(preview.bodies) as [BodyId, BodyMesh][]) {
    // Bodies the draft passed on unchanged are the model's own meshes.
    if (model[id] !== mesh) shapes.push({ mesh, style });
  }
  return { shapes: [...shapes, ...asShapes(ghosts)], tools: false };
}

/** The draft's own status in a preview. */
export function draftStatus(preview: Preview, draft: FeatureId): FeatureStatus | undefined {
  return preview.features[draft];
}

/** The preview as the viewport draws it: shapes, and whether they are out of date. */
export interface ViewPreview {
  shapes: readonly PreviewShape[];
  /** The last valid result, kept while the input is invalid or the draft fails. */
  dimmed: boolean;
  /** The draft's plane, axis or point when it is a construction feature (P3-05). */
  construction?: ConstructionDrawing;
  /** The draft's image when it is a canvas (P4-06, ADR-0066 §5). */
  canvas?: CanvasDrawing;
}

/** "cut", "new join": the styles drawn, for the viewport's test attribute. */
export function previewSummary(preview: ViewPreview | undefined): string | undefined {
  if (!preview) return undefined;
  return preview.shapes.map((s) => s.style).join(' ');
}
