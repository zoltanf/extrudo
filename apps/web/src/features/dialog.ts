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
  type ReferenceIssue,
  type SelectionItem,
  type SessionStore,
  setFeatureVisibility,
  updateFeatureInputs,
  usedSketches,
  type Vec3,
} from '@extrudo/core';
import type { BodyMesh, Preview, SubShapeKind } from '@extrudo/kernel';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ToastOptions } from '../design-system';
import { readTopology, topologyItem } from '../selection/items';
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
  changedFields,
  checkValues,
  defaultValues,
  draftExpressions,
  inputsFor,
  mergeValues,
  pickFields,
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
  /**
   * The edges (mesh indices, the edge itself included) of the tangent
   * chain around an edge, for selection fields with `tangentChain` (fillet,
   * P3-01). Absent: picks stay single edges.
   */
  tangentChain?(body: BodyId, edge: number, base?: boolean): Promise<number[] | undefined>;
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
  /**
   * Fields the user set, which `spec.propose` doesn't change. Undefined for
   * an edited feature until its first refresh, which counts the stored
   * values that differ from the proposal.
   */
  chosen: readonly string[] | undefined;
  /** The draft built from the values (valid or not). */
  draft: Feature;
  /** Where the draft sits in the timeline. */
  index: number;
  expressions: ReadonlyMap<string, EvaluateResult>;
  checked: Checked;
  preview: DialogPreview;
  /**
   * Fixing references (P2-11): says what the feature lost and where to pick
   * it again, above the fields.
   */
  note?: string;
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
  notify?(tone: 'info' | 'error', text: string, options?: ToastOptions): void;
}

