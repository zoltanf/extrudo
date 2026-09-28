/**
 * The feature dialog controller (P2-05, ADR-0027): one per open project.
 * It holds the open dialog's state in a vanilla store, so it works without
 * React and in unit tests:
 *
 * - **start / edit**: a new feature at the timeline marker, filled from the
 *   current selection (pre-selection, UI spec §3.3), or an existing one.
 * - **values**: field changes rebuild the draft feature (model parameter
 *   names assigned once per dialog), check it, and ask the kernel for a
 *   preview. A preview that is still valid replaces the drawing; an invalid
 *   input or a failing draft keeps the last good one, dimmed.
 * - **picking**: `select` is the viewport's model-mode handler while the
 *   dialog is open: picks go into the pick field, as persistent references
 *   (their fingerprints follow from the kernel).
 * - **ok / cancel**: OK dispatches one command (insert, or replace the
 *   inputs), so it is one undo step; Cancel leaves the document alone.
 */
import {
  type BodyId,
  type Command,
  CommandError,
  type DocumentStore,
  type EvaluateResult,
  evaluateParameters,
  type Feature,
  type FeatureId,
  type FeatureStatus,
  type GeomRef,
  insertFeature,
  type ModelStore,
  newId,
  nextFeatureName,
  type SelectionItem,
  type SessionStore,
  updateFeatureInputs,
} from '@extrudo/core';
import type { BodyMesh, Preview, SubShapeKind } from '@extrudo/kernel';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { readTopology } from '../selection/items';
import { clearPickedHover, createModelSelect } from '../selection/useModelSelection';
import type { ModelSelect } from '../viewport/Viewport';
import type { ViewPreview } from './preview';
import { draftStatus, type PreviewDrawing, previewDrawing } from './preview';
import { accepts, itemRef } from './refs';
import type { FeatureDialogs } from './registry';
import type {
  DialogContext,
  DialogField,
  DialogValues,
  FeatureDialogSpec,
  ManipulatorContext,
  SelectionField,
} from './spec';
import {
  type Checked,
  checkValues,
  defaultValues,
  draftExpressions,
  inputsFor,
  shownFields,
  storedParameterNames,
  valuesFor,
  withDraft,
  withParameterNames,
} from './values';

/** What the dialog needs from the kernel: the `Recomputer` in the app. */
export interface DialogKernel {
  /** With `base`, the result also has the bodies before the draft (editing). */
  preview(
    draft: Feature,
    index: number,
    options?: { base?: boolean },
  ): Promise<Preview | undefined>;
  endPreview(): void;
  /** With `base`, of the last preview's base bodies. */
  reference(
    body: BodyId,
    kind: SubShapeKind,
    index: number,
    base?: boolean,
  ): Promise<GeomRef | undefined>;
}

export interface DialogPreview {
  /** The last preview whose draft computed; kept (dimmed) while inputs are invalid. */
  drawing: PreviewDrawing | undefined;
  /** The draft's status in the latest preview (an error's message shows in the dialog). */
  status: FeatureStatus | undefined;
  /** A preview of the current values is on its way. */
  pending: boolean;
}

export interface OpenDialog {
  spec: FeatureDialogSpec;
  mode: 'create' | 'edit';
  /** The new feature's ID (made when the dialog opened), or the edited one's. */
  id: FeatureId;
  name: string;
  values: DialogValues;
  /** Model parameter names of the draft's `expr` inputs, by input name. */
  paramNames: Readonly<Record<string, string>>;
  /** The selection field picks in the view go to. */
  pickField: string | undefined;
  /** The expression field whose manipulator has the heads-up box (else the first one's). */
  activeField: string | undefined;
  /** Fields whose typed text doesn't evaluate yet, with the message. */
  typing: Readonly<Record<string, string>>;
  /** The draft built from the values (valid or not). */
  draft: Feature;
  /** Where the draft sits in the timeline. */
  index: number;
  expressions: ReadonlyMap<string, EvaluateResult>;
  checked: Checked;
  preview: DialogPreview;
  /**
   * Editing: the bodies before the feature, from the last preview. The view
   * shows and picks these instead of the model's (rolled back to the
   * feature), and the draft's references are made from them.
   */
  base?: Readonly<Record<BodyId, BodyMesh>>;
}

