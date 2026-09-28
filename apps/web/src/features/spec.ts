/**
 * Feature dialog specs (P2-05, ADR-0027, architecture §4.2): what the web
 * app adds to a feature type's definition so it gets a command dialog. A
 * spec is data plus a few pure functions: its fields and their defaults,
 * how field values become the feature's `inputs` and back, extra checks,
 * and the in-canvas manipulators. The framework (`dialog.ts` and the
 * components next to it) does the rest: pre-selection, picking into
 * selection fields, parameter names, validation, the live preview, OK and
 * Cancel.
 *
 * A spec extends core's `FeatureDefinition` (type, label, category, icon,
 * inputs schema) and is registered in `featureDialogs()` (`registry.ts`).
 * Registering it also makes its command run: a tool of the toolbar
 * (`command: 'extrude'`, whose label, icon, keys and toolbar place come from
 * `shell/tools.ts` and `commands/keymap.ts`), or a command of its own.
 */
import type {
  BodyId,
  ExtrudoDocument,
  Feature,
  FeatureDefinition,
  FeatureId,
  FeatureInputs,
  GeomRef,
  GeomRefKind,
  SketchReport,
  UnitKind,
  Vec3,
} from '@extrudo/core';
import type { BodyMesh, PreviewToolStyle } from '@extrudo/kernel';
import type { IconName, ToolCategory } from '../design-system';
import type { ToolId } from '../shell/tools';

/** The values of a dialog's fields, by field name, one record per field kind. */
export interface DialogValues {
  /** Selection fields: persistent references, never mesh indices. */
  refs: Readonly<Record<string, readonly GeomRef[]>>;
  /** Expression fields: the expression as typed. */
  exprs: Readonly<Record<string, string>>;
  /** Choice fields (dropdowns): the option's value. */
  choices: Readonly<Record<string, string>>;
  toggles: Readonly<Record<string, boolean>>;
}

interface FieldBase {
  /** Also the name of the input it fills, unless the spec maps inputs itself. */
  name: string;
  label: string;
  /** A sentence under the field or in its tooltip. */
  hint?: string;
  /** Whether the field shows for these values (default: always). Hidden fields make no input. */
  shown?(values: DialogValues): boolean;
}

/**
 * Picks geometry in the view. While it is the dialog's pick field, clicks
 * in the model go to it and the selection filter allows only `accepts`.
 */
export interface SelectionField extends FieldBase {
  kind: 'selection';
  accepts: readonly GeomRefKind[];
  /** Default 1: an empty field is an issue ("Pick a face."). 0 makes it optional. */
  min?: number;
  /** Default unlimited. With 1 a click replaces the pick; otherwise a click adds or removes. */
  max?: number;
  /** "Pick a face" when empty; default from `accepts`. */
  prompt?: string;
}

/** An `<ExpressionInput>`: an expression with a unit, which becomes a model parameter (`d7`). */
export interface ExpressionField extends FieldBase {
  kind: 'expression';
  unit: UnitKind;
  default: string;
}

/** A dropdown (an `enum` input). */
export interface ChoiceField extends FieldBase {
  kind: 'choice';
  options: readonly { value: string; label: string }[];
  default: string;
}

/** A checkbox (a `bool` input). */
export interface ToggleField extends FieldBase {
  kind: 'toggle';
  default: boolean;
}

export type DialogField = SelectionField | ExpressionField | ChoiceField | ToggleField;

/** What the spec's functions may look at besides the values. */
export interface DialogContext {
  /** The document as it is (the draft isn't in it). */
  doc: ExtrudoDocument;
  /** The model's body meshes (what the view shows and picks). */
  bodies: Readonly<Record<BodyId, BodyMesh>>;
  /** The feature being edited; absent for a new one. */
  feature?: Feature;
  /** What the kernel reports about each sketch: frames of sketches on faces (P2-09). */
  sketches?: Readonly<Record<FeatureId, SketchReport>>;
}

export interface ManipulatorContext extends DialogContext {
  /**
   * An expression field's value in mm, degrees or plain units; undefined
   * while its expression is invalid.
   */
  value(field: string): number | undefined;
}

/** What `propose` sees: the manipulators' context and which fields the user set. */
export interface ProposeContext extends ManipulatorContext {
  /**
   * Whether the user set the field (in this dialog, or before: an edited
   * feature's stored value that differs from the proposal). The framework
   * never changes such a field, whatever `propose` returns.
   */
  chosen(field: string): boolean;
}

