/**
 * What a feature dialog's live preview draws (UI spec §3.4, ADR-0027): the
 * draft's preview tools, styled by what they do (new and join translucent,
 * cut red), or, for a feature whose evaluator gives none, the bodies the
 * draft made or changed, in the spec's style. The model's own bodies stay
 * drawn and pickable underneath.
 */
import type { BodyId, FeatureId, FeatureStatus } from '@extrudo/core';
import type { BodyMesh, Preview, PreviewToolStyle } from '@extrudo/kernel';

export interface PreviewShape {
  mesh: BodyMesh;
  style: PreviewToolStyle;
}

export interface PreviewDrawing {
  shapes: readonly PreviewShape[];
  /** Whether the shapes are tools (true) or changed bodies (false). */
  tools: boolean;
}

/** The shapes to draw for a preview, compared with the model's bodies. */
export function previewDrawing(
  preview: Preview,
  model: Readonly<Record<BodyId, BodyMesh>>,
  style: PreviewToolStyle,
): PreviewDrawing {
  if (preview.tools.length > 0) {
    return { shapes: preview.tools.map(({ mesh, style }) => ({ mesh, style })), tools: true };
  }
  const shapes: PreviewShape[] = [];
  for (const [id, mesh] of Object.entries(preview.bodies) as [BodyId, BodyMesh][]) {
    // Bodies the draft passed on unchanged are the model's own meshes.
    if (model[id] !== mesh) shapes.push({ mesh, style });
  }
  return { shapes, tools: false };
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
}

/** "cut", "new join": the styles drawn, for the viewport's test attribute. */
export function previewSummary(preview: ViewPreview | undefined): string | undefined {
  if (!preview) return undefined;
  return preview.shapes.map((s) => s.style).join(' ');
}