export interface DialogController {
  readonly state: StoreApi<DialogState>;
  /** Opens the dialog of a feature type for a new feature. Returns false if there is none. */
  start(type: string): boolean;
  /**
   * Opens an existing feature's dialog. Returns false if its type has none.
   * With `fix` (P2-11, "Fix References"), the references the kernel lost
   * are taken out of their fields and guesses replaced by what it took; the
   * first such field takes picks and the dialog says so.
   */
  edit(id: FeatureId, options?: { fix?: readonly ReferenceIssue[] }): boolean;
  setRefs(field: string, refs: readonly GeomRef[]): void;
  setExpr(field: string, expr: string): void;
  /** The text typed into an expression field doesn't evaluate (`undefined`: it does again). */
  setTyping(field: string, message: string | undefined): void;
  setChoice(field: string, value: string): void;
  setToggle(field: string, value: boolean): void;
  /** Makes a selection field the one picks go to. */
  pickInto(field: string): void;
  /**
   * A click on a plane or face where the view picks planes (P2-10): puts it
   * into the pick field. With a spec that places by click (`placeAt`) it
   * adds rather than toggles and also sets where the click was.
   */
  pickAt(item: SelectionItem, at?: Vec3): void;
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
  const dimmed = invalid || open.preview.status?.status === 'error';
  return {
    shapes: drawing.shapes,
    dimmed,
    ...(drawing.construction && {
      construction: {
        id: open.id,
        name: open.name,
        report: drawing.construction,
        preview: true,
        dimmed,
      },
    }),
  };
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
    const { sketches, construction } = model.getState();
    return { doc, bodies, sketches, construction, ...(feature && { feature }) };
  };

  /** The draft of the values: inputs with parameter names, and its expressions evaluated. */
  const build = (open: OpenDialog, values: DialogValues, ctx: DialogContext, index: number) => {
    const named = withParameterNames(
      inputsFor(open.spec, values, ctx),
      open.paramNames,
      ctx.doc,
      open.mode === 'edit' ? open.id : undefined,
    );
    const draft: Feature = {
      ...(ctx.feature ?? { suppressed: false }),
      id: open.id,
      type: open.spec.type,
      name: ctx.feature?.name ?? open.name,
      inputs: named.inputs,
    };
    return { named, draft, expressions: draftExpressions(ctx.doc, draft, index) };
  };

  /** Rebuilds the draft and its checks from the values, and asks for a preview if valid. */
  const refresh = (open: OpenDialog, values = open.values, typing = open.typing) => {
    const ctx = context(open);
    const { doc } = ctx;
    const index =
      open.mode === 'create' ? doc.timelineMarker : doc.features.findIndex((f) => f.id === open.id);
    let built = build(open, values, ctx, index);
    let chosen = open.chosen;
    if (open.spec.propose) {
      const known = new Set(chosen ?? []);
      const proposal = open.spec.propose(values, {
        ...ctx,
        value: (field) => okValue(built.expressions, field),
        chosen: (field) => known.has(field),
      });
      const changes = proposal ? changedFields(values, proposal) : [];
      if (chosen === undefined) {
        // An edited feature: stored values the rule wouldn't give were the user's choice.
        chosen = changes;
      } else {
        const apply = changes.filter((field) => !known.has(field));
        if (apply.length > 0 && proposal) {
          values = mergeValues(values, pickFields(proposal, apply));
          built = build(open, values, ctx, index);
        }
      }
    }
    const { named, draft, expressions } = built;
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
      chosen: chosen ?? [],
      paramNames: named.names,
      draft,
      index,
      expressions,
      checked,
    };
    // Not `canCommit`: a kernel refusal belongs to the draft it previewed, and a
    // changed draft must be previewed again or the dialog never recovers.
    const valid = checked.first === undefined && Object.keys(typing).length === 0;
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

  /** Applies a change the user made to `field` (which `spec.propose` then leaves alone). */
  const update = (
    field: string,
    change: (open: OpenDialog) => Partial<Pick<OpenDialog, 'values' | 'typing'>>,
  ) => {
    const open = get();
    if (!open) return;
    const changed = change(open);
    const { typing = open.typing } = changed;
    let values = changed.values ?? open.values;
    let next = choose(open, field);
    // The spec's follow-ups to a change (a preset's sizes) are the user's too.
    const more = changed.values ? open.spec.onChange?.(field, values) : undefined;
    if (more) {
      for (const name of changedFields(values, more)) next = choose(next, name);
      values = mergeValues(values, more);
    }
    refresh(next, values, typing);
  };

  const fieldOf = (open: OpenDialog, name: string | undefined): DialogField | undefined =>
    open.spec.fields.find((f) => f.name === name);

  const setRefs = (field: string, refs: readonly GeomRef[]) =>
    update(field, (open) => ({
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
    /** Edges picked or unpicked whose tangent chain follows (`tangentChain` fields). */
    const chained: { item: SelectionItem; mode: 'add' | 'remove' }[] = [];
    for (const item of items) {
      if (!accepts(field.accepts, item)) continue;
      const ref = itemRef(item, bodies);
      if (!ref) continue;
      const at = refs.findIndex((r) => r.kind === ref.kind && r.id === ref.id);
      if (at >= 0) {
        if (mode === 'toggle') {
          refs.splice(at, 1);
          chained.push({ item, mode: 'remove' });
        }
        continue;
      }
      chained.push({ item, mode: 'add' });
      if (max === 1) refs = [ref];
      else if (refs.length < max) refs.push(ref);
      else continue;
      picked.push(item);
    }
    const values = { ...open.values, refs: { ...open.values.refs, [field.name]: refs } };
    const full = max === 1 && refs.length === 1;
    const pickField = full ? (nextPickField(open, values, field.name) ?? field.name) : field.name;
    // A pick is the user's choice: `propose` leaves that field alone from now on.
    refresh(choose({ ...open, pickField }, field.name), values);
    for (const item of picked) fingerprint(item);
    if (field.tangentChain)
      for (const { item, mode } of chained) followChain(field.name, item, mode);
  };

  /**
   * A picked edge brings its tangent chain (OCCT rounds the whole chain,
   * so a set is made of whole chains); unpicking one takes the chain out.
   */
  const followChain = (field: string, item: SelectionItem, mode: 'add' | 'remove') => {
    const topology = readTopology(item);
    if (!kernel?.tangentChain || topology?.kind !== 'edge') return;
    const mine = generation;
    const base = get()?.base !== undefined;
    kernel
      .tangentChain(topology.body, topology.index, base)
      .then((indices) => {
        const open = get();
        if (!open || mine !== generation || !indices || indices.length < 2) return;
        const bodies = dialogBodies(open, model.getState().bodies);
        const refs = [...(open.values.refs[field] ?? [])];
        const added: SelectionItem[] = [];
        for (const index of indices) {
          const member = topologyItem({ kind: 'edge', body: topology.body, index });
          const ref = itemRef(member, bodies);
          if (!ref) continue;
          const at = refs.findIndex((r) => r.kind === ref.kind && r.id === ref.id);
          if (mode === 'add' && at < 0) {
            refs.push(ref);
            added.push(member);
          } else if (mode === 'remove' && at >= 0) {
            refs.splice(at, 1);
          }
        }
        refresh(open, { ...open.values, refs: { ...open.values.refs, [field]: refs } });
        for (const member of added) fingerprint(member);
      })
      .catch(() => {});
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
      // Pre-selection (UI spec §3.3): the selection fills the first field that takes it;
      // what that field doesn't take goes on to the next fields that take it (a profile and
      // an axis selected before Revolve, P2-07). Each item fills one field.
      const selection = session.getState().selection;
      const fields = shownFields(spec, values).filter(
        (f): f is SelectionField => f.kind === 'selection',
      );
      const used: SelectionItem[] = [];
      const chained: { field: string; item: SelectionItem }[] = [];
      for (const target of fields) {
        const refs: GeomRef[] = [];
        for (const item of selection) {
          if (refs.length >= (target.max ?? Number.POSITIVE_INFINITY)) break;
          if (used.includes(item) || !accepts(target.accepts, item)) continue;
          const ref = itemRef(item, bodies);
          if (ref && !refs.some((r) => r.kind === ref.kind && r.id === ref.id)) {
            refs.push(ref);
            used.push(item);
            if (target.tangentChain) chained.push({ field: target.name, item });
          }
        }
        if (refs.length > 0) values = { ...values, refs: { ...values.refs, [target.name]: refs } };
      }
      open({
        spec,
        mode: 'create',
        id: newId<FeatureId>(),
        name: nextFeatureName(doc, spec.label),
        values,
        paramNames: {},
        pickField: firstPickField(spec, values),
        chosen: [],
        ...blank,
      });
      for (const item of used) fingerprint(item);
      for (const { field, item } of chained) followChain(field, item, 'add');
      return true;
    },
    edit(id, options = {}) {
      const feature = store.getState().doc.features.find((f) => f.id === id);
      const spec = feature && dialogs.get(feature.type);
      if (!feature || !spec) return false;
      let values = valuesFor(spec, feature, context({ mode: 'edit', id }));
      const fixed = options.fix ? fixReferences(spec, values, options.fix) : undefined;
      if (fixed) values = fixed.values;
      open({
        spec,
        mode: 'edit',
        id,
        name: feature.name,
        values,
        paramNames: storedParameterNames(feature),
        pickField: fixed?.fields[0] ?? firstPickField(spec, values),
        chosen: undefined,
        ...blank,
        ...(fixed && { note: fixNote(feature.name, spec, fixed) }),
      });
      return true;
    },
    setRefs,
    setExpr: (field, expr) =>
      update(field, (open) => {
        const { [field]: _, ...typing } = open.typing;
        return {
          values: { ...open.values, exprs: { ...open.values.exprs, [field]: expr } },
          typing,
        };
      }),
    setTyping: (field, message) =>
      update(field, (open) => {
        const { [field]: _, ...rest } = open.typing;
        return { typing: message === undefined ? rest : { ...rest, [field]: message } };
      }),
    setChoice: (field, value) =>
      update(field, (open) => ({
        values: { ...open.values, choices: { ...open.values.choices, [field]: value } },
      })),
    setToggle: (field, value) =>
      update(field, (open) => ({
        values: { ...open.values, toggles: { ...open.values.toggles, [field]: value } },
      })),
    pickAt(item, at) {
      const current = get();
      const spec = current?.spec;
      if (!current || !spec?.placeAt) {
        select.onClick(item, false);
        return;
      }
      pick([item], 'add');
      const now = get();
      const world = at;
      if (!now || !world) return;
      const ctx: ManipulatorContext = {
        ...context(now),
        value: (f) => okValue(now.expressions, f),
      };
      const placed = spec.placeAt(world, now.values, ctx);
      if (!placed) return;
      let next = now;
      for (const name of changedFields(now.values, placed)) next = choose(next, name);
      refresh(next, mergeValues(now.values, placed));
    },
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
      let used: FeatureId[] = [];
      try {
        store.getState().dispatch(command);
        // A new feature hides the sketches whose profiles it used, in the same undo step.
        used =
          fresh.mode === 'create' ? usedSketches(fresh.draft, store.getState().doc.features) : [];
        if (used.length > 0) {
          store.getState().amend(setFeatureVisibility({ ids: used, visible: false }));
        }
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
        notify('error', error.message);
        return false;
      }
      close();
      session.getState().clearSelection();
      if (used.length > 0) {
        notify('info', hiddenMessage(store.getState().doc.features, used, fresh.draft.name), {
          action: {
            label: 'Show',
            run: () => showSketches(store, used),
            available: () => hiddenSketches(store, used).length > 0,
          },
          lifetime: HIDDEN_TOAST_MS,
        });
      }
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

/** A dialog's values with lost references taken out and guesses replaced (P2-11). */
export interface FixedReferences {
  values: DialogValues;
  /** Selection fields that changed, in field order: lost ones first. */
  fields: string[];
  lost: number;
  guessed: number;
}

/**
 * Takes the references the kernel lost out of their selection fields and
 * puts the kernel's closest match in place of a guess (ADR-0033). Pure.
 */
export function fixReferences(
  spec: FeatureDialogSpec,
  values: DialogValues,
  issues: readonly ReferenceIssue[],
): FixedReferences {
  const key = (ref: { kind: string; id: string }) => `${ref.kind} ${ref.id}`;
  const byRef = new Map(issues.map((i) => [key(i.ref), i]));
  const refs: Record<string, GeomRef[]> = {};
  const lostIn: string[] = [];
  const guessedIn: string[] = [];
  let lost = 0;
  let guessed = 0;
  for (const field of spec.fields) {
    if (field.kind !== 'selection' && field.kind !== 'features') continue;
    const list = values.refs[field.name] ?? [];
    const next: GeomRef[] = [];
    for (const ref of list) {
      const issue = byRef.get(key(ref));
      if (issue?.state === 'lost') {
        lost++;
        if (!lostIn.includes(field.name)) lostIn.push(field.name);
        continue;
      }
      if (issue?.state === 'guessed') {
        guessed++;
        if (!guessedIn.includes(field.name)) guessedIn.push(field.name);
      }
      const now = issue?.state === 'guessed' ? issue.now : undefined;
      next.push(now ?? ref);
    }
    refs[field.name] = next;
  }
  const fields = [...lostIn, ...guessedIn.filter((f) => !lostIn.includes(f))];
  return { values: { ...values, refs: { ...values.refs, ...refs } }, fields, lost, guessed };
}

/** "Extrude2 lost 1 reference: pick it again in Profiles." */
function fixNote(name: string, spec: FeatureDialogSpec, fixed: FixedReferences): string {
  const label = (field: string | undefined) =>
    spec.fields.find((f) => f.name === field)?.label ?? 'its fields';
  const parts: string[] = [];
  if (fixed.lost > 0) {
    const what = fixed.lost === 1 ? '1 reference' : `${fixed.lost} references`;
    parts.push(
      `${name} lost ${what}: pick ${fixed.lost === 1 ? 'it' : 'them'} again in ${label(fixed.fields[0])}.`,
    );
  }
  if (fixed.guessed > 0) {
    parts.push(
      'Where the model changed, the fields show the closest match the kernel took: keep it with OK, or pick again.',
    );
  }
  return parts.join(' ') || `${name}'s references are all found.`;
}

/** How long the "Sketch1 is hidden" toast stays, ms. */
export const HIDDEN_TOAST_MS = 12_000;

/** "Sketch1 is hidden: Extrude1 used its profile." (one name, or two and more). */
export function hiddenMessage(
  features: readonly Pick<Feature, 'id' | 'name'>[],
  ids: readonly FeatureId[],
  by: string,
): string {
  const names = ids.map((id) => features.find((f) => f.id === id)?.name ?? id);
  if (names.length === 1) return `${names[0]} is hidden: ${by} used its profile.`;
  const list = `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `${list} are hidden: ${by} used their profiles.`;
}

/** Those of `ids` that are still there and hidden (the "Show" button applies while there are any). */
function hiddenSketches(store: DocumentStore, ids: readonly FeatureId[]): FeatureId[] {
  return ids.filter(
    (id) => store.getState().doc.features.find((f) => f.id === id)?.visible === false,
  );
}

/** Shows sketches again (the toast's "Show"), those still there and hidden; one undo step. */
function showSketches(store: DocumentStore, ids: readonly FeatureId[]) {
  const hidden = hiddenSketches(store, ids);
  if (hidden.length > 0) {
    store.getState().dispatch(setFeatureVisibility({ ids: hidden, visible: true }));
  }
}

/** An expression's value if it evaluated. */
function okValue(expressions: ReadonlyMap<string, EvaluateResult>, field: string) {
  const result = expressions.get(field);
  return result?.ok ? result.value : undefined;
}

/** The dialog with `field` among the fields the user set. */
function choose(open: OpenDialog, field: string): OpenDialog {
  const chosen = open.chosen ?? [];
  return chosen.includes(field) ? open : { ...open, chosen: [...chosen, field] };
}

function noPreview(): DialogPreview {
  return { drawing: undefined, status: undefined, pending: false };
}
