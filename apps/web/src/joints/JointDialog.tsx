import { type ExtrudoDocument, formatQuantity, type JointType } from '@extrudo/core';
import { CircleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import { Button, Select, ToolIcon, Tooltip } from '../design-system';
import { DIALOG_COLUMN } from '../features/FeatureDialog';
import { ExpressionInput } from '../parameters/ExpressionInput';
import { Message } from '../parameters/Message';
import {
  type JointDialog as JointDialogController,
  type JointSide,
  jointInfo,
  type OpenJoint,
  SIDE_LABELS,
} from './jointController';

export interface JointDialogProps {
  controller: JointDialogController;
  doc: ExtrudoDocument;
}

const TYPES: { value: JointType; label: string }[] = [
  { value: 'rigid', label: 'Rigid' },
  { value: 'revolute', label: 'Revolute' },
  { value: 'slider', label: 'Slider' },
];

const TYPE_ICONS: Record<JointType, 'joint-rigid' | 'joint-revolute' | 'joint-slider'> = {
  rigid: 'joint-rigid',
  revolute: 'joint-revolute',
  slider: 'joint-slider',
};

/**
 * The Joint dialog (P6-05, ADR-0081 §6): floating where the feature dialogs float, with the
 * same look, but its own controller (`jointDialog.ts`). Type, the two frames ("Moving part",
 * "Fixed part"), the limits for a revolute or slider, Flip, and a read-only line of what the
 * joint does (`[data-info="joint"]`) from the kernel. Non-modal: the view stays live for picks.
 *
 * Test hooks: `data-joint-dialog` (`create`/`edit`), `data-dialog-valid`.
 */
export function JointDialog({ controller, doc }: JointDialogProps) {
  const open = useStore(controller.state, (s) => s.open);
  if (!open) return null;
  return <JointDialogPanel open={open} controller={controller} doc={doc} />;
}

export function JointDialogPanel({
  open,
  controller,
  doc,
}: JointDialogProps & { open: OpenJoint }) {
  const problem = controller.problem();
  const valid = problem === undefined;
  const unit = open.type === 'slider' ? 'travel' : 'angle';
  const report = open.report;
  const info = jointInfo(open, doc);
  const tone =
    report?.status === 'error'
      ? 'text-error'
      : report?.status === 'warning' || report?.status === 'inactive'
        ? 'text-warning'
        : '';
  return (
    <section
      aria-label={open.mode === 'edit' ? `Edit ${open.name} dialog` : 'Joint dialog'}
      data-joint-dialog={open.mode}
      data-dialog-valid={valid || undefined}
      className="pointer-events-auto absolute z-20 flex w-64 flex-col rounded-dialog border border-line shadow-raised backdrop-blur-[6px]"
      style={{
        right: 12,
        top: 148,
        width: DIALOG_COLUMN - 24,
        maxWidth: 'calc(100% - 24px)',
        maxHeight: 'calc(100% - 156px)',
        background: 'color-mix(in srgb, var(--x-raised) 94%, transparent)',
      }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <ToolIcon name={TYPE_ICONS[open.type]} category="construct" size={18} />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
          {open.mode === 'edit' ? `Edit ${open.name}` : 'Joint'}
        </h2>
        <button
          type="button"
          aria-label="Cancel"
          onClick={() => controller.cancel()}
          className="grid size-6 place-items-center rounded-control text-muted hover:bg-accent-soft hover:text-ink"
        >
          <X size={14} />
        </button>
      </header>
      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto p-3">
        {open.note && (
          <p role="note" aria-label="Fix references" className="text-sm text-warning">
            {open.note}
          </p>
        )}
        <Row label="Type">
          <Select
            aria-label="Type"
            value={open.type}
            onChange={(event) => controller.setType(event.target.value as JointType)}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Row>
        {(['a', 'b'] as const).map((side) => (
          <FrameRow key={side} side={side} open={open} controller={controller} />
        ))}
        {open.type !== 'rigid' &&
          (['min', 'max'] as const).map((limit) => {
            const label = `${limit === 'min' ? 'Minimum' : 'Maximum'} ${unit}`;
            return (
              <Row key={`${open.type}-${limit}`} label={limit === 'min' ? 'Minimum' : 'Maximum'}>
                <ExpressionInput
                  label={label}
                  value={open[limit]}
                  evaluate={(text) =>
                    text.trim()
                      ? controller.evaluate(text)
                      : controller.evaluate(open.type === 'slider' ? '0 mm' : '0 deg')
                  }
                  format={(r) => formatQuantity(r.value, r.dim, doc.settings)}
                  onDraftChange={(text, ok) => {
                    if (ok || !text.trim()) controller.setLimit(limit, text);
                    else {
                      const result = controller.evaluate(text);
                      controller.setTyping(
                        limit,
                        result.ok ? undefined : `${label}: ${result.error.message}`,
                      );
                    }
                  }}
                  onCommit={(text) => controller.setLimit(limit, text)}
                />
              </Row>
            );
          })}
        <Row label="Flip">
          <input
            type="checkbox"
            aria-label="Flip"
            className="mt-1.5 size-4 accent-(--x-accent)"
            checked={open.flip}
            onChange={(event) => controller.setFlip(event.target.checked)}
          />
        </Row>
        <p data-info="joint" className={`text-sm ${tone}`}>
          {info}
        </p>
      </div>
      {problem && (open.frames.a !== undefined || open.typing.min || open.typing.max) && (
        <p
          role="status"
          aria-label="Joint status"
          className="mx-3 mb-2 flex shrink-0 items-start gap-1.5 text-sm text-error"
        >
          <CircleAlert size={14} className="mt-0.5 shrink-0" />
          <span>
            <Message text={problem} />
          </span>
        </p>
      )}
      <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-3 py-2">
        <Button variant="ghost" onClick={() => controller.cancel()}>
          Cancel <kbd className="font-mono text-xs text-muted">Esc</kbd>
        </Button>
        <Tooltip label={problem ?? 'OK'}>
          <Button
            variant="primary"
            aria-disabled={!valid || undefined}
            className={valid ? '' : 'opacity-45'}
            onClick={() => controller.ok()}
          >
            OK <kbd className="font-mono text-xs opacity-85">Enter</kbd>
          </Button>
        </Tooltip>
      </footer>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2">
      <span className="pt-1.5 text-sm text-muted">{label}</span>
      <div className="flex min-w-0 flex-col gap-0.5">{children}</div>
    </div>
  );
}

/** A frame field: a button that makes it the pick field, the pick's name, a clear button. */
function FrameRow({
  side,
  open,
  controller,
}: {
  side: JointSide;
  open: OpenJoint;
  controller: JointDialogController;
}) {
  const label = SIDE_LABELS[side];
  const frame = open.frames[side];
  const active = open.pickField === side;
  const hint = open.hints[side];
  return (
    <Row label={side === 'a' ? 'Moving' : 'Fixed'}>
      <div
        data-joint-frame={side}
        data-fix={open.fix?.includes(side) || undefined}
        className={`flex h-8 items-center rounded-input border ${active ? 'border-accent bg-accent-soft' : open.fix?.includes(side) ? 'border-warning' : 'border-line'}`}
      >
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={() => controller.pickInto(side)}
          className={`min-w-0 flex-1 truncate px-2 text-left text-sm ${frame ? 'text-ink' : 'text-muted'}`}
        >
          {controller.frameText(side)}
        </button>
        {frame && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            onClick={() => controller.clear(side)}
            className="mr-1 grid size-6 place-items-center rounded-control text-muted hover:bg-accent-soft hover:text-ink"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {hint && (
        <p className="text-xs text-error" data-joint-hint={side}>
          {hint}
        </p>
      )}
    </Row>
  );
}
