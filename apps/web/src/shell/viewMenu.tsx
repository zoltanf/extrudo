/**
 * The shell's side of the right-click marking menu (P3-11, ADR-0042):
 * `useViewMenu` answers the view's request with the ring (the slot table of
 * the mode, matched with the commands offered now) and the overflow list
 * (`contextEntries`), after selecting what was under the pointer. Also the
 * "ring or list" preference and the Appearance popover that the list's
 * "Appearance…" opens at the menu.
 */
import type { BodyId, Feature, FeatureId, SelectionItem, SessionStore } from '@extrudo/core';
import { type ReactElement, useMemo, useState } from 'react';
import {
  MARKING_SLOTS_KEY,
  type MarkingOverrides,
  MODEL_SLOTS,
  resolveSlots,
  SKETCH_SLOTS,
} from '../commands/marking';
import { type MarkingSlot, Popover, ToolIcon } from '../design-system';
import type { Preferences } from '../platform/preferences';
import type { ViewportStore } from '../viewport/store';
import type { ViewMenu, ViewMenuRequest } from '../viewport/viewMenu';
import { AppearancePanel } from './BrowserPanel';
import type { BodyActions, BodyEntry } from './bodies';
import type { AppCommand } from './commands';
import { contextEntries } from './contextEntries';
import type { GroupActions } from './groupActions';

/** The preference: `true` (the default) draws the ring, `false` one plain list. */
export const MARKING_RADIAL_KEY = 'marking.radial';

/** The ring/list preference and its toggle (the command "Right-Click Menu: …"). */
export function useMarkingStyle(preferences: Preferences) {
  const [radial, setRadial] = useState(() => preferences.get<boolean>(MARKING_RADIAL_KEY, true));
  return {
    radial,
    toggle: () =>
      setRadial((on) => {
        preferences.set(MARKING_RADIAL_KEY, !on);
        return !on;
      }),
  };
}

/** The wedge assignments (the `marking.slots` preference, P4-12) and the ways to change them. */
export function useMarkingSlots(preferences: Preferences) {
  const [overrides, setOverrides] = useState<MarkingOverrides>(() => {
    const stored = preferences.get<MarkingOverrides | null>(MARKING_SLOTS_KEY, null);
    return stored && typeof stored === 'object' ? stored : {};
  });
  const write = (next: MarkingOverrides) => {
    preferences.set(MARKING_SLOTS_KEY, next);
    setOverrides(next);
  };
  return {
    overrides,
    /** Assigns `command` to wedge `index` of the mode; `null` gives the table's wedge back. */
    assign(mode: 'model' | 'sketch', index: number, command: string | null) {
      const list = Array.from({ length: 8 }, (_, i) => overrides[mode]?.[i] ?? null);
      list[index] = command;
      write({ ...overrides, [mode]: list.some((c) => c !== null) ? list : undefined });
    },
    resetAll(mode: 'model' | 'sketch') {
      write({ ...overrides, [mode]: undefined });
    },
  };
}

const sameItem = (a: SelectionItem, b: SelectionItem) => a.kind === b.kind && a.id === b.id;

/** What a right-click in sketch mode acts on: the item under the pointer (the session's hover). */
const SKETCH_KINDS: ReadonlySet<string> = new Set([
  'sketchEntity',
  'constraint',
  'dimension',
  'profile',
]);

export interface ViewMenuInput {
  mode: 'model' | 'sketch';
  session: SessionStore;
  viewport: ViewportStore;
  commands: readonly AppCommand[];
  bodies: readonly BodyEntry[];
  bodyActions: BodyActions;
  features: readonly Feature[];
  featureActions: {
    edit(id: FeatureId): boolean;
    setVisible(ids: readonly FeatureId[], visible: boolean): void;
    remove(id: FeatureId): void;
  };
  /** Grouping the timeline's picked chips, which the list offers as "Group…" (P4-09). */
  groupActions: GroupActions;
  /** The feature chips picked in the timeline (P3-17, P4-09). */
  pickedChips: readonly FeatureId[];
  /** The menu is offered: nothing else (a dialog, Measure, Create Sketch) owns the pointer. */
  enabled: boolean;
  radial: boolean;
  /** The user's wedge assignments (P4-12). */
  overrides?: MarkingOverrides;
  /** A sketch tool runs: its name and how to stop it. */
  runningTool?: { label: string; cancel(): void };
}

/**
 * The view's menu source (`undefined` while `enabled` is false: the view then
 * keeps its plain "Select other…") and the popover to render beside the view.
 */
export function useViewMenu(input: ViewMenuInput): {
  menu: ViewMenu | undefined;
  popover: ReactElement;
} {
  const [appearance, setAppearance] = useState<{ id: BodyId; at: { x: number; y: number } }>();
  const { enabled, mode, session, radial, commands, bodies, bodyActions, overrides } = input;
  const { viewport, features, featureActions, groupActions, pickedChips, runningTool } = input;

  const menu = useMemo<ViewMenu | undefined>(() => {
    if (!enabled) return undefined;
    return {
      open(request: ViewMenuRequest, at) {
        const state = session.getState();
        // A right-click selects what is under the pointer, unless it is selected already.
        const target =
          request.mode === 'model'
            ? request.top
            : state.hover && SKETCH_KINDS.has(state.hover.kind)
              ? state.hover
              : undefined;
        if (target && !state.selection.some((i) => sameItem(i, target))) {
          state.select([target], 'replace');
        }
        const specs = mode === 'sketch' ? SKETCH_SLOTS : MODEL_SLOTS;
        const slots = resolveSlots(specs, commands, overrides?.[mode]).map<MarkingSlot>((slot) => {
          const { command, spec } = slot;
          const tool = spec.icon;
          return {
            id: spec.command,
            label: slot.label,
            icon:
              command?.icon ??
              (tool ? <ToolIcon name={tool.name} category={tool.category} size={16} /> : undefined),
            ...(command?.keys[0] && { shortcut: command.keys[0] }),
            disabled: slot.disabled,
            ...(slot.hint && { hint: slot.hint }),
            onSelect: () => command?.run(),
          };
        });
        const entries = contextEntries({
          mode,
          selection: session.getState().selection,
          commands,
          bodies,
          bodyActions,
          features,
          featureActions,
          groupActions,
          pickedChips,
          viewport,
          clearSelection: () => session.getState().clearSelection(),
          appearance: (id) => setAppearance({ id, at }),
          ...(runningTool && { runningTool }),
        });
        return { radial, slots, entries };
      },
    };
  }, [
    enabled,
    mode,
    session,
    radial,
    overrides,
    commands,
    bodies,
    bodyActions,
    features,
    featureActions,
    groupActions,
    pickedChips,
    viewport,
    runningTool,
  ]);

  const body = appearance && bodies.find((b) => b.id === appearance.id);
  const popover = (
    <Popover
      anchorOnly
      open={body !== undefined}
      onOpenChange={(open) => {
        if (!open) setAppearance(undefined);
      }}
      side="right"
      label={body ? `${body.meta.name} appearance` : 'Appearance'}
      trigger={
        <span
          aria-hidden
          className="pointer-events-none fixed size-0"
          style={appearance ? { left: appearance.at.x, top: appearance.at.y } : undefined}
        />
      }
    >
      {body && <AppearancePanel body={body} actions={bodyActions} />}
    </Popover>
  );
  return { menu, popover };
}
