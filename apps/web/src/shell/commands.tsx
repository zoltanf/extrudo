/**
 * The shell's commands (P1-14, ADR-0023): every tool on the tabs shown in
 * the current mode plus edit, view, panel, file and theme commands, each
 * with its keys from the keymap. The same list drives the shortcuts, the
 * Ctrl+K palette and the S toolbox, so a command found in search runs the
 * same way as its key.
 */
import {
  Bell,
  Box,
  FilePlus2,
  History,
  House,
  Import,
  Maximize,
  Moon,
  PanelBottom,
  PanelLeft,
  Redo2,
  Save,
  ScanEye,
  Sun,
  SunMoon,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { keysFor } from '../commands/keymap';
import type { Searchable } from '../commands/search';
import type { Shortcut } from '../commands/shortcuts';
import { type ThemeChoice, ToolIcon } from '../design-system';
import type { ViewportStore } from '../viewport/store';
import { FACES, type FaceName } from '../viewport/viewcube';
import type { FileActions } from './AppBar';
import { TOOLS, type Tool, type ToolId, visibleTabs } from './tools';

export interface AppCommand extends Searchable {
  /** A tool ID, or a keymap ID such as `undo` or `viewTop`. */
  id: string;
  label: string;
  /** A tile's label when `label` is too long (the toolbox's pins). */
  short?: string;
  /** Where it lives, shown beside it in search results: "Sketch › Create". */
  group: string;
  icon?: ReactNode;
  keys: readonly string[];
  /** Says why it can't run yet ("Arrives with P2-06."); running it says so too. */
  unavailable?: string;
  run(): void;
}

export interface CommandContext {
  mode: 'model' | 'sketch';
  /** Starts a tool (a sketch tool restarts if it's running; the toolbar toggles instead). */
  runTool(id: ToolId): void;
  notify(tone: 'info' | 'error', text: string): void;
  undo(): void;
  redo(): void;
  /** Deletes the selection; absent while nothing can be deleted (no sketch, a tool runs). */
  remove?: () => void;
  /** The construction toggle (UI spec §4); absent outside a sketch. */
  construction?: { on: boolean; toggle(): void };
  lookAtSketch?: () => void;
  viewport: ViewportStore;
  browser: { collapsed: boolean; toggle(): void };
  timeline: { collapsed: boolean; toggle(): void };
  file: FileActions;
  /** The notification history (P3-16): absent where there are no toasts to open it from. */
  notifications?: { open(): void };
  theme: { choice: ThemeChoice; set(choice: ThemeChoice): void };
  /**
   * Tools that work because a feature dialog is registered for them
   * (P2-05), even while `shell/tools.ts` still names the task that brings them.
   */
  ready?: ReadonlySet<string>;
  /** Commands of feature dialogs without a toolbar tool (a debug page's), in model mode. */
  dialogCommands?: readonly AppCommand[];
}

const icon = (Icon: typeof Box) => <Icon size={16} strokeWidth={1.75} />;

const VIEWS: { id: string; face?: FaceName; label: string }[] = [
  { id: 'viewHome', label: 'Home View' },
  { id: 'viewTop', face: 'Top', label: 'Top View' },
  { id: 'viewBottom', face: 'Bottom', label: 'Bottom View' },
  { id: 'viewFront', face: 'Front', label: 'Front View' },
  { id: 'viewBack', face: 'Back', label: 'Back View' },
  { id: 'viewLeft', face: 'Left', label: 'Left View' },
  { id: 'viewRight', face: 'Right', label: 'Right View' },
];

function toolCommand(id: ToolId, group: string, ctx: CommandContext): AppCommand {
  const tool: Tool = TOOLS[id];
  const unavailable = !isToolReady(tool, ctx.ready) && `Arrives with ${tool.comesWith}.`;
  return {
    id,
    label: tool.label,
    ...(tool.short && { short: tool.short }),
    group,
    keywords: `${group} ${tool.hint}`,
    icon: <ToolIcon name={tool.icon} category={tool.category} size={16} />,
    keys: keysFor(id),
    ...(unavailable && { unavailable }),
    run: unavailable
      ? () => ctx.notify('info', `${tool.label} arrives with ${tool.comesWith}.`)
      : () => ctx.runTool(id),
  };
}

/** The commands offered in this context, in the order an empty search lists them. */
export function buildCommands(ctx: CommandContext): AppCommand[] {
  const out: AppCommand[] = [];
  const seen = new Set<string>();
  const add = (command: AppCommand) => {
    if (seen.has(command.id)) return;
    seen.add(command.id);
    out.push(command);
  };
  const plain = (
    id: string,
    label: string,
    group: string,
    run: () => void,
    extra: Partial<AppCommand> = {},
  ) => add({ id, label, group, keys: keysFor(id), run, keywords: group, ...extra });

  for (const tab of visibleTabs(ctx.mode)) {
    for (const group of tab.groups) {
      for (const id of [...group.tools, ...(group.more ?? [])]) {
        add(toolCommand(id, `${tab.label} › ${group.label}`, ctx));
      }
    }
    if (tab.id === 'sketch') {
      add(toolCommand('finishSketch', 'Sketch › Finish', ctx));
      if (ctx.construction) {
        const { on, toggle } = ctx.construction;
        plain('construction', 'Construction', 'Sketch', toggle, {
          icon: <ToolIcon name="line" category="sketch" size={16} />,
          keywords: `Sketch construction geometry dashed ${on ? 'on' : 'off'}`,
        });
      }
      if (ctx.lookAtSketch) {
        plain('lookAtSketch', 'Look At Sketch', 'Sketch', ctx.lookAtSketch, {
          icon: icon(ScanEye),
          keywords: 'Sketch view plane normal',
        });
      }
    }
  }
  if (ctx.mode === 'model') for (const command of ctx.dialogCommands ?? []) add(command);
  plain('undo', 'Undo', 'Edit', ctx.undo, { icon: icon(Undo2) });
  plain('redo', 'Redo', 'Edit', ctx.redo, { icon: icon(Redo2) });
  if (ctx.remove) plain('delete', 'Delete', 'Edit', ctx.remove, { icon: icon(Trash2) });

  const view = () => ctx.viewport.getState();
  plain('fit', 'Fit', 'View', () => view().fit(), {
    icon: icon(Maximize),
    keywords: 'View zoom all extents',
  });
  for (const v of VIEWS) {
    const face = FACES.find((f) => f.name === v.face);
    plain(v.id, v.label, 'View', face ? () => view().lookFrom(face.normal) : () => view().home(), {
      icon: icon(face ? Box : House),
      keywords: 'View standard orientation camera',
    });
  }
  plain(
    'toggleBrowser',
    ctx.browser.collapsed ? 'Show Browser' : 'Hide Browser',
    'Panels',
    ctx.browser.toggle,
    { icon: icon(PanelLeft), keywords: 'Panels browser tree' },
  );
  plain(
    'toggleTimeline',
    ctx.timeline.collapsed ? 'Show Timeline' : 'Hide Timeline',
    'Panels',
    ctx.timeline.toggle,
    { icon: icon(PanelBottom), keywords: 'Panels timeline history' },
  );
  if (ctx.notifications) {
    plain('notificationHistory', 'Notification History', 'Panels', ctx.notifications.open, {
      icon: icon(Bell),
      keywords: 'Panels notifications messages toasts errors log earlier',
    });
  }

  plain('newDesign', 'New Design', 'File', ctx.file.newDesign, { icon: icon(FilePlus2) });
  plain('allDesigns', 'All Designs', 'File', ctx.file.home, {
    icon: icon(House),
    keywords: 'File home projects open',
  });
  if (ctx.file.saveVersion) {
    plain('saveVersion', 'Save Version…', 'File', ctx.file.saveVersion, {
      icon: icon(Save),
      keywords: 'File save version snapshot history checkpoint',
    });
  }
  if (ctx.file.versionHistory) {
    plain('versionHistory', 'Version History…', 'File', ctx.file.versionHistory, {
      icon: icon(History),
      keywords: 'File versions restore revert history',
    });
  }
  plain('exportProject', 'Export .extrudo', 'File', ctx.file.exportFile, {
    icon: icon(Upload),
    keywords: 'File download save project backup',
  });
  plain('importProject', 'Import .extrudo…', 'File', ctx.file.importFile, {
    icon: icon(Import),
    keywords: 'File open upload project',
  });

  const themes: [ThemeChoice, string, typeof Box][] = [
    ['dark', 'Dark Theme', Moon],
    ['light', 'Light Theme', Sun],
    ['system', 'Match System Theme', SunMoon],
  ];
  for (const [choice, label, Icon] of themes) {
    if (choice !== ctx.theme.choice) {
      plain(`theme-${choice}`, label, 'Theme', () => ctx.theme.set(choice), {
        icon: icon(Icon),
        keywords: 'Theme colours appearance',
      });
    }
  }
  return out;
}

/** Whether a tool runs: built, or made ready by a registered feature dialog (P2-05). */
export function isToolReady(tool: Pick<Tool, 'id' | 'comesWith'>, ready?: ReadonlySet<string>) {
  return tool.comesWith === undefined || (ready?.has(tool.id) ?? false);
}

/** One shortcut per key of every command that has keys. */
export function commandShortcuts(commands: readonly AppCommand[]): Shortcut[] {
  return commands.flatMap((command) => command.keys.map((keys) => ({ keys, run: command.run })));
}