/** The bodies an open dialog shows and picks: the base while editing, else the model's. */
export function dialogBodies(
  open: Pick<OpenDialog, 'base'> | undefined,
  model: Readonly<Record<BodyId, BodyMesh>>,
): Readonly<Record<BodyId, BodyMesh>> {
  return open?.base ?? model;
}

export interface DialogState {
  open: OpenDialog | undefined;
}

export interface DialogControllerOptions {
  store: DocumentStore;
  session: SessionStore;
  model: ModelStore<BodyMesh>;
  dialogs: FeatureDialogs;
  /** Absent until the kernel exists (tests without one get no previews). */
  kernel?: DialogKernel;
  notify?(tone: 'info' | 'error', text: string): void;
}

export interface DialogController {
  readonly state: StoreApi<DialogState>;
  /** Opens the dialog of a feature type for a new feature. Returns false if there is none. */
  start(type: string): boolean;
  /** Opens an existing feature's dialog. Returns false if its type has none. */
  edit(id: FeatureId): boolean;
  setRefs(field: string, refs: readonly GeomRef[]): void;
  setExpr(field: string, expr: string): void;
  /** The text typed into an expression field doesn't evaluate (`undefined`: it does again). */
  setTyping(field: string, message: string | undefined): void;
  setChoice(field: string, value: string): void;
  setToggle(field: string, value: boolean): void;
  /** Makes a selection field the one picks go to. */
  pickInto(field: string): void;
  /** Makes an expression field's manipulator the active one (the heads-up box). */
  activate(field: string | undefined): void;
  /** The viewport's model-mode picking while a dialog is open. */
  readonly select: ModelSelect;
  /** Evaluates text typed into an expression field, with the draft in the document. */
  evaluate(field: string, expr: string): EvaluateResult;
  /** What manipulators and custom fields see; undefined while no dialog is open. */
  context(): ManipulatorContext | undefined;
  /** Commits the draft as one undo step. Returns false (and says why) if it can't. */
  ok(): boolean;
  cancel(): void;
  dispose(): void;
}

/** The preview the viewport draws for an open dialog, if any. */
export function viewPreview(open: OpenDialog | undefined): ViewPreview | undefined {
  const drawing = open?.preview.drawing;
  if (!open || !drawing) return undefined;
  const invalid = open.checked.first !== undefined || Object.keys(open.typing).length > 0;
  return { shapes: drawing.shapes, dimmed: invalid || open.preview.status?.status === 'error' };
}

/**
 * Whether OK can run: no issue, nothing half-typed, and the kernel didn't
 * refuse the draft (a preview of the current values that failed; while a
 * newer one is on its way, OK may run).
 */
export function canCommit(open: OpenDialog): boolean {
  const refused = open.preview.status?.status === 'error' && !open.preview.pending;
  return open.checked.first === undefined && Object.keys(open.typing).length === 0 && !refused;
}

/** Why OK can't run, if it can't. */
export function commitProblem(open: OpenDialog): string | undefined {
  if (canCommit(open)) return undefined;
  return (
    open.checked.first?.message ?? Object.values(open.typing)[0] ?? open.preview.status?.message
  );
}

