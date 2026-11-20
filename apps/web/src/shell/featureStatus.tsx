import { type Feature, type FeatureStatus, meshToSolidSummary } from '@extrudo/core';
import { TriangleAlert, X } from 'lucide-react';

export function scriptChipHint(status?: FeatureStatus): string | undefined {
  return status?.script ? `made ${status.script.generated.length} features` : undefined;
}

/** A Mesh to Solid chip's line (ADR-0097 §4): what the conversion made, "6 planes · 0 unfit". */
export function meshToSolidChipHint(status?: FeatureStatus): string | undefined {
  return status?.meshToSolid && meshToSolidSummary(status.meshToSolid);
}

/** A feature's problem as the timeline and the browser show it: a warning or an error. */
export interface FeatureProblem {
  status: 'warning' | 'error';
  message?: string;
}

/**
 * The kernel's verdict on a feature, if it has one worth showing (ADR-0024, ADR-0033): only
 * active features (before the marker, not suppressed) have a status, and `ok` shows nothing.
 * The timeline's chips and the browser's rows (P3-17) both read it.
 */
export function featureProblem(
  feature: Pick<Feature, 'id' | 'suppressed'>,
  index: number,
  marker: number,
  statuses: Readonly<Record<string, FeatureStatus | undefined>>,
): FeatureProblem | undefined {
  if (index >= marker || feature.suppressed) return undefined;
  const status = statuses[feature.id];
  if (!status || status.status === 'ok') return undefined;
  // One problem per status object: a chip's props stay the same while its status does
  // (ADR-0156's amendment of 2026-11-19), so a kernel step doesn't render it.
  let problem = problems.get(status);
  if (!problem) {
    problem = { status: status.status, message: status.message };
    problems.set(status, problem);
  }
  return problem;
}

const problems = new WeakMap<FeatureStatus, FeatureProblem>();

/**
 * ✕ or ⚠ in the status colour (UI spec §1: the colour always comes with a glyph). On a chip's
 * corner (`corner`) or inline in a row.
 */
export function StatusGlyph({
  status,
  corner = false,
}: {
  status: FeatureProblem['status'];
  corner?: boolean;
}) {
  const Icon = status === 'error' ? X : TriangleAlert;
  return (
    <span
      aria-hidden="true"
      className={`grid size-3.5 shrink-0 place-items-center rounded-full text-bg ${corner ? 'absolute -top-1 -right-1' : ''}`}
      style={{ background: `var(--x-${status})` }}
    >
      <Icon size={10} strokeWidth={3} />
    </span>
  );
}
