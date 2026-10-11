import {
  type ExtrudoDocument,
  evaluateParameters,
  formatQuantity,
  type Joint,
  type JointReport,
} from '@extrudo/core';
import { X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button, ToolIcon } from '../design-system';
import { DIALOG_COLUMN } from '../features/FeatureDialog';
import { ExpressionInput } from '../parameters/ExpressionInput';
import { clampPose } from './pose';

export interface JointPanelProps {
  doc: ExtrudoDocument;
  joint: Joint;
  report: JointReport | undefined;
  /** The joint's limits in degrees or mm, when it has both. */
  range: { min: number; max: number } | undefined;
  /** The posed value (degrees or mm); 0 as built. */
  value: number;
  /** Poses the joint; the caller has clamped the value already. */
  onPose(value: number): void;
  onClose(): void;
  /** The clearance check's section (P6-05 J3), under the pose. */
  clearance?: ReactNode;
}

const ICONS = { rigid: 'joint-rigid', revolute: 'joint-revolute', slider: 'joint-slider' } as const;

const round = (n: number) => Number(n.toFixed(2));

/**
 * The Joint panel (P6-05 J2, ADR-0081 §6): the pose of one joint as a slider and an expression
 * field of the same name ("Angle" or "Travel"), Reset and Done. The pose is view state; closing
 * the panel puts everything back. A joint whose frames disagree (a warning or an error) is not
 * posed: the panel says why instead. The clearance check's section (J3) sits below.
 *
 * Test hooks: region "Joint" (`data-joint-panel` the joint's ID, `data-joint-pose` the value),
 * `[data-pose-limited]` while a typed value was held to a limit.
 */
export function JointPanel({
  doc,
  joint,
  report,
  range,
  value,
  onPose,
  onClose,
  clearance,
}: JointPanelProps) {
  const revolute = joint.type === 'revolute';
  const label = revolute ? 'Angle' : 'Travel';
  const unit = revolute ? 'angle' : 'length';
  const suffix = revolute ? '°' : ' mm';
  const [limited, setLimited] = useState<string>();
  const refusal = refusalOf(joint, report, range);
  const min = range ? Math.min(range.min, range.max) : -180;
  const max = range ? Math.max(range.min, range.max) : 180;
  const evaluate = (text: string) => evaluateParameters(doc).evaluate(text, unit);
  const shown = `${round(value)}${revolute ? ' deg' : ' mm'}`;

  const write = (next: number, typed: boolean) => {
    const clamped = clampPose(joint, range, next);
    setLimited(
      typed && range && clamped !== next ? `Limited to ${round(clamped)}${suffix}` : undefined,
    );
    onPose(clamped);
  };

  return (
    <section
      aria-label="Joint"
      data-joint-panel={joint.id}
      data-joint-panel-value={value}
      className="pointer-events-auto absolute z-20 flex flex-col rounded-dialog border border-line shadow-raised backdrop-blur-[6px]"
      style={{
        right: 12,
        top: 148,
        width: DIALOG_COLUMN - 24,
        maxWidth: 'calc(100% - 24px)',
        background: 'color-mix(in srgb, var(--x-raised) 94%, transparent)',
      }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <ToolIcon name={ICONS[joint.type]} category="construct" size={18} />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{joint.name}</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="grid size-6 place-items-center rounded-control text-muted hover:bg-accent-soft hover:text-ink"
        >
          <X size={14} />
        </button>
      </header>
      <div className="flex flex-col gap-2.5 p-3">
        {refusal ? (
          <p role="status" data-pose-refused className="text-sm text-warning">
            {refusal}
          </p>
        ) : (
          <>
            <input
              type="range"
              aria-label={label}
              data-joint-slider
              min={min}
              max={max}
              step={revolute ? 1 : 0.1}
              value={Math.min(max, Math.max(min, value))}
              onChange={(event) => write(Number(event.target.value), false)}
              className="w-full accent-(--x-accent)"
            />
            <ExpressionInput
              label={label}
              value={shown}
              evaluate={evaluate}
              format={(r) => formatQuantity(r.value, r.dim, doc.settings)}
              onCommit={(text) => {
                const result = evaluate(text);
                if (result.ok) write(result.value, true);
              }}
            />
            {limited && (
              <p role="status" data-pose-limited className="text-sm text-warning">
                {limited}
              </p>
            )}
          </>
        )}
        {clearance && <div className="border-t border-line pt-2.5">{clearance}</div>}
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-3 py-2">
        <Button
          variant="ghost"
          onClick={() => {
            setLimited(undefined);
            onPose(0);
          }}
        >
          Reset
        </Button>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </footer>
    </section>
  );
}

/** Why the joint can't be posed, or `undefined` (the joint says so itself, ADR-0081 §4). */
export function refusalOf(
  joint: Joint,
  report: JointReport | undefined,
  range: { min: number; max: number } | undefined,
): string | undefined {
  if (joint.type === 'rigid') return `${joint.name} is a rigid joint: nothing moves.`;
  if (joint.suppressed) return `${joint.name} is suppressed.`;
  if (!report) return `${joint.name} hasn't been resolved yet.`;
  if (report.status !== 'ok') {
    return report.message ?? `${joint.name} can't be posed: its frames don't resolve.`;
  }
  if (joint.type === 'slider' && !range) return `Give ${joint.name} a travel to check it.`;
  return undefined;
}
