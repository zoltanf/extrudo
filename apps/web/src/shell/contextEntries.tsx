/**
 * The marking menu's overflow list (P3-11, FR-UX-03, ADR-0042): what is
 * selected (the right-click first selects what is under the pointer) decides
 * the extra entries. Pure over its input, so the rules are unit tested; the
 * entries reuse the commands (`buildCommands`), `BodyActions`,
 * `FeatureActions` and the viewport store, and add no logic of their own.
 *
 * Model: a face, edge or vertex (Sketch on Face, Section Here, Measure), its body (Hide,
 * Appearance, Export, Delete), a sketch curve or profile (Edit Sketch,
 * Hide Sketch); empty space (Fit, Home View, projection, Redo, Show All
 * Bodies), a construction plane, axis or point (Edit, Hide/Show, Delete;
 * they are picked by their feature's ID, P3-05). Sketch mode: a tool that runs (Cancel), selected geometry,
 * constraints and dimensions (Delete), Look At Sketch, Redo, Repeat.
 */
import {
  type BodyId,
  bodyDisplay,
  type Feature,
  type FeatureId,
  isConstructionType,
  isFeatureVisible,
  parseProfileRefId,
  parseSketchEntityRefId,
  type SelectionItem,
} from '@extrudo/core';
import {
  ArrowDownToLine,
  Boxes,
  CirclePlay,
  Eraser,
  Eye,
  EyeDashed,
  EyeOff,
  FileDown,
  Folder,
  House,
  Maximize,
  Palette,
  Pencil,
  Redo2,
  Repeat2,
  Ruler,
  ScanEye,
  ScissorsLineDashed,
  SquareDashedMousePointer,
  Trash2,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { keysFor } from '../commands/keymap';
import type { MarkingEntry } from '../design-system';
import { readTopology } from '../selection/items';
import type { ViewportStore } from '../viewport/store';
import type { BodyActions, BodyEntry } from './bodies';
import type { AppCommand } from './commands';
import type { GroupActions } from './groupActions';

export interface ContextInput {
  mode: 'model' | 'sketch';
  /** The session's selection, after the right-click selected what was under the pointer. */
  selection: readonly SelectionItem[];
  /** The commands offered now (`buildCommands`). */
  commands: readonly AppCommand[];
  bodies: readonly BodyEntry[];
  bodyActions: BodyActions;
  features: readonly Feature[];
  featureActions: {
    edit(id: FeatureId): boolean;
    setVisible(ids: readonly FeatureId[], visible: boolean): void;
    remove(id: FeatureId): void;
  };
  /** Grouping the timeline's picked chips, which the list offers as "Group" (P4-09). */
  groupActions: GroupActions;
  /** The feature chips picked in the timeline (P3-17): two or more can be grouped. */
  pickedChips: readonly FeatureId[];
  viewport: ViewportStore;
  clearSelection(): void;
  /** Opens the appearance popover of a body at the menu. */
  appearance(id: BodyId): void;
  /** A sketch tool runs: its name and how to stop it. */
  runningTool?: { label: string; cancel(): void };
}

const icon = (node: ReactNode) => node;
const small = { size: 14 } as const;

/** The overflow entries for this selection, in groups (a group's first entry has a separator). */
export function contextEntries(input: ContextInput): MarkingEntry[] {
  const groups = input.mode === 'sketch' ? sketchGroups(input) : modelGroups(input);
  const out: MarkingEntry[] = [];
  for (const group of groups) {
    group.forEach((entry, i) => {
      out.push(i === 0 && out.length > 0 ? { ...entry, separatorBefore: true } : entry);
    });
  }
  return out;
}

/** A command as an entry: runs the command; dimmed while it isn't offered or can't run. */
function commandEntry(
  input: ContextInput,
  id: string,
  label: string,
  extra: Partial<MarkingEntry> = {},
): MarkingEntry {
  const command = input.commands.find((c) => c.id === id);
  const disabled = !command || command.unavailable !== undefined;
  const key = command?.keys[0];
  return {
    id,
    label,
    disabled,
    ...(command?.unavailable && { hint: command.unavailable }),
    ...(key && { shortcut: shortcutName(key) }),
    onSelect: () => command?.run(),
    ...extra,
  };
}

/** "Mod+Z" as the menus write it. */
function shortcutName(key: string): string {
  return key.replace('Mod+', 'Ctrl+').replace('Delete', 'Del');
}

function viewGroup(input: ContextInput): MarkingEntry[] {
  const { viewport } = input;
  const state = () => viewport.getState();
  const orthographic = state().projection === 'orthographic';
  return [
    {
      id: 'fit',
      label: 'Fit',
      icon: icon(<Maximize {...small} />),
      shortcut: shortcutName(keysFor('fit')[0] ?? ''),
      onSelect: () => state().fit(),
    },
    {
      id: 'home',
      label: 'Home View',
      icon: icon(<House {...small} />),
      shortcut: shortcutName(keysFor('viewHome')[0] ?? ''),
      onSelect: () => state().home(),
    },
    {
      id: 'projection',
      label: orthographic ? 'Perspective' : 'Orthographic',
      onSelect: () => state().setProjection(orthographic ? 'perspective' : 'orthographic'),
    },
  ];
}

function redoEntry(input: ContextInput): MarkingEntry {
  return commandEntry(input, 'redo', 'Redo', { icon: icon(<Redo2 {...small} />) });
}

function clearEntry(input: ContextInput): MarkingEntry {
  return {
    id: 'clearSelection',
    label: 'Clear Selection',
    icon: icon(<Eraser {...small} />),
    shortcut: 'Esc',
    onSelect: input.clearSelection,
  };
}

/** The sketch features that the selected curves and profiles belong to, in selection order. */
function sketchesIn(selection: readonly SelectionItem[]): FeatureId[] {
  const out: FeatureId[] = [];
  for (const item of selection) {
    const ref =
      item.kind === 'profile'
        ? parseProfileRefId(item.id)
        : item.kind === 'sketchEntity'
          ? parseSketchEntityRefId(item.id)
          : undefined;
    if (ref && !out.includes(ref.feature)) out.push(ref.feature);
  }
  return out;
}

/** The bodies that the selection touches: a body itself, or a face, edge or vertex of one. */
function bodiesIn(selection: readonly SelectionItem[]): BodyId[] {
  const out: BodyId[] = [];
  for (const item of selection) {
    const topology = readTopology(item);
    if (topology && !out.includes(topology.body)) out.push(topology.body);
  }
  return out;
}

function modelGroups(input: ContextInput): MarkingEntry[][] {
  const { selection, bodies, bodyActions } = input;
  const groups: MarkingEntry[][] = [];
  const topology = selection.map(readTopology).filter((t) => t !== undefined);
  const bodyIds = bodiesIn(selection);
  const entries = bodies.filter((b) => bodyIds.includes(b.id));

  // Two or more chips picked in the timeline: they can be grouped (P4-09, ADR-0065 §2).
  if (input.pickedChips.length > 1) {
    groups.push([
      {
        id: 'group',
        label: `Group ${input.pickedChips.length} features`,
        icon: icon(<Folder {...small} />),
        onSelect: () => input.groupActions.group(input.pickedChips),
      },
    ]);
  }

  const geometry: MarkingEntry[] = [];
  const faces = topology.filter((t) => t.kind === 'face');
  if (faces.length === 1 && selection.length === 1) {
    // "Create Sketch" starts on a flat face selected beforehand (P2-09).
    geometry.push(
      commandEntry(input, 'sketch', 'Sketch on Face', {
        id: 'sketchOnFace',
        icon: icon(<SquareDashedMousePointer {...small} />),
      }),
    );
  }
  if (faces.length === 1 && selection.length === 1) {
    // Section Analysis cuts the view at a flat face selected beforehand (P3-09).
    geometry.push(
      commandEntry(input, 'section', 'Section Here', {
        id: 'sectionHere',
        icon: icon(<ScissorsLineDashed {...small} />),
      }),
    );
  }
  if (faces.length === 1 && selection.length === 1) {
    // Place on Bed turns the face's body so the face lies on the bed (P3-10).
    geometry.push(
      commandEntry(input, 'placeOnBed', 'Place on Bed', {
        icon: icon(<ArrowDownToLine {...small} />),
      }),
    );
  }
  if (topology.length > 0) {
    geometry.push(commandEntry(input, 'measure', 'Measure', { icon: icon(<Ruler {...small} />) }));
  }
  if (geometry.length > 0) groups.push(geometry);

  if (entries.length > 0) {
    const plural = entries.length > 1;
    const noun = plural ? 'Bodies' : 'Body';
    const ids = entries.map((b) => b.id);
    // The display states the picked bodies are not all in: one state offers the
    // other two, and a mixed selection offers all three (ADR-0030's amendment).
    const displays = new Set(entries.map((b) => bodyDisplay(b.meta)));
    const offer = (display: 'shown' | 'ghost' | 'hidden') =>
      displays.size > 1 || !displays.has(display);
    const body: MarkingEntry[] = [];
    if (offer('shown')) {
      body.push({
        id: 'showBody',
        label: `Show ${noun}`,
        icon: icon(<Eye {...small} />),
        onSelect: () => bodyActions.setDisplay(ids, 'shown'),
      });
    }
    if (offer('ghost')) {
      body.push({
        id: 'ghostBody',
        label: 'Show as Ghost',
        icon: icon(<EyeDashed {...small} />),
        onSelect: () => bodyActions.setDisplay(ids, 'ghost'),
      });
    }
    if (offer('hidden')) {
      body.push({
        id: 'hideBody',
        label: `Hide ${noun}`,
        icon: icon(<EyeOff {...small} />),
        onSelect: () => bodyActions.setDisplay(ids, 'hidden'),
      });
    }
    const single = entries.length === 1 ? entries[0] : undefined;
    if (single) {
      body.push({
        id: 'appearance',
        label: 'Appearance…',
        icon: icon(<Palette {...small} />),
        onSelect: () => input.appearance(single.id),
      });
    }
    if (bodyActions.exportBodies) {
      body.push({
        id: 'exportBodies',
        label: 'Export…',
        icon: icon(<FileDown {...small} />),
        onSelect: () => bodyActions.exportBodies?.(ids),
      });
    }
    body.push(
      commandEntry(input, 'newComponent', 'New Component…', { icon: icon(<Boxes {...small} />) }),
    );
    if (selection.some((i) => i.kind === 'body')) {
      body.push(commandEntry(input, 'delete', 'Delete', { icon: icon(<Trash2 {...small} />) }));
    }
    groups.push(body);
  }

  const sketchIds = sketchesIn(selection);
  const sketches = input.features.filter((f) => sketchIds.includes(f.id));
  const first = sketches[0];
  if (first) {
    const hide = sketches.some(isFeatureVisible);
    groups.push([
      ...(sketches.length === 1
        ? [
            {
              id: 'editSketch',
              label: 'Edit Sketch',
              icon: icon(<Pencil {...small} />),
              onSelect: () => {
                input.featureActions.edit(first.id);
              },
            },
          ]
        : []),
      {
        id: hide ? 'hideSketch' : 'showSketch',
        label: `${hide ? 'Hide' : 'Show'} ${sketches.length > 1 ? 'Sketches' : 'Sketch'}`,
        icon: icon(hide ? <EyeOff {...small} /> : <Eye {...small} />),
        onSelect: () =>
          input.featureActions.setVisible(
            sketches.map((s) => s.id),
            !hide,
          ),
      },
    ]);
  }

  const constructions = input.features.filter(
    (f) =>
      isConstructionType(f.type) &&
      selection.some(
        (i) => (i.kind === 'plane' || i.kind === 'axis' || i.kind === 'point') && i.id === f.id,
      ),
  );
  const construction = constructions[0];
  if (construction) {
    const hide = constructions.some(isFeatureVisible);
    const noun =
      constructions.length > 1
        ? 'Construction'
        : (selection.find((i) => i.id === construction.id)?.kind ?? 'plane').replace(/^./, (c) =>
            c.toUpperCase(),
          );
    groups.push([
      ...(constructions.length === 1
        ? [
            {
              id: 'editConstruction',
              label: `Edit ${noun}`,
              icon: icon(<Pencil {...small} />),
              onSelect: () => {
                input.featureActions.edit(construction.id);
              },
            },
          ]
        : []),
      {
        id: hide ? 'hideConstruction' : 'showConstruction',
        label: `${hide ? 'Hide' : 'Show'} ${noun}`,
        icon: icon(hide ? <EyeOff {...small} /> : <Eye {...small} />),
        onSelect: () =>
          input.featureActions.setVisible(
            constructions.map((c) => c.id),
            !hide,
          ),
      },
      ...(constructions.length === 1
        ? [
            {
              id: 'deleteConstruction',
              label: `Delete ${noun}`,
              icon: icon(<Trash2 {...small} />),
              onSelect: () => input.featureActions.remove(construction.id),
            },
          ]
        : []),
    ]);
  }

  const view = viewGroup(input);
  if (selection.length > 0 && input.commands.some((c) => c.id === 'lookAtSelection')) {
    view.unshift(
      commandEntry(input, 'lookAtSelection', 'Look at Selection', {
        icon: icon(<ScanEye {...small} />),
      }),
    );
  }
  const hidden = bodies.filter((b) => !b.meta.visible);
  if (hidden.length > 0 && entries.every((b) => b.meta.visible)) {
    view.push({
      id: 'showAllBodies',
      label: 'Show All Bodies',
      icon: icon(<CirclePlay {...small} />),
      onSelect: () =>
        bodyActions.setVisible(
          hidden.map((b) => b.id),
          true,
        ),
    });
  }
  groups.push(view);
  const edit: MarkingEntry[] = [redoEntry(input)];
  if (selection.length > 0) edit.push(clearEntry(input));
  groups.push(edit);
  return groups;
}

function sketchGroups(input: ContextInput): MarkingEntry[][] {
  const { selection } = input;
  const groups: MarkingEntry[][] = [];
  if (input.runningTool) {
    const { label, cancel } = input.runningTool;
    groups.push([
      {
        id: 'cancelTool',
        label: `Cancel ${label}`,
        icon: icon(<X {...small} />),
        shortcut: 'Esc',
        onSelect: cancel,
      },
    ]);
  }
  // The sketch's own items only: curves and points, constraints, dimensions.
  const inSketch = selection.filter(
    (i) =>
      (i.kind === 'sketchEntity' && !i.id.includes('/')) ||
      i.kind === 'constraint' ||
      i.kind === 'dimension',
  );
  if (inSketch.length > 0 && !input.runningTool) {
    const kinds = new Set(inSketch.map((i) => i.kind));
    const only = kinds.size === 1 ? [...kinds][0] : undefined;
    const noun =
      only === 'constraint'
        ? inSketch.length > 1
          ? 'Constraints'
          : 'Constraint'
        : only === 'dimension'
          ? inSketch.length > 1
            ? 'Dimensions'
            : 'Dimension'
          : '';
    groups.push([
      commandEntry(input, 'delete', noun ? `Delete ${noun}` : 'Delete', {
        icon: icon(<Trash2 {...small} />),
      }),
      clearEntry(input),
    ]);
  }
  const lookAt: MarkingEntry[] = [];
  if (input.commands.some((c) => c.id === 'lookAtSketch')) {
    lookAt.push(
      commandEntry(input, 'lookAtSketch', 'Look At Sketch', { icon: icon(<ScanEye {...small} />) }),
    );
  }
  lookAt.push(...viewGroup(input).slice(0, 1));
  groups.push(lookAt);
  const edit: MarkingEntry[] = [redoEntry(input)];
  const repeat = input.commands.find((c) => c.id === 'repeatLast');
  if (repeat) {
    edit.push(
      commandEntry(input, 'repeatLast', repeat.label, { icon: icon(<Repeat2 {...small} />) }),
    );
  }
  groups.push(edit);
  return groups;
}
