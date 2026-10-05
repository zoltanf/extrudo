/**
 * The Import dialog's OpenSCAD rows (P5-04 slice 2, ADR-0071 §5): the `.scad`
 * file's customizer variables under its groups' headings, each an
 * `<ExpressionInput>` whose empty state is the file's own value (the
 * placeholder). Typing a number, an expression or a parameter's name
 * overrides the variable; emptying the row takes the override out again. A
 * variable that isn't a number (a string, a boolean, a vector) is shown, read
 * only. An override stored for a variable the file's list lacks keeps its row,
 * with a warning.
 *
 * The list comes from the kernel once per file (`scadParameterStore`); the
 * rows' order is `labels.scad`, which this component brings in line with the
 * list when it arrives (the pairs are packed in that order: `scadOverrides.ts`).
 */
import { type AttachmentId, formatQuantity, isScadMediaType } from '@extrudo/core';
import type { ScadParameter } from '@extrudo/kernel';
import { CircleAlert } from 'lucide-react';
import { type KeyboardEvent, useEffect } from 'react';
import { useStore } from 'zustand';
import { ExpressionInput } from '../parameters/ExpressionInput';
import type { DialogController } from './dialog';
import { importedFile } from './import';
import {
  evaluateOverride,
  isEditable,
  rowOrder,
  SCAD_ORDER,
  type ScadParameterList,
  scadKey,
  scadParameterStore,
} from './scadRows';
import type { DialogExtraProps } from './spec';

/** Asks the kernel for a file's list, once per file and session. */
function requestList(controller: DialogController, file: AttachmentId): void {
  if (scadParameterStore.getState()[file]) return;
  scadParameterStore.setState({ [file]: { status: 'loading' } });
  void controller.scadParameters(file).then((result) => {
    const list: ScadParameterList = !result
      ? { status: 'error', error: 'The kernel is not running.' }
      : result.ok
        ? { status: 'ready', parameters: result.parameters }
        : { status: 'error', error: result.error };
    scadParameterStore.setState({ [file]: list });
  });
}

export function ScadOverrides({ open, controller }: DialogExtraProps) {
  const ctx = controller.context();
  const file = ctx ? importedFile(ctx) : undefined;
  const scad = file && isScadMediaType(file.attachment.mediaType) ? file : undefined;
  const list = useStore(scadParameterStore, (lists) => (scad ? lists[scad.id] : undefined));
  const stored = open.values.labels[SCAD_ORDER] ?? [];
  const parameters = list?.status === 'ready' ? list.parameters : undefined;

  // The file's list, once per file (again when the dialog's file changes).
  useEffect(() => {
    if (scad) requestList(controller, scad.id);
  }, [controller, scad]);

  // The rows' order follows the file's once its list is here.
  const order = rowOrder(parameters, stored);
  const key = order.join('\n');
  useEffect(() => {
    if (key !== stored.join('\n')) controller.setLabels(SCAD_ORDER, key ? key.split('\n') : []);
  }, [controller, key, stored]);

  if (!scad || !ctx) return null;
  const known = new Map((parameters ?? []).map((p) => [p.name, p]));
  // The file's variables in its order, then overrides it doesn't list.
  const rows: { name: string; parameter?: ScadParameter }[] = [
    ...(parameters ?? []).map((parameter) => ({ name: parameter.name, parameter })),
    ...stored.filter((name) => !known.has(name)).map((name) => ({ name })),
  ];
  // A heading where the file's group changes.
  const headings = rows.map(({ parameter }, i) => {
    const group = parameter?.group;
    return group && group !== rows[i - 1]?.parameter?.group ? group : undefined;
  });
  return (
    <fieldset
      className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0"
      data-scad-overrides={list?.status ?? 'loading'}
      aria-label="OpenSCAD variables"
    >
      <legend className="text-sm font-semibold">Variables</legend>
      {list?.status === 'loading' && (
        <p className="text-xs text-muted">Reading the file's variables…</p>
      )}
      {list?.status === 'error' && (
        <p className="text-xs text-error" data-scad-error>
          {list.error}
        </p>
      )}
      {list?.status === 'ready' && rows.length === 0 && (
        <p className="text-xs text-muted">
          {`${scad.attachment.fileName} has no customizer variables.`}
        </p>
      )}
      {rows.map(({ name, parameter }, i) => {
        const heading = headings[i];
        return (
          <div key={name} className="flex flex-col gap-1.5">
            {heading && (
              <h3 data-scad-group={heading} className="pt-1 text-xs font-semibold text-muted">
                {heading}
              </h3>
            )}
            <ScadRow
              name={name}
              parameter={parameter}
              missing={list?.status === 'ready' && !parameter}
              fileName={scad.attachment.fileName}
              open={open}
              controller={controller}
            />
          </div>
        );
      })}
    </fieldset>
  );
}

function ScadRow({
  name,
  parameter,
  missing,
  fileName,
  open,
  controller,
}: {
  name: string;
  parameter: ScadParameter | undefined;
  missing: boolean;
  fileName: string;
  open: DialogExtraProps['open'];
  controller: DialogController;
}) {
  const ctx = controller.context();
  if (!ctx) return null;
  const { doc } = ctx;
  const caption = parameter?.caption?.trim() || name;
  const field = scadKey(name);
  const settings = doc.settings;
  const readOnly = parameter !== undefined && !isEditable(parameter);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // As the dialog's own fields (`FieldExpression`): Enter after a valid
    // draft is OK, Esc on a changed draft reverts the row, not the dialog.
    if (event.key === 'Enter' && document.activeElement !== event.target) controller.ok();
    const target = event.target as HTMLElement;
    if (event.key === 'Escape' && target.dataset.keepEscape !== undefined) event.preventDefault();
  };
  const evaluate = (expr: string) => evaluateOverride(doc, expr).result;
  return (
    <div
      className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2"
      data-scad-row={name}
      data-scad-readonly={readOnly || undefined}
      data-scad-missing={missing || undefined}
    >
      <span className="truncate pt-1.5 text-sm text-muted" title={name}>
        {caption}
      </span>
      {readOnly ? (
        <p className="pt-1.5 text-sm">
          {`${JSON.stringify(parameter?.initial)} `}
          <span className="text-muted">(not editable yet)</span>
        </p>
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: forwards Enter and Esc from the field inside.
        <div className="flex min-w-0 flex-col gap-0.5" onKeyDown={onKeyDown}>
          <ExpressionInput
            label={name}
            value={open.values.exprs[field] ?? ''}
            placeholder={
              parameter && typeof parameter.initial === 'number' ? String(parameter.initial) : ''
            }
            evaluate={evaluate}
            format={(r) => formatQuantity(r.value, r.dim, settings)}
            onDraftChange={(expr, valid) => {
              // Empty is the file's own value: the override goes.
              if (expr.trim() === '' || valid) {
                controller.setExpr(field, expr.trim() === '' ? '' : expr);
                return;
              }
              const result = evaluate(expr);
              controller.setTyping(
                field,
                result.ok ? undefined : `${name}: ${result.error.message}`,
              );
            }}
            onCommit={(expr) => controller.setExpr(field, expr)}
          />
          {missing && (
            <p className="flex items-start gap-1 text-xs text-warning">
              <CircleAlert size={12} className="mt-0.5 shrink-0" />
              {`${fileName} doesn't list ${name}: the override may do nothing.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