export function createDialogController(options: DialogControllerOptions): DialogController {
  const { store, session, model, dialogs, kernel } = options;
  const notify = options.notify ?? (() => {});
  const state = createStore<DialogState>()(() => ({ open: undefined }));
  const get = () => state.getState().open;
  const sessionSelect = createModelSelect(session);
  /** Bumped per dialog, so late kernel answers for an older one are dropped. */
  let generation = 0;
  let previewSequence = 0;
  /** The draft and document of the last preview asked for. */
  let previewed: { draft: string; doc: unknown } | undefined;

  const context = (open: Pick<OpenDialog, 'mode' | 'id' | 'base'>): DialogContext => {
    const doc = store.getState().doc;
    const feature = open.mode === 'edit' ? doc.features.find((f) => f.id === open.id) : undefined;
    const bodies = dialogBodies(open, model.getState().bodies);
    return { doc, bodies, ...(feature && { feature }) };
  };

  /** Rebuilds the draft and its checks from the values, and asks for a preview if valid. */
  const refresh = (open: OpenDialog, values = open.values, typing = open.typing) => {
    const ctx = context(open);
    const { doc } = ctx;
    const index =
      open.mode === 'create' ? doc.timelineMarker : doc.features.findIndex((f) => f.id === open.id);
    const named = withParameterNames(
      inputsFor(open.spec, values, ctx),
      open.paramNames,
      doc,
      open.mode === 'edit' ? open.id : undefined,
    );
    const draft: Feature = {
      ...(ctx.feature ?? { suppressed: false }),
      id: open.id,
      type: open.spec.type,
      name: ctx.feature?.name ?? open.name,
      inputs: named.inputs,
    };
    const expressions = draftExpressions(doc, draft, index);
    let checked = checkValues(open.spec, values, expressions, ctx);
    if (!checked.first) {
      const parsed = open.spec.inputsSchema.safeParse(draft.inputs);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const message = `The dialog made invalid inputs: ${issue?.path.join('.')} ${issue?.message ?? ''}`;
        checked = { fields: {}, first: { message: message.trim() } };
      }
    }
    const next: OpenDialog = {
      ...open,
      values,
      typing,
      paramNames: named.names,
      draft,
      index,
      expressions,
      checked,
    };
    const valid = canCommit(next);
    const key = JSON.stringify({ draft, index });
    const wanted = valid && kernel && (previewed?.draft !== key || previewed.doc !== doc);
    if (wanted) {
      previewed = { draft: key, doc };
      next.preview = { ...next.preview, pending: true };
      requestPreview(draft, index, open.mode === 'edit');
    }
    state.setState({ open: next });
  };

  const requestPreview = (draft: Feature, index: number, base: boolean) => {
    const sequence = ++previewSequence;
    const mine = generation;
    kernel
      ?.preview(draft, index, base ? { base } : {})
      .then((result) => {
        const open = get();
        if (!open || mine !== generation || sequence !== previewSequence || !result) return;
        const status = draftStatus(result, draft.id);
        const style = open.spec.previewStyle?.(open.values) ?? 'new';
        const bodies = result.base ?? dialogBodies(open, model.getState().bodies);
        const drawing =
          status?.status === 'error' ? open.preview.drawing : previewDrawing(result, bodies, style);
        state.setState({
          open: {
            ...open,
            preview: { drawing, status, pending: false },
            ...(result.base && { base: result.base }),
          },
        });
      })
      .catch(() => {});
  };

  const update = (change: (open: OpenDialog) => Partial<Pick<OpenDialog, 'values' | 'typing'>>) => {
    const open = get();
    if (!open) return;
    const { values = open.values, typing = open.typing } = change(open);
    refresh(open, values, typing);
  };

  const fieldOf = (open: OpenDialog, name: string | undefined): DialogField | undefined =>
    open.spec.fields.find((f) => f.name === name);

  const setRefs = (field: string, refs: readonly GeomRef[]) =>
    update((open) => ({
      values: { ...open.values, refs: { ...open.values.refs, [field]: [...refs] } },
    }));

  /** Asks the kernel for the fingerprint of a picked face, edge or vertex and stores it. */
  const fingerprint = (item: SelectionItem) => {
    const topology = readTopology(item);
    if (!kernel || !topology || topology.kind === 'body') return;
    const mine = generation;
    const base = get()?.base !== undefined;
    kernel
      .reference(topology.body, topology.kind, topology.index, base)
      .then((ref) => {
        const open = get();
        if (!ref || !open || mine !== generation) return;
        let changed = false;
        const refs: Record<string, GeomRef[]> = {};
        for (const [name, list] of Object.entries(open.values.refs)) {
          refs[name] = list.map((r) => {
            if (r.kind !== ref.kind || r.id !== ref.id || r.fingerprint) return r;
            changed = true;
            return ref;
          });
        }
        if (changed) refresh(open, { ...open.values, refs });
      })
      .catch(() => {});
  };

  /** The next selection field below its minimum after `field`, if any. */
  const nextPickField = (open: OpenDialog, values: DialogValues, after: string) => {
    const fields = shownFields(open.spec, values).filter(
      (f): f is SelectionField => f.kind === 'selection',
    );
    const at = fields.findIndex((f) => f.name === after);
    return fields.slice(at + 1).find((f) => (values.refs[f.name]?.length ?? 0) < (f.min ?? 1))
      ?.name;
  };

  const pick = (items: readonly SelectionItem[], mode: 'toggle' | 'add') => {
    const open = get();
    const field = fieldOf(open as OpenDialog, open?.pickField);
    if (!open || field?.kind !== 'selection') return;
    const bodies = dialogBodies(open, model.getState().bodies);
    const max = field.max ?? Number.POSITIVE_INFINITY;
    let refs = [...(open.values.refs[field.name] ?? [])];
    const picked: SelectionItem[] = [];
    for (const item of items) {
      if (!accepts(field.accepts, item)) continue;
      const ref = itemRef(item, bodies);
      if (!ref) continue;
      const at = refs.findIndex((r) => r.kind === ref.kind && r.id === ref.id);
      if (at >= 0) {
        if (mode === 'toggle') refs.splice(at, 1);
        continue;
      }
      if (max === 1) refs = [ref];
      else if (refs.length < max) refs.push(ref);
      else continue;
      picked.push(item);
    }
    const values = { ...open.values, refs: { ...open.values.refs, [field.name]: refs } };
    const full = max === 1 && refs.length === 1;
    const pickField = full ? (nextPickField(open, values, field.name) ?? field.name) : field.name;
    refresh({ ...open, pickField }, values);
    for (const item of picked) fingerprint(item);
  };

  const select: ModelSelect = {
    onHover: (item) => {
      const open = get();
      const field = fieldOf(open as OpenDialog, open?.pickField);
      // Only what the pick field takes lights up (the filter keeps the rest out anyway).
      const ok = item && field?.kind === 'selection' && accepts(field.accepts, item);
      sessionSelect.onHover(ok ? item : undefined);
    },
    onClick: (item) => {
      if (item) pick([item], 'toggle');
    },
    onBox: (items) => pick(items, 'add'),
  };

  const open = (next: Omit<OpenDialog, 'draft' | 'index' | 'expressions' | 'checked'>) => {
    if (get()) close();
    generation++;
    previewed = undefined;
    refresh({
      ...next,
      draft: undefined as unknown as Feature,
      index: 0,
      expressions: new Map(),
      checked: { fields: {}, first: undefined },
    });
  };

  const close = () => {
    generation++;
    previewSequence++;
    previewed = undefined;
    if (get()) kernel?.endPreview();
    state.setState({ open: undefined });
    clearPickedHover(session);
  };

  const firstPickField = (spec: FeatureDialogSpec, values: DialogValues) => {
    const fields = shownFields(spec, values).filter(
      (f): f is SelectionField => f.kind === 'selection',
    );
    return (fields.find((f) => (values.refs[f.name]?.length ?? 0) < (f.min ?? 1)) ?? fields[0])
      ?.name;
  };

  const blank = { typing: {}, activeField: undefined, preview: noPreview() };

  // Keep the draft in step with the document (a parameter changed, undo);
  // an edited feature that went away closes its dialog.
  const unsubscribe = store.subscribe((s, prev) => {
    const current = get();
    if (!current || s.doc === prev.doc) return;
    if (current.mode === 'edit' && !s.doc.features.some((f) => f.id === current.id)) close();
    else refresh(current);
  });

  return {
    state,
    start(type) {
      const spec = dialogs.get(type);
      if (!spec) return false;
      const doc = store.getState().doc;
      const { bodies } = model.getState();
      let values = defaultValues(spec);
      // Pre-selection (UI spec §3.3): the selection fills the first field that takes it.
      const selection = session.getState().selection;
      const fields = shownFields(spec, values).filter(
        (f): f is SelectionField => f.kind === 'selection',
      );
      const target = fields.find((f) => selection.some((item) => accepts(f.accepts, item)));
      const used: SelectionItem[] = [];
      if (target) {
        const refs: GeomRef[] = [];
        for (const item of selection) {
          if (refs.length >= (target.max ?? Number.POSITIVE_INFINITY)) break;
          const ref = accepts(target.accepts, item) ? itemRef(item, bodies) : undefined;
          if (ref && !refs.some((r) => r.kind === ref.kind && r.id === ref.id)) {
            refs.push(ref);
            used.push(item);
          }
        }
        values = { ...values, refs: { ...values.refs, [target.name]: refs } };
      }
      open({
        spec,
        mode: 'create',
        id: newId<FeatureId>(),
        name: nextFeatureName(doc, spec.label),
        values,
        paramNames: {},
        pickField: firstPickField(spec, values),
        ...blank,
      });
      for (const item of used) fingerprint(item);
      return true;
    },
    edit(id) {
      const feature = store.getState().doc.features.find((f) => f.id === id);
      const spec = feature && dialogs.get(feature.type);
      if (!feature || !spec) return false;
      const values = valuesFor(spec, feature, context({ mode: 'edit', id }));
      open({
        spec,
        mode: 'edit',
        id,
        name: feature.name,
        values,
        paramNames: storedParameterNames(feature),
        pickField: firstPickField(spec, values),
        ...blank,
      });
      return true;
    },
    setRefs,
    setExpr: (field, expr) =>
      update((open) => {
        const { [field]: _, ...typing } = open.typing;
        return {
          values: { ...open.values, exprs: { ...open.values.exprs, [field]: expr } },
          typing,
        };
      }),
    setTyping: (field, message) =>
      update((open) => {
        const { [field]: _, ...rest } = open.typing;
        return { typing: message === undefined ? rest : { ...rest, [field]: message } };
      }),
    setChoice: (field, value) =>
      update((open) => ({
        values: { ...open.values, choices: { ...open.values.choices, [field]: value } },
      })),
    setToggle: (field, value) =>
      update((open) => ({
        values: { ...open.values, toggles: { ...open.values.toggles, [field]: value } },
      })),
    pickInto(field) {
      const current = get();
      if (current && current.pickField !== field) {
        state.setState({ open: { ...current, pickField: field } });
      }
    },
    activate(field) {
      const current = get();
      if (current && current.activeField !== field) {
        state.setState({ open: { ...current, activeField: field } });
      }
    },
    select,
    evaluate(field, expr) {
      const current = get();
      const doc = store.getState().doc;
      const spec = current?.spec.fields.find((f) => f.name === field);
      const unit = spec?.kind === 'expression' ? spec.unit : 'length';
      if (!current) return evaluateParameters(doc).evaluate(expr, unit);
      const input = current.draft.inputs[field];
      if (input?.kind !== 'expr') return evaluateParameters(doc).evaluate(expr, unit);
      const draft = {
        ...current.draft,
        inputs: { ...current.draft.inputs, [field]: { ...input, expr } },
      };
      return (
        draftExpressions(doc, draft, current.index).get(field) ??
        evaluateParameters(withDraft(doc, draft, current.index)).evaluate(expr, unit)
      );
    },
    context() {
      const current = get();
      if (!current) return undefined;
      return {
        ...context(current),
        value(field) {
          const result = current.expressions.get(field);
          return result?.ok ? result.value : undefined;
        },
      };
    },
    ok() {
      const current = get();
      if (!current) return false;
      const why = commitProblem(current);
      if (why !== undefined || !canCommit(current)) {
        if (why) notify('info', why);
        return false;
      }
      // Rebuilt against the document as it is now (parameter names still free).
      refresh(current);
      const fresh = get() as OpenDialog;
      if (!canCommit(fresh)) return false;
      const command: Command<unknown> =
        fresh.mode === 'create'
          ? insertFeature({ feature: fresh.draft, index: fresh.index })
          : updateFeatureInputs({ id: fresh.id, inputs: fresh.draft.inputs, replace: true });
      try {
        store.getState().dispatch(command);
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
        notify('error', error.message);
        return false;
      }
      close();
      session.getState().clearSelection();
      return true;
    },
    cancel() {
      if (get()) close();
    },
    dispose() {
      unsubscribe();
      if (get()) close();
    },
  };
}

function noPreview(): DialogPreview {
  return { drawing: undefined, status: undefined, pending: false };
}
