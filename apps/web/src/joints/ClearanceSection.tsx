import { type ExtrudoDocument, formatQuantity, type JointId } from '@extrudo/core';
import { useState } from 'react';
import { Button } from '../design-system';
import { ExpressionInput } from '../parameters/ExpressionInput';
import type { JointCheckTool } from './useJointCheck';

export interface ClearanceSectionProps {
  tool: JointCheckTool;
  /** The Joint panel's joint: the check shown is its, else Check clearance starts one. */
  joint: JointId;
  /** The minimum gap a new check starts with (`defaultMinGap`). */
  defaultMin: string;
  settings: ExtrudoDocument['settings'];
  /**
   * Poses the joint at a value (J2's pose): each result line gets a Show button. Absent
   * where nothing can pose the joint, and then the lines have none.
   */
  onShow?: (value: number) => void;
}

/**
 * The Clearance section (P6-05 J3, ADR-0081 §4): the minimum gap, Check clearance (with its
 * progress and Cancel while it runs), and the result's lines, each with Show where the joint
 * can be posed. It sits in the Joint panel (J2) under the pose.
 *
 * Test hooks: the region "Clearance", the textbox "Minimum gap" (`exact`), the buttons
 * "Check clearance" and "Cancel check", `data-clearance-state` (`idle`, `pending`, `ready`,
 * `stale`, `error`) and the lines in `[data-joint-result]` (each `data-joint-result-line` =
 * `tightest`, `under`, `collision`, `free`).
 */
export function ClearanceSection({
  tool,
  joint,
  defaultMin,
  settings,
  onShow,
}: ClearanceSectionProps) {
  const { controller } = tool;
  // The check is one at a time: another joint's shows here only once this one is checked.
  const current = tool.state?.joint === joint ? tool.state : undefined;
  const [draft, setDraft] = useState(defaultMin);
  const min = current ? current.min : draft;
  const setMin = (expression: string) => {
    if (current) controller.setMin(expression);
    else setDraft(expression);
  };
  const status = current ? tool.status : 'idle';
  const progress = current ? tool.progress : undefined;
  const lines = current ? tool.lines : [];
  const error = current ? tool.error : undefined;
  const pending = status === 'pending';
  const start = () => {
    if (!current) controller.open(joint, draft);
    void controller.start();
  };
  return (
    <section
      aria-label="Clearance"
      data-clearance-state={status}
      className="flex flex-col gap-3"
      aria-live="polite"
    >
      <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2">
        <span className="pt-0.5 text-sm text-muted">Minimum gap</span>
        <ExpressionInput
          label="Minimum gap"
          value={min}
          evaluate={controller.evaluate}
          format={(r) => formatQuantity(r.value, r.dim, { ...settings, precision: 2 })}
          onCommit={setMin}
          onDraftChange={(expression, valid) => {
            if (valid) setMin(expression);
          }}
        />
      </div>
      {pending ? (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-sm text-muted tabular-nums">
            {progress ? `Checking ${progress.done} of ${progress.of}…` : 'Checking…'}
          </span>
          <Button variant="ghost" aria-label="Cancel check" onClick={controller.cancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={start}>
          Check clearance
        </Button>
      )}
      {status === 'stale' && <p className="text-sm text-muted">The design changed: check again.</p>}
      {error && <p className="text-sm text-error">{error}</p>}
      {lines.length > 0 && (
        <ul data-joint-result className="flex flex-col gap-1.5">
          {lines.map((line) => (
            <li
              key={line.text}
              data-joint-result-line={line.kind}
              className="flex items-start gap-2 text-sm"
            >
              <span
                className={`min-w-0 flex-1 tabular-nums ${line.kind === 'collision' ? 'text-error' : ''}`}
              >
                {line.text}
              </span>
              {onShow && line.show !== undefined && (
                <Button
                  variant="ghost"
                  aria-label={`Show: ${line.text}`}
                  onClick={() => onShow(line.show as number)}
                >
                  Show
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