/** A problem that keeps OK disabled, shown in the dialog (UI spec §8 style). */
export interface DialogIssue {
  message: string;
  /** The field it belongs to, which then shows it; else the dialog does. */
  field?: string;
}

/**
 * A distance arrow (UI spec §3.4): from `origin` along `direction` (world,
 * unit length) to the field's value; dragging the arrow's head sets the
 * field to the distance from `origin` along the direction (negative
 * behind it).
 */
export interface DistanceManipulator {
  kind: 'distance';
  /** An expression field of unit `length`. */
  field: string;
  origin: Vec3;
  direction: Vec3;
  /**
   * World length per unit of the field's value, default 1: the head sits at
   * `value × scale` along the direction, and a drag writes the distance
   * divided by it. A symmetric extrude's arrow (whose field is the whole
   * length) has 0.5.
   */
  scale?: number;
}

/**
 * An angle arc: from `zero` (world, unit length, perpendicular to `axis`)
 * turned by the field's value about `axis` (right-handed) through
 * `origin`; dragging the arc's handle sets the angle.
 */
export interface AngleManipulator {
  kind: 'angle';
  /** An expression field of unit `angle`. */
  field: string;
  origin: Vec3;
  axis: Vec3;
  zero: Vec3;
  /**
   * Degrees turned per unit of the field's value, default 1: the handle
   * sits at `value × scale` and a drag writes the angle divided by it. A
   * symmetric revolve's arc (whose field is the whole angle) has 0.5.
   */
  scale?: number;
  /**
   * The value may run a whole turn either way (−360…360°, a revolve's
   * angle): a drag follows the handle round continuously instead of
   * wrapping at ±180°.
   */
  fullTurn?: boolean;
}

export type Manipulator = DistanceManipulator | AngleManipulator;

/** A command of its own, for a spec without a toolbar tool (a debug page's). */
export interface DialogCommand {
  id: string;
  label: string;
  icon: IconName;
  category: ToolCategory;
  /** Where search lists it: "Solid › Create". */
  group: string;
  hint: string;
}

export interface FeatureDialogSpec<I extends FeatureInputs = FeatureInputs>
  extends FeatureDefinition<I> {
  /** The command that opens the dialog: a toolbar tool's ID, or a command of its own. */
  command: ToolId | DialogCommand;
  fields: readonly DialogField[];
  /**
   * The feature's inputs from the values. Default: one input per shown
   * field, named like it (`ref`, `expr` with the field's unit and a model
   * parameter name, `enum`, `bool`). The framework adds the parameter names
   * to `expr` inputs that have none.
   */
  toInputs?(values: DialogValues, ctx: DialogContext): FeatureInputs;
  /**
   * The values of an existing feature (editing it). Default: the inputs
   * named like the fields; missing ones take the field's default.
   */
  fromInputs?(inputs: FeatureInputs, ctx: DialogContext): Partial<DialogValues>;
  /**
   * Values the spec proposes for the current ones (extrude: join when a
   * face is pulled out, cut when it is pushed in). Called on every change;
   * proposed values replace the current ones except in fields the user set
   * (`ctx.chosen`), before the draft is checked and previewed.
   */
  propose?(values: DialogValues, ctx: ProposeContext): Partial<DialogValues> | undefined;
  /** Checks beyond each field's own (pick counts, expressions): the first problem. */
  validate?(values: DialogValues, ctx: DialogContext): DialogIssue | undefined;
  /** In-canvas handles for expression fields, in world mm. */
  manipulators?(values: DialogValues, ctx: ManipulatorContext): readonly Manipulator[];
  /**
   * How bodies the draft makes or changes are drawn when its evaluator
   * gives no `previewTools` (a fillet): default `new`.
   */
  previewStyle?(values: DialogValues): PreviewToolStyle;
}

/** Defines a spec with its input type checked. */
export function defineFeatureDialog<I extends FeatureInputs>(
  spec: FeatureDialogSpec<I>,
): FeatureDialogSpec {
  return spec as unknown as FeatureDialogSpec;
}

/** The ID of a spec's command: its tool's, or its own. */
export function commandId(spec: Pick<FeatureDialogSpec, 'command'>): string {
  return typeof spec.command === 'string' ? spec.command : spec.command.id;
}
